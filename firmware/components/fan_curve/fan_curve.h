/*
 * fan_curve.h — 风扇曲线引擎：固定查表 (LUT) + PID 自适应双模式
 * 每路风扇独立配置；通过 fan_pwm_set_duty() 输出
 * v1.2: 8 路；LUT/PID/温度源配置经 flash_storage 持久化到 NVS
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

#define FAN_CURVE_FANS         8
#define FAN_CURVE_MAX_POINTS   10   /* LUT 最多10个 (temp, duty) 点 */
#define FAN_CURVE_EMERGENCY_C  80.0f /* 温度超过此值 → 所有风扇100% */
#define TEMP_SOURCE_COUNT      4    /* 温度源数量 */

/* ADJ-5: 协议 §4.2 temperature_source 字符串枚举（4 个合法值） */
typedef enum {
    TEMP_SRC_BME280    = 0,   /* "bme280"    */
    TEMP_SRC_DS18B20_0 = 1,   /* "ds18b20_0" */
    TEMP_SRC_DS18B20_1 = 2,   /* "ds18b20_1" */
    TEMP_SRC_INTERNAL  = 3,   /* "internal"  */
} temp_source_t;

typedef enum { CURVE_MODE_LUT, CURVE_MODE_PID, CURVE_MODE_MANUAL } curve_mode_t;

typedef struct { float temp_c; uint8_t duty_pct; } lut_point_t;

typedef struct {
    float kp, ki, kd;
    float setpoint_c;
} pid_params_t;

/** 初始化风扇曲线引擎，从 NVS 加载配置（首次使用默认曲线） */
esp_err_t fan_curve_init(void);

/** 更新所有风扇转速（每1秒由 fan_control_task 调用）*/
void fan_curve_update(float temp_c);

/** 设置风扇N的曲线模式 */
esp_err_t fan_curve_set_mode(uint8_t fan, curve_mode_t mode);

/** 设置 LUT 曲线点（校验 temp_c 严格递增，保存到 NVS）*/
esp_err_t fan_curve_set_lut(uint8_t fan, const lut_point_t *pts, uint8_t n_pts);

/** 设置 PID 参数（保存到 NVS） */
esp_err_t fan_curve_set_pid(uint8_t fan, const pid_params_t *params);

/** 设置温度源（0=bme280, 1=ds18b20_0, 2=ds18b20_1, 3=internal；保存到 NVS） */
esp_err_t fan_curve_set_temp_source(uint8_t fan, uint8_t source);

/** 注册温度源读数（由 sensor_task 每秒更新） */
void fan_curve_set_temperature(uint8_t source_idx, float temp_c);

/** 当前控制模式是否手动（FW-21: fan state 的 mode 字段） */
bool fan_curve_is_manual(uint8_t fan);

/* ---- ADJ-5: temperature_source 字符串 ↔ 源编号 ---- */
/** 协议字符串 → 源编号；非法字符串返回 -1 */
int fan_curve_temp_source_from_str(const char *s);
const char *fan_curve_temp_source_str(uint8_t source);
