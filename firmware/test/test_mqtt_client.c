/* test_mqtt_client.c — Unity 测试: MQTT Topic 命名空间 + JSON 构造 */
#include "unity.h"
#include "mqtt_client/mqtt_client_wrapper.h"
#include "cJSON.h"
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

TEST_CASE("mqtt: topic prefix constant correct", "[mqtt]")
{
    TEST_ASSERT_EQUAL_STRING("fan-controller", MQTT_TOPIC_PREFIX);
}

TEST_CASE("mqtt: offline queue size >= 50", "[mqtt]")
{
    TEST_ASSERT_GREATER_OR_EQUAL(50, MQTT_OFFLINE_QUEUE_SIZE);
}

TEST_CASE("mqtt: cJSON builds valid JSON with timestamp and device_id", "[mqtt]")
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "timestamp", 1722315503);
    cJSON_AddStringToObject(root, "device_id", "esp32-a1b2c3");
    cJSON_AddNumberToObject(root, "temperature_c", 25.3);

    char *js = cJSON_PrintUnformatted(root);
    TEST_ASSERT_NOT_NULL(js);

    /* Must contain required fields */
    TEST_ASSERT_NOT_NULL(strstr(js, "timestamp"));
    TEST_ASSERT_NOT_NULL(strstr(js, "device_id"));

    free(js);
    cJSON_Delete(root);
}

TEST_CASE("mqtt: LWT topic format", "[mqtt]")
{
    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/status", MQTT_TOPIC_PREFIX, "esp32-a1b2c3");
    TEST_ASSERT_EQUAL_STRING("fan-controller/esp32-a1b2c3/status", topic);
}

TEST_CASE("mqtt: sensor topic format", "[mqtt]")
{
    char topic[64];
    snprintf(topic, sizeof(topic), "%s/%s/sensor/bme280", MQTT_TOPIC_PREFIX, "esp32-a1b2c3");
    TEST_ASSERT_NOT_NULL(strstr(topic, "fan-controller"));
    TEST_ASSERT_NOT_NULL(strstr(topic, "sensor"));
}
