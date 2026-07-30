/*
 * fan_curve.h — 风扇曲线引擎：固定查表 (LUT) + PID 自适应双模式
 * 每路风扇独立配置；通过 fan_pwm_set_duty() 输出
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

#define FAN_CURVE_FANS         4
#define FAN_CURVE_MAX_POINTS   10   /* LUT 最多10个 (temp, duty) 点 */
#define FAN_CURVE_EMERGENCY_C  80.0f /* 温度超过此值 → 所有风扇100% */

typedef enum { CURVE_MODE_LUT, CURVE_MODE_PID, CURVE_MODE_MANUAL } curve_mode_t;

typedef struct { float temp_c; uint8_t duty_pct; } lut_point_t;

typedef struct {
    float kp, ki, kd;
    float setpoint_c;
} pid_params_t;

/** 初始化风扇曲线引擎，从 NVS 加载配置（首次使用默认曲线） */
esp_err_t fan_curve_init(void);

/** 更新所有风扇转速（每1秒由 sensor_task 调用）*/
void fan_curve_update(float temp_c);

/** 设置风扇N的曲线模式 */
esp_err_t fan_curve_set_mode(uint8_t fan, curve_mode_t mode);

/** 设置 LUT 曲线点（保存到 NVS）*/
esp_err_t fan_curve_set_lut(uint8_t fan, const lut_point_t *pts, uint8_t n_pts);

/** 设置 PID 参数 */
esp_err_t fan_curve_set_pid(uint8_t fan, const pid_params_t *params);

/** 设置温度源（0=BME280, 1=DS18B20[0], 2=DS18B20[1], 3=GPU/CPU） */
esp_err_t fan_curve_set_temp_source(uint8_t fan, uint8_t source);

/** 注册温度源回调（由 sensor_task 每秒更新） */
void fan_curve_set_temperature(uint8_t source_idx, float temp_c);
