/*
 * ds18b20.c — DS18B20 OneWire 温度传感器驱动（GPIO bit-bang 实现）
 * 复位脉冲: 480µs LOW + 等待 70µs presence + 410µs
 * 写0槽: 60µs LOW;  写1槽: 1µs LOW + 59µs HIGH
 * 读槽:  1µs LOW + 14µs + 采样 + 45µs
 * 时序由 esp_rom_delay_us 保证（读取期间短暂关抢占可接受 @1Hz）。
 * RMT 硬件化迁移为可选优化项，不强制（FW-24 口径）。
 */
#include "ds18b20.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_rx.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_rom_sys.h"
#include <string.h>
#include <stdio.h>

static const char *TAG = "DS18B20";

#define OW_GPIO     16
#define OW_CMD_SKIP_ROM    0xCC
#define OW_CMD_SEARCH_ROM  0xF0
#define OW_CMD_READ_ROM    0x33
#define OW_CMD_MATCH_ROM   0x55
#define OW_CMD_CONVERT_T   0x44
#define OW_CMD_READ_SCRATCHPAD 0xBE

static ds18b20_sensor_t s_sensors[DS18B20_MAX_SENSORS];
static uint8_t          s_count = 0;

/* ---- Bit-bang OneWire using GPIO (timing via esp_rom_delay_us) ---- */
/* NOTE: For production use, RMT is preferred; this GPIO implementation
 * works on ESP32-S3 where GPIO direct access is fast enough.
 * RMT-based implementation would use async TX/RX; GPIO is simpler
 * and sufficient for 1-2 sensors at 1Hz read rate. */

static void ow_drive_low(void)
{
    gpio_set_direction(OW_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(OW_GPIO, 0);
}

static void ow_release(void)
{
    gpio_set_direction(OW_GPIO, GPIO_MODE_INPUT);
}

static int ow_read_bit(void)
{
    ow_drive_low();
    esp_rom_delay_us(1);
    ow_release();
    esp_rom_delay_us(14);
    int bit = gpio_get_level(OW_GPIO);
    esp_rom_delay_us(45);
    return bit;
}

static void ow_write_bit(int bit)
{
    if (bit) {
        ow_drive_low();
        esp_rom_delay_us(1);
        ow_release();
        esp_rom_delay_us(59);
    } else {
        ow_drive_low();
        esp_rom_delay_us(60);
        ow_release();
        esp_rom_delay_us(1);
    }
}

/** Returns true if a device responded with presence pulse */
static bool ow_reset(void)
{
    ow_drive_low();
    esp_rom_delay_us(480);
    ow_release();
    esp_rom_delay_us(70);
    bool present = (gpio_get_level(OW_GPIO) == 0);
    esp_rom_delay_us(410);
    return present;
}

static void ow_write_byte(uint8_t byte)
{
    for (int i = 0; i < 8; i++) {
        ow_write_bit(byte & 1);
        byte >>= 1;
    }
}

static uint8_t ow_read_byte(void)
{
    uint8_t val = 0;
    for (int i = 0; i < 8; i++) {
        val |= (ow_read_bit() << i);
    }
    return val;
}

/* ---- CRC8 (Dallas/Maxim polynomial 0x31 = x^8+x^5+x^4+1) ---- */
uint8_t ds18b20_crc8(const uint8_t *data, uint8_t len)
{
    uint8_t crc = 0;
    for (uint8_t i = 0; i < len; i++) {
        uint8_t byte = data[i];
        for (int j = 0; j < 8; j++) {
            uint8_t mix = (crc ^ byte) & 0x01;
            crc >>= 1;
            if (mix) crc ^= 0x8C;
            byte >>= 1;
        }
    }
    return crc;
}

/* ---- ROM Search (standard algorithm) ---- */
static uint8_t s_last_discrepancy;
static bool    s_search_done;
static uint8_t s_rom_no[DS18B20_ROM_SIZE];

static bool search_next(uint8_t *rom_out)
{
    if (s_search_done) return false;
    if (!ow_reset()) { s_search_done = true; return false; }

    ow_write_byte(OW_CMD_SEARCH_ROM);

    uint8_t  last_zero         = 0;
    uint8_t  last_family_discrepancy = 0;
    uint8_t  rom[DS18B20_ROM_SIZE];
    memcpy(rom, s_rom_no, DS18B20_ROM_SIZE);

    for (int i = 1; i <= 64; i++) {
        int id_bit     = ow_read_bit();
        int cmp_id_bit = ow_read_bit();

        if (id_bit && cmp_id_bit) { s_search_done = true; return false; } /* no devices */

        int search_direction;
        if (!id_bit && !cmp_id_bit) {
            /* Discrepancy */
            if (i < s_last_discrepancy)
                search_direction = (rom[(i-1)/8] >> ((i-1)%8)) & 1;
            else
                search_direction = (i == s_last_discrepancy) ? 1 : 0;
            if (!search_direction) { last_zero = i; if (i <= 8) last_family_discrepancy = i; }
        } else {
            search_direction = id_bit;
        }

        if (search_direction) rom[(i-1)/8] |=  (1 << ((i-1)%8));
        else                  rom[(i-1)/8] &= ~(1 << ((i-1)%8));

        ow_write_bit(search_direction);
    }

    if (ds18b20_crc8(rom, 7) != rom[7]) { return false; } /* CRC fail */

    s_last_discrepancy = last_zero;
    (void)last_family_discrepancy;
    if (s_last_discrepancy == 0) s_search_done = true;
    memcpy(s_rom_no, rom, DS18B20_ROM_SIZE);
    memcpy(rom_out, rom, DS18B20_ROM_SIZE);
    return true;
}

/* ---- ROM 地址 → 协议字符串（"28-" + 6 字节 hex，FW-18/ADJ-6） ---- */
void ds18b20_address_str(const uint8_t rom[DS18B20_ROM_SIZE],
                         char *out, size_t out_len)
{
    if (!rom || !out || out_len < DS18B20_ADDR_STR_LEN) {
        if (out && out_len > 0) out[0] = '\0';
        return;
    }
    snprintf(out, out_len, "%02x-%02x%02x%02x%02x%02x%02x",
             rom[0], rom[1], rom[2], rom[3], rom[4], rom[5], rom[6]);
}

/* ---- Public API ---- */
esp_err_t ds18b20_init(void)
{
    gpio_config_t io_cfg = {
        .pin_bit_mask = (1ULL << OW_GPIO),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE, /* external 4.7kΩ */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_cfg);

    /* Enumerate sensors */
    s_count = 0;
    s_last_discrepancy = 0;
    s_search_done      = false;
    memset(s_rom_no, 0, sizeof(s_rom_no));

    uint8_t rom[DS18B20_ROM_SIZE];
    while (s_count < DS18B20_MAX_SENSORS && search_next(rom)) {
        if (rom[0] == 0x28) { /* DS18B20 family code */
            memcpy(s_sensors[s_count].rom, rom, DS18B20_ROM_SIZE);
            s_sensors[s_count].valid       = false;
            s_sensors[s_count].temperature_c = 0.0f;
            s_count++;
        }
    }

    ESP_LOGI(TAG, "DS18B20 init OK: %d sensor(s) found on GPIO%d", s_count, OW_GPIO);
    return ESP_OK;
}

esp_err_t ds18b20_read_all(ds18b20_sensor_t *sensors, uint8_t *count)
{
    if (!sensors || !count) return ESP_ERR_INVALID_ARG;
    if (s_count == 0) { *count = 0; return ESP_OK; }

    /* SKIP ROM + CONVERT T (all sensors simultaneously) */
    if (!ow_reset()) return ESP_ERR_NOT_FOUND;
    ow_write_byte(OW_CMD_SKIP_ROM);
    ow_write_byte(OW_CMD_CONVERT_T);

    /* 12-bit conversion: max 750 ms */
    vTaskDelay(pdMS_TO_TICKS(800));

    for (uint8_t i = 0; i < s_count; i++) {
        if (!ow_reset()) { sensors[i].valid = false; continue; }
        ow_write_byte(OW_CMD_MATCH_ROM);
        for (int b = 0; b < DS18B20_ROM_SIZE; b++) ow_write_byte(s_sensors[i].rom[b]);
        ow_write_byte(OW_CMD_READ_SCRATCHPAD);

        uint8_t sp[9];
        for (int b = 0; b < 9; b++) sp[b] = ow_read_byte();

        if (ds18b20_crc8(sp, 8) != sp[8]) {
            ESP_LOGW(TAG, "sensor %d CRC mismatch", i);
            sensors[i].valid = false;
        } else {
            int16_t raw = (int16_t)(sp[1] << 8 | sp[0]);
            sensors[i].temperature_c = raw * 0.0625f; /* 12-bit: LSB=0.0625°C */
            sensors[i].valid         = true;
        }
        memcpy(sensors[i].rom, s_sensors[i].rom, DS18B20_ROM_SIZE);
    }
    *count = s_count;
    return ESP_OK;
}
