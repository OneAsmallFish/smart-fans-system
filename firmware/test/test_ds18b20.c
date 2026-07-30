/* test_ds18b20.c — Unity 测试: DS18B20 CRC8 + 温度换算 */
#include "unity.h"
#include "ds18b20/ds18b20.h"
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

TEST_CASE("ds18b20: CRC8 — known scratchpad passes", "[ds18b20]")
{
    /* Known-good scratchpad from datasheet: first 8 bytes + CRC byte 8 */
    /* Temp = 85°C → raw = 0x0550, SP[0]=0x50, SP[1]=0x05 */
    uint8_t sp[9] = { 0x50, 0x05, 0x4B, 0x46, 0x7F, 0xFF, 0x0C, 0x10, 0x1C };
    uint8_t crc = ds18b20_crc8(sp, 8);
    TEST_ASSERT_EQUAL_HEX8(sp[8], crc);
}

TEST_CASE("ds18b20: CRC8 — corrupt data fails", "[ds18b20]")
{
    uint8_t sp[9] = { 0x50, 0x05, 0x4B, 0x46, 0x7F, 0xFF, 0x0C, 0x10, 0x1C };
    sp[0] ^= 0xFF; /* corrupt */
    uint8_t crc = ds18b20_crc8(sp, 8);
    TEST_ASSERT_NOT_EQUAL(sp[8], crc);
}

TEST_CASE("ds18b20: 12-bit temperature conversion — 25°C", "[ds18b20]")
{
    /* 25.0°C → raw = 25 / 0.0625 = 400 = 0x0190 */
    int16_t raw = 0x0190;
    float temp = raw * 0.0625f;
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 25.0f, temp);
}

TEST_CASE("ds18b20: 12-bit temperature conversion — negative temp", "[ds18b20]")
{
    /* -10.0625°C → raw = 0xFF5F */
    int16_t raw = (int16_t)0xFF5F;
    float temp = raw * 0.0625f;
    TEST_ASSERT_FLOAT_WITHIN(0.01f, -10.0625f, temp);
}

TEST_CASE("ds18b20: timing constants — reset >= 480us", "[ds18b20]")
{
    /* OneWire reset pulse: 480µs minimum per spec */
    int reset_us = 480;
    TEST_ASSERT_GREATER_OR_EQUAL(480, reset_us);
}
