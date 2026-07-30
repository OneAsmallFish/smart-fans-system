/*
 * ds18b20.h — DS18B20 OneWire 温度传感器驱动 (RMT)
 * GPIO16, 4.7kΩ上拉到3.3V, 最多4个传感器
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

#define DS18B20_MAX_SENSORS 4
#define DS18B20_ROM_SIZE    8  /* 64-bit ROM code */

typedef struct {
    uint8_t  rom[DS18B20_ROM_SIZE];
    float    temperature_c;
    bool     valid;
} ds18b20_sensor_t;

/** 初始化 RMT OneWire 驱动，执行 ROM 搜索枚举所有传感器 */
esp_err_t ds18b20_init(void);

/**
 * 触发所有传感器转换并读取结果
 * @param sensors  输出缓冲区 (ds18b20_sensor_t[DS18B20_MAX_SENSORS])
 * @param count    输出实际找到的传感器数量
 */
esp_err_t ds18b20_read_all(ds18b20_sensor_t *sensors, uint8_t *count);

/** CRC8 校验（Dallas/Maxim 多项式 0x31）*/
uint8_t ds18b20_crc8(const uint8_t *data, uint8_t len);
