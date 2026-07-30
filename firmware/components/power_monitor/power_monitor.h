/*
 * power_monitor.h — 电源电压监控驱动 (ADC1)
 * ⚠️ 仅使用 ADC1（ADC2 与 WiFi 冲突）
 * 12V: 100kΩ+20kΩ 分压 → ~2.0V @ADC (VOLTAGE_DIVIDER_12V = 6.0)
 * 5V:  10kΩ+10kΩ  分压 → ~2.5V @ADC (VOLTAGE_DIVIDER_5V  = 2.0)
 * 3.3V:10kΩ+10kΩ  分压 → ~1.65V@ADC (VOLTAGE_DIVIDER_3V3 = 2.0)
 */
#pragma once
#include "esp_err.h"
#include <stdbool.h>

/* 分压比宏 (actual_V = adc_V * ratio) */
#define VOLTAGE_DIVIDER_12V  6.0f    /* 100k/(100k+20k) = 1/6 → ×6 */
#define VOLTAGE_DIVIDER_5V   2.0f    /* 10k/(10k+10k)   = 1/2 → ×2 */
#define VOLTAGE_DIVIDER_3V3  2.0f    /* 10k/(10k+10k)   = 1/2 → ×2 */

typedef void (*power_fail_cb_t)(void);

/** 初始化 ADC1，配置三个通道和内部温度传感器 */
esp_err_t power_monitor_init(void);

/**
 * 读取全部电源电压（16次均值滤波）
 * @param v12  输出 12V 实际电压 (V)
 * @param v5   输出 5V 实际电压 (V)
 * @param v33  输出 3.3V 实际电压 (V)
 */
esp_err_t power_monitor_read_all(float *v12, float *v5, float *v33);

/** 读取 ESP32-S3 内部温度传感器 (°C) */
float power_monitor_read_internal_temp(void);

/** 注册断电回调（12V 连续3次低于 10.0V 时触发，只触发一次直到恢复） */
void power_monitor_on_power_fail(power_fail_cb_t cb);
