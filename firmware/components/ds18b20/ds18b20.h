/*
 * ds18b20.h — DS18B20 OneWire 温度传感器驱动
 * 实现方式: GPIO bit-bang + esp_rom_delay_us 精确时序（非 RMT；
 * RMT 迁移为可选优化项）。1-2 个传感器 @1Hz 读取场景足够。
 * GPIO16, 4.7kΩ上拉到3.3V, 最多4个传感器。
 * ⚠️ 不支持寄生供电（parasitic power）模式——硬件需外接强上拉供电。
 */
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

#define DS18B20_MAX_SENSORS 4
#define DS18B20_ROM_SIZE    8  /* 64-bit ROM code */
#define DS18B20_ADDR_STR_LEN 17  /* "28-" + 12 hex + NUL */

typedef struct {
    uint8_t  rom[DS18B20_ROM_SIZE];
    float    temperature_c;
    bool     valid;
} ds18b20_sensor_t;

/** 初始化 OneWire 驱动，执行 ROM 搜索枚举所有传感器 */
esp_err_t ds18b20_init(void);

/**
 * 触发所有传感器转换并读取结果
 * @param sensors  输出缓冲区 (ds18b20_sensor_t[DS18B20_MAX_SENSORS])
 * @param count    输出实际找到的传感器数量
 */
esp_err_t ds18b20_read_all(ds18b20_sensor_t *sensors, uint8_t *count);

/** ROM 地址 → 协议字符串格式 "28-xxxxxxxxxxxx"（FW-18/ADJ-6，HA 按 address 匹配） */
void ds18b20_address_str(const uint8_t rom[DS18B20_ROM_SIZE],
                         char *out, size_t out_len);

/** CRC8 校验（Dallas/Maxim 多项式 0x31）*/
uint8_t ds18b20_crc8(const uint8_t *data, uint8_t len);
