idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES
        nvs_flash
        esp_wifi
        esp_event
        esp_netif
        mqtt
        esp_https_ota
        driver
        esp_adc
        usb
        freertos
        log
        esp_timer
        json
        # ---- 自定义组件（FW-02: 13 个全部补齐） ----
        fan_pwm
        fan_tach
        fan_curve
        alert_manager
        bme280
        ds18b20
        power_monitor
        status_led
        wifi_manager
        mqtt_client
        usb_console
        flash_storage
        ota_handler
)
