/*
 * fan_curve.c — 风扇曲线引擎 (LUT 线性插值 + PID Anti-windup)
 * ⚠️ 不直接控制 PWM（通过 fan_pwm_set_duty() 接口）
 * ⚠️ 不采集传感器数据（温度通过 fan_curve_set_temperature() 注入）
 */
#include "fan_curve.h"
#include "fan_pwm/fan_pwm.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <string.h>
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
    uint8_t      temp_source;      /* 0-3 */
    lut_point_t  lut[FAN_CURVE_MAX_POINTS];
    uint8_t      lut_n;
    pid_params_t pid;
    /* PID state */
    float integral;
    float prev_error;
    int64_t last_update_us;        /* ⚠️ int64_t for esp_timer_get_time() */
} fan_state_t;

static fan_state_t s_fans[FAN_CURVE_FANS];
static float       s_temps[4];    /* indexed by temp_source */
static bool        s_emergency    = false;

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
        f->temp_source  = 0;
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
    }
    memset(s_temps, 0, sizeof(s_temps));
    ESP_LOGI(TAG, "Fan curve engine init OK (LUT default, 30-70°C range)");
    return ESP_OK;
}

void fan_curve_set_temperature(uint8_t source_idx, float temp_c)
{
    if (source_idx < 4) s_temps[source_idx] = temp_c;
}

void fan_curve_update(float temp_c)
{
    (void)temp_c; /* caller may pass primary temp; we use per-fan sources */

    /* Emergency: any source > threshold → all fans 100% */
    s_emergency = false;
    for (int i = 0; i < 4; i++) {
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
    memcpy(s_fans[fan].lut, pts, n_pts * sizeof(lut_point_t));
    s_fans[fan].lut_n = n_pts;
    return ESP_OK;
}

esp_err_t fan_curve_set_pid(uint8_t fan, const pid_params_t *params)
{
    if (fan >= FAN_CURVE_FANS || !params) return ESP_ERR_INVALID_ARG;
    s_fans[fan].pid = *params;
    s_fans[fan].integral = 0.0f; /* reset on param change */
    return ESP_OK;
}

esp_err_t fan_curve_set_temp_source(uint8_t fan, uint8_t source)
{
    if (fan >= FAN_CURVE_FANS || source >= 4) return ESP_ERR_INVALID_ARG;
    s_fans[fan].temp_source = source;
    return ESP_OK;
}
