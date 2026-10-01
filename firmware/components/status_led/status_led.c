/*
 * status_led.c — WS2812B-2020 RGB 状态指示灯驱动 (RMT TX + copy encoder)
 * v1.2: GPIO45（权威引脚表）；FW-01: init 返回 esp_err_t
 * 编码方式：rmt_new_copy_encoder + 直接发送 rmt_symbol_word_t 数组
 * （IDF v5.x RMT 驱动无 rmt_write_symbols API，自研 encoder 已移除）
 */
#include "status_led.h"
#include "esp_check.h"
#include "driver/rmt_tx.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "esp_log.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>

static const char *TAG = "STATUS_LED";

#define LED_GPIO         45
#define RMT_CLK_HZ       10000000   /* 10 MHz → 100 ns per tick */
#define T0H_TICKS        4          /* 400 ns */
#define T0L_TICKS        8          /* 800 ns */
#define T1H_TICKS        8          /* 800 ns */
#define T1L_TICKS        4          /* 450 ns (spec ≥450 ns, 400 ns ok at 10 MHz) */
#define RESET_TICKS      5000       /* 500 µs reset */
#define BYTES_PER_LED    3          /* GRB order */

static rmt_channel_handle_t s_rmt_chan = NULL;
static rmt_encoder_handle_t s_encoder  = NULL;   /* copy encoder */
static TimerHandle_t        s_timer    = NULL;
static led_mode_t           s_mode     = LED_MODE_OFF;
static int                  s_frame    = 0;

/* ---- Low-level pixel send：copy encoder 直接驱动 symbol 数组 ---- */
static void send_pixel(uint8_t r, uint8_t g, uint8_t b)
{
    /* WS2812B: GRB order, MSB first；24 个数据 symbol + 1 个 reset symbol */
    const uint8_t data[BYTES_PER_LED] = { g, r, b };
    rmt_symbol_word_t symbols[BYTES_PER_LED * 8 + 1];
    size_t count = 0;

    for (int byte = 0; byte < BYTES_PER_LED; byte++) {
        for (int bit = 7; bit >= 0; bit--) {
            if (data[byte] & (1 << bit)) {
                symbols[count++] = (rmt_symbol_word_t){
                    .level0 = 1, .duration0 = T1H_TICKS,
                    .level1 = 0, .duration1 = T1L_TICKS };
            } else {
                symbols[count++] = (rmt_symbol_word_t){
                    .level0 = 1, .duration0 = T0H_TICKS,
                    .level1 = 0, .duration1 = T0L_TICKS };
            }
        }
    }
    /* Append reset symbol */
    symbols[count++] = (rmt_symbol_word_t){
        .level0 = 0, .duration0 = RESET_TICKS,
        .level1 = 0, .duration1 = 0 };

    rmt_transmit_config_t tx_cfg = { .loop_count = 0 };
    rmt_transmit(s_rmt_chan, s_encoder, symbols,
                 count * sizeof(rmt_symbol_word_t), &tx_cfg);
    rmt_tx_wait_all_done(s_rmt_chan, 10 /* ms */);
}

/* ---- Tick: advance animation based on current mode ---- */
void status_led_tick(void)
{
    s_frame++;
    uint8_t r = 0, g = 0, b = 0;

    switch (s_mode) {
        case LED_MODE_NORMAL: {
            /* Green breathing: sin wave 0-255, period ~2 s at 50 ms ticks */
            float v = (sinf(s_frame * 0.157f) + 1.0f) * 0.5f; /* 0-1 */
            g = (uint8_t)(v * 40);  /* max brightness 40/255 (dim green) */
            break;
        }
        case LED_MODE_WARNING:
            /* Yellow slow blink 1 Hz (on 500 ms, off 500 ms) */
            if ((s_frame % 20) < 10) { r = 60; g = 40; }
            break;
        case LED_MODE_ERROR:
            /* Red fast blink 4 Hz */
            if ((s_frame % 5) < 2) { r = 80; }
            break;
        case LED_MODE_WIFI_DISCONNECTED:
            /* Blue slow blink 0.5 Hz */
            if ((s_frame % 40) < 20) { b = 60; }
            break;
        case LED_MODE_OTA: {
            /* Purple breathing */
            float v = (sinf(s_frame * 0.157f) + 1.0f) * 0.5f;
            r = (uint8_t)(v * 30);
            b = (uint8_t)(v * 50);
            break;
        }
        case LED_MODE_OFF:
        default:
            break;
    }
    send_pixel(r, g, b);
}

static void timer_cb(TimerHandle_t t) { (void)t; status_led_tick(); }

/* ---- Public API ---- */
esp_err_t status_led_init(void)
{
    rmt_tx_channel_config_t chan_cfg = {
        .gpio_num         = LED_GPIO,
        .clk_src          = RMT_CLK_SRC_DEFAULT,
        .resolution_hz    = RMT_CLK_HZ,
        .mem_block_symbols= 64,
        .trans_queue_depth= 4,
    };
    ESP_RETURN_ON_ERROR(rmt_new_tx_channel(&chan_cfg, &s_rmt_chan),
                        TAG, "rmt tx channel config failed");

    /* copy encoder：把 rmt_symbol_word_t 数组原样送入通道 */
    rmt_copy_encoder_config_t enc_cfg = {};
    ESP_RETURN_ON_ERROR(rmt_new_copy_encoder(&enc_cfg, &s_encoder),
                        TAG, "copy encoder create failed");

    ESP_RETURN_ON_ERROR(rmt_enable(s_rmt_chan), TAG, "rmt enable failed");

    s_timer = xTimerCreate("led_tick", pdMS_TO_TICKS(50), pdTRUE, NULL, timer_cb);
    xTimerStart(s_timer, 0);

    send_pixel(0, 0, 0); /* off */
    ESP_LOGI(TAG, "WS2812B init OK (GPIO%d, 3.3V supply)", LED_GPIO);
    return ESP_OK;
}

void status_led_set_mode(led_mode_t mode)
{
    s_mode  = mode;
    s_frame = 0;
}

void status_led_set_rgb(uint8_t r, uint8_t g, uint8_t b)
{
    send_pixel(r, g, b);
}
