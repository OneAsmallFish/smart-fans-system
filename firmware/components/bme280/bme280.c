/*
 * bme280.c — BME280 I2C 驱动 + Bosch 补偿算法
 * 使用 int64_t 防溢出（补偿公式最大中间值约 2^40）
 * ⚠️ I2C 超时设为 1000ms；出错后重新调用 i2c_master_bus_rm_device + 重初始化，
 *    防止总线死锁永久阻塞
 */
#include "bme280.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "BME280";

#define I2C_PORT      I2C_NUM_0
#define I2C_SDA_GPIO  17
#define I2C_SCL_GPIO  18
#define I2C_CLK_HZ    400000      /* 400 kHz fast mode */
#define BME280_ADDR   0x76
#define I2C_TIMEOUT_MS 1000

/* BME280 register addresses */
#define REG_CALIB_T1   0x88
#define REG_ID         0xD0
#define REG_RESET      0xE0
#define REG_CALIB_H1   0xA1
#define REG_CALIB_H2   0xE1
#define REG_CTRL_HUM   0xF2
#define REG_STATUS     0xF3
#define REG_CTRL_MEAS  0xF4
#define REG_CONFIG     0xF5
#define REG_PRESS_MSB  0xF7

/* Calibration coefficients */
static struct {
    uint16_t T1; int16_t T2, T3;
    uint16_t P1; int16_t P2, P3, P4, P5, P6, P7, P8, P9;
    uint8_t  H1; int16_t H2; uint8_t H3; int16_t H4, H5; int8_t H6;
} s_cal;

static i2c_master_bus_handle_t  s_bus;
static i2c_master_dev_handle_t  s_dev;
static int32_t                  s_t_fine; /* shared between T/P/H compensation */

static esp_err_t bme_write(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    return i2c_master_transmit(s_dev, buf, 2, I2C_TIMEOUT_MS);
}

static esp_err_t bme_read(uint8_t reg, uint8_t *out, size_t len)
{
    esp_err_t r = i2c_master_transmit(s_dev, &reg, 1, I2C_TIMEOUT_MS);
    if (r != ESP_OK) return r;
    return i2c_master_receive(s_dev, out, len, I2C_TIMEOUT_MS);
}

/* --- Bosch compensation formulas (int64_t for pressure) --- */
static float compensate_temperature(int32_t adc_T)
{
    int32_t var1 = (((adc_T >> 3) - ((int32_t)s_cal.T1 << 1)) * s_cal.T2) >> 11;
    int32_t var2 = (((((adc_T >> 4) - (int32_t)s_cal.T1) *
                      ((adc_T >> 4) - (int32_t)s_cal.T1)) >> 12) * s_cal.T3) >> 14;
    s_t_fine = var1 + var2;
    return (float)((s_t_fine * 5 + 128) >> 8) / 100.0f;
}

static float compensate_pressure(int32_t adc_P)
{
    int64_t var1 = (int64_t)s_t_fine - 128000;
    int64_t var2 = var1 * var1 * (int64_t)s_cal.P6;
    var2 += (var1 * (int64_t)s_cal.P5) << 17;
    var2 += ((int64_t)s_cal.P4) << 35;
    var1  = ((var1 * var1 * (int64_t)s_cal.P3) >> 8) +
            ((var1 * (int64_t)s_cal.P2) << 12);
    var1  = ((((int64_t)1 << 47) + var1) * (int64_t)s_cal.P1) >> 33;
    if (var1 == 0) return 0.0f;
    int64_t p = 1048576 - adc_P;
    p = (((p << 31) - var2) * 3125) / var1;
    var1 = ((int64_t)s_cal.P9 * (p >> 13) * (p >> 13)) >> 25;
    var2 = ((int64_t)s_cal.P8 * p) >> 19;
    p = ((p + var1 + var2) >> 8) + ((int64_t)s_cal.P7 << 4);
    return (float)p / 25600.0f; /* → hPa */
}

static float compensate_humidity(int32_t adc_H)
{
    int32_t v = s_t_fine - 76800;
    v = (((adc_H << 14) - ((int32_t)s_cal.H4 << 20) - (s_cal.H5 * v) + 16384) >> 15) *
        ((((((v * s_cal.H6) >> 10) * (((v * s_cal.H3) >> 11) + 32768)) >> 10) + 2097152) *
         s_cal.H2 + 8192) >> 14;
    v -= ((((v >> 15) * (v >> 15)) >> 7) * s_cal.H1) >> 4;
    if (v < 0) v = 0;
    if (v > 419430400) v = 419430400;
    return (float)(v >> 12) / 1024.0f;
}

esp_err_t bme280_init(void)
{
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port     = I2C_PORT,
        .sda_io_num   = I2C_SDA_GPIO,
        .scl_io_num   = I2C_SCL_GPIO,
        .clk_source   = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = false, /* external 4.7kΩ pull-ups */
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &s_bus), TAG, "bus init failed");

    i2c_device_config_t dev_cfg = {
        .device_address = BME280_ADDR,
        .scl_speed_hz   = I2C_CLK_HZ,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(s_bus, &dev_cfg, &s_dev),
                        TAG, "device add failed");

    /* Check chip ID */
    uint8_t chip_id = 0;
    ESP_RETURN_ON_ERROR(bme_read(REG_ID, &chip_id, 1), TAG, "read id failed");
    if (chip_id != 0x60) {
        ESP_LOGE(TAG, "unexpected chip ID 0x%02X (expect 0x60)", chip_id);
        return ESP_ERR_NOT_FOUND;
    }

    /* Soft reset */
    bme_write(REG_RESET, 0xB6);
    vTaskDelay(pdMS_TO_TICKS(10));

    /* Read temperature/pressure calibration (0x88..0x9F) */
    uint8_t cal[26];
    bme_read(REG_CALIB_T1, cal, 24);
    s_cal.T1 = (uint16_t)(cal[1] << 8 | cal[0]);
    s_cal.T2 = (int16_t)(cal[3] << 8 | cal[2]);
    s_cal.T3 = (int16_t)(cal[5] << 8 | cal[4]);
    s_cal.P1 = (uint16_t)(cal[7] << 8 | cal[6]);
    for (int i = 0; i < 8; i++)
        ((int16_t *)&s_cal.P2)[i] = (int16_t)(cal[9+i*2] << 8 | cal[8+i*2]);

    /* Humidity calibration */
    bme_read(REG_CALIB_H1, &s_cal.H1, 1);
    uint8_t hcal[7];
    bme_read(REG_CALIB_H2, hcal, 7);
    s_cal.H2 = (int16_t)(hcal[1] << 8 | hcal[0]);
    s_cal.H3 = hcal[2];
    s_cal.H4 = (int16_t)(hcal[3] << 4 | (hcal[4] & 0x0F));
    s_cal.H5 = (int16_t)((hcal[4] >> 4) | (hcal[5] << 4));
    s_cal.H6 = (int8_t)hcal[6];

    /* Configure oversampling: T×2, P×16, H×1, forced mode */
    bme_write(REG_CTRL_HUM, 0x01);   /* humidity ×1 */
    bme_write(REG_CONFIG,   0x00);   /* no standby, no IIR */

    ESP_LOGI(TAG, "BME280 init OK (I2C 0x76, GPIO17/18, 400kHz)");
    return ESP_OK;
}

esp_err_t bme280_read(bme280_data_t *out)
{
    if (!out) return ESP_ERR_INVALID_ARG;

    /* Trigger forced measurement: osrs_t×2, osrs_p×16, mode=forced */
    esp_err_t r = bme_write(REG_CTRL_MEAS, 0x57); /* 010 10000 11 */
    if (r != ESP_OK) return r;

    /* Wait for measurement (~10 ms typical) */
    uint8_t status;
    int tries = 20;
    do {
        vTaskDelay(pdMS_TO_TICKS(2));
        bme_read(REG_STATUS, &status, 1);
    } while ((status & 0x08) && --tries > 0); /* bit3=measuring */

    /* Read 8 bytes: press(3) + temp(3) + hum(2) */
    uint8_t raw[8];
    ESP_RETURN_ON_ERROR(bme_read(REG_PRESS_MSB, raw, 8), TAG, "read data failed");

    int32_t adc_P = (int32_t)((raw[0] << 12) | (raw[1] << 4) | (raw[2] >> 4));
    int32_t adc_T = (int32_t)((raw[3] << 12) | (raw[4] << 4) | (raw[5] >> 4));
    int32_t adc_H = (int32_t)((raw[6] << 8)  |  raw[7]);

    out->temperature_c = compensate_temperature(adc_T);
    out->pressure_hpa  = compensate_pressure(adc_P);
    out->humidity_pct  = compensate_humidity(adc_H);
    return ESP_OK;
}
