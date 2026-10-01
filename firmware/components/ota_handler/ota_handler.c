/*
 * ota_handler.c — OTA 三阶段回滚保护实现 + 进度上报
 *
 * 回滚逻辑:
 *   Phase 1 — 启动后30s内调用 ota_handler_confirm_boot()，否则重启回滚
 *   Phase 2 — WiFi GOT_IP后调用 ota_handler_confirm_network()，2分钟超时
 *   Phase 3 — MQTT 连接建立后调用 ota_handler_confirm_mqtt()（由 main 经
 *             mqtt_client_set_connected_cb 接线，FW-08），5分钟超时
 *   三阶段全通过 → esp_ota_mark_app_valid_cancel_rollback()
 *
 * 进度上报（FW-10）: fan-controller/{id}/ota/status（协议 §7：
 * state/progress_pct/message），下载期间周期发布。
 */
#include "ota_handler.h"
#include "cJSON.h"
#include "esp_https_ota.h"
#include "esp_ota_ops.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "mqtt_client_wrapper.h"
#include <string.h>
#include <stdio.h>
#include <time.h>

static const char *TAG = "OTA";

typedef enum {
    CONFIRM_BOOT    = 0,
    CONFIRM_NETWORK = 1,
    CONFIRM_MQTT    = 2,
    CONFIRM_DONE    = 3,
} confirm_phase_t;

static confirm_phase_t s_confirm_phase = CONFIRM_DONE; /* DONE means not pending */
static TimerHandle_t   s_watchdog[3];

static const uint32_t TIMEOUT_MS[3] = {
    30000,      /* Phase 1: 30s boot */
    120000,     /* Phase 2: 2min network */
    300000,     /* Phase 3: 5min MQTT */
};

static void rollback_cb(TimerHandle_t t)
{
    (void)t;
    ESP_LOGE(TAG, "OTA confirmation timeout — rolling back firmware");
    esp_ota_mark_app_invalid_rollback_and_reboot();
}

/* ---- FW-10: ota/status 进度上报 ---- */
static void ota_publish_status(const char *state, int progress_pct,
                               const char *message)
{
    char topic[96];
    snprintf(topic, sizeof(topic), "%s/%s/ota/status",
             MQTT_TOPIC_PREFIX, mqtt_client_get_device_id());

    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp",    (double)time(NULL));
    cJSON_AddStringToObject(root, "device_id",    mqtt_client_get_device_id());
    cJSON_AddStringToObject(root, "state",        state);
    cJSON_AddNumberToObject(root, "progress_pct", progress_pct);
    cJSON_AddStringToObject(root, "message",      message);
    char *js = cJSON_PrintUnformatted(root);
    if (js) {
        mqtt_publish(topic, js, 1);   /* QoS 1，离线时告警类消息入队 */
        free(js);
    }
    cJSON_Delete(root);
}

/* ---- OTA download task ---- */
static void ota_task(void *arg)
{
    char *url = (char *)arg;

    ESP_LOGI(TAG, "OTA start: %s", url);
    ota_publish_status("downloading", 0, "Starting download");

    /* TLS: 证书 bundle 验证（FW-09 —— crt_bundle_attach 启用后才为真验证） */
    esp_https_ota_config_t ota_cfg = {
        .http_config = &(esp_http_client_config_t){
            .url              = url,
            .timeout_ms       = 30000,
            .keep_alive_enable = true,
            .crt_bundle_attach = esp_crt_bundle_attach,
        },
    };

    esp_https_ota_handle_t ota_handle;
    esp_err_t r = esp_https_ota_begin(&ota_cfg, &ota_handle);
    if (r != ESP_OK) {
        ESP_LOGE(TAG, "OTA begin failed: %s", esp_err_to_name(r));
        ota_publish_status("failed", 0, esp_err_to_name(r));
        goto done;
    }

    esp_app_desc_t new_app_info;
    esp_https_ota_get_img_desc(ota_handle, &new_app_info);
    ESP_LOGI(TAG, "New firmware version: %s", new_app_info.version);

    int last_pct = -1;
    while (1) {
        r = esp_https_ota_perform(ota_handle);
        if (r != ESP_ERR_HTTPS_OTA_IN_PROGRESS) break;
        int progress = esp_https_ota_get_image_len_read(ota_handle);
        int total    = esp_https_ota_get_image_size(ota_handle);
        if (total > 0) {
            int pct = progress * 100 / total;
            ESP_LOGI(TAG, "OTA: %d/%d bytes (%d%%)", progress, total, pct);
            if (pct != last_pct) {           /* 每 1% 变化上报一次 */
                ota_publish_status("downloading", pct, "Downloading firmware");
                last_pct = pct;
            }
        }
    }

    if (r == ESP_OK) {
        ota_publish_status("verifying", 100, "Verifying image");
        r = esp_https_ota_finish(ota_handle);
        if (r == ESP_OK) {
            ESP_LOGI(TAG, "OTA complete — boot partition switched — rebooting");
            ota_publish_status("success", 100, "OTA complete, rebooting");
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        } else {
            ota_publish_status("failed", last_pct, esp_err_to_name(r));
        }
    } else {
        esp_https_ota_abort(ota_handle);
        ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(r));
        ota_publish_status("failed", last_pct > 0 ? last_pct : 0,
                           esp_err_to_name(r));
    }

done:
    free(url);
    vTaskDelete(NULL);
}

/* ---- Public API ---- */
esp_err_t ota_handler_init(void)
{
    /* Check if we're running a pending OTA — start rollback watchdog */
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t   ota_state;
    if (esp_ota_get_state_partition(running, &ota_state) == ESP_OK) {
        if (ota_state == ESP_OTA_IMG_PENDING_VERIFY) {
            ESP_LOGI(TAG, "New firmware pending verify — starting rollback watchdog");
            s_confirm_phase = CONFIRM_BOOT;
            for (int i = 0; i < 3; i++) {
                s_watchdog[i] = xTimerCreate("ota_wd", pdMS_TO_TICKS(TIMEOUT_MS[i]),
                                              pdFALSE, NULL, rollback_cb);
            }
            xTimerStart(s_watchdog[CONFIRM_BOOT], 0);
        } else {
            s_confirm_phase = CONFIRM_DONE;
        }
    }
    ESP_LOGI(TAG, "OTA handler init OK");
    return ESP_OK;
}

esp_err_t ota_handler_start(const char *url)
{
    if (!url || url[0] == '\0') return ESP_ERR_INVALID_ARG;
    char *url_copy = strdup(url);
    if (!url_copy) return ESP_ERR_NO_MEM;
    /* OTA downloads to ota_0 or ota_1 (never factory) */
    xTaskCreate(ota_task, "ota_dl", 12288, url_copy, 1, NULL);
    return ESP_OK;
}

void ota_handler_confirm_boot(void)
{
    if (s_confirm_phase != CONFIRM_BOOT) return;
    xTimerStop(s_watchdog[CONFIRM_BOOT], 0);
    s_confirm_phase = CONFIRM_NETWORK;
    xTimerStart(s_watchdog[CONFIRM_NETWORK], 0);
    ESP_LOGI(TAG, "OTA Phase 1 (boot) confirmed — waiting for network");
}

void ota_handler_confirm_network(void)
{
    if (s_confirm_phase != CONFIRM_NETWORK) return;
    xTimerStop(s_watchdog[CONFIRM_NETWORK], 0);
    s_confirm_phase = CONFIRM_MQTT;
    xTimerStart(s_watchdog[CONFIRM_MQTT], 0);
    ESP_LOGI(TAG, "OTA Phase 2 (network) confirmed — waiting for MQTT");
}

void ota_handler_confirm_mqtt(void)
{
    if (s_confirm_phase != CONFIRM_MQTT) return;
    xTimerStop(s_watchdog[CONFIRM_MQTT], 0);
    s_confirm_phase = CONFIRM_DONE;
    esp_ota_mark_app_valid_cancel_rollback();
    ESP_LOGI(TAG, "OTA Phase 3 (MQTT) confirmed — firmware VALID, rollback cancelled");
}
