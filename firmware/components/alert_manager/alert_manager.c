/*
 * alert_manager.c — 告警规则引擎
 * 4类告警 + NORMAL/WARNING/CRITICAL 状态机 + 2分钟去重
 */
#include "alert_manager.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <string.h>

static const char *TAG = "ALERT";

#define DEDUP_INTERVAL_US  (2LL * 60 * 1000000)  /* 2 minutes */
#define TEMP_WARN_C        75.0f
#define STALL_RPM          200
#define V12_MIN            10.8f
#define V12_MAX            13.2f
#define V5_TOLERANCE       0.25f  /* ±5% of 5V */
#define V33_TOLERANCE      0.165f /* ±5% of 3.3V */
#define WIFI_TIMEOUT_S     60

/* Per-rule state */
typedef struct {
    bool     active;
    int64_t  last_fired_us;  /* ⚠️ int64_t */
    int64_t  active_since_us;
} rule_state_t;

static rule_state_t   s_rules[ALERT_TYPE_COUNT];
static alert_cb_t     s_on_alert = NULL;
static alert_clear_cb_t s_on_clear = NULL;
static alert_severity_t s_severity = ALERT_NORMAL;

/* Shared sensor snapshot */
static float   s_max_temp = 0;
static uint16_t s_fan_rpm[4];
static float   s_v12 = 12.0f, s_v5 = 5.0f, s_v33 = 3.3f;
static bool    s_wifi = true;
static int64_t s_wifi_disconnected_at = 0;

static void fire_alert(alert_type_t type, alert_severity_t sev,
                        const char *msg, float val, float thresh)
{
    int64_t now = esp_timer_get_time();
    rule_state_t *r = &s_rules[type];

    if (r->active && (now - r->last_fired_us) < DEDUP_INTERVAL_US) return;

    r->active        = true;
    r->last_fired_us = now;

    /* Update overall severity */
    if (sev > s_severity) s_severity = sev;

    alert_event_t ev = {
        .type      = type,
        .severity  = sev,
        .value     = val,
        .threshold = thresh,
    };
    strncpy(ev.message, msg, sizeof(ev.message) - 1);

    ESP_LOGW(TAG, "ALERT [%d]: %s (val=%.2f, thresh=%.2f)", type, msg, val, thresh);
    if (s_on_alert) s_on_alert(&ev);
}

static void clear_rule(alert_type_t type)
{
    if (s_rules[type].active) {
        s_rules[type].active = false;
        ESP_LOGI(TAG, "ALERT_CLEARED [%d]", type);
        if (s_on_clear) s_on_clear(type);
    }
}

esp_err_t alert_manager_init(alert_cb_t on_alert, alert_clear_cb_t on_clear)
{
    memset(s_rules, 0, sizeof(s_rules));
    s_on_alert = on_alert;
    s_on_clear = on_clear;
    s_severity = ALERT_NORMAL;
    ESP_LOGI(TAG, "Alert manager init OK (4 rules, 2-min dedup)");
    return ESP_OK;
}

void alert_manager_update_temperature(float max_temp_c) { s_max_temp = max_temp_c; }
void alert_manager_update_fan_rpm(uint8_t i, uint16_t rpm)
    { if (i < 4) s_fan_rpm[i] = rpm; }
void alert_manager_update_voltages(float v12, float v5, float v33)
    { s_v12 = v12; s_v5 = v5; s_v33 = v33; }
void alert_manager_update_wifi(bool connected)
{
    if (!connected && s_wifi)
        s_wifi_disconnected_at = esp_timer_get_time();
    s_wifi = connected;
}

void alert_manager_check_all(void)
{
    alert_severity_t new_sev = ALERT_NORMAL;

    /* Rule 1: temperature_high */
    if (s_max_temp > TEMP_WARN_C) {
        alert_severity_t sev = (s_max_temp > 80.0f) ? ALERT_CRITICAL : ALERT_WARNING;
        char msg[64];
        snprintf(msg, sizeof(msg), "Temperature %.1f°C > %.0f°C", s_max_temp, TEMP_WARN_C);
        fire_alert(ALERT_TYPE_TEMPERATURE, sev, msg, s_max_temp, TEMP_WARN_C);
        if (sev > new_sev) new_sev = sev;
    } else {
        clear_rule(ALERT_TYPE_TEMPERATURE);
    }

    /* Rule 2: fan_stall */
    for (int i = 0; i < 4; i++) {
        if (s_fan_rpm[i] > 0 && s_fan_rpm[i] < STALL_RPM) {
            char msg[64];
            snprintf(msg, sizeof(msg), "Fan %d stalled: %u RPM", i, s_fan_rpm[i]);
            fire_alert(ALERT_TYPE_FAN_STALL, ALERT_CRITICAL, msg, s_fan_rpm[i], STALL_RPM);
            if (ALERT_CRITICAL > new_sev) new_sev = ALERT_CRITICAL;
        }
    }

    /* Rule 3: voltage_abnormal */
    bool volt_ok = (s_v12 >= V12_MIN && s_v12 <= V12_MAX) &&
                   (fabsf(s_v5  - 5.0f)  <= V5_TOLERANCE) &&
                   (fabsf(s_v33 - 3.3f) <= V33_TOLERANCE);
    if (!volt_ok) {
        char msg[64];
        snprintf(msg, sizeof(msg), "Voltage abnormal: 12V=%.2f 5V=%.2f 3.3V=%.2f",
                 s_v12, s_v5, s_v33);
        fire_alert(ALERT_TYPE_VOLTAGE, ALERT_WARNING, msg, s_v12, V12_MIN);
        if (ALERT_WARNING > new_sev) new_sev = ALERT_WARNING;
    } else {
        clear_rule(ALERT_TYPE_VOLTAGE);
    }

    /* Rule 4: wifi_disconnected > 60s */
    if (!s_wifi) {
        int64_t disconn_s = (esp_timer_get_time() - s_wifi_disconnected_at) / 1000000;
        if (disconn_s > WIFI_TIMEOUT_S) {
            char msg[64];
            snprintf(msg, sizeof(msg), "WiFi disconnected for %lld s", (long long)disconn_s);
            fire_alert(ALERT_TYPE_WIFI, ALERT_WARNING, msg, (float)disconn_s, WIFI_TIMEOUT_S);
            if (ALERT_WARNING > new_sev) new_sev = ALERT_WARNING;
        }
    } else {
        clear_rule(ALERT_TYPE_WIFI);
    }

    s_severity = new_sev;
}

alert_severity_t alert_manager_get_severity(void) { return s_severity; }
