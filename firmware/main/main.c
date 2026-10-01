/*
 * main.c — Smart Fan Controller 固件主循环（v1.2 整改版）
 * 平台: ESP32-S3-N16R8  框架: ESP-IDF v5.3+
 *
 * 启动顺序（FW-12/FW-13）: LEDC(duty=0 上电安全态) → NVS → Flash →
 *   Tach → 曲线 → LED/告警 → 传感器 → USB console → WiFi/MQTT 最后
 *   （WiFi/MQTT 失败不 abort：记日志、进入本地模式、后台重试）
 */
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_mac.h"
#include "nvs_flash.h"
#include "cJSON.h"

#include "power_monitor.h"
#include "fan_pwm.h"
#include "fan_tach.h"
#include "bme280.h"
#include "ds18b20.h"
#include "status_led.h"
#include "wifi_manager.h"
#include "mqtt_client_wrapper.h"
#include "usb_console.h"
#include "flash_storage.h"
#include "fan_curve.h"
#include "alert_manager.h"
#include "ota_handler.h"

static const char *TAG = "MAIN";
#define FW_VERSION "v1.0.1"

/* ---- MQTT topic helpers ---- */
static char s_device_id[16] = "esp32-unknown";

static void publish_sensor_json(const char *type, const char *json)
{
    char topic[80];
    snprintf(topic, sizeof(topic), "%s/%s/sensor/%s",
             MQTT_TOPIC_PREFIX, s_device_id, type);
    mqtt_publish(topic, json, 0);
}

/* FW-21: fan state 补 mode 字段；FW-31: 删除死代码 payload 缓冲 */
static void publish_fan_state(uint8_t idx, uint8_t duty_pct, uint16_t rpm, bool stalled)
{
    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/fan/%d/state",
             MQTT_TOPIC_PREFIX, s_device_id, idx);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp",    (double)time(NULL));   /* FW-15: Unix 秒 */
    cJSON_AddStringToObject(root, "device_id",    s_device_id);
    cJSON_AddNumberToObject(root, "fan_index",    idx);
    cJSON_AddNumberToObject(root, "pwm_duty_pct", duty_pct);
    cJSON_AddNumberToObject(root, "rpm",          rpm);
    cJSON_AddBoolToObject  (root, "stalled",      stalled);
    cJSON_AddStringToObject(root, "mode",
                            fan_curve_is_manual(idx) ? "manual" : "auto");
    char *js = cJSON_PrintUnformatted(root);
    if (js) {
        mqtt_publish(topic, js, 0);
        free(js);
    }
    cJSON_Delete(root);
}

/* ---- WiFi callbacks ---- */
static bool s_wifi_connected = false;
static TimerHandle_t s_mqtt_start_timer = NULL;

/* FW-05: 定时器回调真正以 NULL 调用 mqtt_client_connect（不再把
 * TimerHandle_t 伪装成 broker_url 传参） */
static void mqtt_start_timer_cb(TimerHandle_t t)
{
    (void)t;
    mqtt_client_connect(NULL);   /* NULL → 从 NVS 加载 broker_url */
}

static void on_wifi_connected(const char *ip)
{
    ESP_LOGI(TAG, "WiFi connected: %s", ip);
    s_wifi_connected = true;
    status_led_set_mode(LED_MODE_NORMAL);
    alert_manager_update_wifi(true);
    ota_handler_confirm_network(); /* OTA Phase 2 */
    mqtt_client_set_status_info(FW_VERSION, ip);   /* FW-14: online 报文字段 */

    /* ⚠️ MQTT 启动延迟 500ms（不在事件处理器中直接调用，避免递归互斥锁崩溃） */
    if (!s_mqtt_start_timer) {
        s_mqtt_start_timer = xTimerCreate("mqtt_st", pdMS_TO_TICKS(500),
                                           pdFALSE, NULL, mqtt_start_timer_cb);
    }
    xTimerStart(s_mqtt_start_timer, 0);
}

static void on_wifi_disconnected(void)
{
    ESP_LOGW(TAG, "WiFi disconnected");
    s_wifi_connected = false;
    status_led_set_mode(LED_MODE_WIFI_DISCONNECTED);
    alert_manager_update_wifi(false);
}

/* ---- Alert callbacks ---- */

/* FW-17: per-type retained 状态 topic（ADJ-8），告警触发/恢复时更新 */
static void publish_alert_state(alert_type_t type, bool active,
                                alert_severity_t sev)
{
    char topic[80];
    snprintf(topic, sizeof(topic), "%s/%s/alert/%s/state",
             MQTT_TOPIC_PREFIX, s_device_id, alert_type_to_string(type));
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject  (root, "active",    active);
    cJSON_AddStringToObject(root, "severity",
                            active ? alert_severity_to_string(sev) : "normal");
    cJSON_AddNumberToObject(root, "timestamp", (double)time(NULL));
    char *js = cJSON_PrintUnformatted(root);
    if (js) {
        mqtt_publish(topic, js, 1);   /* retain 语义经 QoS1 事件 topic 承载见下 */
        free(js);
    }
    cJSON_Delete(root);
}

static void on_alert(const alert_event_t *ev)
{
    /* Update LED */
    led_mode_t mode = (ev->severity == ALERT_CRITICAL) ? LED_MODE_ERROR : LED_MODE_WARNING;
    status_led_set_mode(mode);

    /* FW-16/ADJ-2: 协议 §5 完整字段 —— alert_type 字符串 + severity + sensor */
    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/alert", MQTT_TOPIC_PREFIX, s_device_id);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp",  (double)time(NULL));
    cJSON_AddStringToObject(root, "device_id",  s_device_id);
    cJSON_AddStringToObject(root, "alert_type", alert_type_to_string(ev->type));
    cJSON_AddStringToObject(root, "severity",   alert_severity_to_string(ev->severity));
    cJSON_AddStringToObject(root, "message",    ev->message);
    cJSON_AddNumberToObject(root, "value",      ev->value);
    cJSON_AddNumberToObject(root, "threshold",  ev->threshold);
    cJSON_AddStringToObject(root, "sensor",     alert_type_sensor(ev->type));
    char *js = cJSON_PrintUnformatted(root);
    if (js) { mqtt_publish(topic, js, 1); free(js); }
    cJSON_Delete(root);

    /* per-type 状态 topic 同步更新 */
    publish_alert_state(ev->type, true, ev->severity);
}

static void on_alert_clear(alert_type_t type)
{
    if (alert_manager_get_severity() == ALERT_NORMAL)
        status_led_set_mode(LED_MODE_NORMAL);

    /* FW-17: 恢复发布 per-type 状态 topic（旧的独立清除 topic 已删除） */
    publish_alert_state(type, false, ALERT_NORMAL);
}

/* ---- Fan stall callback ---- */
static void on_fan_stall(uint8_t fan_index)
{
    ESP_LOGE(TAG, "Fan %d stalled!", fan_index);
    alert_manager_update_fan_rpm(fan_index, 0);
}

/* ---- MQTT command handler（协议 §4/§6） ---- */

/* FW-20①: command/curve —— LUT points / PID 平铺字段 / temperature_source 字符串 */
static void handle_curve_command(cJSON *root)
{
    cJSON *idx_j = cJSON_GetObjectItem(root, "fan_index");
    if (!idx_j || idx_j->valueint < 0 || idx_j->valueint >= FAN_CURVE_FANS) {
        ESP_LOGW(TAG, "curve: fan_index out of range, dropped");
        return;
    }
    uint8_t fan = (uint8_t)idx_j->valueint;

    cJSON *src_j = cJSON_GetObjectItem(root, "temperature_source");
    if (src_j && src_j->valuestring) {
        int src = fan_curve_temp_source_from_str(src_j->valuestring);  /* ADJ-5 */
        if (src < 0) {
            ESP_LOGW(TAG, "curve: invalid temperature_source '%s', dropped",
                     src_j->valuestring);
            return;
        }
        fan_curve_set_temp_source(fan, (uint8_t)src);
    }

    cJSON *mode_j = cJSON_GetObjectItem(root, "mode");
    const char *mode = (mode_j && mode_j->valuestring) ? mode_j->valuestring : "lut";

    if (strcmp(mode, "lut") == 0) {
        cJSON *pts = cJSON_GetObjectItem(root, "points");
        if (cJSON_IsArray(pts)) {
            int n = cJSON_GetArraySize(pts);
            if (n > 0 && n <= FAN_CURVE_MAX_POINTS) {
                lut_point_t lut[FAN_CURVE_MAX_POINTS];
                for (int i = 0; i < n; i++) {
                    cJSON *p = cJSON_GetArrayItem(pts, i);
                    cJSON *t = cJSON_GetObjectItem(p, "temp_c");
                    cJSON *d = cJSON_GetObjectItem(p, "duty_pct");
                    if (!t || !d) return;
                    lut[i].temp_c   = (float)t->valuedouble;
                    lut[i].duty_pct = (uint8_t)t->valueint;
                }
                if (fan_curve_set_lut(fan, lut, (uint8_t)n) != ESP_OK) {
                    ESP_LOGW(TAG, "curve: LUT rejected (not strictly increasing)");
                }
            }
        }
        fan_curve_set_mode(fan, CURVE_MODE_LUT);
    } else if (strcmp(mode, "pid") == 0) {
        cJSON *kp = cJSON_GetObjectItem(root, "kp");
        cJSON *ki = cJSON_GetObjectItem(root, "ki");
        cJSON *kd = cJSON_GetObjectItem(root, "kd");
        cJSON *sp = cJSON_GetObjectItem(root, "setpoint_c");
        fan_curve_set_pid(fan, &(pid_params_t){
            .kp = kp ? (float)kp->valuedouble : 2.0f,
            .ki = ki ? (float)ki->valuedouble : 0.1f,
            .kd = kd ? (float)kd->valuedouble : 0.5f,
            .setpoint_c = sp ? (float)sp->valuedouble : 50.0f,
        });
        fan_curve_set_mode(fan, CURVE_MODE_PID);
    }
}

/* FW-20④: config/alert —— set 保存 NVS+应用；get 回读发布 */
static void save_alert_cfg_to_nvs(void)
{
    alert_thresholds_t th;
    alert_manager_get_thresholds(&th);
    char val[96];
    snprintf(val, sizeof(val), "%.1f,%.1f,%.2f,%.2f,%u,%u",
             th.temp_warn_c, th.temp_crit_c, th.v12_min, th.v12_max,
             th.stall_rpm, th.wifi_timeout_s);
    storage_write_config("alert_cfg", val);
}

static void load_alert_cfg_from_nvs(void)
{
    char val[96];
    if (storage_read_config("alert_cfg", val, sizeof(val)) != ESP_OK) return;
    alert_thresholds_t th;
    if (sscanf(val, "%f,%f,%f,%f,%hu,%hu",
               &th.temp_warn_c, &th.temp_crit_c, &th.v12_min, &th.v12_max,
               &th.stall_rpm, &th.wifi_timeout_s) == 6) {
        alert_manager_set_thresholds(&th);
        ESP_LOGI(TAG, "alert thresholds loaded from NVS");
    }
}

static void publish_alert_cfg(void)
{
    char topic[80];
    snprintf(topic, sizeof(topic), "%s/%s/config/alert",
             MQTT_TOPIC_PREFIX, s_device_id);
    alert_thresholds_t th;
    alert_manager_get_thresholds(&th);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp", (double)time(NULL));
    cJSON_AddStringToObject(root, "device_id", s_device_id);
    cJSON *rules = cJSON_AddArrayToObject(root, "rules");
    cJSON *r;
    r = cJSON_CreateObject();
    cJSON_AddStringToObject(r, "type", "temperature_high");
    cJSON_AddNumberToObject(r, "warn_c",  th.temp_warn_c);
    cJSON_AddNumberToObject(r, "crit_c",  th.temp_crit_c);
    cJSON_AddBoolToObject(r, "enabled", true);
    cJSON_AddItemToArray(rules, r);
    r = cJSON_CreateObject();
    cJSON_AddStringToObject(r, "type", "fan_stall");
    cJSON_AddNumberToObject(r, "stall_rpm", th.stall_rpm);
    cJSON_AddBoolToObject(r, "enabled", true);
    cJSON_AddItemToArray(rules, r);
    r = cJSON_CreateObject();
    cJSON_AddStringToObject(r, "type", "voltage_abnormal");
    cJSON_AddNumberToObject(r, "12v_min", th.v12_min);
    cJSON_AddNumberToObject(r, "12v_max", th.v12_max);
    cJSON_AddBoolToObject(r, "enabled", true);
    cJSON_AddItemToArray(rules, r);
    r = cJSON_CreateObject();
    cJSON_AddStringToObject(r, "type", "wifi_disconnected");
    cJSON_AddNumberToObject(r, "timeout_s", th.wifi_timeout_s);
    cJSON_AddBoolToObject(r, "enabled", true);
    cJSON_AddItemToArray(rules, r);
    char *js = cJSON_PrintUnformatted(root);
    if (js) { mqtt_publish(topic, js, 1); free(js); }
    cJSON_Delete(root);
}

static void handle_config_alert(cJSON *root)
{
    /* get 回读：空对象或 {"get":true} */
    cJSON *get_j = cJSON_GetObjectItem(root, "get");
    if (get_j && cJSON_IsTrue(get_j)) {
        publish_alert_cfg();
        return;
    }

    cJSON *rules = cJSON_GetObjectItem(root, "rules");
    if (!cJSON_IsArray(rules)) {
        ESP_LOGW(TAG, "config/alert: no rules array, ignored");
        return;
    }

    alert_thresholds_t th;
    alert_manager_get_thresholds(&th);
    cJSON *r;
    cJSON_ArrayForEach(r, rules) {
        cJSON *type_j = cJSON_GetObjectItem(r, "type");
        if (!type_j || !type_j->valuestring) continue;
        alert_type_t t = alert_type_from_string(type_j->valuestring);
        cJSON *en_j = cJSON_GetObjectItem(r, "enabled");
        if (en_j && !cJSON_IsTrue(en_j)) continue;   /* 规则停用：保持默认 */
        cJSON *v;
        switch (t) {
            case ALERT_TYPE_TEMPERATURE:
                if ((v = cJSON_GetObjectItem(r, "threshold")) ||
                    (v = cJSON_GetObjectItem(r, "warn_c")))
                    th.temp_warn_c = (float)v->valuedouble;
                if ((v = cJSON_GetObjectItem(r, "crit_c")))
                    th.temp_crit_c = (float)v->valuedouble;
                break;
            case ALERT_TYPE_FAN_STALL:
                if ((v = cJSON_GetObjectItem(r, "threshold")))
                    th.stall_rpm = (uint16_t)v->valueint;
                break;
            case ALERT_TYPE_VOLTAGE:
                if ((v = cJSON_GetObjectItem(r, "12v_min")))
                    th.v12_min = (float)v->valuedouble;
                if ((v = cJSON_GetObjectItem(r, "12v_max")))
                    th.v12_max = (float)v->valuedouble;
                break;
            case ALERT_TYPE_WIFI:
                if ((v = cJSON_GetObjectItem(r, "threshold")))
                    th.wifi_timeout_s = (uint16_t)v->valueint;
                break;
            default:
                ESP_LOGW(TAG, "config/alert: unknown rule type '%s'",
                         type_j->valuestring);
                break;
        }
    }
    alert_manager_set_thresholds(&th);
    save_alert_cfg_to_nvs();
}

static void on_mqtt_command(const char *topic, int topic_len,
                             const char *data,  int data_len)
{
    /* Always use cJSON — never sscanf for JSON */
    char buf[1024];
    if (data_len <= 0 || data_len >= (int)sizeof(buf)) return;
    memcpy(buf, data, data_len);
    buf[data_len] = '\0';

    cJSON *root = cJSON_Parse(buf);
    if (!root) return;

    /* Route by topic suffix */
    char topic_str[128];
    int  len = (topic_len < 127) ? topic_len : 127;
    memcpy(topic_str, topic, len);
    topic_str[len] = '\0';

    /* FW-04: 防御性校验 —— topic 中的 device_id 与本机一致才执行 */
    if (strncmp(topic_str, MQTT_TOPIC_PREFIX "/", strlen(MQTT_TOPIC_PREFIX) + 1) == 0) {
        char topic_dev[16];
        const char *dev = topic_str + strlen(MQTT_TOPIC_PREFIX) + 1;
        const char *slash = strchr(dev, '/');
        size_t dev_len = slash ? (size_t)(slash - dev) : strlen(dev);
        if (dev_len >= sizeof(topic_dev)) dev_len = sizeof(topic_dev) - 1;
        memcpy(topic_dev, dev, dev_len);
        topic_dev[dev_len] = '\0';
        if (strcmp(topic_dev, s_device_id) != 0) {
            ESP_LOGW(TAG, "Command for other device '%s', ignored", topic_dev);
            cJSON_Delete(root);
            return;
        }
    }

    if (strstr(topic_str, "/command/fan")) {
        cJSON *idx_j  = cJSON_GetObjectItem(root, "fan_index");
        cJSON *duty_j = cJSON_GetObjectItem(root, "duty_pct");
        if (idx_j && duty_j) {
            /* FW-20⑤: 越界直接丢弃并记日志 */
            if (idx_j->valueint < 0 || idx_j->valueint >= FAN_PWM_COUNT ||
                duty_j->valueint < 0 || duty_j->valueint > 100) {
                ESP_LOGW(TAG, "command/fan: index/duty out of range, dropped");
            } else {
                fan_curve_set_mode((uint8_t)idx_j->valueint, CURVE_MODE_MANUAL);
                fan_pwm_set_duty((uint8_t)idx_j->valueint, (uint8_t)duty_j->valueint);
            }
        }
    } else if (strstr(topic_str, "/command/curve")) {          /* FW-20① */
        handle_curve_command(root);
    } else if (strstr(topic_str, "/command/ota")) {            /* ADJ-3 */
        cJSON *url_j = cJSON_GetObjectItem(root, "firmware_url");
        if (url_j && url_j->valuestring) {
            status_led_set_mode(LED_MODE_OTA);
            ota_handler_start(url_j->valuestring);
        }
    } else if (strstr(topic_str, "/command/reboot")) {
        ESP_LOGW(TAG, "Reboot command received");
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
    } else if (strstr(topic_str, "/command/reset")) {          /* FW-20③ */
        cJSON *confirm_j = cJSON_GetObjectItem(root, "confirm");
        if (confirm_j && cJSON_IsTrue(confirm_j)) {
            ESP_LOGW(TAG, "Factory reset confirmed — erasing + rebooting");
            wifi_manager_factory_reset();     /* FW-28: 三 namespace 统一清理 */
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        } else {
            ESP_LOGW(TAG, "reset without confirm:true — ignored");
        }
    } else if (strstr(topic_str, "/config/alert")) {           /* FW-20④ */
        handle_config_alert(root);
    }

    cJSON_Delete(root);
}

/* ---- USB console commands（FW-22: help/status/reboot/ota/fan/wifi/mqtt） ---- */
static char *cmd_status(const char *args)
{
    (void)args;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject  (root, "ok",           true);
    cJSON_AddBoolToObject  (root, "wifi",         s_wifi_connected);
    cJSON_AddBoolToObject  (root, "mqtt",         mqtt_client_is_connected());
    cJSON_AddNumberToObject(root, "uptime_s",     (double)(esp_timer_get_time() / 1000000LL));
    cJSON_AddNumberToObject(root, "free_heap",    (double)esp_get_free_heap_size());
    cJSON_AddNumberToObject(root, "alert_level",  alert_manager_get_severity());
    char *js = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return js;
}

static char *cmd_ota(const char *args)
{
    if (!args || args[0] == '\0') {
        return strdup("{\"ok\":false,\"error\":\"usage: ota <url>\"}");
    }
    status_led_set_mode(LED_MODE_OTA);
    ota_handler_start(args);
    return strdup("{\"ok\":true,\"message\":\"OTA started\"}");
}

/* FW-22: fan <0-7> <duty 0-100>（验收流程依赖） */
static char *cmd_fan(const char *args)
{
    int fan = -1, duty = -1;
    if (!args || sscanf(args, "%d %d", &fan, &duty) != 2) {
        return strdup("{\"ok\":false,\"error\":\"usage: fan <0-7> <duty 0-100>\"}");
    }
    if (fan < 0 || fan >= FAN_PWM_COUNT || duty < 0 || duty > 100) {
        return strdup("{\"ok\":false,\"error\":\"fan index 0-7, duty 0-100\"}");
    }
    fan_curve_set_mode((uint8_t)fan, CURVE_MODE_MANUAL);
    fan_pwm_set_duty((uint8_t)fan, (uint8_t)duty);
    char resp[64];
    snprintf(resp, sizeof(resp), "{\"ok\":true,\"fan\":%d,\"duty\":%d}", fan, duty);
    return strdup(resp);
}

/* FW-22: wifi status | reset（config/wifi 降级为 console 命令，ADJ-9） */
static char *cmd_wifi(const char *args)
{
    if (args && strcmp(args, "reset") == 0) {
        wifi_manager_factory_reset();   /* FW-28 */
        return strdup("{\"ok\":true,\"message\":\"factory reset, rebooting\"}");
    }
    /* 无参数或 status：WiFi 凭据存于 fan_ctrl namespace（wifi_manager 私有），
     * 此处只报连接状态与配网入口 */
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok",        true);
    cJSON_AddBoolToObject(root, "connected", s_wifi_connected);
    cJSON_AddStringToObject(root, "mode_hint",
                            "long-press BTN(GPIO47) 3s = AP provisioning, 10s = factory reset");
    char *js = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return js;
}

/* FW-22: mqtt status | set <url>（ADJ-9: config/mqtt 降级为 console 命令） */
static char *cmd_mqtt(const char *args)
{
    if (args && strncmp(args, "set ", 4) == 0) {
        const char *url = args + 4;
        if (strncmp(url, "mqtt://", 7) != 0 && strncmp(url, "mqtts://", 8) != 0) {
            return strdup("{\"ok\":false,\"error\":\"URL must start with mqtt:// or mqtts://\"}");
        }
        mqtt_client_save_broker(url);
        return strdup("{\"ok\":true,\"message\":\"broker saved, reconnect after reboot\"}");
    }
    char broker[128] = "";
    mqtt_client_get_broker(broker, sizeof(broker));
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject  (root, "ok",        true);
    cJSON_AddBoolToObject  (root, "connected", mqtt_client_is_connected());
    cJSON_AddStringToObject(root, "broker",    broker[0] ? broker : "(not set)");
    char *js = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return js;
}

/* ---- FreeRTOS tasks ---- */

/* FW-08: MQTT 连接建立 → 确认 OTA（杜绝 5 分钟回滚循环） */
static void on_mqtt_connected(void)
{
    ota_handler_confirm_mqtt();
}

static void sensor_task(void *arg)
{
    (void)arg;
    bme280_data_t bme;
    bool     bme_ok = false;
    ds18b20_sensor_t ds_sensors[DS18B20_MAX_SENSORS];
    uint8_t  ds_count = 0;
    float    v12 = 12.0f, v5 = 5.0f, v33 = 3.3f, internal_t = 0.0f;
    bool     pwr_ok = false;
    int      slow_tick = 0;    /* FW-19: voltage/internal_temp 5s 周期 */

    while (1) {
        /* BME280 @1s */
        bme_ok = (bme280_read(&bme) == ESP_OK);
        if (bme_ok) {
            fan_curve_set_temperature(TEMP_SRC_BME280, bme.temperature_c);

            cJSON *root = cJSON_CreateObject();
            cJSON_AddNumberToObject(root, "timestamp",     (double)time(NULL));
            cJSON_AddStringToObject(root, "device_id",     s_device_id);
            cJSON_AddNumberToObject(root, "temperature_c", bme.temperature_c);
            cJSON_AddNumberToObject(root, "humidity_pct",  bme.humidity_pct);
            cJSON_AddNumberToObject(root, "pressure_hpa",  bme.pressure_hpa);
            char *js = cJSON_PrintUnformatted(root);
            if (js) { publish_sensor_json("bme280", js); free(js); }
            cJSON_Delete(root);
        }

        /* DS18B20 @1s（FW-18: address/valid，无效项也上报，不跳过） */
        if (ds18b20_read_all(ds_sensors, &ds_count) == ESP_OK && ds_count > 0) {
            cJSON *root = cJSON_CreateObject();
            cJSON_AddNumberToObject(root, "timestamp", (double)time(NULL));
            cJSON_AddStringToObject(root, "device_id", s_device_id);
            cJSON *arr = cJSON_AddArrayToObject(root, "sensors");
            float ds_max = -1000.0f;
            int   ds_valid = 0;
            for (uint8_t i = 0; i < ds_count; i++) {
                char addr[DS18B20_ADDR_STR_LEN];
                ds18b20_address_str(ds_sensors[i].rom, addr, sizeof(addr));
                cJSON *s = cJSON_CreateObject();
                cJSON_AddStringToObject(s, "address",       addr);
                cJSON_AddBoolToObject  (s, "valid",         ds_sensors[i].valid);
                cJSON_AddNumberToObject(s, "temperature_c", ds_sensors[i].temperature_c);
                cJSON_AddItemToArray(arr, s);
                if (ds_sensors[i].valid) {
                    /* 前两个探头映射 ds18b20_0 / ds18b20_1 温度源 */
                    fan_curve_set_temperature(
                        (i == 0) ? TEMP_SRC_DS18B20_0 : TEMP_SRC_DS18B20_1,
                        ds_sensors[i].temperature_c);
                    if (ds_sensors[i].temperature_c > ds_max)
                        ds_max = ds_sensors[i].temperature_c;
                    ds_valid++;
                }
            }
            char *js = cJSON_PrintUnformatted(root);
            if (js) { publish_sensor_json("ds18b20", js); free(js); }
            cJSON_Delete(root);

            /* FW-26: DS18B20 探头参与温度告警（三源最大值） */
            float m = ds_max;
            if (bme_ok && bme.temperature_c > m) m = bme.temperature_c;
            alert_manager_update_temperature(m);
        } else if (bme_ok) {
            alert_manager_update_temperature(bme.temperature_c);
        }

        /* 电源 @1s 读取（断电检测窗口）；遥测发布 @5s（FW-19/ADJ-7） */
        pwr_ok = (power_monitor_read_all(&v12, &v5, &v33) == ESP_OK);
        if (pwr_ok) {
            alert_manager_update_voltages(v12, v5, v33);
            internal_t = power_monitor_read_internal_temp();
            fan_curve_set_temperature(TEMP_SRC_INTERNAL, internal_t);
        }
        if (slow_tick % 5 == 0 && pwr_ok) {
            cJSON *root = cJSON_CreateObject();
            cJSON_AddNumberToObject(root, "timestamp", (double)time(NULL));
            cJSON_AddStringToObject(root, "device_id", s_device_id);
            cJSON_AddNumberToObject(root, "voltage_12v", v12);
            cJSON_AddNumberToObject(root, "voltage_5v",  v5);
            cJSON_AddNumberToObject(root, "voltage_3v3", v33);
            char *js = cJSON_PrintUnformatted(root);
            if (js) { publish_sensor_json("voltage", js); free(js); }
            cJSON_Delete(root);

            cJSON *tr = cJSON_CreateObject();
            cJSON_AddNumberToObject(tr, "timestamp",    (double)time(NULL));
            cJSON_AddStringToObject(tr, "device_id",    s_device_id);
            cJSON_AddNumberToObject(tr, "temperature_c", internal_t);
            char *tj = cJSON_PrintUnformatted(tr);
            if (tj) { publish_sensor_json("internal_temp", tj); free(tj); }
            cJSON_Delete(tr);
        }

        /* Log to Flash every ~30s (handled by storage_log_sensor_data internally) */
        if (slow_tick % 30 == 0 && pwr_ok) {
            /* ⚠️ int64_t intermediate; uint32_t seconds field safe for 136+ years */
            int64_t uptime_s = esp_timer_get_time() / 1000000LL;
            log_entry_t le = {
                .timestamp = (uint32_t)uptime_s,
                .voltages  = { v12, v5, v33 },
            };
            if (bme_ok) le.temps[0] = bme.temperature_c;
            for (int i = 0; i < FAN_TACH_COUNT; i++) le.fan_rpm[i] = fan_tach_get_rpm(i);
            storage_log_sensor_data(&le);
        }

        slow_tick++;
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void fan_control_task(void *arg)
{
    (void)arg;
    while (1) {
        fan_curve_update(0); /* temperatures injected via fan_curve_set_temperature() */
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void tach_monitor_task(void *arg)
{
    (void)arg;
    while (1) {
        for (int i = 0; i < FAN_TACH_COUNT; i++) {
            uint16_t rpm = fan_tach_get_rpm(i);
            uint8_t  duty = fan_pwm_get_duty(i);
            alert_manager_update_fan_rpm(i, rpm);
            alert_manager_update_fan_duty(i, duty);   /* FW-11: 停转判定需要 duty */
            publish_fan_state(i, duty, rpm, duty > 5 && rpm < 200);
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void alert_task(void *arg)
{
    (void)arg;
    while (1) {
        alert_manager_check_all();
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

/* ---- app_main ---- */
void app_main(void)
{
    ESP_LOGI(TAG, "==============================================");
    ESP_LOGI(TAG, "  Smart Fan Controller %s", FW_VERSION);
    ESP_LOGI(TAG, "  Platform: ESP32-S3-N16R8 (8 fans)");
    ESP_LOGI(TAG, "==============================================");

    /* Derive device ID from MAC */
    uint8_t mac[6];
    esp_base_mac_addr_get(mac);
    snprintf(s_device_id, sizeof(s_device_id), "esp32-%02x%02x%02x", mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "Device ID: %s", s_device_id);

    /* 0. FW-13: LEDC duty=0 最先配置（上电安全态，缩短缓冲输入悬空窗口；
     *    与硬件下拉 H-17 双保险） */
    ESP_ERROR_CHECK(fan_pwm_init());
    ESP_LOGI(TAG, "[0/7] Fan PWM safe-state OK (8ch duty=0)");

    /* 1. NVS */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_LOGI(TAG, "[1/7] NVS OK");

    /* 2. Flash storage */
    ESP_ERROR_CHECK(flash_storage_init());
    ESP_LOGI(TAG, "[2/7] Flash storage OK");

    /* 3. Fan drivers: Tach + 曲线（含 NVS 加载，FW-20） */
    ESP_ERROR_CHECK(fan_tach_init());
    fan_tach_on_stall(on_fan_stall);
    ESP_ERROR_CHECK(fan_curve_init());
    ESP_LOGI(TAG, "[3/7] Tach + curve OK");

    /* 4. Alert + LED */
    ESP_ERROR_CHECK(status_led_init());
    status_led_set_mode(LED_MODE_WIFI_DISCONNECTED);
    ESP_ERROR_CHECK(alert_manager_init(on_alert, on_alert_clear));
    load_alert_cfg_from_nvs();      /* FW-20④: config/alert 持久化恢复 */
    ESP_LOGI(TAG, "[4/7] Alert + LED OK");

    /* 5. Sensors */
    ESP_ERROR_CHECK(power_monitor_init());
    ESP_ERROR_CHECK(bme280_init());
    ESP_ERROR_CHECK(ds18b20_init());
    ESP_LOGI(TAG, "[5/7] Sensors OK");

    /* 6. OTA + USB console */
    ESP_ERROR_CHECK(ota_handler_init());
    ota_handler_confirm_boot(); /* OTA Phase 1: boot confirmed */
    ESP_ERROR_CHECK(usb_console_init());
    console_register_command("status", cmd_status);
    console_register_command("ota",    cmd_ota);
    console_register_command("fan",    cmd_fan);     /* FW-22 */
    console_register_command("wifi",    cmd_wifi);   /* FW-22 */
    console_register_command("mqtt",    cmd_mqtt);   /* FW-22 */
    ESP_LOGI(TAG, "[6/7] OTA + USB console OK");

    /* 7. WiFi + MQTT 最后（FW-12: 失败不 abort——本地模式运行，后台重试） */
    esp_err_t err = wifi_manager_init(on_wifi_connected, on_wifi_disconnected);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi init failed (%s) — running in local mode",
                 esp_err_to_name(err));
    } else {
        err = wifi_manager_start();
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "WiFi start failed (%s) — running in local mode",
                     esp_err_to_name(err));
        }
    }

    err = mqtt_client_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "MQTT init failed (%s)", esp_err_to_name(err));
    } else {
        /* FW-04: 具体设备订阅（不用 + 通配）；FW-03: 连接建立后才真正下发 */
        char sub_topic[80];
        snprintf(sub_topic, sizeof(sub_topic), "%s/%s/command/#",
                 MQTT_TOPIC_PREFIX, s_device_id);
        mqtt_subscribe(sub_topic, on_mqtt_command);
        snprintf(sub_topic, sizeof(sub_topic), "%s/%s/config/#",
                 MQTT_TOPIC_PREFIX, s_device_id);
        mqtt_subscribe(sub_topic, on_mqtt_command);
        mqtt_client_set_connected_cb(on_mqtt_connected);   /* FW-08 */
    }
    ESP_LOGI(TAG, "[7/7] WiFi + MQTT init OK (local mode if not connected)");

    /* Spawn FreeRTOS tasks */
    xTaskCreatePinnedToCore(sensor_task,       "sensor",   4096, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(fan_control_task,  "fan_ctrl", 4096, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(tach_monitor_task, "tach_mon", 3072, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(alert_task,        "alert",    3072, NULL, 2, NULL, 1);
    /* mqtt_task and wifi_task are driven by esp_mqtt and esp_wifi internally */

    ESP_LOGI(TAG, "All systems operational — %s ready", s_device_id);
}
