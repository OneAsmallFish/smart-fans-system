/*
 * status_led.h — WS2812B-2020 RGB 状态指示灯驱动
 * 平台: ESP32-S3  外设: RMT (TX)
 * GPIO45, VCC=3.3V (⚠️ 不接5V，3.3V时VIH_min=2.31V < GPIO VOH=3.0V ✓)
 * GPIO45 为 strapping(VDD_SPI 电压) 引脚：WS2812 DIN 为高阻输入，
 * 复位期内部下拉保持 VDD_SPI=3.3V，安全（硬件决策 D5/权威引脚表 §1）
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>

/* ---- 工作模式 ---- */
typedef enum {
    LED_MODE_NORMAL,            /* 绿色呼吸 — 正常运行     */
    LED_MODE_WARNING,           /* 黄色慢闪 — 警告         */
    LED_MODE_ERROR,             /* 红色快闪 — 严重告警     */
    LED_MODE_WIFI_DISCONNECTED, /* 蓝色慢闪 — WiFi断开     */
    LED_MODE_OTA,               /* 紫色呼吸 — OTA更新中   */
    LED_MODE_OFF,               /* 关闭                   */
} led_mode_t;

/** 初始化 RMT + GPIO，完成后设置为 LED_MODE_OFF；返回底层错误码 */
esp_err_t status_led_init(void);

/** 切换工作模式；内部 50ms 定时器驱动动画 */
void status_led_set_mode(led_mode_t mode);

/** 立即设置 RGB 颜色（r/g/b 0-255，覆盖当前模式动画） */
void status_led_set_rgb(uint8_t r, uint8_t g, uint8_t b);

/** 供 FreeRTOS 定时器回调调用，推进动画帧 */
void status_led_tick(void);
