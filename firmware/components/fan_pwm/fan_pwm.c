/*
 * fan_pwm.c — 风扇 PWM 驱动  (LEDC, 25 kHz, 10-bit)
 *
 * ⚠️ ESP32-S3 注意:
 *  - 使用 LEDC_LOW_SPEED_MODE（S3 不支持 HIGH_SPEED_MODE）
 *  - 不使用 ledc_set_fade_with_time()（与 WiFi 并发时可能触发 WDT）
 *    → 手动软启动：独立任务每10ms递增1%
 */
#include "fan_pwm.h"
#include "driver/ledc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "FAN_PWM";

/* 25 kHz, 10-bit: duty range 0-1023 */
#define PWM_FREQ_HZ      25000
#define PWM_RESOLUTION   LEDC_TIMER_10_BIT
#define PWM_MAX_DUTY     1023

static const int FAN_GPIO[FAN_PWM_COUNT] = { 4, 5, 6, 7 };
static uint8_t s_duty_pct[FAN_PWM_COUNT] = { 0 };

/* ---- soft-start task ---- */
typedef struct { uint8_t fan; uint8_t target; } softstart_args_t;

static void softstart_task(void *arg)
{
    softstart_args_t *a = (softstart_args_t *)arg;
    uint8_t fan    = a->fan;
    uint8_t target = a->target;
    free(a);

    uint8_t current = s_duty_pct[fan];
    int8_t  step    = (target > current) ? 1 : -1;

    while (current != target) {
        current = (uint8_t)(current + step);
        uint32_t raw = (uint32_t)current * PWM_MAX_DUTY / 100;
        ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)fan, raw);
        ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)fan);
        s_duty_pct[fan] = current;
        vTaskDelay(pdMS_TO_TICKS(10)); /* 10ms per 1% step */
    }
    vTaskDelete(NULL);
}

/* ---------------------------------------------------------------- */
esp_err_t fan_pwm_init(void)
{
    ledc_timer_config_t timer = {
        .speed_mode      = LEDC_LOW_SPEED_MODE,
        .duty_resolution = PWM_RESOLUTION,
        .timer_num       = LEDC_TIMER_0,
        .freq_hz         = PWM_FREQ_HZ,    /* 25000 Hz */
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer), TAG, "timer config failed");

    for (int i = 0; i < FAN_PWM_COUNT; i++) {
        ledc_channel_config_t ch = {
            .channel    = (ledc_channel_t)i,
            .duty       = 0,
            .gpio_num   = FAN_GPIO[i],
            .speed_mode = LEDC_LOW_SPEED_MODE,
            .hpoint     = 0,
            .timer_sel  = LEDC_TIMER_0,
        };
        ESP_RETURN_ON_ERROR(ledc_channel_config(&ch), TAG, "ch%d config failed", i);
        s_duty_pct[i] = 0;
    }
    ESP_LOGI(TAG, "LEDC init OK: 25kHz, 10-bit, GPIO4-7");
    return ESP_OK;
}

esp_err_t fan_pwm_set_duty(uint8_t fan_index, uint8_t percent)
{
    if (fan_index >= FAN_PWM_COUNT) return ESP_ERR_INVALID_ARG;
    if (percent > 100) percent = 100;

    softstart_args_t *a = malloc(sizeof(softstart_args_t));
    if (!a) return ESP_ERR_NO_MEM;
    a->fan = fan_index; a->target = percent;

    /* Soft-start runs in a short-lived task (stack 2KB sufficient) */
    xTaskCreate(softstart_task, "fan_ss", 2048, a, 3, NULL);
    return ESP_OK;
}

uint8_t fan_pwm_get_duty(uint8_t fan_index)
{
    if (fan_index >= FAN_PWM_COUNT) return 0;
    return s_duty_pct[fan_index];
}
