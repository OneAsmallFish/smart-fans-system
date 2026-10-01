/*
 * mqtt_client_wrapper.c — MQTT 3.1.1 客户端封装
 *
 * 功能:
 *   - LWT 遗嘱消息（status="offline"，payload 与协议 §1.2 逐字段对齐）
 *   - QoS 0/1 发布/订阅；订阅在 CONNECTED 事件中执行（缓存 topic，FW-03）
 *   - WiFi 断开时离线消息队列（NVS 环形 key 复用，最多 50 条，FW-06/FW-07）
 *   - 重连时批量补发：topic 加 /buffered 后缀、payload 加 buffered:true（ADJ-12）
 *   - 分片大数据重组（FW-34）
 *
 * ⚠️ 陷阱规避:
 *   - 始终用 cJSON 构造/解析 JSON（不用 sscanf）
 *   - 不在 MQTT 事件处理器内调用 vTaskDelay
 *   - 不硬编码 Broker 地址
 */
#include "mqtt_client_wrapper.h"
#include "esp_check.h"
#include "mqtt_client.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "freertos/semphr.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <time.h>

static const char *TAG = "MQTT";

#define NVS_NS           "fan_mqtt"
#define NVS_KEY_BROKER   "broker_url"
#define NVS_KEY_Q_HEAD   "q_head"
#define NVS_KEY_Q_COUNT  "q_count"
#define MAX_TOPIC_LEN    128
#define MAX_PAYLOAD_LEN  512
#define SENSOR_THROTTLE_S 30   /* 离线时 sensor/fan 类消息最小入队间隔（协议 §10） */

/* Offline message entry stored in NVS */
typedef struct {
    char topic[MAX_TOPIC_LEN];
    char payload[MAX_PAYLOAD_LEN];
    int  qos;
} offline_msg_t;

static esp_mqtt_client_handle_t  s_client        = NULL;
static bool                      s_connected     = false;
static mqtt_message_cb_t         s_msg_cb        = NULL;
static mqtt_connected_cb_t       s_connected_cb  = NULL;
static SemaphoreHandle_t         s_queue_mutex   = NULL;
static char                      s_device_id[16] = "esp32-unknown";
static char                      s_fw_version[32] = "unknown";
static char                      s_ip_address[16] = "";

/* Cached subscriptions (FW-03: 连接建立后才真正下发) */
static char s_sub_topics[MQTT_MAX_SUBSCRIPTIONS][MAX_TOPIC_LEN];
static int  s_sub_count = 0;

/* ---- LWT topic helper ---- */
static void build_lwt_topic(char *buf, size_t len)
{
    snprintf(buf, len, "%s/%s/status", MQTT_TOPIC_PREFIX, s_device_id);
}

const char *mqtt_client_get_device_id(void) { return s_device_id; }

void mqtt_client_set_status_info(const char *fw_version, const char *ip_address)
{
    if (fw_version)
        strncpy(s_fw_version, fw_version, sizeof(s_fw_version) - 1);
    if (ip_address)
        strncpy(s_ip_address, ip_address, sizeof(s_ip_address) - 1);
}

/* ---- Offline queue (NVS, 环形 key 复用，FW-06/FW-07) ----
 * 固定 MQTT_OFFLINE_QUEUE_SIZE 个 key（q_0..q_49）轮转：
 * q_head = 最旧条目位置，q_count = 当前条数。
 * push 写 (head+count)%N；flush 从 head 逐条读发并逐 key 删除，
 * 绝不整 namespace 擦除（broker_url 与队列共用本 namespace）。 */

static void queue_get_meta(nvs_handle_t nvs, uint8_t *head, uint8_t *count)
{
    *head = 0; *count = 0;
    nvs_get_u8(nvs, NVS_KEY_Q_HEAD,  head);
    nvs_get_u8(nvs, NVS_KEY_Q_COUNT, count);
}

static void queue_set_meta(nvs_handle_t nvs, uint8_t head, uint8_t count)
{
    nvs_set_u8(nvs, NVS_KEY_Q_HEAD,  head);
    nvs_set_u8(nvs, NVS_KEY_Q_COUNT, count);
    nvs_commit(nvs);
}

static void offline_queue_push(const char *topic, const char *payload, int qos)
{
    /* 互斥保护 push/flush 并发（FW-07①）；调用方可能来自多个任务 */
    xSemaphoreTake(s_queue_mutex, portMAX_DELAY);

    /* FW-07③: 离线时 sensor/fan 类遥测降频（30s 一条，协议 §10） */
    static time_t s_last_telemetry_enq = 0;
    bool is_telemetry = (strstr(topic, "/sensor/") != NULL) ||
                        (strstr(topic, "/fan/")   != NULL);
    if (is_telemetry) {
        time_t now = time(NULL);
        if (now - s_last_telemetry_enq < SENSOR_THROTTLE_S) {
            xSemaphoreGive(s_queue_mutex);
            return;   /* 丢弃本次遥测（告警消息不受此限制） */
        }
        s_last_telemetry_enq = now;
    }

    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) != ESP_OK) {
        xSemaphoreGive(s_queue_mutex);
        return;
    }

    uint8_t head, count;
    queue_get_meta(nvs, &head, &count);

    if (count >= MQTT_OFFLINE_QUEUE_SIZE) {
        /* 队列满：淘汰最旧一条（head 前移，key 直接复用，无搬移写放大） */
        char key[16];
        snprintf(key, sizeof(key), "q_%u", head % MQTT_OFFLINE_QUEUE_SIZE);
        nvs_erase_key(nvs, key);
        head = (head + 1) % MQTT_OFFLINE_QUEUE_SIZE;
        count--;
    }

    offline_msg_t msg;
    memset(&msg, 0, sizeof(msg));
    strncpy(msg.topic,   topic,   sizeof(msg.topic)   - 1);
    strncpy(msg.payload, payload, sizeof(msg.payload) - 1);
    msg.qos = qos;

    char key[16];
    snprintf(key, sizeof(key), "q_%u",
             (uint8_t)((head + count) % MQTT_OFFLINE_QUEUE_SIZE));
    nvs_set_blob(nvs, key, &msg, sizeof(msg));
    queue_set_meta(nvs, head, count + 1);
    nvs_close(nvs);
    ESP_LOGD(TAG, "Offline queue: pushed (%u/%u)", count + 1,
             MQTT_OFFLINE_QUEUE_SIZE);
    xSemaphoreGive(s_queue_mutex);
}

/* FW-07④ + ADJ-12: 补发时 topic 加 /buffered、payload 加 buffered:true */
static void flush_one(const offline_msg_t *msg)
{
    char topic[MAX_TOPIC_LEN + 16];
    snprintf(topic, sizeof(topic), "%s/buffered", msg->topic);

    char *payload = NULL;
    cJSON *root = cJSON_Parse(msg->payload);
    if (root) {
        cJSON_AddBoolToObject(root, "buffered", true);
        payload = cJSON_PrintUnformatted(root);
        cJSON_Delete(root);
    }
    const char *body = payload ? payload : msg->payload;

    esp_mqtt_client_publish(s_client, topic, body, (int)strlen(body),
                            msg->qos, 0);
    free(payload);
}

static void offline_queue_flush(void)
{
    xSemaphoreTake(s_queue_mutex, portMAX_DELAY);

    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) != ESP_OK) {
        xSemaphoreGive(s_queue_mutex);
        return;
    }

    uint8_t head, count;
    queue_get_meta(nvs, &head, &count);
    ESP_LOGI(TAG, "Flushing %u offline messages", count);

    for (uint8_t i = 0; i < count; i++) {
        char key[16];
        snprintf(key, sizeof(key), "q_%u",
                 (uint8_t)((head + i) % MQTT_OFFLINE_QUEUE_SIZE));
        offline_msg_t msg;
        size_t sz = sizeof(msg);
        if (nvs_get_blob(nvs, key, &msg, &sz) == ESP_OK) {
            flush_one(&msg);
        }
        /* 逐 key 删除（严禁整 namespace 擦除 —— broker_url 共用本 namespace，FW-06） */
        nvs_erase_key(nvs, key);
    }
    queue_set_meta(nvs, (uint8_t)((head + count) % MQTT_OFFLINE_QUEUE_SIZE), 0);
    nvs_close(nvs);
    xSemaphoreGive(s_queue_mutex);
}

/* ---- 分片消息重组（FW-34） ---- */
static void dispatch_message(const char *topic, int topic_len,
                             const char *data, int data_len)
{
    if (s_msg_cb && topic && data) {
        s_msg_cb(topic, topic_len, data, data_len);
    }
}

static void handle_event_data(esp_mqtt_event_handle_t event)
{
    /* 大 payload 分片到达：current_data_offset / total_data_len */
    if (event->current_data_offset == 0 && event->data_len == event->total_data_len) {
        dispatch_message(event->topic, event->topic_len, event->data, event->data_len);
        return;
    }

    /* 分片路径：静态重组缓冲（MQTT_BUFFER_SIZE=4096，单消息足够） */
    static char reasm[4096];
    static int  reasm_len = 0;
    static char reasm_topic[128];
    static int  reasm_topic_len = 0;

    if (event->current_data_offset == 0) {
        reasm_len = 0;
        reasm_topic_len = event->topic_len < (int)sizeof(reasm_topic) - 1
                          ? event->topic_len : (int)sizeof(reasm_topic) - 1;
        memcpy(reasm_topic, event->topic, reasm_topic_len);
        reasm_topic[reasm_topic_len] = '\0';
    }
    int room = (int)sizeof(reasm) - 1 - reasm_len;
    int copy = event->data_len < room ? event->data_len : room;
    memcpy(reasm + reasm_len, event->data, copy);
    reasm_len += copy;

    if (event->current_data_offset + event->data_len >= event->total_data_len) {
        reasm[reasm_len] = '\0';
        dispatch_message(reasm_topic, reasm_topic_len, reasm, reasm_len);
        reasm_len = 0;
    }
}

/* ---- MQTT event handler ---- */
static void mqtt_event_handler(void *arg, esp_event_base_t base,
                                int32_t event_id, void *event_data)
{
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT connected");
            s_connected = true;

            /* FW-03: 订阅在连接建立路径执行（此前缓存的 topic 全部下发） */
            for (int i = 0; i < s_sub_count; i++) {
                esp_mqtt_client_subscribe(s_client, s_sub_topics[i], 1);
                ESP_LOGI(TAG, "Subscribed: %s", s_sub_topics[i]);
            }

            /* FW-14: online 报文按协议 §1.1 逐字段对齐 */
            {
                char topic[64];
                build_lwt_topic(topic, sizeof(topic));
                cJSON *root = cJSON_CreateObject();
                cJSON_AddNumberToObject(root, "timestamp",       (double)time(NULL));
                cJSON_AddStringToObject(root, "device_id",       s_device_id);
                cJSON_AddStringToObject(root, "status",          "online");
                cJSON_AddStringToObject(root, "firmware_version", s_fw_version);
                cJSON_AddStringToObject(root, "ip_address",      s_ip_address);
                cJSON_AddNumberToObject(root, "uptime_seconds",
                                        (double)(esp_timer_get_time() / 1000000LL));
                char *js = cJSON_PrintUnformatted(root);
                if (js) {
                    esp_mqtt_client_publish(s_client, topic, js, 0, 1, 1 /* retain */);
                    free(js);
                }
                cJSON_Delete(root);
            }

            /* Flush offline queue — ⚠️ NOT in event handler directly, use timer */
            {
                TimerHandle_t flush_t = xTimerCreate("mqtt_flush", pdMS_TO_TICKS(200),
                                                      pdFALSE, NULL,
                                                      (void(*)(TimerHandle_t))offline_queue_flush);
                xTimerStart(flush_t, 0);
            }

            /* FW-08: 连接建立即确认 OTA（pending-verify 分区防回滚） */
            if (s_connected_cb) s_connected_cb();
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "MQTT disconnected");
            s_connected = false;
            break;

        case MQTT_EVENT_DATA:
            handle_event_data(event);
            break;

        case MQTT_EVENT_ERROR:
            ESP_LOGW(TAG, "MQTT error, type=%d",
                     event->error_handle->error_type);
            break;

        default: break;
    }
}

/* ---- Public API ---- */
esp_err_t mqtt_client_init(void)
{
    s_queue_mutex = xSemaphoreCreateMutex();
    if (!s_queue_mutex) return ESP_ERR_NO_MEM;

    /* Derive device_id from MAC */
    uint8_t mac[6];
    esp_base_mac_addr_get(mac);
    snprintf(s_device_id, sizeof(s_device_id), "esp32-%02x%02x%02x",
             mac[3], mac[4], mac[5]);

    ESP_LOGI(TAG, "MQTT client init OK, device_id=%s", s_device_id);
    return ESP_OK;
}

esp_err_t mqtt_client_connect(const char *broker_url)
{
    if (!broker_url || broker_url[0] == '\0') {
        /* Try to load from NVS */
        static char stored[128] = {0};
        nvs_handle_t nvs;
        if (nvs_open(NVS_NS, NVS_READONLY, &nvs) == ESP_OK) {
            size_t len = sizeof(stored);
            nvs_get_str(nvs, NVS_KEY_BROKER, stored, &len);
            nvs_close(nvs);
        }
        if (stored[0] == '\0') {
            ESP_LOGE(TAG, "No broker URL configured");
            return ESP_ERR_NOT_FOUND;
        }
        broker_url = stored;
    }

    char lwt_topic[64];
    build_lwt_topic(lwt_topic, sizeof(lwt_topic));

    /* FW-14: LWT payload 与协议 §1.2 逐字段对齐（status/device_id/timestamp） */
    char lwt_payload[96];
    cJSON *lwt = cJSON_CreateObject();
    cJSON_AddNumberToObject(lwt, "timestamp", (double)time(NULL));
    cJSON_AddStringToObject(lwt, "device_id", s_device_id);
    cJSON_AddStringToObject(lwt, "status",    "offline");
    char *lwt_js = cJSON_PrintUnformatted(lwt);
    if (lwt_js) {
        strncpy(lwt_payload, lwt_js, sizeof(lwt_payload) - 1);
        lwt_payload[sizeof(lwt_payload) - 1] = '\0';
        free(lwt_js);
    } else {
        strcpy(lwt_payload, "{\"status\":\"offline\"}");
    }
    cJSON_Delete(lwt);

    const esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri         = broker_url,
        .session.protocol_ver       = MQTT_PROTOCOL_V_3_1_1,
        .session.keepalive          = 60,
        .session.last_will = {
            .topic   = lwt_topic,
            .msg     = lwt_payload,
            .qos     = 1,
            .retain  = 1,
        },
        .network.timeout_ms = 10000,
        .task.stack_size    = 8192,
    };

    if (s_client) {
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
    }

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (!s_client) return ESP_FAIL;

    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID,
                                   mqtt_event_handler, NULL);
    esp_err_t r = esp_mqtt_client_start(s_client);
    if (r == ESP_OK) {
        ESP_LOGI(TAG, "MQTT connecting to %s", broker_url);
    }
    return r;
}

esp_err_t mqtt_publish(const char *topic, const char *payload, int qos)
{
    if (!topic || !payload) return ESP_ERR_INVALID_ARG;

    if (!s_connected) {
        /* Cache offline */
        offline_queue_push(topic, payload, qos);
        return ESP_ERR_INVALID_STATE;
    }
    int msg_id = esp_mqtt_client_publish(s_client, topic, payload,
                                          (int)strlen(payload), qos, 0);
    return (msg_id >= 0) ? ESP_OK : ESP_FAIL;
}

esp_err_t mqtt_subscribe(const char *topic, mqtt_message_cb_t msg_cb)
{
    if (!topic) return ESP_ERR_INVALID_ARG;
    s_msg_cb = msg_cb;
    if (s_sub_count >= MQTT_MAX_SUBSCRIPTIONS) return ESP_ERR_NO_MEM;
    strncpy(s_sub_topics[s_sub_count], topic, MAX_TOPIC_LEN - 1);
    s_sub_topics[s_sub_count][MAX_TOPIC_LEN - 1] = '\0';
    s_sub_count++;
    if (s_client && s_connected) {
        esp_mqtt_client_subscribe(s_client, topic, 1);
    }
    return ESP_OK;
}

void mqtt_client_set_connected_cb(mqtt_connected_cb_t cb)
{
    s_connected_cb = cb;
}

bool mqtt_client_is_connected(void) { return s_connected; }

esp_err_t mqtt_client_save_broker(const char *broker_url)
{
    nvs_handle_t nvs;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &nvs), TAG, "nvs open");
    nvs_set_str(nvs, NVS_KEY_BROKER, broker_url);
    nvs_commit(nvs);
    nvs_close(nvs);
    ESP_LOGI(TAG, "Broker saved: %s", broker_url);
    return ESP_OK;
}

esp_err_t mqtt_client_get_broker(char *out_url, size_t out_len)
{
    nvs_handle_t nvs;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READONLY, &nvs), TAG, "nvs open");
    esp_err_t r = nvs_get_str(nvs, NVS_KEY_BROKER, out_url, &out_len);
    nvs_close(nvs);
    return r;
}
