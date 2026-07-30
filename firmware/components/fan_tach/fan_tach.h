/*
 * fan_tach.h — 风扇转速计驱动 (PCNT 硬件脉冲计数)
 * GPIO8-11 ← 分压后约3.0V的Tach脉冲
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

#define FAN_TACH_COUNT 4

typedef void (*fan_stall_cb_t)(uint8_t fan_index);

/** 初始化4个PCNT单元，启动1秒采样定时器 */
esp_err_t fan_tach_init(void);

/** 查询当前RPM；采样窗口=1秒，2脉冲/转 */
uint16_t fan_tach_get_rpm(uint8_t fan_index);

/** 注册停转回调（RPM<200 持续3秒触发一次，之后不重复，直到恢复） */
void fan_tach_on_stall(fan_stall_cb_t cb);
