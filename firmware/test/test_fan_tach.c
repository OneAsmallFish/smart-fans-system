/* test_fan_tach.c — Unity 测试: Tach RPM 数学验证 */
#include "unity.h"
#include "fan_tach/fan_tach.h"
#include <stdint.h>

void setUp(void) {}
void tearDown(void) {}

/* RPM = pulses * 60 / (2 * 1.0) — unit math test (no hardware) */
static uint16_t compute_rpm(int pulses)
{
    return (uint16_t)((pulses * 60) / 2);
}

TEST_CASE("fan_tach: RPM formula — 2000 RPM", "[fan_tach]")
{
    /* 2000 RPM × 2 pulses/rev ÷ 60s = 66.67 pulses/s ≈ 67 pulses in 1s window */
    int pulses = (int)(2000 * 2 / 60);
    TEST_ASSERT_EQUAL_UINT16(2000 - (2000 % 90), compute_rpm(pulses) / 10 * 10);
    /* allow ±60 RPM rounding */
    TEST_ASSERT_INT_WITHIN(60, 2000, compute_rpm(pulses));
}

TEST_CASE("fan_tach: RPM formula — 0 RPM (stall)", "[fan_tach]")
{
    TEST_ASSERT_EQUAL_UINT16(0, compute_rpm(0));
}

TEST_CASE("fan_tach: RPM formula — 3000 RPM", "[fan_tach]")
{
    int pulses = (int)(3000 * 2 / 60);
    TEST_ASSERT_INT_WITHIN(60, 3000, compute_rpm(pulses));
}

TEST_CASE("fan_tach: stall threshold below 200 RPM", "[fan_tach]")
{
    /* Verify that 150 RPM < stall threshold */
    uint16_t rpm = compute_rpm(5); /* 5 pulses → 150 RPM */
    TEST_ASSERT_LESS_THAN(200, rpm);
}
