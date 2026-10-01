/*
 * fan_pwm.h — 风扇 PWM 驱动 (LEDC, 25 kHz)
 * GPIO5-12 → 74AHCT125 ×2 电平转换 → 风扇 PWM Pin4（8 路）
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>

#define FAN_PWM_COUNT 8  /* 8路风扇（ESP32-S3 LEDC 8 通道全占用，硬件决策 D2） */

/** 初始化 LEDC 定时器和8个通道；完成后所有风扇 duty=0%（上电安全态） */
esp_err_t fan_pwm_init(void);

/**
 * 设置风扇目标占空比（常驻软启动任务以每10ms步进1%逼近目标）
 * @param fan_index  0-7
 * @param percent    0-100
 */
esp_err_t fan_pwm_set_duty(uint8_t fan_index, uint8_t percent);

/** 查询当前占空比（0-100%，软启动过程中的实际值） */
uint8_t fan_pwm_get_duty(uint8_t fan_index);
