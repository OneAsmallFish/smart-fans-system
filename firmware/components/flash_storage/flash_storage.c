/*
 * flash_storage.c — NVS 配置持久化 + WL 循环日志
 */
#include "flash_storage.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "wear_levelling.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>

static const char *TAG = "FLASH";

#define NVS_NS       "fan_cfg"
#define WL_PARTITION "storage"

/* Circular log header stored at start of WL partition */
typedef struct {
    uint32_t magic;    /* 0xFAC70001 = valid header */
    uint32_t head;     /* write pointer */
    uint32_t count;    /* total entries written (wraps STORAGE_LOG_MAX_ENTRIES) */
} log_header_t;

#define LOG_MAGIC    0xFAC70001
#define HEADER_SIZE  sizeof(log_header_t)
#define ENTRY_SIZE   sizeof(log_entry_t)

static wl_handle_t        s_wl_handle    = WL_INVALID_HANDLE;
static SemaphoreHandle_t  s_wl_mutex     = NULL;
/* ⚠️ int64_t for esp_timer_get_time() — prevents 72min overflow */
static int64_t            s_last_log_us  = 0;

/* ---- WL helpers ---- */
static esp_err_t wl_read_header(log_header_t *hdr)
{
    return wl_read(s_wl_handle, 0, hdr, HEADER_SIZE);
}

static esp_err_t wl_write_header(const log_header_t *hdr)
{
    return wl_write(s_wl_handle, 0, hdr, HEADER_SIZE);
}

/* ---- Public API ---- */
esp_err_t flash_storage_init(void)
{
    s_wl_mutex = xSemaphoreCreateMutex();

    /* Wear Levelling on "storage" FAT partition */
    esp_err_t r = wl_mount(esp_partition_find_first(
                      ESP_PARTITION_TYPE_DATA,
                      ESP_PARTITION_SUBTYPE_DATA_FAT,
                      WL_PARTITION), &s_wl_handle);
    if (r != ESP_OK) {
        ESP_LOGE(TAG, "WL mount failed (%s)", esp_err_to_name(r));
        return r;
    }

    /* Validate or initialise log header */
    log_header_t hdr;
    wl_read_header(&hdr);
    if (hdr.magic != LOG_MAGIC) {
        ESP_LOGI(TAG, "Initialising circular log");
        hdr.magic = LOG_MAGIC; hdr.head = 0; hdr.count = 0;
        wl_write_header(&hdr);
    }

    ESP_LOGI(TAG, "Flash storage init OK (WL partition '%s')", WL_PARTITION);
    return ESP_OK;
}

esp_err_t storage_write_config(const char *key, const char *value)
{
    nvs_handle_t nvs;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &nvs), TAG, "nvs open");
    esp_err_t r = nvs_set_str(nvs, key, value);
    nvs_commit(nvs);
    nvs_close(nvs);
    return r;
}

esp_err_t storage_read_config(const char *key, char *out_val, size_t max_len)
{
    nvs_handle_t nvs;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READONLY, &nvs), TAG, "nvs open");
    esp_err_t r = nvs_get_str(nvs, key, out_val, &max_len);
    nvs_close(nvs);
    return r;
}

esp_err_t storage_log_sensor_data(const log_entry_t *entry)
{
    if (!entry) return ESP_ERR_INVALID_ARG;
    if (s_wl_handle == WL_INVALID_HANDLE) return ESP_ERR_INVALID_STATE;

    /* Throttle writes: minimum STORAGE_LOG_MIN_INTERVAL_S seconds */
    int64_t now_us = esp_timer_get_time();  /* ⚠️ int64_t */
    if ((now_us - s_last_log_us) < ((int64_t)STORAGE_LOG_MIN_INTERVAL_S * 1000000LL)) {
        return ESP_OK; /* skip — too soon */
    }

    xSemaphoreTake(s_wl_mutex, portMAX_DELAY);

    log_header_t hdr;
    wl_read_header(&hdr);

    size_t offset = HEADER_SIZE + (hdr.head % STORAGE_LOG_MAX_ENTRIES) * ENTRY_SIZE;
    wl_write(s_wl_handle, offset, entry, ENTRY_SIZE);

    hdr.head = (hdr.head + 1) % STORAGE_LOG_MAX_ENTRIES;
    if (hdr.count < STORAGE_LOG_MAX_ENTRIES) hdr.count++;
    wl_write_header(&hdr);

    s_last_log_us = now_us;
    xSemaphoreGive(s_wl_mutex);
    return ESP_OK;
}

esp_err_t storage_get_recent_logs(log_entry_t *out, uint32_t *count)
{
    if (!out || !count) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_wl_mutex, portMAX_DELAY);
    log_header_t hdr;
    wl_read_header(&hdr);

    uint32_t n = (*count < hdr.count) ? *count : hdr.count;
    /* Read backwards from head */
    uint32_t start = (hdr.head + STORAGE_LOG_MAX_ENTRIES - n) % STORAGE_LOG_MAX_ENTRIES;
    for (uint32_t i = 0; i < n; i++) {
        size_t offset = HEADER_SIZE + ((start + i) % STORAGE_LOG_MAX_ENTRIES) * ENTRY_SIZE;
        wl_read(s_wl_handle, offset, &out[i], ENTRY_SIZE);
    }
    *count = n;
    xSemaphoreGive(s_wl_mutex);
    return ESP_OK;
}

uint32_t storage_get_log_count(void)
{
    log_header_t hdr;
    if (s_wl_handle == WL_INVALID_HANDLE) return 0;
    wl_read_header(&hdr);
    return (hdr.magic == LOG_MAGIC) ? hdr.count : 0;
}
