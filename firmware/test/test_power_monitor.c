/* test_power_monitor.c — Unity 测试: 电源监控分压换算 */
#include "unity.h"
#include "power_monitor/power_monitor.h"

void setUp(void) {}
void tearDown(void) {}

/* Verify divider ratio constants */
TEST_CASE("power_monitor: 12V divider ratio == 6.0", "[power_monitor]")
{
    /* 100kΩ + 20kΩ: actual_V = adc_V × 6.0 */
    float ratio = VOLTAGE_DIVIDER_12V;
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 6.0f, ratio);
}

TEST_CASE("power_monitor: 5V divider ratio == 2.0", "[power_monitor]")
{
    float ratio = VOLTAGE_DIVIDER_5V;
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, ratio);
}

TEST_CASE("power_monitor: 3.3V divider ratio == 2.0", "[power_monitor]")
{
    float ratio = VOLTAGE_DIVIDER_3V3;
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f, ratio);
}

TEST_CASE("power_monitor: 12V ADC input safety — max 2.2V at 13.2V rail", "[power_monitor]")
{
    /* Worst case: 12V rail at +10% = 13.2V → ADC input = 13.2/6.0 = 2.2V
     * ESP32-S3 ADC推荐上限: 2.4V → 2.2V < 2.4V ✓ */
    float adc_in_max = 13.2f / VOLTAGE_DIVIDER_12V;
    TEST_ASSERT_LESS_THAN_FLOAT(2.4f, adc_in_max);
}

TEST_CASE("power_monitor: 12V voltage reconstruction", "[power_monitor]")
{
    /* adc = 2.0V → actual 12V */
    float adc_v  = 2.0f;
    float actual = adc_v * VOLTAGE_DIVIDER_12V;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 12.0f, actual);
}
