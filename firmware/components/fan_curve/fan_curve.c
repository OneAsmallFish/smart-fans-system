/*
 * fan_curve.c — 风扇曲线引擎 (LUT 线性插值 + PID Anti-windup)
 * ⚠️ 不直接控制 PWM（通过 fan_pwm_set_duty() 接口）
 * ⚠️ 不采集传感器数据（温度通过 fan_curve_set_temperature() 注入）
 * v1.2: 8 路；LUT/PID/温度源经 flash_storage(NVS fan_cfg) 持久化（FW-20）
 */
#include "fan_curve.h"
#include "fan_pwm.h"
#include "flash_storage.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

static const char *TAG = "FAN_CURVE";

/* Default LUT curve: {temp°C, duty%} */
static const lut_point_t DEFAULT_LUT[] = {
    { 30.0f, 20 },
    { 40.0f, 40 },
    { 50.0f, 60 },
    { 60.0f, 80 },
    { 70.0f, 100 },
};
#define DEFAULT_LUT_N (sizeof(DEFAULT_LUT) / sizeof(DEFAULT_LUT[0]))

typedef struct {
    curve_mode_t mode;
    uint8_t      temp_source;      /* 0-3 (temp_source_t) */
    lut_point_t  lut[FAN_CURVE_MAX_POINTS];
    uint8_t      lut_n;
    pid_params_t pid;
    /* PID state */
    float integral;
    float prev_error;
    int64_t last_update_us;        /* ⚠️ int64_t for esp_timer_get_time() */
} fan_state_t;

static fan_state_t s_fans[FAN_CURVE_FANS];
static float       s_temps[TEMP_SOURCE_COUNT];  /* indexed by temp_source */
static bool        s_emergency    = false;

/* ---- ADJ-5: temperature_source 字符串映射 ---- */
static const char *SRC_STR[TEMP_SOURCE_COUNT] = {
    "bme280", "ds18b20_0", "ds18b20_1", "internal",
};

int fan_curve_temp_source_from_str(const char *s)
{
    if (!s) return -1;
    for (int i = 0; i < TEMP_SOURCE_COUNT; i++)
        if (strcmp(s, SRC_STR[i]) == 0) return i;
    return -1;
}

const char *fan_curve_temp_source_str(uint8_t source)
{
    return (source < TEMP_SOURCE_COUNT) ? SRC_STR[source] : "unknown";
}

/* ---- NVS persistence（flash_storage fan_cfg namespace，字符串 KV） ---- */
static void save_fan_cfg(uint8_t fan)
{
    char key[16], val[128];
    fan_state_t *f = &s_fans[fan];

    snprintf(key, sizeof(key), "fan%u_lut", fan);
    val[0] = '\0';
    for (uint8_t i = 0; i < f->lut_n; i++) {
        char pt[24];
        snprintf(pt, sizeof(pt), "%s%.1f:%u", i ? "," : "",
                 f->lut[i].temp_c, f->lut[i].duty_pct);
        strlcat(val, pt, sizeof(val));
    }
    storage_write_config(key, val);

    snprintf(key, sizeof(key), "fan%u_pid", fan);
    snprintf(val, sizeof(val), "%.3f,%.3f,%.3f,%.1f",
             f->pid.kp, f->pid.ki, f->pid.kd, f->pid.setpoint_c);
    storage_write_config(key, val);

    snprintf(key, sizeof(key), "fan%u_src", fan);
    snprintf(val, sizeof(val), "%u", f->temp_source);
    storage_write_config(key, val);
}

static void load_fan_cfg(uint8_t fan)
{
    char key[16], val[128];
    fan_state_t *f = &s_fans[fan];

    snprintf(key, sizeof(key), "fan%u_lut", fan);
    if (storage_read_config(key, val, sizeof(val)) == ESP_OK && val[0] != '\0') {
        lut_point_t pts[FAN_CURVE_MAX_POINTS];
        uint8_t n = 0;
        char *p = val;
        while (n < FAN_CURVE_MAX_POINTS) {
            char *comma = strchr(p, ',');
            if (comma) *comma = '\0';
            float t; unsigned d;
            if (sscanf(p, "%f:%u", &t, &d) != 2) break;
            pts[n].temp_c = t;
            pts[n].duty_pct = (d > 100) ? 100 : (uint8_t)d;
            n++;
            if (!comma) break;
            p = comma + 1;
        }
        if (n > 0 && fan_curve_set_lut(fan, pts, n) == ESP_OK) {
            ESP_LOGI(TAG, "fan%u: LUT loaded from NVS (%u pts)", fan, n);
        }
    }

    snprintf(key, sizeof(key), "fan%u_pid", fan);
    if (storage_read_config(key, val, sizeof(val)) == ESP_OK) {
        pid_params_t pid;
        if (sscanf(val, "%f,%f,%f,%f", &pid.kp, &pid.ki, &pid.kd,
                   &pid.setpoint_c) == 4) {
            s_fans[fan].pid = pid;
            s_fans[fan].integral = 0.0f;
        }
    }

    snprintf(key, sizeof(key), "fan%u_src", fan);
    if (storage_read_config(key, val, sizeof(val)) == ESP_OK) {
        int src = atoi(val);
        if (src >= 0 && src < TEMP_SOURCE_COUNT) f->temp_source = (uint8_t)src;
    }
}

/* ---- LUT linear interpolation ---- */
static uint8_t lut_interpolate(const lut_point_t *pts, uint8_t n, float temp)
{
    if (temp <= pts[0].temp_c)   return pts[0].duty_pct;
    if (temp >= pts[n-1].temp_c) return pts[n-1].duty_pct;

    for (uint8_t i = 0; i < n - 1; i++) {
        if (temp >= pts[i].temp_c && temp < pts[i+1].temp_c) {
            float t = (temp - pts[i].temp_c) / (pts[i+1].temp_c - pts[i].temp_c);
            return (uint8_t)(pts[i].duty_pct + t * (pts[i+1].duty_pct - pts[i].duty_pct));
        }
    }
    return pts[n-1].duty_pct;
}

/* ---- PID controller (discrete, anti-windup clamp) ---- */
static uint8_t pid_compute(fan_state_t *f, float temp)
{
    int64_t now_us = esp_timer_get_time();  /* ⚠️ int64_t */
    float dt = (f->last_update_us > 0)
               ? (float)(now_us - f->last_update_us) / 1e6f
               : 1.0f;
    f->last_update_us = now_us;

    float error      = f->pid.setpoint_c - temp;
    float derivative = (dt > 0.0f) ? (error - f->prev_error) / dt : 0.0f;

    f->integral += error * dt;

    /* Anti-windup: clamp integral contribution */
    float I_MAX = 100.0f / (f->pid.ki > 0.0f ? f->pid.ki : 1.0f);
    if (f->integral >  I_MAX) f->integral =  I_MAX;
    if (f->integral < -I_MAX) f->integral = -I_MAX;

    float output = f->pid.kp * error + f->pid.ki * f->integral + f->pid.kd * derivative;
    f->prev_error = error;

    /* Map PID output to duty: 0-100% */
    int duty = (int)(50.0f + output);  /* Centered at 50% */
    if (duty < 0)   duty = 0;
    if (duty > 100) duty = 100;
    return (uint8_t)duty;
}

/* ---- Public API ---- */
esp_err_t fan_curve_init(void)
{
    for (int i = 0; i < FAN_CURVE_FANS; i++) {
        fan_state_t *f  = &s_fans[i];
        f->mode         = CURVE_MODE_LUT;
        f->temp_source  = TEMP_SRC_BME280;
        f->lut_n        = (uint8_t)DEFAULT_LUT_N;
        memcpy(f->lut, DEFAULT_LUT, DEFAULT_LUT_N * sizeof(lut_point_t));
        /* Default PID params */
        f->pid.kp       = 2.0f;
        f->pid.ki       = 0.1f;
        f->pid.kd       = 0.5f;
        f->pid.setpoint_c = 50.0f;
        f->integral     = 0.0f;
        f->prev_error   = 0.0f;
        f->last_update_us = 0;
        load_fan_cfg(i);   /* NVS 有配置则覆盖默认值 */
    }
    memset(s_temps, 0, sizeof(s_temps));
    ESP_LOGI(TAG, "Fan curve engine init OK (8 fans, LUT default 30-70°C)");
    return ESP_OK;
}

void fan_curve_set_temperature(uint8_t source_idx, float temp_c)
{
    if (source_idx < TEMP_SOURCE_COUNT) s_temps[source_idx] = temp_c;
}

void fan_curve_update(float temp_c)
{
    (void)temp_c; /* caller may pass primary temp; we use per-fan sources */

    /* Emergency: any source > threshold → all fans 100% */
    s_emergency = false;
    for (int i = 0; i < TEMP_SOURCE_COUNT; i++) {
        if (s_temps[i] > FAN_CURVE_EMERGENCY_C) { s_emergency = true; break; }
    }
    if (s_emergency) {
        ESP_LOGW(TAG, "EMERGENCY: temperature >%.0f°C, all fans 100%%",
                 FAN_CURVE_EMERGENCY_C);
        for (int i = 0; i < FAN_CURVE_FANS; i++) fan_pwm_set_duty(i, 100);
        return;
    }

    for (int i = 0; i < FAN_CURVE_FANS; i++) {
        fan_state_t *f    = &s_fans[i];
        float        temp = s_temps[f->temp_source];
        uint8_t      duty = 0;

        switch (f->mode) {
            case CURVE_MODE_LUT:
                duty = lut_interpolate(f->lut, f->lut_n, temp);
                break;
            case CURVE_MODE_PID:
                duty = pid_compute(f, temp);
                break;
            case CURVE_MODE_MANUAL:
                continue; /* skip — manual duty set externally */
        }
        fan_pwm_set_duty(i, duty);
    }
}

esp_err_t fan_curve_set_mode(uint8_t fan, curve_mode_t mode)
{
    if (fan >= FAN_CURVE_FANS) return ESP_ERR_INVALID_ARG;
    s_fans[fan].mode = mode;
    return ESP_OK;
}

esp_err_t fan_curve_set_lut(uint8_t fan, const lut_point_t *pts, uint8_t n_pts)
{
    if (fan >= FAN_CURVE_FANS || !pts || n_pts == 0 || n_pts > FAN_CURVE_MAX_POINTS)
        return ESP_ERR_INVALID_ARG;
    /* FW-33: temp_c 必须严格递增，乱序拒绝 */
    for (uint8_t i = 0; i < n_pts; i++) {
        if (pts[i].duty_pct > 100) return ESP_ERR_INVALID_ARG;
        if (i > 0 && !(pts[i].temp_c > pts[i-1].temp_c)) {
            ESP_LOGW(TAG, "fan%u LUT rejected: temp_c not strictly increasing at pt %u",
                     fan, i);
            return ESP_ERR_INVALID_ARG;
        }
    }
    memcpy(s_fans[fan].lut, pts, n_pts * sizeof(lut_point_t));
    s_fans[fan].lut_n = n_pts;
    save_fan_cfg(fan);
    return ESP_OK;
}

esp_err_t fan_curve_set_pid(uint8_t fan, const pid_params_t *params)
{
    if (fan >= FAN_CURVE_FANS || !params) return ESP_ERR_INVALID_ARG;
    s_fans[fan].pid = *params;
    s_fans[fan].integral = 0.0f; /* reset on param change */
    save_fan_cfg(fan);
    return ESP_OK;
}

esp_err_t fan_curve_set_temp_source(uint8_t fan, uint8_t source)
{
    if (fan >= FAN_CURVE_FANS || source >= TEMP_SOURCE_COUNT) return ESP_ERR_INVALID_ARG;
    s_fans[fan].temp_source = source;
    save_fan_cfg(fan);
    return ESP_OK;
}

bool fan_curve_is_manual(uint8_t fan)
{
    if (fan >= FAN_CURVE_FANS) return false;
    return s_fans[fan].mode == CURVE_MODE_MANUAL;
}
