idf_component_register(
    SRCS "mqtt_client_wrapper.c"
    INCLUDE_DIRS "."
    REQUIRES mqtt nvs_flash json esp_timer log freertos
)
