idf_component_register(
    SRCS "status_led.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_timer log
)
