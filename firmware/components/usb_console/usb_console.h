/*
 * usb_console.h — USB-CDC 串口命令控制台 (ESP32-S3 原生 USB-OTG)
 * ⚠️ 不使用 UART 转 USB 桥接，直接使用 TinyUSB CDC-ACM
 * ⚠️ 命令处理异步，不在接收回调中阻塞
 */
#pragma once
#include "esp_err.h"

/** 命令处理器函数原型 — 输入: 参数字符串; 输出: JSON 字符串（调用方 free）*/
typedef char *(*console_cmd_handler_t)(const char *args);

/** 初始化 TinyUSB CDC-ACM，启动接收任务 */
esp_err_t usb_console_init(void);

/** 注册自定义命令 (供其他组件调用) */
esp_err_t console_register_command(const char *cmd, console_cmd_handler_t handler);

/** 向 USB-CDC 发送字符串 */
void usb_console_write(const char *str);
