/*
 * fan_tach.c — 风扇转速计驱动 (PCNT)
 * RPM = pulses * 60 / (2 * 1.0)   [2 pulses/rev, 1s window]
 * ⚠️ 不用GPIO中断计数，PCNT硬件保证不丢脉冲
 */
#include "fan_tach.h"
#include "esp_check.h"
#include "driver/pulse_cnt.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "FAN_TACH";

/* v1.2 权威引脚表：Fan1-8 Tach → GPIO13/14/15/21/38/39/40/41
 * S3 仅 4 个 PCNT 单元，每单元 2 通道：unit = i/2, channel = i%2 */
static const int TACH_GPIO[FAN_TACH_COUNT] = { 13, 14, 15, 21, 38, 39, 40, 41 };
#define PCNT_UNIT_N   (FAN_TACH_COUNT / 2)   /* 4 units × 2 channels */

#define STALL_RPM_THRESHOLD  200  /* RPM低于此值视为停转 */
#define STALL_CONFIRM_SECS   3    /* 连续3秒才触发停转回调 */

static pcnt_unit_handle_t  s_units[PCNT_UNIT_N];
static uint16_t            s_rpm[FAN_TACH_COUNT];
static uint8_t             s_stall_secs[FAN_TACH_COUNT];
static bool                s_stall_fired[FAN_TACH_COUNT];
static fan_stall_cb_t      s_stall_cb = NULL;
static TimerHandle_t       s_sample_timer;

static void sample_cb(TimerHandle_t t)
{
    (void)t;
    for (int i = 0; i < FAN_TACH_COUNT; i++) {
        int count = 0;
        pcnt_unit_get_count(s_units[i / 2], &count);
        pcnt_unit_clear_count(s_units[i / 2]);

        /* RPM = pulses * 60 / (2 * 1.0s window) */
        s_rpm[i] = (uint16_t)((count * 60) / 2);

        if (s_rpm[i] < STALL_RPM_THRESHOLD) {
            s_stall_secs[i]++;
            if (s_stall_secs[i] >= STALL_CONFIRM_SECS && !s_stall_fired[i]) {
                s_stall_fired[i] = true;
                if (s_stall_cb) s_stall_cb((uint8_t)i);
            }
        } else {
            s_stall_secs[i] = 0;
            s_stall_fired[i] = false;
        }
    }
}

esp_err_t fan_tach_init(void)
{
    /* 4 个 PCNT 单元 */
    for (int u = 0; u < PCNT_UNIT_N; u++) {
        pcnt_unit_config_t unit_cfg = {
            .high_limit = 32767,
            .low_limit  = -1,
        };
        ESP_RETURN_ON_ERROR(pcnt_new_unit(&unit_cfg, &s_units[u]),
                            TAG, "pcnt unit %d failed", u);
        pcnt_unit_enable(s_units[u]);
        pcnt_unit_clear_count(s_units[u]);
        pcnt_unit_start(s_units[u]);
    }

    /* 每单元 2 通道，共 8 路 Tach 输入（上升沿计数） */
    for (int i = 0; i < FAN_TACH_COUNT; i++) {
        pcnt_chan_config_t chan_cfg = {
            .edge_gpio_num  = TACH_GPIO[i],
            .level_gpio_num = -1,
        };
        pcnt_channel_handle_t ch;
        ESP_RETURN_ON_ERROR(pcnt_new_channel(s_units[i / 2], &chan_cfg, &ch),
                            TAG, "pcnt ch %d failed", i);
        pcnt_channel_set_edge_action(ch, PCNT_CHANNEL_EDGE_ACTION_INCREASE,
                                     PCNT_CHANNEL_EDGE_ACTION_HOLD);
        s_rpm[i] = 0; s_stall_secs[i] = 0; s_stall_fired[i] = false;
    }

    s_sample_timer = xTimerCreate("tach_s", pdMS_TO_TICKS(1000), pdTRUE, NULL, sample_cb);
    xTimerStart(s_sample_timer, 0);

    ESP_LOGI(TAG, "PCNT tach init OK: GPIO13/14/15/21/38/39/40/41, 2 pulses/rev");
    return ESP_OK;
}

uint16_t fan_tach_get_rpm(uint8_t fan_index)
{
    if (fan_index >= FAN_TACH_COUNT) return 0;
    return s_rpm[fan_index];
}

void fan_tach_on_stall(fan_stall_cb_t cb)
{
    s_stall_cb = cb;
}
