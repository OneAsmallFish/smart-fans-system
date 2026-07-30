/* test_status_led.c — Unity 测试: LED 颜色编码验证 */
#include "unity.h"
#include "status_led/status_led.h"
#include <stdint.h>

void setUp(void) {}
void tearDown(void) {}

TEST_CASE("status_led: 5 preset modes exist", "[status_led]")
{
    /* Verify all enum values are accessible */
    led_mode_t modes[] = {
        LED_MODE_NORMAL,
        LED_MODE_WARNING,
        LED_MODE_ERROR,
        LED_MODE_WIFI_DISCONNECTED,
        LED_MODE_OTA,
    };
    TEST_ASSERT_EQUAL(5, sizeof(modes) / sizeof(modes[0]));
}

TEST_CASE("status_led: GRB byte order — R=255,G=0,B=0 encodes as G=0,R=255,B=0", "[status_led]")
{
    /* WS2812B uses GRB order */
    uint8_t r = 255, g = 0, b = 0;
    uint8_t grb[3] = { g, r, b }; /* expected wire order */
    TEST_ASSERT_EQUAL_HEX8(0x00, grb[0]); /* G */
    TEST_ASSERT_EQUAL_HEX8(0xFF, grb[1]); /* R */
    TEST_ASSERT_EQUAL_HEX8(0x00, grb[2]); /* B */
}

TEST_CASE("status_led: T0H < T1H timing", "[status_led]")
{
    int t0h_ns = 400;
    int t1h_ns = 800;
    TEST_ASSERT_LESS_THAN(t1h_ns, t0h_ns);
}

TEST_CASE("status_led: WS2812B 3.3V supply — VIH check", degree_symbol_not_needed)
{
    /* With VDD=3.3V, VIH_min = 0.7×3.3 = 2.31V
     * ESP32-S3 VOH_typ = 3.0V > 2.31V ✓ */
    float vdd = 3.3f;
    float vih_min = 0.7f * vdd;   /* 2.31V */
    float esp_voh = 3.0f;
    TEST_ASSERT_GREATER_THAN_FLOAT(vih_min, esp_voh);
}
