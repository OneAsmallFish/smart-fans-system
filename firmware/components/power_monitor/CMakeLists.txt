idf_component_register(
    SRCS "power_monitor.c"
    INCLUDE_DIRS "."
    REQUIRES esp_adc driver log
)
