; ============================================================
; fan-driver.sch — 风扇驱动电路原理图
; 4路 4Pin PWM风扇 (25kHz, Intel规范)
; GPIO分配: PWM=GPIO4-7(LEDC), Tach=GPIO8-11(PCNT)
; ============================================================

; ---- PWM电平转换: ESP32-S3 3.3V → 74AHCT125 → 5V风扇PWM ----
; 74AHCT125: VCC=5V, VIH=2.0V → ESP32输出3.3V≥2.0V ✓
; 输出VOH≈4.7V @5V VCC，满足Intel风扇PWM规范 ✓
; 封装: SOIC-14 或 TSSOP-14

Component: 74AHCT125 U3
  VCC = VCC_5V
  GND = GND_PWR
  ; 通道1: Fan1 PWM
  A1   = FAN1_PWM_3V3    ; 输入(来自ESP32 GPIO4, 3.3V逻辑)
  Y1   = FAN1_PWM_5V     ; 输出(5V逻辑，接风扇PWM引脚)
  OE1  = GND_PWR         ; 使能低有效，常导通
  ; 通道2: Fan2 PWM
  A2   = FAN2_PWM_3V3    ; GPIO5
  Y2   = FAN2_PWM_5V
  OE2  = GND_PWR
  ; 通道3: Fan3 PWM
  A3   = FAN3_PWM_3V3    ; GPIO6
  Y3   = FAN3_PWM_5V
  OE3  = GND_PWR
  ; 通道4: Fan4 PWM
  A4   = FAN4_PWM_3V3    ; GPIO7
  Y4   = FAN4_PWM_5V
  OE4  = GND_PWR

; 74AHCT125 去耦
Component: CERAMIC_100nF C18 (0402)
  + = VCC_5V
  - = GND_PWR

; ---- Tach转速反馈: 风扇开漏 → 5V上拉 → 分压 → ESP32 ----
; Intel规范: Tach上拉必须到5V (不能3.3V)
; 分压: 5V × 3.3kΩ/(2.2kΩ+3.3kΩ) = 3.0V → ESP32 GPIO (VIH=2.48V ✓, Vmax=3.6V ✓)

; Fan1 Tach
Component: RESISTOR_10K R13 (0805)      ; Tach上拉到5V (Intel规范: 5V上拉)
  1 = VCC_5V
  2 = FAN1_TACH_RAW
Component: RESISTOR_2K2 R14 (0805)      ; 分压上半段
  1 = FAN1_TACH_RAW
  2 = FAN1_TACH_IN                       ; → GPIO8 (ESP32, 3.0V)
Component: RESISTOR_3K3 R15 (0805)      ; 分压下半段
  1 = FAN1_TACH_IN
  2 = GND_PWR

; Fan2 Tach
Component: RESISTOR_10K R16 (0805)      ; Tach上拉到5V
  1 = VCC_5V
  2 = FAN2_TACH_RAW
Component: RESISTOR_2K2 R17 (0805)
  1 = FAN2_TACH_RAW
  2 = FAN2_TACH_IN                       ; → GPIO9
Component: RESISTOR_3K3 R18 (0805)
  1 = FAN2_TACH_IN
  2 = GND_PWR

; Fan3 Tach
Component: RESISTOR_10K R19 (0805)      ; Tach上拉到5V
  1 = VCC_5V
  2 = FAN3_TACH_RAW
Component: RESISTOR_2K2 R20 (0805)
  1 = FAN3_TACH_RAW
  2 = FAN3_TACH_IN                       ; → GPIO10
Component: RESISTOR_3K3 R21 (0805)
  1 = FAN3_TACH_IN
  2 = GND_PWR

; Fan4 Tach
Component: RESISTOR_10K R22 (0805)      ; Tach上拉到5V
  1 = VCC_5V
  2 = FAN4_TACH_RAW
Component: RESISTOR_2K2 R23 (0805)
  1 = FAN4_TACH_RAW
  2 = FAN4_TACH_IN                       ; → GPIO11
Component: RESISTOR_3K3 R24 (0805)
  1 = FAN4_TACH_IN
  2 = GND_PWR

; ---- 4路 4Pin 风扇接座 ----
; 4Pin定义 (Intel PWM Fan Spec Rev1.3):
;   Pin1 = GND   Pin2 = 12V   Pin3 = TACH(开漏)   Pin4 = PWM(5V逻辑)

Component: FAN_CONNECTOR_4PIN J3  ; Fan 1
  Pin1 = GND_PWR                  ; GND
  Pin2 = VCC_12V                  ; 12V供电
  Pin3 = FAN1_TACH_RAW            ; Tach (开漏输出)
  Pin4 = FAN1_PWM_5V              ; PWM (5V逻辑输入)
; 12V去耦
Component: ELECTROLYTIC_100uF C19 (25V, 5mm)
  + = VCC_12V
  - = GND_PWR

Component: FAN_CONNECTOR_4PIN J4  ; Fan 2
  Pin1 = GND_PWR
  Pin2 = VCC_12V
  Pin3 = FAN2_TACH_RAW
  Pin4 = FAN2_PWM_5V
Component: ELECTROLYTIC_100uF C20 (25V)
  + = VCC_12V
  - = GND_PWR

Component: FAN_CONNECTOR_4PIN J5  ; Fan 3
  Pin1 = GND_PWR
  Pin2 = VCC_12V
  Pin3 = FAN3_TACH_RAW
  Pin4 = FAN3_PWM_5V
Component: ELECTROLYTIC_100uF C21 (25V)
  + = VCC_12V
  - = GND_PWR

Component: FAN_CONNECTOR_4PIN J6  ; Fan 4
  Pin1 = GND_PWR
  Pin2 = VCC_12V
  Pin3 = FAN4_TACH_RAW
  Pin4 = FAN4_PWM_5V
Component: ELECTROLYTIC_100uF C22 (25V)
  + = VCC_12V
  - = GND_PWR

; ---- GPIO分配注释 ----
; LEDC_CH0 = GPIO4  → FAN1_PWM_3V3 → 74AHCT125_A1 → FAN1_PWM_5V → J3.Pin4
; LEDC_CH1 = GPIO5  → FAN2_PWM_3V3 → 74AHCT125_A2 → FAN2_PWM_5V → J4.Pin4
; LEDC_CH2 = GPIO6  → FAN3_PWM_3V3 → 74AHCT125_A3 → FAN3_PWM_5V → J5.Pin4
; LEDC_CH3 = GPIO7  → FAN4_PWM_3V3 → 74AHCT125_A4 → FAN4_PWM_5V → J6.Pin4
; PCNT_UNIT0 = GPIO8  ← R15(3.3kΩ下拉) ← R14(2.2kΩ串) ← FAN1_TACH_RAW ← J3.Pin3
; PCNT_UNIT1 = GPIO9  ← ... FAN2
; PCNT_UNIT2 = GPIO10 ← ... FAN3
; PCNT_UNIT3 = GPIO11 ← ... FAN4
