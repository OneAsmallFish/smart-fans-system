; ============================================================
; protection.sch — 保护 + 监控电路原理图
; 电源保险丝 + ESD保护 + 断电检测 + 散热标注
; ============================================================

; ---- 电源输入保护 ----

; 12V 自恢复保险丝 (PTC)
; 额定2A, 保护风扇电路: 4路×0.5A=2A峰值
Component: PTC_FUSE F1 (MF-MSMF250-2, 2A hold, 4A trip)
  IN  = VCC_12V_RAW     ; 来自SATA 12V
  OUT = VCC_12V         ; 到风扇驱动电路

; 12V 反向保护肖特基二极管
Component: SCHOTTKY_DIODE D1 (SS34, 3A, 40V, SMA)
  Anode   = VCC_12V_RAW
  Cathode = VCC_12V
; 注: 正常使用SATA电源不存在反接风险，但防止接错时损坏电路

; 5V 自恢复保险丝 (PTC)
; 额定1A, 保护AMS1117 LDO: 输入最大1A
Component: PTC_FUSE F2 (MF-MSMF100-2, 1A hold, 2A trip)
  IN  = VCC_5V_RAW      ; 来自SATA 5V
  OUT = VCC_5V          ; 到LDO + WS2812B + 74AHCT125

; 5V 反向保护
Component: SCHOTTKY_DIODE D2 (SS12, 1A, 20V, SMA)
  Anode   = VCC_5V_RAW
  Cathode = VCC_5V

; ---- ESD 保护 ----

; Type-C USB D+/D- ESD保护阵列
; SRV05-4: 4通道TVS二极管阵列，专为USB设计，Vbr=5V
Component: TVS_ARRAY_SRV05-4 D3
  VCC  = USBC_VBUS
  GND  = GND_PWR
  IO1  = USBC_DM        ; D- 保护
  IO2  = USBC_DP        ; D+ 保护
  IO3  = NC
  IO4  = NC

; 风扇Tach输入 ESD保护 (GPIO过压保护)
; 单向TVS, Vbr=5.1V, 保护ESP32 GPIO (Vmax=3.6V绝对极限)
Component: TVS_UNIDIRECTIONAL D4 (SOD-323, Vbr=5.1V)  ; Fan1 Tach
  Anode   = GND_PWR
  Cathode = FAN1_TACH_RAW
Component: TVS_UNIDIRECTIONAL D5 (SOD-323, Vbr=5.1V)  ; Fan2 Tach
  Anode   = GND_PWR
  Cathode = FAN2_TACH_RAW
Component: TVS_UNIDIRECTIONAL D6 (SOD-323, Vbr=5.1V)  ; Fan3 Tach
  Anode   = GND_PWR
  Cathode = FAN3_TACH_RAW
Component: TVS_UNIDIRECTIONAL D7 (SOD-323, Vbr=5.1V)  ; Fan4 Tach
  Anode   = GND_PWR
  Cathode = FAN4_TACH_RAW

; DS18B20 DQ线 ESD保护
Component: TVS_UNIDIRECTIONAL D8 (SOD-323, Vbr=3.6V)
  Anode   = GND_PWR
  Cathode = ONEWIRE_BUS

; ---- 断电检测电路 ----
; 12V下降时触发ESP32中断，及时保存状态到NVS
; 分压: 12V → 100kΩ+20kΩ → ADC1_CH2 (GPIO3) ≈2.0V @12V (与power.sch共用R7/R8)
; 注: 断电检测使用ADC轮询，12V持续低于10V触发断电处理
; 断电时GPIO驱动12V风扇MOSFET关断，减少保护电容放电负载

; 断电保护大电容 (与power.sch C7 对应，12V轨)
; BULK电容: 470μF-1000μF, 25V耐压, 维持系统约100ms(供保存NVS状态)
; 注: power.sch C7=470uF已定义，此处标注其断电保护功能
; Component: ELECTROLYTIC_1000uF C_BULK (25V) — 可选升级为1000uF
;   + = VCC_12V
;   - = GND_PWR
; 注释: BULK电容=C7 (power.sch), 断电检测分压=R7+R8 (power.sch)

; ---- 可选: ADS1115 高精度ADC (预留焊盘) ----
; 16-bit I2C ADC，用于高精度电压测量
; 焊盘预留，默认不焊接，共用I2C总线(GPIO17/18)
; Component: ADS1115 U5 [OPT]
;   VDD  = VCC_3V3
;   GND  = GND_PWR
;   SCL  = I2C_SCL
;   SDA  = I2C_SDA
;   ADDR = GND_PWR  ; I2C地址=0x48
;   A0   = ADC_12V_MON   ; 12V高精度监测
;   A1   = ADC_5V_MON    ; 5V高精度监测
;   A2   = NC
;   A3   = NC

; ---- 散热设计注释 ----
; AMS1117-3.3 (U1, SOT-223封装):
;   峰值功耗: (5V-3.3V)×0.4A = 0.68W
;   SOT-223 θJA = 72°C/W (有铜皮时降至~50°C/W)
;   推荐: 2cm²覆铜散热焊盘，顶层覆铜连接至U1散热引脚
;   结温估算: 25°C + 50°C/W × 0.68W = 59°C (安全裕量充足)
; 74AHCT125 (U3, TSSOP-14):
;   开关功耗微小 (<0.1W)，无需额外散热
; 风扇12V: 4路×0.5A = 2A，12V走线宽度≥2.0mm (1oz铜)
;   发热估算: I²×R×L = 2²×0.5Ω/m×0.1m = 0.2W/段，可接受

; ---- ADC滤波电容 (与power.sch分压点对应) ----
; 已在 power.sch 中定义 C15/C16/C17 (各100nF)
; 本文件标注断电检测专用滤波
Component: CERAMIC_100nF C25 (0805)   ; 12V断电检测ADC滤波 (与C15并联或合并)
  + = ADC_12V_MON
  - = GND_PWR
