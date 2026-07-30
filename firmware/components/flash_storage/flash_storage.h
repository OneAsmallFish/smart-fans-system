/*
 * flash_storage.h — NVS 配置 + Wear Levelling 循环日志
 * ⚠️ 日志间隔 ≥ 30s（减少 Flash 擦写）
 * ⚠️ 不直接操作 Flash 原始地址（使用 NVS + WL API）
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

#define STORAGE_LOG_MAX_ENTRIES 1024  /* 循环缓冲区容量 */
#define STORAGE_LOG_MIN_INTERVAL_S 30 /* 最短写入间隔 */

typedef struct {
    uint32_t timestamp;
    float    temps[4];      /* BME280 + DS18B20×2 + internal */
    uint16_t fan_rpm[4];    /* 4路风扇转速 */
    float    voltages[3];   /* 12V / 5V / 3.3V */
} log_entry_t;

/** 初始化 NVS 命名空间和 WL 分区 */
esp_err_t flash_storage_init(void);

/** NVS 字符串配置读写 */
esp_err_t storage_write_config(const char *key, const char *value);
esp_err_t storage_read_config(const char *key, char *out_val, size_t max_len);

/** 写入一条传感器日志（内部节流，< 30s 间隔则跳过） */
esp_err_t storage_log_sensor_data(const log_entry_t *entry);

/**
 * 读取最近 N 条日志（最多 STORAGE_LOG_MAX_ENTRIES）
 * @param out    调用方分配的缓冲区
 * @param count  请求条数；输出实际返回条数
 */
esp_err_t storage_get_recent_logs(log_entry_t *out, uint32_t *count);

uint32_t storage_get_log_count(void);
