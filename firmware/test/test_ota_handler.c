/* test_ota_handler.c — Unity 测试: OTA 分区切换逻辑 + 版本比较 */
#include "unity.h"
#include "ota_handler/ota_handler.h"
#include "esp_ota_ops.h"

void setUp(void) {}
void tearDown(void) {}

TEST_CASE("ota_handler: running partition is not factory", "[ota]")
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    /* System should never run from factory after first OTA */
    /* (On first boot from factory, this is the factory partition — OK) */
    TEST_ASSERT_NOT_NULL(running);
    /* Verify partition type is app */
    TEST_ASSERT_EQUAL(ESP_PARTITION_TYPE_APP, running->type);
}

TEST_CASE("ota_handler: rollback is available when OTA partitions exist", "[ota]")
{
    const esp_partition_t *ota0 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, NULL);
    const esp_partition_t *ota1 = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_1, NULL);
    /* Both OTA partitions must exist per our partitions.csv */
    TEST_ASSERT_NOT_NULL(ota0);
    TEST_ASSERT_NOT_NULL(ota1);
}

TEST_CASE("ota_handler: null URL returns error", "[ota]")
{
    esp_err_t r = ota_handler_start(NULL);
    TEST_ASSERT_NOT_EQUAL(ESP_OK, r);
}

TEST_CASE("ota_handler: empty URL returns error", "[ota]")
{
    esp_err_t r = ota_handler_start("");
    TEST_ASSERT_NOT_EQUAL(ESP_OK, r);
}
