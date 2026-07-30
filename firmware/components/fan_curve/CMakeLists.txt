idf_component_register(
    SRCS "fan_curve.c"
    INCLUDE_DIRS "."
    REQUIRES fan_pwm nvs_flash log
)
