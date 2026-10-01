/*
 * mqtt_client_wrapper.h — MQTT 客户端封装 (esp_mqtt)
 * Topic 命名空间: fan-controller/{device_id}/...
 * ⚠️ 不硬编码 Broker 地址（从 NVS/Kconfig 读取）
 * ⚠️ 不在 WiFi 事件处理器中调用 esp_mqtt_client_start()（FreeRTOS Timer 延迟）
 * ⚠️ 订阅在 MQTT_EVENT_CONNECTED 时执行（topic 先缓存，FW-03）
 */
#pragma once
#include "esp_err.h"
#include <stddef.h>
#include <stdbool.h>

#define MQTT_TOPIC_PREFIX   "fan-controller"
#define MQTT_OFFLINE_QUEUE_SIZE  50  /* Flash 离线缓存消息数（环形 key 复用） */
#define MQTT_MAX_SUBSCRIPTIONS   8

typedef void (*mqtt_message_cb_t)(const char *topic, int topic_len,
                                   const char *data,  int data_len);
typedef void (*mqtt_connected_cb_t)(void);

/** 初始化 MQTT 客户端（从 NVS 读取 broker URL）；不自动连接 */
esp_err_t mqtt_client_init(void);

/**
 * 连接到 Broker（由 WiFi GOT_IP 事件触发，通过 FreeRTOS Timer 延迟调用）
 * @param broker_url  "mqtt://192.168.1.100:1883"，NULL 时从 NVS 加载
 */
esp_err_t mqtt_client_connect(const char *broker_url);

/**
 * 发布消息（离线时入 NVS 队列，重连后带 /buffered 后缀补发）
 * @param topic    完整 Topic
 * @param payload  JSON 字符串
 * @param qos      0 或 1
 */
esp_err_t mqtt_publish(const char *topic, const char *payload, int qos);

/**
 * 订阅 Topic（缓存；连接建立后在 MQTT_EVENT_CONNECTED 中真正下发，FW-03）
 * @param topic  完整 topic（建议含具体 device_id 而非 + 通配，FW-04）
 * @param msg_cb 消息回调（在 MQTT 事件任务中调用）
 */
esp_err_t mqtt_subscribe(const char *topic, mqtt_message_cb_t msg_cb);

/** 注册连接建立回调（FW-08: main 用于 ota_handler_confirm_mqtt） */
void mqtt_client_set_connected_cb(mqtt_connected_cb_t cb);

bool mqtt_client_is_connected(void);

/** 保存 Broker URL 到 NVS */
esp_err_t mqtt_client_save_broker(const char *broker_url);

/** 从 NVS 读取 Broker URL（未配置返回 ESP_ERR_NOT_FOUND） */
esp_err_t mqtt_client_get_broker(char *out_url, size_t out_len);

/** 本机 device_id（"esp32-XXXXXX"，ota/status 等 topic 构造用） */
const char *mqtt_client_get_device_id(void);

/**
 * 上线报文的设备信息（FW-14: online payload 的 firmware_version/ip_address
 * 由 main 在 WiFi 获得后注入；uptime/timestamp 由本组件填充）
 */
void mqtt_client_set_status_info(const char *fw_version, const char *ip_address);
