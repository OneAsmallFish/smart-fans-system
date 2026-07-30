/*
 * wifi_manager.c — WiFi STA/AP 管理器 + 按键处理 + Captive Portal
 *
 * ⚠️ 关键设计决策（来自 Medication-Reminder-System 已踩坑经验）:
 *   1. SNTP 在 IP_EVENT_STA_GOT_IP 启动，不在 WIFI_EVENT_STA_CONNECTED
 *   2. MQTT 启动通过 FreeRTOS Timer 延迟（不在事件处理器内调用）
 *   3. 断连后指数退避重连 (1s, 2s, 4s ... 60s)
 *   4. 事件处理器内绝对不调用 vTaskDelay（用 esp_rom_delay_us 替代）
 */
#include "wifi_manager.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_sntp.h"
#include "esp_http_server.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "freertos/task.h"
#include <string.h>
#include <stdio.h>

static const char *TAG = "WIFI_MGR";

/* NVS keys */
#define NVS_NS          "fan_ctrl"
#define NVS_KEY_SSID    "wifi_ssid"
#define NVS_KEY_PASS    "wifi_pass"

/* Button GPIO */
#define BTN_GPIO        38
#define BTN_LONG_MS     3000   /* 3s  → AP 配网模式 */
#define BTN_FACTORY_MS  10000  /* 10s → 恢复出厂设置 */

static wifi_connected_cb_t    s_on_connected    = NULL;
static wifi_disconnected_cb_t s_on_disconnected = NULL;
static TimerHandle_t          s_reconnect_timer = NULL;
static TimerHandle_t          s_btn_timer       = NULL;
static esp_netif_t           *s_sta_netif       = NULL;
static esp_netif_t           *s_ap_netif        = NULL;
static bool                   s_connected       = false;
static int                    s_retry_count     = 0;
static int64_t                s_btn_press_time  = 0;  /* ⚠️ int64_t for esp_timer_get_time() */
static httpd_handle_t         s_httpd           = NULL;

/* ---- Reconnect backoff ---- */
static void reconnect_cb(TimerHandle_t t)
{
    (void)t;
    ESP_LOGI(TAG, "Reconnect attempt %d", s_retry_count);
    esp_wifi_connect();
}

static void schedule_reconnect(void)
{
    int delay_ms = 1000 << s_retry_count; /* 1s, 2s, 4s, 8s ... */
    if (delay_ms > 60000) delay_ms = 60000;
    s_retry_count++;
    xTimerChangePeriod(s_reconnect_timer, pdMS_TO_TICKS(delay_ms), 0);
    xTimerStart(s_reconnect_timer, 0);
}

/* ---- Captive Portal ---- */
static esp_err_t portal_root_handler(httpd_req_t *req)
{
    static const char *HTML =
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<title>Fan Controller WiFi Setup</title></head><body>"
        "<h2>WiFi Configuration</h2>"
        "<form method='POST' action='/save'>"
        "SSID: <input name='ssid' type='text' required><br><br>"
        "Password: <input name='pass' type='password'><br><br>"
        "<input type='submit' value='Save &amp; Connect'>"
        "</form></body></html>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_sendstr(req, HTML);
}

static esp_err_t portal_save_handler(httpd_req_t *req)
{
    char buf[256] = {0};
    int  len = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (len <= 0) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    /* Parse URL-encoded form: ssid=...&pass=... */
    char ssid[33] = {0}, pass[65] = {0};
    httpd_query_key_value(buf, "ssid", ssid, sizeof(ssid));
    httpd_query_key_value(buf, "pass", pass, sizeof(pass));

    if (ssid[0]) {
        wifi_manager_set_credentials(ssid, pass);
        httpd_resp_sendstr(req, "<html><body><p>Saved! Rebooting...</p></body></html>");
        /* Reboot after short delay (timer, not vTaskDelay in handler) */
        static TimerHandle_t reboot_t = NULL;
        if (!reboot_t) {
            reboot_t = xTimerCreate("reboot", pdMS_TO_TICKS(1500), pdFALSE, NULL,
                                    (void(*)(TimerHandle_t))esp_restart);
        }
        xTimerStart(reboot_t, 0);
    } else {
        httpd_resp_sendstr(req, "<html><body><p>Invalid SSID</p></body></html>");
    }
    return ESP_OK;
}

static void start_captive_portal(void)
{
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    if (httpd_start(&s_httpd, &cfg) != ESP_OK) return;

    httpd_uri_t root = { .uri="/",     .method=HTTP_GET,  .handler=portal_root_handler  };
    httpd_uri_t save = { .uri="/save", .method=HTTP_POST, .handler=portal_save_handler  };
    httpd_register_uri_handler(s_httpd, &root);
    httpd_register_uri_handler(s_httpd, &save);
    ESP_LOGI(TAG, "Captive portal running at 192.168.4.1");
}

/* ---- Event handlers ---- */
static void wifi_event_handler(void *arg, esp_event_base_t base,
                                int32_t event_id, void *event_data)
{
    switch (event_id) {
        case WIFI_EVENT_STA_START:
            esp_wifi_connect();
            break;

        case WIFI_EVENT_STA_CONNECTED:
            ESP_LOGI(TAG, "WiFi connected, waiting for IP...");
            /* ⚠️ DO NOT start MQTT here — wait for IP_EVENT_STA_GOT_IP */
            break;

        case WIFI_EVENT_STA_DISCONNECTED:
            s_connected = false;
            if (s_on_disconnected) s_on_disconnected();
            schedule_reconnect();
            ESP_LOGW(TAG, "WiFi disconnected, retry %d", s_retry_count);
            break;

        case WIFI_EVENT_AP_STACONNECTED:
            ESP_LOGI(TAG, "Station connected to AP");
            break;

        default: break;
    }
}

static void ip_event_handler(void *arg, esp_event_base_t base,
                              int32_t event_id, void *event_data)
{
    if (event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)event_data;
        char ip_str[16];
        snprintf(ip_str, sizeof(ip_str), IPSTR, IP2STR(&e->ip_info.ip));
        ESP_LOGI(TAG, "Got IP: %s", ip_str);
        s_connected   = true;
        s_retry_count = 0;

        /* ⚠️ SNTP 在 GOT_IP 启动（不在 STA_CONNECTED） */
        esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
        esp_sntp_setservername(0, "ntp.aliyun.com");
        esp_sntp_setservername(1, "pool.ntp.org");
        esp_sntp_init();

        if (s_on_connected) s_on_connected(ip_str);
    }
}

/* ---- Button polling (called from a timer every 50ms) ---- */
static void btn_poll_cb(TimerHandle_t t)
{
    (void)t;
    static bool s_was_pressed = false;
    bool pressed = (gpio_get_level(BTN_GPIO) == 0);

    if (pressed && !s_was_pressed) {
        /* ⚠️ int64_t for esp_timer_get_time() — prevents 72min overflow */
        s_btn_press_time = esp_timer_get_time();
        s_was_pressed    = true;
    } else if (!pressed && s_was_pressed) {
        int64_t held_us = esp_timer_get_time() - s_btn_press_time;
        int64_t held_ms = held_us / 1000;
        s_was_pressed   = false;

        if (held_ms >= BTN_FACTORY_MS) {
            ESP_LOGW(TAG, "Factory reset triggered");
            wifi_manager_clear_credentials();
            esp_restart();
        } else if (held_ms >= BTN_LONG_MS) {
            ESP_LOGI(TAG, "Entering AP provisioning mode");
            wifi_manager_start_ap();
        }
    }
}

/* ---- Public API ---- */
esp_err_t wifi_manager_init(wifi_connected_cb_t    on_connected,
                             wifi_disconnected_cb_t on_disconnected)
{
    s_on_connected    = on_connected;
    s_on_disconnected = on_disconnected;

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif init failed");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop failed");

    s_sta_netif = esp_netif_create_default_wifi_sta();
    s_ap_netif  = esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "wifi init failed");

    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL);
    esp_event_handler_register(IP_EVENT,   IP_EVENT_STA_GOT_IP, ip_event_handler, NULL);

    /* Button GPIO */
    gpio_config_t io = {
        .pin_bit_mask = (1ULL << BTN_GPIO),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,  /* internal 45kΩ pull-up */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&io);

    s_reconnect_timer = xTimerCreate("wifi_rc", pdMS_TO_TICKS(1000), pdFALSE, NULL, reconnect_cb);
    s_btn_timer       = xTimerCreate("btn_poll", pdMS_TO_TICKS(50),  pdTRUE,  NULL, btn_poll_cb);
    xTimerStart(s_btn_timer, 0);

    ESP_LOGI(TAG, "WiFi manager init OK (STA+AP, btn=GPIO%d)", BTN_GPIO);
    return ESP_OK;
}

esp_err_t wifi_manager_start(void)
{
    char ssid[33] = {0}, pass[65] = {0};
    nvs_handle_t nvs;
    bool has_creds = false;

    if (nvs_open(NVS_NS, NVS_READONLY, &nvs) == ESP_OK) {
        size_t ssid_len = sizeof(ssid), pass_len = sizeof(pass);
        if (nvs_get_str(nvs, NVS_KEY_SSID, ssid, &ssid_len) == ESP_OK &&
            nvs_get_str(nvs, NVS_KEY_PASS, pass, &pass_len) == ESP_OK &&
            ssid[0] != '\0') {
            has_creds = true;
        }
        nvs_close(nvs);
    }

    if (!has_creds) {
        ESP_LOGI(TAG, "No WiFi credentials, starting AP mode");
        return wifi_manager_start_ap();
    }

    wifi_config_t wifi_cfg = {0};
    strncpy((char *)wifi_cfg.sta.ssid,     ssid, sizeof(wifi_cfg.sta.ssid) - 1);
    strncpy((char *)wifi_cfg.sta.password, pass, sizeof(wifi_cfg.sta.password) - 1);

    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "set STA mode failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg), TAG, "set config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start failed");
    ESP_LOGI(TAG, "Connecting to SSID: %s", ssid);
    return ESP_OK;
}

esp_err_t wifi_manager_start_ap(void)
{
    char ap_ssid[32];
    uint8_t mac[6];
    esp_wifi_get_mac(WIFI_IF_AP, mac);
    snprintf(ap_ssid, sizeof(ap_ssid), "FanCtrl-%02X%02X", mac[4], mac[5]);

    wifi_config_t ap_cfg = {
        .ap = {
            .max_connection = 4,
            .authmode       = WIFI_AUTH_OPEN,
        }
    };
    strncpy((char *)ap_cfg.ap.ssid, ap_ssid, sizeof(ap_cfg.ap.ssid));
    ap_cfg.ap.ssid_len = strlen(ap_ssid);

    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_AP), TAG, "AP mode failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg), TAG, "AP config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi AP start failed");

    start_captive_portal();
    ESP_LOGI(TAG, "AP mode: SSID=%s (open), portal=192.168.4.1", ap_ssid);
    return ESP_OK;
}

esp_err_t wifi_manager_set_credentials(const char *ssid, const char *password)
{
    nvs_handle_t nvs;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &nvs), TAG, "nvs open failed");
    nvs_set_str(nvs, NVS_KEY_SSID, ssid);
    nvs_set_str(nvs, NVS_KEY_PASS, password ? password : "");
    nvs_commit(nvs);
    nvs_close(nvs);
    ESP_LOGI(TAG, "WiFi credentials saved: SSID=%s", ssid);
    return ESP_OK;
}

esp_err_t wifi_manager_clear_credentials(void)
{
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS, NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_erase_all(nvs);
        nvs_commit(nvs);
        nvs_close(nvs);
    }
    ESP_LOGI(TAG, "WiFi credentials cleared (factory reset)");
    return ESP_OK;
}

bool wifi_manager_is_connected(void) { return s_connected; }
