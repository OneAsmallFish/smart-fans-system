/*
 * wifi_manager.h — WiFi 管理器 (STA + AP Captive Portal) + 按键处理
 * 按键: GPIO47 (配网/重置)，使用内部上拉（v1.2 权威引脚表）
 * ⚠️ 回调函数不可调用 vTaskDelay，使用 esp_rom_delay_us 替代
 * ⚠️ MQTT 启动延迟通过 FreeRTOS Timer 实现（不在 IP 事件处理器内直接调用）
 * ⚠️ SNTP 必须在 IP_EVENT_STA_GOT_IP 事件中启动，不在 STA_CONNECTED 中
 */
#pragma once
#include "esp_err.h"
#include <stdbool.h>

typedef void (*wifi_connected_cb_t)(const char *ip_addr);
typedef void (*wifi_disconnected_cb_t)(void);

/**
 * 初始化 WiFi 栈、事件处理器和按键 GPIO
 * @param on_connected    WiFi 连接+获得 IP 后调用
 * @param on_disconnected WiFi 断开后调用
 */
esp_err_t wifi_manager_init(wifi_connected_cb_t    on_connected,
                             wifi_disconnected_cb_t on_disconnected);

/** 从 NVS 加载凭据并尝试连接；首次启动若无凭据则进入 AP 模式 */
esp_err_t wifi_manager_start(void);

/** 强制进入 AP 模式（配网模式；portal 需输入串口日志打印的 4 位确认码） */
esp_err_t wifi_manager_start_ap(void);

/** 保存新 WiFi 凭据到 NVS 并重启连接 */
esp_err_t wifi_manager_set_credentials(const char *ssid, const char *password);

/** 清除 NVS 中的 WiFi 凭据（fan_ctrl namespace） */
esp_err_t wifi_manager_clear_credentials(void);

/** 恢复出厂：清除 WiFi 凭据 + 曲线/告警配置 + MQTT broker/离线队列（FW-28） */
esp_err_t wifi_manager_factory_reset(void);

bool wifi_manager_is_connected(void);
