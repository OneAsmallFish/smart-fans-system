idf_component_register(
    SRCS "fan_tach.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_timer log
)
