/*
 * usb_console.c — USB-CDC 命令行控制台
 * 命令格式: <cmd> [args]\n
 * 响应格式: {"ok":true,"data":{...}}\n 或 {"ok":false,"error":"..."}\n
 */
#include "usb_console.h"
#include "esp_check.h"
#include "tinyusb.h"
#include "tinyusb_default_config.h"
#include "tinyusb_cdc_acm.h"
#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/timers.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "USB_CON";

#define MAX_CMDS      16
#define RX_BUF_SIZE   256

typedef struct { char name[32]; console_cmd_handler_t handler; } cmd_entry_t;
static cmd_entry_t s_cmds[MAX_CMDS];
static int         s_cmd_count = 0;

static QueueHandle_t s_line_queue;  /* lines received from USB CDC */
static char          s_rx_buf[RX_BUF_SIZE];
static int           s_rx_pos = 0;

/* ---- Built-in command handlers ---- */
static char *cmd_help(const char *args)
{
    (void)args;
    cJSON *root = cJSON_CreateObject();
    cJSON *cmds = cJSON_AddArrayToObject(root, "commands");
    for (int i = 0; i < s_cmd_count; i++) {
        cJSON_AddItemToArray(cmds, cJSON_CreateString(s_cmds[i].name));
    }
    char *js = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return js;
}

static char *cmd_reboot(const char *args)
{
    (void)args;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "rebooting", true);
    char *js = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    /* Reboot via timer so we can send the response first */
    extern void esp_restart(void);
    static TimerHandle_t t = NULL;
    if (!t) t = xTimerCreate("reboot", pdMS_TO_TICKS(500), pdFALSE, NULL,
                              (void(*)(TimerHandle_t))esp_restart);
    xTimerStart(t, 0);
    return js;
}

/* ---- CDC receive callback (called from TinyUSB task) ---- */
static void cdc_rx_cb(int itf, cdcacm_event_t *event)
{
    (void)itf;
    if (event->type != CDC_EVENT_RX) return;

    uint8_t buf[64];
    size_t  rx_size = 0;
    tinyusb_cdcacm_read(itf, buf, sizeof(buf), &rx_size);

    for (size_t i = 0; i < rx_size; i++) {
        char c = (char)buf[i];
        if (c == '\n' || c == '\r') {
            if (s_rx_pos > 0) {
                s_rx_buf[s_rx_pos] = '\0';
                char *line = strdup(s_rx_buf);
                if (line) xQueueSend(s_line_queue, &line, 0);
                s_rx_pos = 0;
            }
        } else if (s_rx_pos < RX_BUF_SIZE - 1) {
            s_rx_buf[s_rx_pos++] = c;
        }
    }
}

/* ---- Command dispatch task ---- */
static void console_task(void *arg)
{
    (void)arg;
    char *line;
    while (1) {
        if (xQueueReceive(s_line_queue, &line, portMAX_DELAY)) {
            /* Split: first token = cmd, rest = args */
            char *cmd  = line;
            char *args = strchr(line, ' ');
            if (args) { *args = '\0'; args++; } else { args = ""; }

            char *response = NULL;
            bool  found    = false;
            for (int i = 0; i < s_cmd_count; i++) {
                if (strcmp(s_cmds[i].name, cmd) == 0) {
                    response = s_cmds[i].handler(args);
                    found    = true;
                    break;
                }
            }

            if (!found) {
                cJSON *err = cJSON_CreateObject();
                cJSON_AddBoolToObject(err, "ok", false);
                cJSON_AddStringToObject(err, "error", "unknown command");
                response = cJSON_PrintUnformatted(err);
                cJSON_Delete(err);
            }

            if (response) {
                /* Wrap in {"ok":true,"data":...} if not already wrapped */
                usb_console_write(response);
                usb_console_write("\n");
                free(response);
            }
            free(line);
        }
    }
}

/* ---- Public API ---- */
esp_err_t usb_console_init(void)
{
    /* esp_tinyusb v2.0：默认描述符（VID/PID 等来自组件 Kconfig） */
    const tinyusb_config_t tusb_cfg = TINYUSB_DEFAULT_CONFIG();
    ESP_RETURN_ON_ERROR(tinyusb_driver_install(&tusb_cfg), TAG, "tusb install failed");

    tinyusb_config_cdcacm_t acm_cfg = {
        .cdc_port   = TINYUSB_CDC_ACM_0,
        .callback_rx      = cdc_rx_cb,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = NULL,
        .callback_line_coding_changed = NULL,
    };
    ESP_RETURN_ON_ERROR(tinyusb_cdcacm_init(&acm_cfg), TAG, "cdc acm init failed");

    s_line_queue = xQueueCreate(8, sizeof(char *));

    /* Register built-in commands */
    console_register_command("help",   cmd_help);
    console_register_command("reboot", cmd_reboot);
    /* main.c 注册: status / ota / fan / wifi / mqtt（FW-22 命令集） */

    xTaskCreate(console_task, "usb_con", 4096, NULL, 1, NULL);
    ESP_LOGI(TAG, "USB-CDC console init OK (GPIO19/20, native USB-OTG)");
    return ESP_OK;
}

esp_err_t console_register_command(const char *cmd, console_cmd_handler_t handler)
{
    if (s_cmd_count >= MAX_CMDS) return ESP_ERR_NO_MEM;
    strncpy(s_cmds[s_cmd_count].name, cmd, sizeof(s_cmds[0].name) - 1);
    s_cmds[s_cmd_count].handler = handler;
    s_cmd_count++;
    return ESP_OK;
}

void usb_console_write(const char *str)
{
    if (!str) return;
    tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0, (const uint8_t *)str, strlen(str));
    tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0, 0);
}
