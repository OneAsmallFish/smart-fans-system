/* test_fan_pwm.c — Unity 测试: 风扇PWM驱动 */
#include "unity.h"
#include "fan_pwm/fan_pwm.h"

void setUp(void) {}
void tearDown(void) {}

TEST_CASE("fan_pwm: duty clamps to 100", "[fan_pwm]")
{
    /* set_duty with >100 should clamp */
    TEST_ASSERT_EQUAL(ESP_OK, fan_pwm_set_duty(0, 150));
    vTaskDelay(pdMS_TO_TICKS(200)); /* allow soft-start task to finish */
    TEST_ASSERT_EQUAL_UINT8(100, fan_pwm_get_duty(0));
}

TEST_CASE("fan_pwm: duty 0 percent", "[fan_pwm]")
{
    TEST_ASSERT_EQUAL(ESP_OK, fan_pwm_set_duty(1, 0));
    vTaskDelay(pdMS_TO_TICKS(200));
    TEST_ASSERT_EQUAL_UINT8(0, fan_pwm_get_duty(1));
}

TEST_CASE("fan_pwm: invalid fan index returns error", "[fan_pwm]")
{
    TEST_ASSERT_NOT_EQUAL(ESP_OK, fan_pwm_set_duty(4, 50));
    TEST_ASSERT_EQUAL_UINT8(0, fan_pwm_get_duty(4));
}

TEST_CASE("fan_pwm: soft-start reaches target", "[fan_pwm]")
{
    fan_pwm_set_duty(2, 50);
    /* 50 steps × 10ms each = 500ms minimum */
    vTaskDelay(pdMS_TO_TICKS(700));
    TEST_ASSERT_EQUAL_UINT8(50, fan_pwm_get_duty(2));
}
