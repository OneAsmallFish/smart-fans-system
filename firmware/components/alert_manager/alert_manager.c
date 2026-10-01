/*
 * alert_manager.c — 告警规则引擎
 * 4类告警 + NORMAL/WARNING/CRITICAL 状态机 + 2分钟去重
 * v1.2: 8 路风扇；停转判定 duty>5% 且 RPM<200（0% 占空比合法停转不告警）
 */
#include "alert_manager.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <string.h>
#include <stdio.h>
#include <math.h>

static const char *TAG = "ALERT";

#define DEDUP_INTERVAL_US  (2LL * 60 * 1000000)  /* 2 minutes */
#define STALL_DUTY_PCT     5    /* 停转判定要求 duty 高于此值（%） */
#define V5_NOMINAL          5.0f
#define V5_TOLERANCE        0.25f   /* ±5% of 5V */
#define V33_NOMINAL         3.3f
#define V33_TOLERANCE       0.165f  /* ±5% of 3.3V */

/* Per-rule state */
typedef struct {
    bool     active;
    int64_t  last_fired_us;  /* ⚠️ int64_t */
    int64_t  active_since_us;
} rule_state_t;

static rule_state_t     s_rules[ALERT_TYPE_COUNT];
static alert_cb_t       s_on_alert = NULL;
static alert_clear_cb_t s_on_clear = NULL;
static alert_severity_t s_severity = ALERT_NORMAL;

/* Shared sensor snapshot */
static float     s_max_temp = 0;
static uint16_t  s_fan_rpm[ALERT_FAN_COUNT];
static uint8_t   s_fan_duty[ALERT_FAN_COUNT];
static float     s_v12 = 12.0f, s_v5 = 5.0f, s_v33 = 3.3f;
static bool      s_wifi = false;   /* 初值 false：从未联网也能报 wifi_disconnected */
static int64_t   s_wifi_disconnected_at = 0;

/* Configurable thresholds (ADJ-14 defaults) */
static alert_thresholds_t s_thresh = {
    .temp_warn_c    = 75.0f,
    .temp_crit_c    = 80.0f,
    .v12_min        = 10.8f,
    .v12_max        = 13.2f,
    .stall_rpm      = 200,
    .wifi_timeout_s = 60,
};

/* ---- 协议 §5 字符串映射 ---- */
static const char *TYPE_STR[ALERT_TYPE_COUNT] = {
    "temperature_high", "fan_stall", "voltage_abnormal", "wifi_disconnected",
};
static const char *TYPE_SENSOR[ALERT_TYPE_COUNT] = {
    "bme280", "fan", "power", "wifi",
};

const char *alert_type_to_string(alert_type_t type)
    { return (type < ALERT_TYPE_COUNT) ? TYPE_STR[type] : "unknown"; }

alert_type_t alert_type_from_string(const char *str)
{
    if (!str) return ALERT_TYPE_COUNT;
    for (int i = 0; i < ALERT_TYPE_COUNT; i++)
        if (strcmp(str, TYPE_STR[i]) == 0) return (alert_type_t)i;
    return ALERT_TYPE_COUNT;
}

const char *alert_severity_to_string(alert_severity_t s)
{
    switch (s) {
        case ALERT_WARNING:  return "warning";
        case ALERT_CRITICAL: return "critical";
        default:             return "normal";
    }
}

const char *alert_type_sensor(alert_type_t type)
    { return (type < ALERT_TYPE_COUNT) ? TYPE_SENSOR[type] : "unknown"; }

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

    ESP_LOGW(TAG, "ALERT [%s]: %s (val=%.2f, thresh=%.2f)",
             alert_type_to_string(type), msg, val, thresh);
    if (s_on_alert) s_on_alert(&ev);
}

static void clear_rule(alert_type_t type)
{
    if (s_rules[type].active) {
        s_rules[type].active = false;
        ESP_LOGI(TAG, "ALERT_CLEARED [%s]", alert_type_to_string(type));
        if (s_on_clear) s_on_clear(type);
    }
}

esp_err_t alert_manager_init(alert_cb_t on_alert, alert_clear_cb_t on_clear)
{
    memset(s_rules, 0, sizeof(s_rules));
    s_on_alert = on_alert;
    s_on_clear = on_clear;
    s_severity = ALERT_NORMAL;
    ESP_LOGI(TAG, "Alert manager init OK (4 rules, 2-min dedup, %d fans)",
             ALERT_FAN_COUNT);
    return ESP_OK;
}

void alert_manager_update_temperature(float max_temp_c) { s_max_temp = max_temp_c; }
void alert_manager_update_fan_rpm(uint8_t i, uint16_t rpm)
    { if (i < ALERT_FAN_COUNT) s_fan_rpm[i] = rpm; }
void alert_manager_update_fan_duty(uint8_t i, uint8_t duty_pct)
    { if (i < ALERT_FAN_COUNT) s_fan_duty[i] = duty_pct; }
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

    /* Rule 1: temperature_high（三源最大值，含 DS18B20 探头，FW-26） */
    if (s_max_temp > s_thresh.temp_warn_c) {
        alert_severity_t sev = (s_max_temp > s_thresh.temp_crit_c)
                               ? ALERT_CRITICAL : ALERT_WARNING;
        char msg[64];
        snprintf(msg, sizeof(msg), "Temperature %.1f°C > %.0f°C",
                 s_max_temp, s_thresh.temp_warn_c);
        fire_alert(ALERT_TYPE_TEMPERATURE, sev, msg, s_max_temp, s_thresh.temp_warn_c);
        if (sev > new_sev) new_sev = sev;
    } else {
        clear_rule(ALERT_TYPE_TEMPERATURE);
    }

    /* Rule 2: fan_stall —— duty>5% 且 RPM<stall_rpm（0% 占空比合法停转除外） */
    bool any_stall = false;
    for (int i = 0; i < ALERT_FAN_COUNT; i++) {
        if (s_fan_duty[i] > STALL_DUTY_PCT && s_fan_rpm[i] < s_thresh.stall_rpm) {
            any_stall = true;
            char msg[64];
            snprintf(msg, sizeof(msg), "Fan %d stalled: %u RPM (duty %u%%)",
                     i, s_fan_rpm[i], s_fan_duty[i]);
            fire_alert(ALERT_TYPE_FAN_STALL, ALERT_CRITICAL, msg,
                       s_fan_rpm[i], s_thresh.stall_rpm);
            if (ALERT_CRITICAL > new_sev) new_sev = ALERT_CRITICAL;
        }
    }
    if (!any_stall) clear_rule(ALERT_TYPE_FAN_STALL);  /* FW-25: 恢复补 clear */

    /* Rule 3: voltage_abnormal（12V 窗口 + 5V/3.3V 容差） */
    bool volt_ok = (s_v12 >= s_thresh.v12_min && s_v12 <= s_thresh.v12_max) &&
                   (fabsf(s_v5  - V5_NOMINAL)  <= V5_TOLERANCE) &&
                   (fabsf(s_v33 - V33_NOMINAL) <= V33_TOLERANCE);
    if (!volt_ok) {
        char msg[64];
        snprintf(msg, sizeof(msg), "Voltage abnormal: 12V=%.2f 5V=%.2f 3.3V=%.2f",
                 s_v12, s_v5, s_v33);
        fire_alert(ALERT_TYPE_VOLTAGE, ALERT_WARNING, msg, s_v12, s_thresh.v12_min);
        if (ALERT_WARNING > new_sev) new_sev = ALERT_WARNING;
    } else {
        clear_rule(ALERT_TYPE_VOLTAGE);
    }

    /* Rule 4: wifi_disconnected > wifi_timeout_s */
    if (!s_wifi) {
        int64_t disconn_s = (esp_timer_get_time() - s_wifi_disconnected_at) / 1000000;
        if (disconn_s > s_thresh.wifi_timeout_s) {
            char msg[64];
            snprintf(msg, sizeof(msg), "WiFi disconnected for %lld s",
                     (long long)disconn_s);
            fire_alert(ALERT_TYPE_WIFI, ALERT_WARNING, msg,
                       (float)disconn_s, s_thresh.wifi_timeout_s);
            if (ALERT_WARNING > new_sev) new_sev = ALERT_WARNING;
        }
    } else {
        clear_rule(ALERT_TYPE_WIFI);
    }

    s_severity = new_sev;
}

alert_severity_t alert_manager_get_severity(void) { return s_severity; }

void alert_manager_get_thresholds(alert_thresholds_t *out)
{
    if (out) *out = s_thresh;
}

void alert_manager_set_thresholds(const alert_thresholds_t *th)
{
    if (!th) return;
    if (th->temp_warn_c > 0)    s_thresh.temp_warn_c    = th->temp_warn_c;
    if (th->temp_crit_c > th->temp_warn_c) s_thresh.temp_crit_c = th->temp_crit_c;
    if (th->v12_min > 0)        s_thresh.v12_min        = th->v12_min;
    if (th->v12_max > th->v12_min) s_thresh.v12_max     = th->v12_max;
    if (th->stall_rpm > 0)      s_thresh.stall_rpm      = th->stall_rpm;
    if (th->wifi_timeout_s > 0) s_thresh.wifi_timeout_s = th->wifi_timeout_s;
    ESP_LOGI(TAG, "Thresholds updated: warn=%.1f crit=%.1f 12V=%.1f-%.1f stall=%u wifi=%us",
             s_thresh.temp_warn_c, s_thresh.temp_crit_c,
             s_thresh.v12_min, s_thresh.v12_max,
             s_thresh.stall_rpm, s_thresh.wifi_timeout_s);
}
