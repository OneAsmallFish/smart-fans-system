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
        cJSON
)
