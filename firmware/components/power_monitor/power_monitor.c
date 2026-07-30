/*
 * power_monitor.c — ADC1 电源电压监控 + 内部温度传感器
 * ⚠️ 不使用 ADC2（与 WiFi 冲突）
 */
#include "power_monitor.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "driver/temperature_sensor.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "PWR_MON";

/* ADC1 通道分配 (GPIO1=CH0, GPIO2=CH1, GPIO3=CH2) */
#define CH_3V3   ADC_CHANNEL_0   /* GPIO1 */
#define CH_5V    ADC_CHANNEL_1   /* GPIO2 */
#define CH_12V   ADC_CHANNEL_2   /* GPIO3 */
#define ADC_ATTEN ADC_ATTEN_DB_11 /* 最大 ~3.1V 输入 */
#define FILTER_N 16               /* 均值滤波采样次数 */
#define FAIL_THRESHOLD_V  10.0f   /* 12V 低于此值视为断电 */
#define FAIL_CONFIRM      3       /* 连续 3 次确认 */

static adc_oneshot_unit_handle_t s_adc_handle = NULL;
static adc_cali_handle_t         s_cali_handle = NULL;
static temperature_sensor_handle_t s_temp_sensor = NULL;
static power_fail_cb_t           s_fail_cb      = NULL;
static int                       s_fail_count   = 0;
static bool                      s_fail_fired   = false;

static float read_channel_voltage(adc_channel_t ch)
{
    int sum = 0;
    for (int i = 0; i < FILTER_N; i++) {
        int raw = 0;
        adc_oneshot_read(s_adc_handle, ch, &raw);
        sum += raw;
    }
    int avg_raw = sum / FILTER_N;
    int mv = 0;
    if (s_cali_handle) {
        adc_cali_raw_to_voltage(s_cali_handle, avg_raw, &mv);
    } else {
        /* Fallback: linear approximation without calibration */
        mv = (int)((float)avg_raw * 3100.0f / 4095.0f);
    }
    return (float)mv / 1000.0f; /* → Volts */
}

esp_err_t power_monitor_init(void)
{
    /* ADC1 oneshot unit */
    adc_oneshot_unit_init_cfg_t init_cfg = { .unit_id = ADC_UNIT_1 };
    ESP_RETURN_ON_ERROR(adc_oneshot_new_unit(&init_cfg, &s_adc_handle),
                        TAG, "adc unit init failed");

    adc_oneshot_chan_cfg_t ch_cfg = {
        .atten    = ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(s_adc_handle, CH_3V3, &ch_cfg),
                        TAG, "ch_3v3 failed");
    ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(s_adc_handle, CH_5V,  &ch_cfg),
                        TAG, "ch_5v failed");
    ESP_RETURN_ON_ERROR(adc_oneshot_config_channel(s_adc_handle, CH_12V, &ch_cfg),
                        TAG, "ch_12v failed");

    /* ADC calibration (curve fitting preferred; fallback to line fitting) */
#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cali_cfg = {
        .unit_id  = ADC_UNIT_1,
        .chan     = CH_12V,
        .atten    = ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    if (adc_cali_create_scheme_curve_fitting(&cali_cfg, &s_cali_handle) != ESP_OK) {
        ESP_LOGW(TAG, "curve fitting cali failed, using raw");
    }
#endif

    /* Internal temperature sensor */
    temperature_sensor_config_t temp_cfg = TEMPERATURE_SENSOR_CONFIG_DEFAULT(10, 80);
    if (temperature_sensor_install(&temp_cfg, &s_temp_sensor) == ESP_OK) {
        temperature_sensor_enable(s_temp_sensor);
    }

    ESP_LOGI(TAG, "ADC1 power monitor init OK (CH0=3.3V, CH1=5V, CH2=12V)");
    return ESP_OK;
}

esp_err_t power_monitor_read_all(float *v12, float *v5, float *v33)
{
    if (!v12 || !v5 || !v33) return ESP_ERR_INVALID_ARG;

    float adc_3v3 = read_channel_voltage(CH_3V3);
    float adc_5v  = read_channel_voltage(CH_5V);
    float adc_12v = read_channel_voltage(CH_12V);

    *v33 = adc_3v3 * VOLTAGE_DIVIDER_3V3;
    *v5  = adc_5v  * VOLTAGE_DIVIDER_5V;
    *v12 = adc_12v * VOLTAGE_DIVIDER_12V;

    /* 断电检测: 12V 低于阈值连续 FAIL_CONFIRM 次 */
    if (*v12 < FAIL_THRESHOLD_V) {
        s_fail_count++;
        if (s_fail_count >= FAIL_CONFIRM && !s_fail_fired) {
            s_fail_fired = true;
            ESP_LOGW(TAG, "Power fail detected! 12V=%.2fV", *v12);
            if (s_fail_cb) s_fail_cb();
        }
    } else {
        s_fail_count = 0;
        s_fail_fired = false;
    }
    return ESP_OK;
}

float power_monitor_read_internal_temp(void)
{
    float temp = 0.0f;
    if (s_temp_sensor) {
        temperature_sensor_get_celsius(s_temp_sensor, &temp);
    }
    return temp;
}

void power_monitor_on_power_fail(power_fail_cb_t cb)
{
    s_fail_cb = cb;
}
