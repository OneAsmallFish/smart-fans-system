/*
 * mqtt_client_wrapper.h — MQTT 客户端封装 (esp_mqtt)
 * Topic 命名空间: fan-controller/{device_id}/...
 * ⚠️ 不硬编码 Broker 地址（从 NVS/Kconfig 读取）
 * ⚠️ 不在 WiFi 事件处理器中调用 mqtt_client_start()（FreeRTOS Timer 延迟）
 */
#pragma once
#include "esp_err.h"
#include <stddef.h>
#include <stdbool.h>

#define MQTT_TOPIC_PREFIX   "fan-controller"
#define MQTT_OFFLINE_QUEUE_SIZE  50  /* Flash 离线缓存消息数 */

typedef void (*mqtt_message_cb_t)(const char *topic, int topic_len,
                                   const char *data,  int data_len);

/** 初始化 MQTT 客户端（从 NVS 读取 broker URL）；不自动连接 */
esp_err_t mqtt_client_init(void);

/**
 * 连接到 Broker（由 WiFi GOT_IP 事件触发，通过 FreeRTOS Timer 延迟调用）
 * @param broker_url  "mqtt://192.168.1.100:1883"
 */
esp_err_t mqtt_client_connect(const char *broker_url);

/**
 * 发布消息
 * @param topic    完整 Topic（或相对 Topic，函数内拼接前缀）
 * @param payload  JSON 字符串
 * @param qos      0 或 1
 */
esp_err_t mqtt_publish(const char *topic, const char *payload, int qos);

/** 订阅 Topic；msg_cb 将在 MQTT 事件任务中调用 */
esp_err_t mqtt_subscribe(const char *topic, mqtt_message_cb_t msg_cb);

bool mqtt_client_is_connected(void);

/** 保存 Broker URL 到 NVS */
esp_err_t mqtt_client_save_broker(const char *broker_url);
