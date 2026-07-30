/*
 * bme280.h — BME280 环境传感器驱动 (I2C, 固件侧)
 * I2C地址: 0x76 (SDO=GND), 总线: I2C_NUM_0, GPIO17(SDA)/GPIO18(SCL)
 */
#pragma once
#include "esp_err.h"

typedef struct {
    float temperature_c;    /* °C, 0.01°C 分辨率 */
    float humidity_pct;     /* % RH, 0.008%RH 分辨率 */
    float pressure_hpa;     /* hPa, 0.18 Pa 分辨率 */
} bme280_data_t;

/** 初始化 I2C 驱动和 BME280，执行 forced-mode 配置 */
esp_err_t bme280_init(void);

/** 触发一次测量并等待就绪（forced mode，~10ms）; 结果写入 out */
esp_err_t bme280_read(bme280_data_t *out);
