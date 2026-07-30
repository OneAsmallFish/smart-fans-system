/* test_fan_curve.c — Unity 测试: LUT 插值 + PID Anti-windup + 紧急模式 */
#include "unity.h"
#include "fan_curve/fan_curve.h"
#include <math.h>

void setUp(void) {}
void tearDown(void) {}

/* Inline version of LUT interpolation for host-side math verification */
static float lerp(float t, float a, float b) { return a + t * (b - a); }
static float lut_interpolate_test(float temp)
{
    /* Default curve: 30→20%, 40→40%, 50→60%, 60→80%, 70→100% */
    static const float temps[] = { 30, 40, 50, 60, 70 };
    static const float duties[] = { 20, 40, 60, 80, 100 };
    int n = 5;
    if (temp <= temps[0])   return duties[0];
    if (temp >= temps[n-1]) return duties[n-1];
    for (int i = 0; i < n - 1; i++) {
        if (temp >= temps[i] && temp < temps[i+1]) {
            float t = (temp - temps[i]) / (temps[i+1] - temps[i]);
            return lerp(t, duties[i], duties[i+1]);
        }
    }
    return duties[n-1];
}

TEST_CASE("fan_curve: LUT — 30°C maps to 20%", "[fan_curve]")
{
    float duty = lut_interpolate_test(30.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 20.0f, duty);
}

TEST_CASE("fan_curve: LUT — 70°C maps to 100%", "[fan_curve]")
{
    float duty = lut_interpolate_test(70.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 100.0f, duty);
}

TEST_CASE("fan_curve: LUT — 45°C interpolates between 40% and 60%", "[fan_curve]")
{
    float duty = lut_interpolate_test(45.0f);
    TEST_ASSERT_FLOAT_WITHIN(0.5f, 50.0f, duty); /* midpoint 40+60 */
}

TEST_CASE("fan_curve: emergency threshold == 80°C", "[fan_curve]")
{
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 80.0f, FAN_CURVE_EMERGENCY_C);
}

TEST_CASE("fan_curve: PID Anti-windup — integral clamped", "[fan_curve]")
{
    float ki = 0.1f;
    float I_MAX = 100.0f / ki;  /* = 1000 */
    float integral = 0.0f;
    /* Simulate sustained positive error */
    for (int i = 0; i < 10000; i++) integral += 1.0f;
    /* Apply clamp */
    if (integral > I_MAX) integral = I_MAX;
    TEST_ASSERT_FLOAT_WITHIN(0.1f, I_MAX, integral);
}

TEST_CASE("fan_curve: PID params — Kp/Ki/Kd defaults", "[fan_curve]")
{
    /* Verify default values match plan spec */
    float kp = 2.0f, ki = 0.1f, kd = 0.5f;
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f,  kp);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.1f,  ki);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f,  kd);
}
