/*
 * fan_pwm.h — 风扇 PWM 驱动 (LEDC, 25 kHz)
 * GPIO4-7 → 74AHCT125 电平转换 → 风扇 PWM Pin4
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>

#define FAN_PWM_COUNT 4  /* 4路风扇 */

/** 初始化 LEDC 定时器和4个通道；完成后所有风扇 duty=0% */
esp_err_t fan_pwm_init(void);

/**
 * 设置风扇占空比（带软启动，每10ms步进1%）
 * @param fan_index  0-3
 * @param percent    0-100
 */
esp_err_t fan_pwm_set_duty(uint8_t fan_index, uint8_t percent);

/** 查询当前占空比（0-100%） */
uint8_t fan_pwm_get_duty(uint8_t fan_index);
