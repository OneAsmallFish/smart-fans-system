; ============================================================
; sensors-io.sch — 传感器 + I/O 原理图
; BME280 (I2C) + DS18B20 (1-Wire) + WS2812B RGB LED + 按键
; ============================================================

; ---- BME280 环境传感器 (I2C) ----
; I2C地址: SDO=GND → 0x76, SDO=VCC → 0x77 (本设计使用0x76)
; I2C速率: 400kHz Fast Mode

Component: BME280 U4
  VDD  = VCC_3V3
  GND  = GND_PWR
  SDI  = I2C_SDA    ; GPIO17
  SCK  = I2C_SCL    ; GPIO18
  SDO  = GND_PWR    ; I2C地址=0x76
  CSB  = VCC_3V3    ; 强制I2C模式

; BME280 去耦
Component: CERAMIC_100nF C23 (0402)
  + = VCC_3V3
  - = GND_PWR

; I2C 上拉电阻 (4.7kΩ，400kHz可用)
Component: RESISTOR_4K7 R25 (0805)   ; SDA上拉
  1 = VCC_3V3
  2 = I2C_SDA
Component: RESISTOR_4K7 R26 (0805)   ; SCL上拉
  1 = VCC_3V3
  2 = I2C_SCL

; ---- DS18B20 远程温度探头接口 ----
; 1-Wire协议，支持多传感器菊链
; 上拉: 4.7kΩ到3.3V (标准推荐值)
; GPIO16 → RMT外设驱动OneWire时序 (480μs复位, 60μs读写槽)

; 1-Wire 总线上拉
Component: RESISTOR_4K7 R27 (0805)   ; OneWire上拉到3.3V
  1 = VCC_3V3
  2 = ONEWIRE_BUS

; DS18B20探头接口1 (3.5mm音频座 或 XH2.54-3P接线端子)
Component: TERMINAL_3P J7            ; DS18B20接口1
  VCC  = VCC_3V3
  DQ   = ONEWIRE_BUS                 ; GPIO16
  GND  = GND_PWR

; DS18B20探头接口2 (同一1-Wire总线，传感器ROM地址自动识别)
Component: TERMINAL_3P J8            ; DS18B20接口2
  VCC  = VCC_3V3
  DQ   = ONEWIRE_BUS                 ; GPIO16 (同一总线)
  GND  = GND_PWR

; DS18B20 ESD保护 (可选)
; Component: TVS_UNIDIRECTIONAL D5 (SOD-323, Vbr=3.6V)
;   Anode = GND_PWR
;   Cathode = ONEWIRE_BUS

; ---- WS2812B-2020 RGB状态LED ----
; ⚠️ 关键: VCC接3.3V (不接5V)
; 原因: ESP32 GPIO VOH=3.0V < WS2812B VIH_min=0.7×5V=3.5V (5V供电时不可靠)
; 3.3V供电: VIH_min=0.7×3.3V=2.31V < 3.0V ✓ 逻辑可靠
; 亮度: ~12mA/channel (vs 20mA@5V)，状态指示足够亮

Component: WS2812B-2020 LED1         ; RGB状态指示LED
  VDD  = VCC_3V3                     ; ⚠️ 3.3V供电 (不是5V)
  GND  = GND_PWR
  DIN  = LED_DIN                     ; GPIO48 RMT输出 (3.3V逻辑)
  DOUT = NC                          ; 单颗LED，DOUT悬空

; WS2812B 去耦 (紧贴VDD引脚放置)
Component: CERAMIC_100nF C24 (0402)  ; WS2812B去耦
  + = VCC_3V3
  - = GND_PWR

; ---- 物理按键 ----
; WiFi配网键 (GPIO38)
Component: TACTILE_SW SW3            ; 配网按键 (长按3s进入AP配网模式)
  1 = BTN_WIFI_CFG                   ; GPIO38 (内部上拉，软件配置)
  2 = GND_PWR
; 注: GPIO38 使用 ESP32-S3 内部弱上拉 (45kΩ)，无需外部上拉电阻

; 系统重置键 → 直连ESP32-S3 EN引脚 (已在 power.sch SW1 定义)
; 注: 超长按(10s)→恢复出厂设置逻辑由固件按键时长检测实现

; ---- I2C 网络总结 ----
; GPIO17 (SDA) ←→ R25(4.7kΩ→VCC_3V3) ←→ BME280.SDI
; GPIO18 (SCL) ←→ R26(4.7kΩ→VCC_3V3) ←→ BME280.SCK
; GPIO16 (1-Wire) ←→ R27(4.7kΩ→VCC_3V3) ←→ J7.DQ + J8.DQ
; GPIO48 (RMT) → LED1.DIN (WS2812B)
; GPIO38 (Input, 内部上拉) ← SW3
