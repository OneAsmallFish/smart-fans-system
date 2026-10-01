/*
 * ota_handler.h — OTA 固件更新 (MQTT + USB-CDC 双触发, 3阶段回滚保护)
 * ⚠️ 不跳过 TLS 证书验证（esp_crt_bundle_attach，FW-09）
 * ⚠️ 不下载到 factory 分区（保留出厂恢复）
 * ⚠️ 3阶段确认: ①启动成功30s ②网络正常2min ③MQTT通信5min
 * ⚠️ 下载进度发布 fan-controller/{id}/ota/status（FW-10）
 */
#pragma once
#include "esp_err.h"

/** 初始化 OTA 处理器（检查 pending-verify 分区，启动回滚看门狗） */
esp_err_t ota_handler_init(void);

/**
 * 触发 OTA 下载（可由 MQTT command/ota 或 USB 命令 "ota URL" 调用）
 * @param url  HTTPS 固件 URL
 */
esp_err_t ota_handler_start(const char *url);

/** 新固件首次启动后调用——推进三阶段确认状态机 */
void ota_handler_confirm_boot(void);
void ota_handler_confirm_network(void);
void ota_handler_confirm_mqtt(void);
