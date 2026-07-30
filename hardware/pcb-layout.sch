; ============================================================
; pcb-layout-spec.md → hardware/pcb-layout.sch
; PCB布局约束 + 布线规则 + Gerber导出规格
; 目标EDA工具: KiCad 8.0 / EasyEDA Pro
; 板尺寸目标: 80mm × 60mm (双层, FR4, 1.6mm, 1oz铜)
; 嘉立创可打样 (无面积限制)
; ============================================================

; ============================================================
; 天线约束 (ANTENNA_KEEPOUT)
; ESP32-S3-WROOM-1模块天线端 (模块短边方向)
; ============================================================

Rule: ANTENNA_KEEPOUT
  Description: ESP32-S3板载PCB天线禁布区域
  Zone: 15mm × 15mm (模块天线端向外延伸)
  Constraints:
    - 禁止走线 (Trace=NO)
    - 禁止覆铜 (Pour=NO)
    - 禁止元件放置 (Component=NO)
    - 与PCB边缘距离 ≥5mm (防止金属外壳遮挡)
  KiCad_Zone_Type: rule_area
  Note: ESP32-S3-WROOM-1天线在模块短边(38mm端)

; ============================================================
; 元件布局原则
; ============================================================

Rule: COMPONENT_PLACEMENT
  Description: 元件布局分区

  PowerZone:    ; 电源区域 (靠近SATA连接器)
    - J1 (SATA 15Pin): 板边缘 (左侧或底边)
    - U1 (AMS1117-3.3): J1附近，顶层，铜皮散热 ≥2cm²
    - C1,C3 (电解电容): U1两侧 1cm内
    - F1,F2 (PTC保险丝): J1出来后第一个元件

  FanZone:      ; 风扇接口区域
    - J3-J6 (4Pin风扇座): 板边缘分布 (便于理线)
    - U3 (74AHCT125): J3-J6附近，12V走线距离最短
    - C19-C22 (100uF去耦): 每个风扇座旁3mm内

  MCUZone:      ; ESP32核心区域 (板中央)
    - U2 (ESP32-S3-WROOM-1): 中央，天线端朝向板边空旷侧
    - J2 (Type-C): 板边缘，USB口朝外
    - SW1,SW2 (Reset/Boot按键): U2附近，可触及
    - SW3 (WiFi配网键): 板边缘，外露

  SensorZone:   ; 传感器区域 (远离热源和电源轨)
    - U4 (BME280): 远离12V/5V走线和风扇MOSFET
    - J7,J8 (DS18B20接口): 板边缘，探头引出方便
    - LED1 (WS2812B): 板边缘，可见位置
    - R25,R26,R27 (I2C/1Wire上拉): 靠近U4/J7

  ProtectionZone: ; 保护电路
    - D1,D2 (肖特基二极管): J1附近，与F1/F2紧邻
    - D3 (SRV05-4 TVS): J2旁，D+/D-走线最短
    - D4-D8 (TVS管): 分别靠近对应信号入口

; ============================================================
; 布线规则
; ============================================================

Rule: ROUTING
  Description: 导线宽度和间距规则

  NetClass: POWER_12V
    Minimum_Width: 2.0mm          ; 4路风扇 2A峰值
    Clearance: 0.5mm
    Via_Drill: 0.6mm, Via_Size: 1.2mm
    Affected_Nets: [VCC_12V, GND_PWR_12V]

  NetClass: POWER_5V
    Minimum_Width: 1.0mm          ; 最大1A
    Clearance: 0.3mm
    Affected_Nets: [VCC_5V]

  NetClass: POWER_3V3
    Minimum_Width: 0.8mm          ; 最大400mA
    Clearance: 0.3mm
    Affected_Nets: [VCC_3V3]

  NetClass: SIGNAL_DIGITAL
    Minimum_Width: 0.25mm         ; 标准数字信号
    Clearance: 0.2mm
    Affected_Nets: [FAN*_PWM*, FAN*_TACH*, LED_DIN, BTN_*, ONEWIRE_BUS]

  NetClass: SIGNAL_I2C
    Minimum_Width: 0.25mm
    Max_Length: 50mm              ; I2C短走线减少电容
    Route_Away_From: 12V走线, 风扇电源
    Affected_Nets: [I2C_SDA, I2C_SCL]

  NetClass: SIGNAL_USB_DIFF
    Minimum_Width: 0.25mm
    Length_Match: ≤0.1mm          ; D+/D-等长差分
    Impedance: 90Ω differential
    Affected_Nets: [USBC_DP, USBC_DM]

  NetClass: SIGNAL_ADC
    Minimum_Width: 0.25mm
    Route_Away_From: 开关噪声源, PWM走线
    Guard_Ring: 可选 (ADC精度要求高时)
    Affected_Nets: [ADC_12V_MON, ADC_5V_MON, ADC_3V3_MON]

; ============================================================
; 覆铜规则
; ============================================================

Rule: COPPER_POUR
  Bottom_Layer:
    - 完整GND覆铜 (全板)
    - 连接所有GND焊盘
    - Thermal_Relief: 4条辐射线 (Spoke_Width=0.5mm)

  Top_Layer:
    - AMS1117-3.3散热焊盘: 2cm² 覆铜 (连接至底层GND via矩阵)
    - 局部GND覆铜 (功率区域, 传感器区域)
    - 天线区域: 禁止覆铜 (见ANTENNA_KEEPOUT)

  Stitching_Vias: 间距5mm, 钻孔0.4mm, 尺寸0.8mm (连接顶底GND)

; ============================================================
; 丝印标注
; ============================================================

Rule: SILKSCREEN
  Required_Labels:
    - J1: "SATA PWR IN", Pin1/15位置标注
    - J2: "USB-C"
    - J3-J6: "FAN1-FAN4", Pin1=GND位置标注 (三角形或方焊盘)
    - J7,J8: "DS18B20-1/2", Pin定义: VCC/DQ/GND
    - SW1: "RST", SW2: "BOOT", SW3: "WIFI CFG"
    - U2: 天线方向箭头 (指向禁布区)
    - LED1: 极性标注
  Version_String: "Smart Fan Ctrl v1.0" (底边丝印)
  GPIO_Labels: 关键测试点标注GPIO编号

; ============================================================
; 制造规格 (嘉立创兼容)
; ============================================================

Rule: MANUFACTURING
  PCB_Size: 80mm × 60mm (目标, 可调整)
  Layers: 2 (双层)
  Copper_Thickness: 1oz (35μm)
  Board_Thickness: 1.6mm
  Min_Track_Width: 0.1mm (嘉立创标准: 0.127mm推荐)
  Min_Clearance: 0.1mm (嘉立创标准: 0.127mm推荐)
  Min_Drill: 0.2mm (嘉立创标准: 0.3mm推荐)
  Min_Annular_Ring: 0.13mm
  Surface_Finish: HASL (无铅) 或 ENIG (HASL更省钱)
  Solder_Mask: 两面绿色
  Silkscreen: 两面白色

; ============================================================
; Gerber导出规格
; ============================================================

Rule: GERBER_EXPORT
  Files_Required:
    - SmartFan_F_Cu.gbr         ; 顶铜 (Top Copper)
    - SmartFan_B_Cu.gbr         ; 底铜 (Bottom Copper)
    - SmartFan_F_Mask.gbr       ; 顶阻焊 (Top Solder Mask)
    - SmartFan_B_Mask.gbr       ; 底阻焊 (Bottom Solder Mask)
    - SmartFan_F_Silkscreen.gbr ; 顶丝印 (Top Silkscreen)
    - SmartFan_B_Silkscreen.gbr ; 底丝印 (Bottom Silkscreen)
    - SmartFan_Edge_Cuts.gbr    ; 板框 (Board Outline)
    - SmartFan_NPTH.drl         ; 非金属化孔 (机械孔)
    - SmartFan_PTH.drl          ; 金属化孔 (过孔+焊盘孔)
  Format: Gerber X2 (RS-274X兼容)
  Coordinate_Origin: PCB左下角

  BOM_Files:
    - SmartFan_BOM.csv          ; 含位号/物料/封装/数量/LCSC编号
    - SmartFan_Positions.csv    ; 贴片坐标文件 (Pick-and-Place)

; ============================================================
; DRC检查要求
; ============================================================

Rule: DRC_REQUIREMENTS
  Pass_Criteria:
    - 0 Errors (短路/间距违规/断线)
    - Warnings允许: 天线区域审查 (手动确认)
    - 12V走线宽度 ≥2.0mm (DRC自定义规则)
    - 无未连接网络 (Unconnected = 0)
