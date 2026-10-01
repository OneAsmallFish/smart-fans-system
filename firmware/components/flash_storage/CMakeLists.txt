idf_component_register(
    SRCS "flash_storage.c"
    INCLUDE_DIRS "."
    REQUIRES nvs_flash wear_levelling fatfs esp_timer log
)
