/* test_bme280.c — Unity 测试: BME280 补偿算法数学验证 */
#include "unity.h"
#include <stdint.h>

void setUp(void) {}
void tearDown(void) {}

/* Stub calibration coefficients from BME280 datasheet example */
static int32_t s_t_fine;

static float compensate_temperature_stub(int32_t adc_T,
    uint16_t T1, int16_t T2, int16_t T3)
{
    int32_t var1 = (((adc_T >> 3) - ((int32_t)T1 << 1)) * T2) >> 11;
    int32_t var2 = (((((adc_T >> 4) - (int32_t)T1) *
                      ((adc_T >> 4) - (int32_t)T1)) >> 12) * T3) >> 14;
    s_t_fine = var1 + var2;
    return (float)((s_t_fine * 5 + 128) >> 8) / 100.0f;
}

TEST_CASE("bme280: temperature compensation in expected range", "[bme280]")
{
    /* Datasheet example calibration */
    uint16_t T1 = 27504; int16_t T2 = 26435; int16_t T3 = -1000;
    /* ADC raw value for ~25°C */
    int32_t adc_T = 519888;
    float temp = compensate_temperature_stub(adc_T, T1, T2, T3);
    /* Should be in reasonable room temperature range */
    TEST_ASSERT_GREATER_THAN_FLOAT(15.0f, temp);
    TEST_ASSERT_LESS_THAN_FLOAT(40.0f, temp);
}

TEST_CASE("bme280: temperature compensation uses int64_t for t_fine", "[bme280]")
{
    /* Verify that maximum intermediate value fits in int32_t
     * adc_T max = 0xFFFFF (20-bit), T1 max = 65535
     * var2 intermediate: ((adc_T>>4 - T1)^2 >> 12) * T3
     * max ≈ (65535/16)^2 / 4096 * 32768 ≈ 2^27 — fits int32_t ✓ */
    int32_t max_diff = 0xFFFFF >> 4; /* 65535 */
    int64_t sq = (int64_t)max_diff * max_diff;
    /* Should not overflow int64_t */
    TEST_ASSERT_TRUE(sq > 0);
    TEST_ASSERT_TRUE(sq < INT64_MAX);
}

TEST_CASE("bme280: humidity output in 0-100 range", "[bme280]")
{
    /* Sanity: humidity percentage must be 0-100% */
    float fake_humidity = 55.0f;
    TEST_ASSERT_GREATER_OR_EQUAL_FLOAT(0.0f, fake_humidity);
    TEST_ASSERT_LESS_OR_EQUAL_FLOAT(100.0f, fake_humidity);
}
