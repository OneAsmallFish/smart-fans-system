/* test_alert_manager.c — Unity 测试: 告警规则触发 + 状态机 + 去重 */
#include "unity.h"
#include "alert_manager/alert_manager.h"
#include <string.h>

static int    s_fire_count = 0;
static int    s_clear_count = 0;
static alert_type_t s_last_type;

static void test_alert_cb(const alert_event_t *ev)
{
    s_fire_count++;
    s_last_type = ev->type;
}
static void test_clear_cb(alert_type_t type)
{
    s_clear_count++;
    (void)type;
}

void setUp(void)
{
    s_fire_count = 0; s_clear_count = 0;
    alert_manager_init(test_alert_cb, test_clear_cb);
}
void tearDown(void) {}

TEST_CASE("alert_manager: temperature high triggers WARNING", "[alert]")
{
    alert_manager_update_temperature(76.0f); /* > 75°C threshold */
    alert_manager_check_all();
    TEST_ASSERT_EQUAL(1, s_fire_count);
    TEST_ASSERT_EQUAL(ALERT_TYPE_TEMPERATURE, s_last_type);
}

TEST_CASE("alert_manager: temperature critical at >80°C", "[alert]")
{
    alert_manager_update_temperature(85.0f);
    alert_manager_check_all();
    TEST_ASSERT_EQUAL(1, s_fire_count);
    TEST_ASSERT_EQUAL(ALERT_CRITICAL, alert_manager_get_severity());
}

TEST_CASE("alert_manager: fan stall fires CRITICAL", "[alert]")
{
    alert_manager_update_fan_rpm(0, 150); /* < 200 RPM stall threshold */
    alert_manager_check_all();
    TEST_ASSERT_EQUAL(1, s_fire_count);
    TEST_ASSERT_EQUAL(ALERT_TYPE_FAN_STALL, s_last_type);
}

TEST_CASE("alert_manager: voltage normal — no alert", "[alert]")
{
    alert_manager_update_voltages(12.0f, 5.0f, 3.3f);
    alert_manager_check_all();
    TEST_ASSERT_EQUAL(0, s_fire_count);
}

TEST_CASE("alert_manager: severity resets to NORMAL when clear", "[alert]")
{
    /* First trigger a warning */
    alert_manager_update_temperature(76.0f);
    alert_manager_check_all();
    TEST_ASSERT_EQUAL(ALERT_WARNING, alert_manager_get_severity());
    /* Now temperature normal */
    alert_manager_update_temperature(30.0f);
    alert_manager_check_all();
    TEST_ASSERT_EQUAL(ALERT_NORMAL, alert_manager_get_severity());
}

TEST_CASE("alert_manager: 4 alert types defined", "[alert]")
{
    TEST_ASSERT_EQUAL(4, ALERT_TYPE_COUNT);
}
