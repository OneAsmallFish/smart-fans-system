/* test_wifi_manager.c — Unity 测试: NVS 凭据存储逻辑 */
#include "unity.h"
#include "wifi_manager/wifi_manager.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <string.h>

void setUp(void)
{
    nvs_flash_init();
}
void tearDown(void) {}

TEST_CASE("wifi_manager: save and load credentials via NVS", "[wifi]")
{
    wifi_manager_set_credentials("TestSSID", "TestPass");

    nvs_handle_t nvs;
    char ssid[33] = {0}, pass[65] = {0};
    size_t s_len = sizeof(ssid), p_len = sizeof(pass);

    TEST_ASSERT_EQUAL(ESP_OK, nvs_open("fan_ctrl", NVS_READONLY, &nvs));
    TEST_ASSERT_EQUAL(ESP_OK, nvs_get_str(nvs, "wifi_ssid", ssid, &s_len));
    TEST_ASSERT_EQUAL(ESP_OK, nvs_get_str(nvs, "wifi_pass", pass, &p_len));
    nvs_close(nvs);

    TEST_ASSERT_EQUAL_STRING("TestSSID", ssid);
    TEST_ASSERT_EQUAL_STRING("TestPass", pass);
}

TEST_CASE("wifi_manager: clear credentials removes NVS keys", "[wifi]")
{
    wifi_manager_set_credentials("TempSSID", "TempPass");
    wifi_manager_clear_credentials();

    nvs_handle_t nvs;
    char ssid[33] = {0};
    size_t len = sizeof(ssid);
    if (nvs_open("fan_ctrl", NVS_READONLY, &nvs) == ESP_OK) {
        esp_err_t r = nvs_get_str(nvs, "wifi_ssid", ssid, &len);
        TEST_ASSERT_NOT_EQUAL(ESP_OK, r); /* key should not exist after clear */
        nvs_close(nvs);
    }
}
