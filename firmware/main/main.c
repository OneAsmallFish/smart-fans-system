/*
 * main.c — Smart Fan Controller 固件主循环（完整集成版）
 * 平台: ESP32-S3-N16R8  框架: ESP-IDF v5.3+
 * 启动顺序: NVS → WiFi → MQTT → 传感器 → 风扇 → 告警 → USB
 */
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "cJSON.h"

#include "power_monitor/power_monitor.h"
#include "fan_pwm/fan_pwm.h"
#include "fan_tach/fan_tach.h"
#include "bme280/bme280.h"
#include "ds18b20/ds18b20.h"
#include "status_led/status_led.h"
#include "wifi_manager/wifi_manager.h"
#include "mqtt_client/mqtt_client_wrapper.h"
#include "usb_console/usb_console.h"
#include "flash_storage/flash_storage.h"
#include "fan_curve/fan_curve.h"
#include "alert_manager/alert_manager.h"
#include "ota_handler/ota_handler.h"

static const char *TAG = "MAIN";

/* ---- MQTT topic helpers ---- */
static char s_device_id[16] = "esp32-unknown";

static void publish_sensor_json(const char *type, const char *json)
{
    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/sensor/%s",
             MQTT_TOPIC_PREFIX, s_device_id, type);
    mqtt_publish(topic, json, 0);
}

static void publish_fan_state(uint8_t idx, uint8_t duty_pct, uint16_t rpm, bool stalled)
{
    char topic[64], payload[128];
    snprintf(topic, sizeof(topic), "%s/%s/fan/%d/state",
             MQTT_TOPIC_PREFIX, s_device_id, idx);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp", (int)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(root, "device_id", s_device_id);
    cJSON_AddNumberToObject(root, "fan_index",    idx);
    cJSON_AddNumberToObject(root, "pwm_duty_pct", duty_pct);
    cJSON_AddNumberToObject(root, "rpm",          rpm);
    cJSON_AddBoolToObject  (root, "stalled",      stalled);
    char *js = cJSON_PrintUnformatted(root);
    if (js) {
        mqtt_publish(topic, js, 0);
        free(js);
    }
    cJSON_Delete(root);
    (void)payload;
}

/* ---- WiFi callbacks ---- */
static bool s_wifi_connected = false;
static TimerHandle_t s_mqtt_start_timer = NULL;

static void on_wifi_connected(const char *ip)
{
    ESP_LOGI(TAG, "WiFi connected: %s", ip);
    s_wifi_connected = true;
    status_led_set_mode(LED_MODE_NORMAL);
    alert_manager_update_wifi(true);
    ota_handler_confirm_network(); /* OTA Phase 2 */

    /* ⚠️ MQTT 启动延迟 500ms（不在事件处理器中直接调用，避免递归互斥锁崩溃） */
    if (!s_mqtt_start_timer) {
        s_mqtt_start_timer = xTimerCreate("mqtt_st", pdMS_TO_TICKS(500),
                                           pdFALSE, NULL,
                                           (void(*)(TimerHandle_t))mqtt_client_connect);
    }
    /* Pass NULL → mqtt_client_connect loads broker from NVS */
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
static void on_alert(const alert_event_t *ev)
{
    /* Update LED */
    led_mode_t mode = (ev->severity == ALERT_CRITICAL) ? LED_MODE_ERROR : LED_MODE_WARNING;
    status_led_set_mode(mode);

    /* Publish MQTT alert */
    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/alert", MQTT_TOPIC_PREFIX, s_device_id);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp", (int)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(root, "device_id", s_device_id);
    cJSON_AddNumberToObject(root, "alert_type", ev->type);
    cJSON_AddStringToObject(root, "message",    ev->message);
    cJSON_AddNumberToObject(root, "value",      ev->value);
    cJSON_AddNumberToObject(root, "threshold",  ev->threshold);
    char *js = cJSON_PrintUnformatted(root);
    if (js) { mqtt_publish(topic, js, 1); free(js); }
    cJSON_Delete(root);
}

static void on_alert_clear(alert_type_t type)
{
    if (alert_manager_get_severity() == ALERT_NORMAL)
        status_led_set_mode(LED_MODE_NORMAL);

    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/alert/cleared", MQTT_TOPIC_PREFIX, s_device_id);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp",  (int)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(root, "device_id",  s_device_id);
    cJSON_AddNumberToObject(root, "alert_type", type);
    char *js = cJSON_PrintUnformatted(root);
    if (js) { mqtt_publish(topic, js, 1); free(js); }
    cJSON_Delete(root);
}

/* ---- Fan stall callback ---- */
static void on_fan_stall(uint8_t fan_index)
{
    ESP_LOGE(TAG, "Fan %d stalled!", fan_index);
    alert_manager_update_fan_rpm(fan_index, 0);
}

/* ---- MQTT command handler ---- */
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

    if (strstr(topic_str, "/command/fan")) {
        cJSON *idx_j  = cJSON_GetObjectItem(root, "fan_index");
        cJSON *duty_j = cJSON_GetObjectItem(root, "duty_pct");
        if (idx_j && duty_j) {
            fan_curve_set_mode(idx_j->valueint, CURVE_MODE_MANUAL);
            fan_pwm_set_duty(idx_j->valueint, duty_j->valueint);
        }
    } else if (strstr(topic_str, "/command/ota")) {
        cJSON *url_j = cJSON_GetObjectItem(root, "firmware_url");
        if (url_j && url_j->valuestring) {
            status_led_set_mode(LED_MODE_OTA);
            ota_handler_start(url_j->valuestring);
        }
    } else if (strstr(topic_str, "/command/reboot")) {
        ESP_LOGW(TAG, "Reboot command received");
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
    }

    cJSON_Delete(root);
}

/* ---- USB console commands ---- */
static char *cmd_status(const char *args)
{
    (void)args;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject  (root, "ok",           true);
    cJSON_AddBoolToObject  (root, "wifi",         s_wifi_connected);
    cJSON_AddBoolToObject  (root, "mqtt",         mqtt_client_is_connected());
    cJSON_AddNumberToObject(root, "uptime_s",     (int)(esp_timer_get_time() / 1000000));
    cJSON_AddNumberToObject(root, "free_heap",    esp_get_free_heap_size());
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

/* ---- FreeRTOS tasks ---- */
static void sensor_task(void *arg)
{
    (void)arg;
    bme280_data_t bme;
    ds18b20_sensor_t ds_sensors[DS18B20_MAX_SENSORS];
    uint8_t ds_count = 0;
    float   v12, v5, v33;

    while (1) {
        /* Read all sensors */
        if (bme280_read(&bme) == ESP_OK) {
            fan_curve_set_temperature(0, bme.temperature_c);
            alert_manager_update_temperature(bme.temperature_c);

            cJSON *root = cJSON_CreateObject();
            cJSON_AddNumberToObject(root, "timestamp",     (int)(esp_timer_get_time() / 1000000));
            cJSON_AddStringToObject(root, "device_id",     s_device_id);
            cJSON_AddNumberToObject(root, "temperature_c", bme.temperature_c);
            cJSON_AddNumberToObject(root, "humidity_pct",  bme.humidity_pct);
            cJSON_AddNumberToObject(root, "pressure_hpa",  bme.pressure_hpa);
            char *js = cJSON_PrintUnformatted(root);
            if (js) { publish_sensor_json("bme280", js); free(js); }
            cJSON_Delete(root);
        }

        if (ds18b20_read_all(ds_sensors, &ds_count) == ESP_OK && ds_count > 0) {
            cJSON *root = cJSON_CreateObject();
            cJSON_AddNumberToObject(root, "timestamp", (int)(esp_timer_get_time() / 1000000));
            cJSON_AddStringToObject(root, "device_id", s_device_id);
            cJSON *arr = cJSON_AddArrayToObject(root, "sensors");
            for (uint8_t i = 0; i < ds_count; i++) {
                if (!ds_sensors[i].valid) continue;
                cJSON *s = cJSON_CreateObject();
                cJSON_AddNumberToObject(s, "index",        i);
                cJSON_AddNumberToObject(s, "temperature_c", ds_sensors[i].temperature_c);
                cJSON_AddItemToArray(arr, s);
                fan_curve_set_temperature(i + 1, ds_sensors[i].temperature_c);
            }
            char *js = cJSON_PrintUnformatted(root);
            if (js) { publish_sensor_json("ds18b20", js); free(js); }
            cJSON_Delete(root);
        }

        if (power_monitor_read_all(&v12, &v5, &v33) == ESP_OK) {
            alert_manager_update_voltages(v12, v5, v33);
            float internal_t = power_monitor_read_internal_temp();

            cJSON *root = cJSON_CreateObject();
            cJSON_AddNumberToObject(root, "timestamp", (int)(esp_timer_get_time() / 1000000));
            cJSON_AddStringToObject(root, "device_id", s_device_id);
            cJSON_AddNumberToObject(root, "voltage_12v", v12);
            cJSON_AddNumberToObject(root, "voltage_5v",  v5);
            cJSON_AddNumberToObject(root, "voltage_3v3", v33);
            char *js = cJSON_PrintUnformatted(root);
            if (js) { publish_sensor_json("voltage", js); free(js); }
            cJSON_Delete(root);

            cJSON *tr = cJSON_CreateObject();
            cJSON_AddNumberToObject(tr, "timestamp",    (int)(esp_timer_get_time() / 1000000));
            cJSON_AddStringToObject(tr, "device_id",    s_device_id);
            cJSON_AddNumberToObject(tr, "temperature_c", internal_t);
            char *tj = cJSON_PrintUnformatted(tr);
            if (tj) { publish_sensor_json("internal_temp", tj); free(tj); }
            cJSON_Delete(tr);

            /* Log to Flash every ~30s (handled by storage_log_sensor_data internally) */
            /* ⚠️ int64_t intermediate; uint32_t seconds field safe for 136+ years */
            int64_t uptime_s = esp_timer_get_time() / 1000000LL;
            log_entry_t le = {
                .timestamp = (uint32_t)uptime_s,
                .voltages  = { v12, v5, v33 },
            };
            if (bme280_read(&bme) == ESP_OK) le.temps[0] = bme.temperature_c;
            for (int i = 0; i < 4; i++) le.fan_rpm[i] = fan_tach_get_rpm(i);
            storage_log_sensor_data(&le);
        }

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
        for (int i = 0; i < 4; i++) {
            uint16_t rpm = fan_tach_get_rpm(i);
            uint8_t  duty = fan_pwm_get_duty(i);
            alert_manager_update_fan_rpm(i, rpm);
            publish_fan_state(i, duty, rpm, rpm < 200 && duty > 5);
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
    ESP_LOGI(TAG, "  Smart Fan Controller v1.0.0");
    ESP_LOGI(TAG, "  Platform: ESP32-S3-N16R8");
    ESP_LOGI(TAG, "==============================================");

    /* 1. NVS */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_LOGI(TAG, "[1/7] NVS OK");

    /* Derive device ID from MAC */
    uint8_t mac[6];
    esp_base_mac_addr_get(mac);
    snprintf(s_device_id, sizeof(s_device_id), "esp32-%02x%02x%02x", mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "Device ID: %s", s_device_id);

    /* 2. Flash storage */
    ESP_ERROR_CHECK(flash_storage_init());
    ESP_LOGI(TAG, "[2/7] Flash storage OK");

    /* 3. WiFi (must init before MQTT per SW coexist requirement) */
    ESP_ERROR_CHECK(wifi_manager_init(on_wifi_connected, on_wifi_disconnected));
    ESP_ERROR_CHECK(wifi_manager_start());
    ESP_LOGI(TAG, "[3/7] WiFi started");

    /* 4. MQTT client init (connect deferred until WiFi GOT_IP) */
    ESP_ERROR_CHECK(mqtt_client_init());
    mqtt_subscribe("fan-controller/+/command/#", on_mqtt_command);
    ESP_LOGI(TAG, "[4/7] MQTT client init OK");

    /* 5. Sensors */
    ESP_ERROR_CHECK(power_monitor_init());
    ESP_ERROR_CHECK(bme280_init());
    ESP_ERROR_CHECK(ds18b20_init());
    ESP_LOGI(TAG, "[5/7] Sensors OK");

    /* 6. Fan drivers */
    ESP_ERROR_CHECK(fan_pwm_init());
    ESP_ERROR_CHECK(fan_tach_init());
    fan_tach_on_stall(on_fan_stall);
    ESP_ERROR_CHECK(fan_curve_init());
    ESP_LOGI(TAG, "[6/7] Fan drivers OK");

    /* 7. Alert + LED + USB */
    ESP_ERROR_CHECK(status_led_init());
    status_led_set_mode(LED_MODE_WIFI_DISCONNECTED);
    ESP_ERROR_CHECK(alert_manager_init(on_alert, on_alert_clear));
    ESP_ERROR_CHECK(ota_handler_init());
    ota_handler_confirm_boot(); /* OTA Phase 1: boot confirmed */
    ESP_ERROR_CHECK(usb_console_init());
    console_register_command("status", cmd_status);
    console_register_command("ota",    cmd_ota);
    ESP_LOGI(TAG, "[7/7] Alert+LED+USB OK");

    /* Spawn FreeRTOS tasks */
    xTaskCreatePinnedToCore(sensor_task,       "sensor",   4096, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(fan_control_task,  "fan_ctrl", 4096, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(tach_monitor_task, "tach_mon", 3072, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(alert_task,        "alert",    3072, NULL, 2, NULL, 1);
    /* mqtt_task and wifi_task are driven by esp_mqtt and esp_wifi internally */

    ESP_LOGI(TAG, "All systems operational — %s ready", s_device_id);
}
