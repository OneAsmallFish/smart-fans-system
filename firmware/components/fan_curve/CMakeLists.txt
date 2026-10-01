idf_component_register(
    SRCS "fan_curve.c"
    INCLUDE_DIRS "."
    REQUIRES fan_pwm flash_storage log esp_timer
)
