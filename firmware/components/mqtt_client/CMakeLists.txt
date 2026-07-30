idf_component_register(
    SRCS "mqtt_client_wrapper.c"
    INCLUDE_DIRS "."
    REQUIRES mqtt nvs_flash cJSON log freertos
)
