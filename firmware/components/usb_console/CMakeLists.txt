idf_component_register(
    SRCS "usb_console.c"
    INCLUDE_DIRS "."
    REQUIRES log freertos json
)
