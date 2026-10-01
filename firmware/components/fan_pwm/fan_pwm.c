/*
 * fan_pwm.c — 风扇 PWM 驱动  (LEDC, 25 kHz, 10-bit, 8 通道)
 *
 * ⚠️ ESP32-S3 注意:
 *  - 使用 LEDC_LOW_SPEED_MODE（S3 不支持 HIGH_SPEED_MODE）
 *  - 不使用 ledc_set_fade_with_time()（与 WiFi 并发时可能触发 WDT）
 *    → 手动软启动：常驻控制器任务每10ms将各风扇向目标值步进1%
 *      （取代旧的"每次 set_duty 派生临时任务"模型，消除并发竞态）
 */
#include "fan_pwm.h"
#include "esp_check.h"
#include "driver/ledc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "FAN_PWM";

/* 25 kHz, 10-bit: duty range 0-1023 */
#define PWM_FREQ_HZ      25000
#define PWM_RESOLUTION   LEDC_TIMER_10_BIT
#define PWM_MAX_DUTY     1023
#define SOFTSTART_MS     10   /* 每 1% 步进的间隔 */

/* v1.2 权威引脚表：GPIO5-12 → LEDC_CH0-CH7 → 74AHCT125 ×2 → Fan1-8 PWM */
static const int FAN_GPIO[FAN_PWM_COUNT] = { 5, 6, 7, 8, 9, 10, 11, 12 };

static uint8_t          s_duty_pct[FAN_PWM_COUNT]   = { 0 };  /* 实际输出 */
static uint8_t          s_target_pct[FAN_PWM_COUNT] = { 0 };  /* 目标值 */
static SemaphoreHandle_t s_pwm_mutex = NULL;

/* ---- 常驻软启动控制器任务：所有 LEDC 写入集中在此任务，天然串行化 ---- */
static void softstart_controller_task(void *arg)
{
    (void)arg;
    while (1) {
        xSemaphoreTake(s_pwm_mutex, portMAX_DELAY);
        for (int i = 0; i < FAN_PWM_COUNT; i++) {
            if (s_duty_pct[i] != s_target_pct[i]) {
                s_duty_pct[i] += (s_target_pct[i] > s_duty_pct[i]) ? 1 : -1;
                uint32_t raw = (uint32_t)s_duty_pct[i] * PWM_MAX_DUTY / 100;
                ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)i, raw);
                ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)i);
            }
        }
        xSemaphoreGive(s_pwm_mutex);
        vTaskDelay(pdMS_TO_TICKS(SOFTSTART_MS));
    }
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
        s_duty_pct[i]   = 0;
        s_target_pct[i] = 0;
    }

    s_pwm_mutex = xSemaphoreCreateMutex();
    if (!s_pwm_mutex) return ESP_ERR_NO_MEM;

    /* 常驻控制器任务（2KB 栈足够：只做 LEDC 寄存器写入） */
    if (xTaskCreate(softstart_controller_task, "fan_ss", 2048, NULL, 3, NULL) != pdPASS)
        return ESP_ERR_NO_MEM;

    ESP_LOGI(TAG, "LEDC init OK: 25kHz, 10-bit, GPIO5-12 (8 fans, duty=0)");
    return ESP_OK;
}

esp_err_t fan_pwm_set_duty(uint8_t fan_index, uint8_t percent)
{
    if (fan_index >= FAN_PWM_COUNT) return ESP_ERR_INVALID_ARG;
    if (percent > 100) percent = 100;

    xSemaphoreTake(s_pwm_mutex, portMAX_DELAY);
    s_target_pct[fan_index] = percent;
    xSemaphoreGive(s_pwm_mutex);
    return ESP_OK;
}

uint8_t fan_pwm_get_duty(uint8_t fan_index)
{
    if (fan_index >= FAN_PWM_COUNT) return 0;
    xSemaphoreTake(s_pwm_mutex, portMAX_DELAY);
    uint8_t d = s_duty_pct[fan_index];
    xSemaphoreGive(s_pwm_mutex);
    return d;
}
