/*
 * mqtt_client_wrapper.c — MQTT 3.1.1 客户端封装
 *
 * 功能:
 *   - LWT 遗嘱消息 (status = "offline")
 *   - QoS 0/1 发布/订阅
 *   - WiFi 断开时离线消息队列（Flash NVS, 最多50条）
 *   - 重连时批量补发离线队列
 *
 * ⚠️ 陷阱规避:
 *   - 始终用 cJSON 构造/解析 JSON（不用 sscanf）
 *   - 不在 MQTT 事件处理器内调用 vTaskDelay
 *   - 不硬编码 Broker 地址
 */
#include "mqtt_client_wrapper.h"
#include "mqtt_client.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "freertos/semphr.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "MQTT";

#define NVS_NS           "fan_mqtt"
#define NVS_KEY_BROKER   "broker_url"
#define NVS_KEY_QUEUE    "offline_q"
#define MAX_TOPIC_LEN    128
#define MAX_PAYLOAD_LEN  512

/* Offline message entry stored in NVS */
typedef struct {
    char topic[MAX_TOPIC_LEN];
    char payload[MAX_PAYLOAD_LEN];
    int  qos;
} offline_msg_t;

static esp_mqtt_client_handle_t  s_client        = NULL;
static bool                      s_connected     = false;
static mqtt_message_cb_t         s_msg_cb        = NULL;
static SemaphoreHandle_t         s_queue_mutex   = NULL;
static char                      s_device_id[16] = "esp32-unknown";

/* ---- LWT topic helper ---- */
static void build_lwt_topic(char *buf, size_t len)
{
    snprintf(buf, len, "%s/%s/status", MQTT_TOPIC_PREFIX, s_device_id);
}

/* ---- Offline queue (NVS) ---- */
static int offline_queue_count(nvs_handle_t nvs)
{
    uint8_t count = 0;
    nvs_get_u8(nvs, "q_count", &count);
    return count;
}

static void offline_queue_push(const char *topic, const char *payload, int qos)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) != ESP_OK) return;

    int count = offline_queue_count(nvs);
    if (count >= MQTT_OFFLINE_QUEUE_SIZE) {
        /* Queue full: drop oldest (index 0), shift down */
        for (int i = 0; i < count - 1; i++) {
            char key_src[16], key_dst[16];
            snprintf(key_src, sizeof(key_src), "q_%d", i + 1);
            snprintf(key_dst, sizeof(key_dst), "q_%d", i);
            uint8_t buf[sizeof(offline_msg_t)];
            size_t  sz = sizeof(buf);
            if (nvs_get_blob(nvs, key_src, buf, &sz) == ESP_OK)
                nvs_set_blob(nvs, key_dst, buf, sz);
        }
        count--;
    }

    offline_msg_t msg;
    memset(&msg, 0, sizeof(msg));
    strncpy(msg.topic,   topic,   sizeof(msg.topic)   - 1);
    strncpy(msg.payload, payload, sizeof(msg.payload) - 1);
    msg.qos = qos;

    char key[16];
    snprintf(key, sizeof(key), "q_%d", count);
    nvs_set_blob(nvs, key, &msg, sizeof(msg));
    nvs_set_u8(nvs, "q_count", (uint8_t)(count + 1));
    nvs_commit(nvs);
    nvs_close(nvs);
    ESP_LOGD(TAG, "Offline queue: pushed (%d/%d)", count + 1, MQTT_OFFLINE_QUEUE_SIZE);
}

static void offline_queue_flush(void)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) != ESP_OK) return;

    int count = offline_queue_count(nvs);
    ESP_LOGI(TAG, "Flushing %d offline messages", count);

    for (int i = 0; i < count; i++) {
        char key[16];
        snprintf(key, sizeof(key), "q_%d", i);
        offline_msg_t msg;
        size_t sz = sizeof(msg);
        if (nvs_get_blob(nvs, key, &msg, &sz) == ESP_OK) {
            esp_mqtt_client_publish(s_client, msg.topic, msg.payload,
                                    (int)strlen(msg.payload), msg.qos, 0);
        }
    }
    /* Clear queue */
    nvs_erase_all(nvs);
    nvs_commit(nvs);
    nvs_close(nvs);
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

            /* Publish online status */
            {
                char topic[64], payload[128];
                build_lwt_topic(topic, sizeof(topic));
                /* cJSON — never use sscanf/sprintf for JSON */
                cJSON *root = cJSON_CreateObject();
                cJSON_AddStringToObject(root, "status",    "online");
                cJSON_AddStringToObject(root, "device_id", s_device_id);
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
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "MQTT disconnected");
            s_connected = false;
            break;

        case MQTT_EVENT_DATA:
            if (s_msg_cb && event->topic && event->data) {
                s_msg_cb(event->topic, event->topic_len,
                         event->data,  event->data_len);
            }
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

    const esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri         = broker_url,
        .session.protocol_ver       = MQTT_PROTOCOL_V_3_1_1,
        .session.keepalive          = 60,
        .session.last_will = {
            .topic   = lwt_topic,
            .msg     = "{\"status\":\"offline\"}",
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
    if (s_client && s_connected) {
        esp_mqtt_client_subscribe(s_client, topic, 1);
    }
    return ESP_OK;
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
