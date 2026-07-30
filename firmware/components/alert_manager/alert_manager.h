/*
 * alert_manager.h — 告警规则引擎 + 三级状态机 + 去重
 */
#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

typedef enum { ALERT_NORMAL, ALERT_WARNING, ALERT_CRITICAL } alert_severity_t;

typedef enum {
    ALERT_TYPE_TEMPERATURE,
    ALERT_TYPE_FAN_STALL,
    ALERT_TYPE_VOLTAGE,
    ALERT_TYPE_WIFI,
    ALERT_TYPE_COUNT
} alert_type_t;

typedef struct {
    alert_type_t     type;
    alert_severity_t severity;
    char             message[128];
    float            value;
    float            threshold;
} alert_event_t;

typedef void (*alert_cb_t)(const alert_event_t *event);
typedef void (*alert_clear_cb_t)(alert_type_t type);

/** 初始化告警引擎，注册告警触发回调和恢复回调 */
esp_err_t alert_manager_init(alert_cb_t on_alert, alert_clear_cb_t on_clear);

/** 更新传感器数据（由 sensor_task 每秒调用） */
void alert_manager_update_temperature(float max_temp_c);
void alert_manager_update_fan_rpm(uint8_t fan_index, uint16_t rpm);
void alert_manager_update_voltages(float v12, float v5, float v33);
void alert_manager_update_wifi(bool connected);

/** 触发规则检查（由 alert_task 每5秒调用） */
void alert_manager_check_all(void);

alert_severity_t alert_manager_get_severity(void);
