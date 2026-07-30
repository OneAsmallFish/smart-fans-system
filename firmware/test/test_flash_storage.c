/* test_flash_storage.c — Unity 测试: 循环日志 + Wear Levelling */
#include "unity.h"
#include "flash_storage/flash_storage.h"
#include <string.h>

void setUp(void) { flash_storage_init(); }
void tearDown(void) {}

TEST_CASE("flash_storage: write and read config round-trip", "[storage]")
{
    storage_write_config("test_key", "hello_value");
    char buf[32] = {0};
    esp_err_t r = storage_read_config("test_key", buf, sizeof(buf));
    TEST_ASSERT_EQUAL(ESP_OK, r);
    TEST_ASSERT_EQUAL_STRING("hello_value", buf);
}

TEST_CASE("flash_storage: log count starts at 0 or valid uint32", "[storage]")
{
    uint32_t count = storage_get_log_count();
    TEST_ASSERT_LESS_OR_EQUAL(STORAGE_LOG_MAX_ENTRIES, count);
}

TEST_CASE("flash_storage: log interval minimum >= 30s", "[storage]")
{
    TEST_ASSERT_GREATER_OR_EQUAL(30, STORAGE_LOG_MIN_INTERVAL_S);
}

TEST_CASE("flash_storage: log entry size <= 128 bytes", "[storage]")
{
    TEST_ASSERT_LESS_OR_EQUAL(128, sizeof(log_entry_t));
}

TEST_CASE("flash_storage: get_recent_logs returns count <= requested", "[storage]")
{
    log_entry_t entries[5];
    uint32_t count = 5;
    esp_err_t r = storage_get_recent_logs(entries, &count);
    TEST_ASSERT_EQUAL(ESP_OK, r);
    TEST_ASSERT_LESS_OR_EQUAL(5, count);
}
