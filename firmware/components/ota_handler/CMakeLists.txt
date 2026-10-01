idf_component_register(
    SRCS "ota_handler.c"
    INCLUDE_DIRS "."
    REQUIRES esp_https_ota app_update mqtt_client nvs_flash log mbedtls json
)
