/*
 * alert_manager.h — 告警规则引擎 + 三级状态机 + 去重
 * v1.2: 8 路风扇；停转判定 duty>5% 且 RPM<200（0% 合法停转除外）
 */
#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

#define ALERT_FAN_COUNT 8   /* 与 FAN_TACH_COUNT 一致（本组件自有口径） */

typedef enum { ALERT_NORMAL, ALERT_WARNING, ALERT_CRITICAL } alert_severity_t;

typedef enum {
    ALERT_TYPE_TEMPERATURE,
    ALERT_TYPE_FAN_STALL,
    ALERT_TYPE_VOLTAGE,
    ALERT_TYPE_WIFI,
    ALERT_TYPE_COUNT
} alert_type_t;

/* 可配置阈值（ADJ-14 双阈值口径，config/alert 可覆盖） */
typedef struct {
    float    temp_warn_c;    /* 温度警告阈值（默认 75） */
    float    temp_crit_c;    /* 温度 critical 阈值（默认 80） */
    float    v12_min;        /* 12V 下限（默认 10.8） */
    float    v12_max;        /* 12V 上限（默认 13.2） */
    uint16_t stall_rpm;      /* 停转判定 RPM 上限（默认 200，配合 duty>5%） */
    uint16_t wifi_timeout_s; /* WiFi 断连告警秒数（默认 60） */
} alert_thresholds_t;

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
void alert_manager_update_fan_duty(uint8_t fan_index, uint8_t duty_pct);
void alert_manager_update_voltages(float v12, float v5, float v33);
void alert_manager_update_wifi(bool connected);

/** 触发规则检查（由 alert_task 每5秒调用） */
void alert_manager_check_all(void);

alert_severity_t alert_manager_get_severity(void);

/** 读取/设置阈值（config/alert set 应用；NVS 持久化由调用方负责） */
void alert_manager_get_thresholds(alert_thresholds_t *out);
void alert_manager_set_thresholds(const alert_thresholds_t *th);

/* ---- 协议 §5 字符串映射（payload 的 alert_type/severity/sensor 字段） ---- */
const char *alert_type_to_string(alert_type_t type);      /* "temperature_high" 等 */
alert_type_t alert_type_from_string(const char *str);     /* 解析失败返回 ALERT_TYPE_COUNT */
const char *alert_severity_to_string(alert_severity_t s); /* "warning"/"critical" 等 */
const char *alert_type_sensor(alert_type_t type);         /* "bme280"/"fan"/"power"/"wifi" */
