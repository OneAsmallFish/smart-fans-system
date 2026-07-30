; ============================================================
; power.sch — 电源 + ESP32-S3 核心原理图
; 智能风扇控制系统 v1.0
; 格式: 文本网表 (grep-friendly，可导入KiCad/EasyEDA)
; ============================================================

; ---- SATA 15Pin 电源连接器 J1 ----
; SATA Pin定义（服务器PSU侧输出）
; ⚠️ SATA Pin1-3 虽输出3.3V，但电流受限且有PWDIS兼容性问题
; 本设计仅使用 5V(Pin7-9) 和 12V(Pin13-15)，3.3V改由LDO转换
; Pin3=PWDIS/3.3V → NC (不连接，避免PWDIS干扰)

Component: SATA_15PIN J1
  Pin1  = 3.3V_SATA → NC  ; PWDIS/3.3V — 不连接
  Pin2  = 3.3V_SATA → NC  ; PWDIS/3.3V — 不连接
  Pin3  = 3.3V_PWDIS → NC ; PWDIS — 不连接，NC (Power Disable，不使用)
  Pin4  = GND → GND_PWR
  Pin5  = GND → GND_PWR
  Pin6  = GND → GND_PWR
  Pin7  = 5V  → VCC_5V
  Pin8  = 5V  → VCC_5V
  Pin9  = 5V  → VCC_5V
  Pin10 = GND → GND_PWR
  Pin11 = GND → GND_PWR
  Pin12 = GND → GND_PWR
  Pin13 = 12V → VCC_12V
  Pin14 = 12V → VCC_12V
  Pin15 = 12V → VCC_12V

; ---- 5V → 3.3V LDO (AMS1117-3.3) U1 ----
; 封装: SOT-223 (必须，散热要求)
; 散热铜皮: ≥2cm² (顶层覆铜连接至散热焊盘)
; 峰值功耗: (5V-3.3V)×0.4A=0.68W, θJA=72°C/W, ΔT=49°C @25°C环境 → 安全

Component: AMS1117-3.3 U1
  VIN  = VCC_5V
  GND  = GND_PWR
  VOUT = VCC_3V3

; LDO Input Decoupling
Component: ELECTROLYTIC_100uF C1 (25V, 5mm径向)
  + = VCC_5V
  - = GND_PWR
Component: CERAMIC_100nF C2 (0805, X5R)
  + = VCC_5V
  - = GND_PWR

; LDO Output Decoupling
Component: ELECTROLYTIC_100uF C3 (10V, 5mm径向)
  + = VCC_3V3
  - = GND_PWR
Component: CERAMIC_100nF C4 (0805, X5R)
  + = VCC_3V3
  - = GND_PWR

; ---- 5V 主线去耦 ----
Component: ELECTROLYTIC_100uF C5 (16V, 5mm径向)
  + = VCC_5V
  - = GND_PWR
Component: CERAMIC_100nF C6 (0805)
  + = VCC_5V
  - = GND_PWR

; ---- 12V 主线去耦 + 断电保护大电容 ----
Component: ELECTROLYTIC_470uF C7 (25V, 8mm径向) ; 断电保护缓冲电容
  + = VCC_12V
  - = GND_PWR
Component: ELECTROLYTIC_100uF C8 (25V, 5mm径向)
  + = VCC_12V
  - = GND_PWR
Component: CERAMIC_100nF C9 (0805)
  + = VCC_12V
  - = GND_PWR

; ---- ESP32-S3-N16R8 核心 U2 ----
; 模组: ESP32-S3-WROOM-1-N16R8
; 天线: 板载PCB天线 → 天线区域禁布 ≥15mm×15mm (天线端)

Component: ESP32-S3-WROOM-1 U2
  ; 电源引脚
  VDD3P3      = VCC_3V3
  VDD3P3_RTC  = VCC_3V3
  VDD3P3_CPU  = VCC_3V3
  GND[1..8]   = GND_PWR
  EN          = ESP_EN_NET    ; 复位网络
  IO0         = ESP_IO0_NET   ; Boot模式控制

  ; USB-OTG (Type-C直连，无转串口芯片)
  USB_D_MINUS = USBC_DM       ; GPIO19
  USB_D_PLUS  = USBC_DP       ; GPIO20

  ; ADC1 通道 — 电源电压监控
  GPIO1  = ADC_3V3_MON        ; ADC1_CH0: 3.3V监控
  GPIO2  = ADC_5V_MON         ; ADC1_CH1: 5V监控
  GPIO3  = ADC_12V_MON        ; ADC1_CH2: 12V监控 (Strapping pin, 分压≈2.0V @12V)

  ; 风扇PWM输出 → 74AHCT125 (电平转换后5V)
  GPIO4  = FAN1_PWM_3V3
  GPIO5  = FAN2_PWM_3V3
  GPIO6  = FAN3_PWM_3V3
  GPIO7  = FAN4_PWM_3V3

  ; 风扇Tach输入 ← 分压后3.0V
  GPIO8  = FAN1_TACH_IN
  GPIO9  = FAN2_TACH_IN
  GPIO10 = FAN3_TACH_IN
  GPIO11 = FAN4_TACH_IN

  ; DS18B20 1-Wire 总线
  GPIO16 = ONEWIRE_BUS

  ; BME280 I2C 接口
  GPIO17 = I2C_SDA
  GPIO18 = I2C_SCL

  ; WS2812B RGB LED (RMT输出)
  GPIO48 = LED_DIN

  ; 按键
  GPIO38 = BTN_WIFI_CFG       ; WiFi配网按键

; ESP32-S3 去耦电容 (每个VDD引脚旁100nF)
Component: CERAMIC_100nF C10 (0402)  ; VDD3P3 去耦1
  + = VCC_3V3
  - = GND_PWR
Component: CERAMIC_100nF C11 (0402)  ; VDD3P3_RTC 去耦
  + = VCC_3V3
  - = GND_PWR
Component: CERAMIC_100nF C12 (0402)  ; VDD3P3_CPU 去耦
  + = VCC_3V3
  - = GND_PWR
Component: CERAMIC_10uF C13 (0805)   ; 大容量并联去耦
  + = VCC_3V3
  - = GND_PWR

; ---- EN 复位电路 ----
Component: RESISTOR_10K R1 (0805)    ; EN上拉到3.3V
  1 = VCC_3V3
  2 = ESP_EN_NET
Component: CERAMIC_100nF C14 (0805)  ; EN延时电容 (上电稳定)
  + = ESP_EN_NET
  - = GND_PWR
Component: TACTILE_SW SW1            ; 复位按键 (EN→GND)
  1 = ESP_EN_NET
  2 = GND_PWR

; ---- IO0 Boot 模式控制 ----
Component: RESISTOR_10K R2 (0805)    ; IO0上拉 (正常启动)
  1 = VCC_3V3
  2 = ESP_IO0_NET
Component: TACTILE_SW SW2            ; IO0按键 (烧录模式)
  1 = ESP_IO0_NET
  2 = GND_PWR

; ---- Type-C USB 连接器 J2 ----
Component: USB_TYPE_C J2
  VBUS = USBC_VBUS              ; 不连接到系统电源(仅数据)
  CC1  = USBC_CC1
  CC2  = USBC_CC2
  D_MINUS = USBC_DM
  D_PLUS  = USBC_DP
  GND[1..4] = GND_PWR

; CC 下拉电阻 (UFP设备识别: 5V/0.9A)
Component: RESISTOR_5K1 R3 (0805)    ; CC1下拉 — UFP设备识别
  1 = USBC_CC1
  2 = GND_PWR
Component: RESISTOR_5K1 R4 (0805)    ; CC2下拉 — UFP设备识别
  1 = USBC_CC2
  2 = GND_PWR

; VBUS检测分压 → ADC监测Type-C供电状态
Component: RESISTOR_100K R5 (0805)
  1 = USBC_VBUS
  2 = VBUS_DIV_MID
Component: RESISTOR_10K R6 (0805)
  1 = VBUS_DIV_MID
  2 = GND_PWR
; VBUS_DIV_MID → GPIO (可选，接到某个ADC1通道监测USB供电)

; ---- 电源电压监控分压网络 ----
; ⚠️ 关键修正: 12V使用100kΩ+20kΩ分压，确保ADC输入≤2.0V
; ESP32-S3 ADC1推荐上限2.4V，绝对上限3.1V

; 12V监控: 100kΩ+20kΩ → Vout=2.0V @12V, 2.2V @13.2V(最坏) ✓
Component: RESISTOR_100K R7 (0805, 1%)
  1 = VCC_12V
  2 = ADC_12V_MON
Component: RESISTOR_20K R8 (0805, 1%)
  1 = ADC_12V_MON
  2 = GND_PWR
Component: CERAMIC_100nF C15 (0805)   ; ADC采样滤波
  + = ADC_12V_MON
  - = GND_PWR

; 5V监控: 10kΩ+10kΩ → Vout=2.5V @5V ✓
Component: RESISTOR_10K R9 (0805, 1%)
  1 = VCC_5V
  2 = ADC_5V_MON
Component: RESISTOR_10K R10 (0805, 1%)
  1 = ADC_5V_MON
  2 = GND_PWR
Component: CERAMIC_100nF C16 (0805)   ; ADC采样滤波
  + = ADC_5V_MON
  - = GND_PWR

; 3.3V监控: 10kΩ+10kΩ → Vout=1.65V @3.3V ✓
Component: RESISTOR_10K R11 (0805, 1%)
  1 = VCC_3V3
  2 = ADC_3V3_MON
Component: RESISTOR_10K R12 (0805, 1%)
  1 = ADC_3V3_MON
  2 = GND_PWR
Component: CERAMIC_100nF C17 (0805)   ; ADC采样滤波
  + = ADC_3V3_MON
  - = GND_PWR
