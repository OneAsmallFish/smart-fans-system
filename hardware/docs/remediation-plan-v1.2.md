# 硬件整改清单 v1.2（Remediation Plan）

> 本文档是给整改执行 agent 的**唯一权威依据**（硬件部分）。执行时以本文档的引脚表和决策为准，
> 与旧文档（v1.1 指南、旧 BOM、组装指南）冲突时一律以本文档为准。
> 审查背景见 2026-08-23 的硬件审查结论（占位原理图/PCB、引脚冲突、ADC 引脚错误、扩展板供电矛盾等）。
> **v1.2.1（2026-08-24）**：吸收 `docs/module-review-report.md`（75 条发现）中与硬件相关的增量——
> H-03 扩展（分压比/console 路由/五处硬编码）、H-06/H-07 勘误（README 现状为 4 路而非 6 路；
> `hardware/BOM.csv` 实际存在）、新增 H-17（PWM 下拉）。
> 固件非引脚类问题与 agent/web/ha/test 的整改由 **`docs/module-remediation-plan-v1.2.md`** 承接。

---

## 0. 已确认的设计决策（不得偏离）

| # | 决策 | 说明 |
|---|------|------|
| D1 | **扩展板独立 SATA 供电** | 扩展板为用户自购成品板，自带 SATA 供电，接主控任意一路 4Pin 风扇座即原生可用。主控板**不做任何**为其供电的电路（删除 PH2.0 12V 供电、EXT_PWM、GPIO13 扩展板专用信号等所有相关设计）。固件也**不需要**为该路做特殊逻辑——它就是一个普通风扇通道。建议默认接 Fan6（J8）。 |
| D2 | **主控板风扇路数 = 8 路** | 依据：ESP32-S3 的 LEDC 恰好 8 通道、PCNT 恰好 4 单元×2 通道=8、2 片 74AHCT125 恰好 8 个缓冲通道，三个资源同时用满；超过 8 路需外加芯片，超出单板定位。总风扇数 = 7 独立 + 12 统一 = 19。 |
| D3 | **板卡规格：≤99×99mm，4 层板** | 嘉立创免费打样已确认（2026-08 核实）：2 层和 4 层板均免费，尺寸 ≤100×100mm，每次 5 片，每月 2 张免费券；需保持标准工艺（板厚 1.6mm、外层 1oz）。板框取 99×99mm 留公差余量。叠层：L1 信号+元件 / L2 完整 GND / L3 电源（12V 铺铜 + 5V/3.3V）/ L4 信号。 |
| D4 | **USB VBUS 与 SATA 5V 二极管或** | VBUS 经肖特基 D3（B5819W）接入 +5V 轨，与 SATA 5V 支路 D2 构成二极管或，杜绝倒灌。USB 单独供电时板卡可工作（调试场景），SATA 供电时 USB 仅作数据。 |
| D5 | **UART0（GPIO43/44）让渡给屏幕 SPI** | 控制台与烧录一律走 USB-CDC（GPIO19/20 原生 USB，S3 支持 ROM 下载模式），不设 UART 调试串口。 |
| D6 | **嘉立创 EDA 为唯一硬件真源；旧 KiCad 工程归档 legacy/** | v1.2 原理图/PCB 由用户在嘉立创 EDA（专业版）绘制，可编辑工程存 `hardware/lceda/`，导出物（原理图 PDF、BOM、Gerber、钻孔、ERC/DRC 证据）归档 `hardware/`。旧 KiCad 工程（占位 kicad_*、文本 .sch、旧 gerber）已于 2026-08-26 整体移入 `hardware/legacy/` 仅供参考，不再维护；**不参与任何 grep 验收**（命令统一加 `--exclude-dir=legacy`）；legacy 内 `.bak`/`.v?backup` 保持 git 不跟踪。 |

**禁用引脚背景（必须写进原理图注释）：**
- GPIO26~32：模组内 SPI Flash 占用，WROOM-1 未引出。
- GPIO35~37：N16R8 为八线 PSRAM 版本，GPIO35/36/37 被模组内 PSRAM 占用，**不可用**（现有原理图符号里画了这三个引脚，需标注 NC）。GPIO33/34 模组未引出。
- Strapping 引脚（GPIO0/3/45/46）：复位瞬间电平影响启动，除本表指定用法外禁止外接负载。

---

## 1. v1.2 GPIO 分配总表（唯一权威，全项目以此为准）

| GPIO | 网络名 | 方向 | 外设资源 | 备注 |
|:----:|--------|:----:|----------|------|
| EN | RESET | IN | — | 10kΩ 上拉 + 100nF 去抖 + SW1 接地 |
| GPIO0 | BOOT | IN | strapping | 10kΩ 上拉 + SW2 接地 |
| GPIO1 | ADC_12V | IN | ADC1_CH0 | 100k/20k 分压（÷6） |
| GPIO2 | ADC_5V | IN | ADC1_CH1 | 47k/10k 分压（÷5.7） |
| GPIO3 | **NC** | — | strapping | JTAG 源选择，禁止外接任何负载 |
| GPIO4 | ADC_3V3 | IN | ADC1_CH3 | 47k/10k 分压（÷5.7） |
| GPIO5 | FAN1_PWM | OUT | LEDC_CH0 | → 74AHCT125 #1 |
| GPIO6 | FAN2_PWM | OUT | LEDC_CH1 | → 74AHCT125 #1 |
| GPIO7 | FAN3_PWM | OUT | LEDC_CH2 | → 74AHCT125 #1 |
| GPIO8 | FAN4_PWM | OUT | LEDC_CH3 | → 74AHCT125 #1 |
| GPIO9 | FAN5_PWM | OUT | LEDC_CH4 | → 74AHCT125 #2 |
| GPIO10 | FAN6_PWM | OUT | LEDC_CH5 | → 74AHCT125 #2，**建议接扩展板** |
| GPIO11 | FAN7_PWM | OUT | LEDC_CH6 | → 74AHCT125 #2 |
| GPIO12 | FAN8_PWM | OUT | LEDC_CH7 | → 74AHCT125 #2 |
| GPIO13 | FAN1_TACH | IN | PCNT_U0_CH0 | 分压输入（见 §2 Tach 网络） |
| GPIO14 | FAN2_TACH | IN | PCNT_U0_CH1 | |
| GPIO15 | FAN3_TACH | IN | PCNT_U1_CH0 | |
| GPIO16 | DS18B20_DQ | I/O | OneWire | 4.7kΩ 上拉，J11/J12 两探头共用 |
| GPIO17 | I2C_SDA | I/O | I2C0_SDA | 4.7kΩ 上拉，BME280 + 屏幕 |
| GPIO18 | I2C_SCL | OUT | I2C0_SCL | 4.7kΩ 上拉 |
| GPIO19 | USB_D- | I/O | USB-Serial-JTAG | 原生 USB |
| GPIO20 | USB_D+ | I/O | USB-Serial-JTAG | 原生 USB |
| GPIO21 | FAN4_TACH | IN | PCNT_U1_CH1 | |
| GPIO38 | FAN5_TACH | IN | PCNT_U2_CH0 | |
| GPIO39 | FAN6_TACH | IN | PCNT_U2_CH1 | MTCK，正常 GPIO 使用 |
| GPIO40 | FAN7_TACH | IN | PCNT_U3_CH0 | |
| GPIO41 | FAN8_TACH | IN | PCNT_U3_CH1 | |
| GPIO42 | SPI_SCK | OUT | GPIO 矩阵 | 屏幕预留（J13 Pin3） |
| GPIO43 | SPI_MOSI | OUT | GPIO 矩阵 | 屏幕预留（原 UART0_TX，J13 Pin4） |
| GPIO44 | SPI_CS | OUT | GPIO 矩阵 | 屏幕预留（原 UART0_RX，J13 Pin5），**10kΩ 上拉到 3.3V**（防上电阶段 UART0 启动日志串入屏幕） |
| GPIO45 | WS2812B_DI | OUT | RMT | strapping(VDD_SPI 电压)：WS2812 DIN 为高阻输入，复位期内部下拉保持 VDD_SPI=3.3V，安全 |
| GPIO46 | **NC** | — | strapping | boot 模式选择，禁止外接任何负载 |
| GPIO47 | BTN_WIFI_CFG | IN | GPIO 输入 | 10kΩ 上拉 + SW3 接地 |
| GPIO48 | SPI_DC | OUT | GPIO 矩阵 | 屏幕预留（J13 Pin6） |

风扇索引约定：文档写 Fan1~Fan8，固件/协议用 index 0~7（Fan1=index 0）。

**接口位号 v1.2：** J1 SATA、J2 USB-C、J3~J10 八路风扇座、J11/J12 DS18B20 端子（XH2.54-3P）、J13 屏幕排针（2.54-8P）。不再有"扩展板专用接口"。

---

## 2. 电源架构 v1.2

```
SATA 12V (Pin13-15) → F1 [PTC, hold ≥3A] → D1 [SS34] → +12V 轨
    +12V 轨 → J3~J10 Pin2（8 路风扇，每路 100nF 去耦）
    +12V 轨 → 100k/20k 分压 → GPIO1

SATA 5V (Pin7-9) → F2 [PTC 1A] → D2 [B5819W] ──┐
USB-C VBUS       → D3 [B5819W] ────────────────┴→ +5V 轨
    +5V 轨 → AMS1117-3.3 → +3V3（10µF+100nF 输出，≥8×100nF ESP32 去耦）
    +5V 轨 → 74AHCT125 #1/#2 VCC（各 100nF 去耦）
    +5V 轨 → 8 路 Tach 上拉（10kΩ×8）
    +3V3 → ESP32 / BME280 / WS2812B / DS18B20 / 全部上拉与分压下臂
```

要点：
- F1 必须 hold ≥3A（8 风扇 ≈2.4~2.8A 稳态 + 启动浪涌；原 MF-MSMF250 的 2.5A hold 会误跳）。选型在 MF-SM 系列（1812/2920）或嘉立创基础库等效 ≥3A hold PTC。
- 12V 载流按 IPC-2150：1oz 外层 2mm 走线仅约 4A（10℃ 温升），**删除旧文档"2.0mm=6A"的错误表述**。4 层板中 12V 在 L3 铺铜（≥5mm 宽或区块铺铜），过孔阵列换层。
- SATA Pin1-3（3.3V/PWDIS）不连接，维持原设计。
- USB VBUS 支路可加可选 1A PTC（位号预留 F3，NC 亦可）。

## 3. 关键电路规范（与 v1.1 的差异已标注）

**Tach 输入网络（每路 3 电阻 + 1 电容，共 8 组）：**
```
风扇 Pin3(Tach, 开漏) ──[10kΩ 上拉至 +5V]──┬──[10kΩ 串联]──┬──→ GPIO
                                            │                │
                                          (节点)          [10kΩ 下拉至 GND] + [1nF 至 GND]
高电平 = 5V × 10k/(10k+10k) = 2.5V > VIH 2.31V ✓
```
共需：10kΩ×24 只（8 路上拉/串联/下拉各 8）+ 1nF×8。旧文档"10k×12"数量不足，一并修正。

**74AHCT125（2 片，SOIC-14）：**
- #1：4 通道全用（GPIO5~8 → FAN1~4_PWM）；#2：4 通道全用（GPIO9~12 → FAN5~8_PWM）。
- 两片的 OE1~OE4（Pin1/4/10/13）**全部接 GND** 并在原理图明确画出。
- 无悬空输入（旧文档"Pin9~12 悬空或接地"作废，本方案 8 通道全用，不存在未用通道）。
- VCC=+5V，各配 100nF 去耦。
- **每路 A 输入线（GPIO5~12 的 PWM 网络）加 10kΩ 下拉到 GND，共 8 只（H-17）**：上电窗口期
  ESP32 引脚为高阻、OE 又恒使能，不加下拉则缓冲输出电平不定、风扇可能满转数百毫秒
  （模块审查 MA-19 的硬件侧对策；固件侧对策见模块整改清单 FW-14——app_main 最早配置 LEDC duty=0）。

**USB-C（J2）+ ESD：**
- CC1/CC2 各 5.1kΩ 下拉；A6/A7 与 B6/B7 并联；VBUS 经 D3 进 +5V 轨（见 §2）。
- USBLC6-2SC6 的 VCC 接 **+5V 轨**（旧文档接 3.3V 有误：该器件按 5V 供电设计，3.3V 供电时对 D± 的钳位行为不正确）。
- D± 差分 90Ω、等长误差 ≤5mm、紧邻 J2 放置。

**BME280 / DS18B20 / WS2812B：** 与 v1.1 相同（I2C 0x76、SDO→GND、CSB→3.3V；OneWire GPIO16；WS2812 DIN 串 33~100Ω 抑制振铃，电源 100nF 去耦）。

**屏幕接口 J13（2.54 排针 8P）：**
Pin1=3.3V, Pin2=GND, Pin3=SPI_SCK(GPIO42), Pin4=SPI_MOSI(GPIO43), Pin5=SPI_CS(GPIO44, 带 10k 上拉), Pin6=SPI_DC(GPIO48), Pin7=I2C_SDA(GPIO17), Pin8=I2C_SCL(GPIO18)。

**ADC 分压网络：**
| 网络 | 上臂 | 下臂 | 分压比 | 12V→2.0V / 5V→0.88V / 3.3V→0.58V |
|------|------|------|--------|------|
| ADC_12V | 100kΩ | 20kΩ | ÷6 | 全部 ≤2.0V，低于 ADC 安全区上限 |
| ADC_5V | 47kΩ | 10kΩ | ÷5.7 | 旧审查清单中"47k+18k"的矛盾表述删除 |
| ADC_3V3 | 47kΩ | 10kΩ | ÷5.7 | GPIO4（原 GPIO36 方案作废，GPIO36 不可用） |

---

## 4. 整改项清单

优先级：P0=阻断性（不做完不许进入下一项）；P1=设计缺陷；P2=改进建议。

### P0 项

**H-01 完整重绘原理图（嘉立创 EDA v1.2 工程，D6）**
- 动作：在嘉立创 EDA（专业版）新建 v1.2 工程（存 `hardware/lceda/`；旧 KiCad 占位工程已移入 `hardware/legacy/`，不得作为底稿），按本文档 §1~§3 绘制全部电路：电源（SATA/PTC/二极管或/LDO）、ESP32 最小系统（EN/BOOT 按键+上拉+去抖）、8 路 PWM、8 路 Tach 网络、BME280、DS18B20×2 端子、WS2812B、USB-C+USBLC6、屏幕排针 J13、3 路 ADC 分压、WiFi 按键、安装孔。
- 原理图符号修正：ESP32-S3 符号中 GPIO35/36/37 引脚标注 NC（N16R8 被 PSRAM 占用）；补全 GPIO26~32 缺失说明。
- 验收：ERC 0 错误 0 警告；每个网络连通完整；每片 IC 电源脚 100nF 去耦；所有元件有位号+数值+封装；导出的原理图 PDF 与可编辑工程归档；`grep -rni "placeholder" hardware/lceda/ hardware/*.pdf 2>/dev/null` 为空（legacy/ 不检查）。

**H-02 重绘 PCB（嘉立创 EDA v1.2 工程，D6）**
- 动作：板框 99×99mm；4 层叠层按 D3；按 v1.1 指南布局思路重排（SATA/USB-C 板边、ESP32 居中且**天线端出板边或天线区板外悬空**、15×15mm 天线禁布区用 EDA 的 keepout（禁布区）功能实现而非丝印文字、风扇座两行排列、L2 全 GND 平面）。
- 布线约束：12V 在 L3 铺铜；USB D± 差分 90Ω 等长 ≤5mm；AMS1117 散热焊盘 ≥4cm² GND 铺铜 + 2mm 间距过孔阵列；去耦电容距 IC 电源脚 <5mm。
- 工艺按嘉立创免费档：最小线宽/间距 0.127mm（设计目标 ≥0.2mm），过孔 0.3/0.6mm，1.6mm 板厚，1oz。
- 验收：DRC 0 错误；板框 ≤99×99mm；L2 无除过孔外的分割；4 个 M3 安装孔四角；keepout zone 存在于文件中。

**H-03 固件引脚同步（与 H-01 并行可做；v1.2.1 已按模块审查 MA-07/MA-21/MA-34 扩展）**

> 先决条件提示：模块审查判定固件当前存在 2 处编译错误（MA-01 `ESP_ERROR_CHECK(void)`、
> MA-02 main 组件 REQUIRES 缺失），由模块整改清单 Phase 0 的 FW-01/FW-02 修复。
> 本项的 grep 验收不依赖编译，但最终的 `idf.py build` 验收依赖两者都完成。

精确改动（含注释同步）：
```c
// firmware/components/fan_pwm/fan_pwm.h
#define FAN_PWM_COUNT 8            /* 原 4 */

// firmware/components/fan_pwm/fan_pwm.c
static const int FAN_GPIO[FAN_PWM_COUNT] = { 5, 6, 7, 8, 9, 10, 11, 12 };
/* 原 {4,5,6,7}；ESP32-S3 LEDC 共 8 通道，全部占用，共用 1 个 timer */

// firmware/components/fan_tach/fan_tach.h
#define FAN_TACH_COUNT 8           /* 原 4 */

// firmware/components/fan_tach/fan_tach.c
static const int TACH_GPIO[FAN_TACH_COUNT] = { 13, 14, 15, 21, 38, 39, 40, 41 };
/* 原 {8,9,10,11}；S3 仅 4 个 PCNT 单元×2 通道，unit = i/2, channel = i%2，
   需同步修改 PCNT 配置代码（原 4 路大概率 unit=i，会越界） */

// firmware/components/power_monitor/power_monitor.c
#define CH_12V  ADC_CHANNEL_0   /* GPIO1，原 CH_12V=CH2(GPIO3) */
#define CH_5V   ADC_CHANNEL_1   /* GPIO2 */
#define CH_3V3  ADC_CHANNEL_3   /* GPIO4，原 CH_3V3=CH0(GPIO1)；ADC1_CH3=GPIO4 */

// firmware/components/status_led/status_led.c
#define LED_GPIO 45             /* 原 48 */

// firmware/components/wifi_manager/wifi_manager.c
#define BTN_GPIO 47             /* 原 38，与 FAN5_TACH 冲突 */

// ---------- v1.2.1 增量（模块审查发现，原 H-03 未覆盖）----------

// firmware/components/power_monitor/power_monitor.h  —— MA-21
#define VOLTAGE_DIVIDER_5V  5.7f   /* 原 2.0f；硬件 47k/10k=÷5.7，不改则读数偏差 2.85 倍 */
#define VOLTAGE_DIVIDER_3V3 5.7f   /* 原 2.0f；同上 */
/* 12V 常数核对为 6.0f（100k/20k=÷6）；头文件中的分压网络描述注释同步更新 */

// firmware/sdkconfig.defaults  —— MA-34
/* 控制台与日志路由改走 USB-Serial-JTAG（GPIO19/20），不得再走 UART0：
   GPIO43/44 已让渡给屏幕 SPI（决策 D5），日志继续走 UART0 会与屏幕信号冲突。
   增加 CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y 作为默认控制台 */

// 路数硬编码清理（MA-07 连带，共五处；索引仍为 0 基）：
//   fan_curve.h:10          FAN_CURVE_FANS 4   → 8
//   flash_storage.h:17      fan_rpm[4]         → fan_rpm[8]
//   main.c:280,301          循环字面量 4       → 引用各组件 COUNT 宏
//   alert_manager.c:35,87,113 数组与循环 4      → 8（或本组件宏）
```

- 验收（在仓库根执行，全部必须为空或符合注释）：
```bash
grep -rn "{ 4, 5, 6, 7 }" firmware/                      # 空
grep -rn "FAN_PWM_COUNT 4\|FAN_TACH_COUNT 4" firmware/   # 空
grep -n "LED_GPIO         48" firmware/components/status_led/status_led.c   # 空
grep -n "BTN_GPIO        38" firmware/components/wifi_manager/wifi_manager.c # 空
grep -rn "ADC_CHANNEL_2" firmware/components/power_monitor/  # 空（12V 不再在 GPIO3）
grep -n "VOLTAGE_DIVIDER" firmware/components/power_monitor/power_monitor.h  # 5V/3V3=5.7f，12V=6.0f
grep -n "CONSOLE_UART" firmware/sdkconfig.defaults                          # 空
grep -rn "FAN_CURVE_FANS 4\|fan_rpm\[4\]" firmware/                          # 空
```
- 连带检查：`fan_pwm.c` 的日志字符串（如 "GPIO4-7"）同步改为 "GPIO5-12"；`fan_tach.c` 的 "GPIO8-11" 同理。
- 协议层与 web/HA 的风扇数量扩散影响（15 处口径，见审查报告表 2）由模块整改清单 WEB-03/HA-02 等项承接，不在本项范围。

**H-04 扩展板矛盾清理（文档层）**
- 动作：在 `hardware/docs/hardware-design-guide-v1.1.md`（升级为 v1.2）与 `hardware/docs/schematic-review-checklist.md` 中：删除"J11 PH2.0-3P 扩展板 12V 供电"、删除"GPIO13 → 74AHCT125 → 扩展板 PWM"、删除"扩展板优先级最高/最低转速阈值/独立控制曲线"等特殊固件逻辑章节；统一表述为 D1 的口径（扩展板=接在一路风扇座上的普通风扇，独立 SATA 供电，推荐 J8）。
- 验收（v1.2.2 修正：原命令会命中本计划自身；且 GPIO13 已是合法的 FAN1_TACH 引脚，不能要求全库为空）：
```bash
grep -rn "EXT_PWM" hardware/docs/ --exclude=remediation-plan-v1.2.md --exclude=changelog-v1.2.md   # 空（两份元文档不参与扫描）
grep -rn "GPIO13" hardware/docs/ --exclude=remediation-plan-v1.2.md --exclude=changelog-v1.2.md | grep -v "FAN1_TACH"   # 空
grep -rn "扩展板" hardware/docs/ --exclude=remediation-plan-v1.2.md | grep "12V\|供电\|PWM"   # 仅剩 D1 口径表述（扩展板=普通风扇位，独立供电）
```
外加人工确认：文档中不存在任何"主控板给扩展板供 12V"的表述。

**H-05 USB/SATA 倒灌防护**
- 动作：按 §2 增加 D3（B5819W，VBUS→+5V 轨）；原理图中 USB VBUS 不得与 SATA 5V 有任何直连路径。
- 验收：原理图网络检查：VBUS 网络仅连接 J2、USBLC6（若接 VBUS 版）、D3 阳极；无直连 +5V/SATA 节点。

**H-06 BOM v1.2 重做（`hardware/docs/bom-main-board-v1.1.md` → 新文件 `bom-main-board-v1.2.md`）**
- 动作：按 §1~§3 重列：风扇座×8、74AHCT125×2、Tach 电阻 10kΩ×24 + 1nF×8、D3 新增、F1 ≥3A 选型、10µF 电容耐压改 16V/25V、屏幕排针 J13 位号、PWM 下拉 10kΩ×8（H-17）；删除 J11 PH2.0 行。逐位号与原理图核对。
- **`hardware/BOM.csv` 实际存在（模块审查 MF-09 勘误：此前误判为缺失），但内容是 v1.1 旧口径**——将其同步重写为 v1.2 内容（位号/规格/数量与新 md BOM 完全一致，供嘉立创 BOM 配单上传使用）。
- 验收：BOM 位号集合 == 原理图位号集合（写一个对照表附在 BOM 末尾）；无 18kΩ 规格（已废除）；F1 规格含 "3A" 及以上 hold；`hardware/BOM.csv` 与 md BOM 的位号/数量逐行一致。

**H-07 全部文档同步**
- `hardware/docs/hardware-design-guide-v1.1.md` → v1.2：引脚表、路数、板尺寸 99×99/4 层、电源架构、走线载流表述全部替换；删除"扩展板 v1.0 BOM"章节（扩展板为成品，改为一句话说明 D1）。
- `docs/hardware-assembly.md`：按 v1.2 重写（8 路、新位号、删除不存在的 D3 SRV05-4/D4~D8 TVS 表述）。注意：`hardware/BOM.csv` **实际存在**（v1.1 旧口径，MF-09 勘误），由 H-06 同步重写为 v1.2 后，组装指南同时引用 md 与 csv 两个 BOM。
- `hardware/docs/schematic-review-checklist.md`：引脚表与 §1 对齐（ADC 引脚、GPIO47 按键、GPIO45 WS2812、GPIO44 CS 上拉）；第 8 节扩展板检查表改为 D1 口径。
- `README.md` 硬件章节：现状为 **4 路**（模块审查 MF-01 勘误，并非此前误记的 6 路）→ 统一改为 8 路；尺寸/层数更新为 99×99mm 4 层；总风扇数 7 独立 + 12 统一 = 19。`docs/index.html`（GitHub Pages 门面）同口径修正（MF-02，由模块整改清单 DOC-03 承接）。
- v1.1 旧文档处置：`hardware-design-guide-v1.1.md` 与 `bom-main-board-v1.1.md` 升级替换为 v1.2 后**删除旧文件或移入 `hardware/legacy/`**（二者择一并在硬件 changelog 登记），否则下方 grep 无法清零。
- 验收（v1.2.2 修正：原命令会命中本计划自身与审查档案；legacy/ 归档不检查）：
```bash
grep -rn "100×70\|100x70" hardware/ docs/ README.md   --exclude-dir=legacy --exclude=remediation-plan-v1.2.md --exclude=changelog-v1.2.md   # 空
grep -rn "GPIO21.*ADC\|GPIO35.*ADC\|GPIO36.*ADC\|ADC.*GPIO21\|ADC.*GPIO35\|ADC.*GPIO36" hardware/ docs/   --exclude-dir=legacy --exclude=remediation-plan-v1.2.md --exclude=changelog-v1.2.md   --exclude=module-review-plan.md --exclude=module-review-report.md   # 空（审查档案与元文档不改写）
grep -rn "6 路\|6路" hardware/docs/ README.md   --exclude=remediation-plan-v1.2.md --exclude=changelog-v1.2.md   --exclude=module-review-plan.md --exclude=module-review-report.md   # 空
```
外加人工确认：所有文档路数表述为 8。

### P1 项

**H-08 USBLC6 VCC 改接 +5V 轨**（随 H-01 落实，单独列为验收点：原理图 U5 Pin5 网络 = +5V）。

**H-09 74AHCT125 使能与去耦完整**（随 H-01 落实，验收点：两片共 8 个 OE 脚全部接 GND、两个 VCC 各 100nF）。

**H-10 F1 选型与 12V 载流**（随 H-02/H-06 落实，验收点：BOM 中 F1 hold ≥3A；PCB 12V 为 L3 铺铜且旧"2mm=6A"表述已在文档删除）。

**H-11 Tach 网络补齐**（随 H-01/H-06 落实，验收点：原理图每路 3 电阻 + 1nF，共 8 路；BOM 数量 24+8）。

**H-12 SPI_CS 上拉与 strapping 标注**（随 H-01 落实，验收点：GPIO44 有 10k 上拉到 3.3V；GPIO3/GPIO46 在原理图标 NC）。

**H-17 PWM 输入线下拉电阻（新增于 v1.2.1，源自模块审查 MA-19）**
- 动作：8 路 PWM 网络（GPIO5~12 → 74AHCT125 的 A 输入）各加 10kΩ 下拉到 GND（见 §3 74AHCT125 节说明）。
- 验收：原理图 8 个 PWM 网络各有下拉电阻；BOM 含 10kΩ 增量×8（随 H-01/H-06 落实）。
- 配套（不在本清单）：固件侧 app_main 最早配置 LEDC duty=0，见模块整改清单 FW-14。

### P2 项

**H-13 AMS1117 热设计**：散热焊盘 ≥4cm² GND 铺铜 + 过孔阵列；文档注明"若 WiFi 高负载下 3.3V 跌落 >5%，备选 AZ1117-3.3（SOT-223 引脚兼容）"。

**H-14 WS2812 数据线串 33~100Ω**（抑制振铃，随 H-01 落实，BOM 加 1 只 0805 电阻）。

**H-15 仓库清理（v1.2.2 调整：配合 D6，备份不再删除而是归档）**：旧 KiCad 工程已整体移入 `hardware/legacy/`（2026-08-26 执行完毕）；`.gitignore` 已含 `*.bak`、`*.v7backup`（模块整改 DOC-05 顺带完成）。验收：`git ls-files hardware/legacy/ | grep -E "bak|v7backup"` 为空（legacy 内备份文件磁盘保留、git 不跟踪）。

**H-16 清理文档死链接**：`hardware/docs/hardware-design-guide-v1.1.md` 附录引用的 `bom-*.xlsx`、`pcb-layout-example.png`、`test-procedure.md` 均不存在，删除或替换为实际存在的仓库内文件。

---

## 5. 总验收门（整改完成的定义）

1. `hardware/lceda/` 嘉立创 EDA 工程（D6）：ERC=0、DRC=0、无 placeholder 内容；仓库内无被 git 跟踪的 .bak/.v7backup 文件（legacy/ 归档不参与验收）。
2. 三方一致性：本文档 §1 引脚表 == 原理图网络 == 固件 define（H-03 的 grep 全部通过）。
3. BOM ↔ 原理图 1:1（H-06 的对照表存在且无差异行；`hardware/BOM.csv` 与 md 口径一致）。
4. 文档一致性：H-07 的 grep 全部通过；全仓库无 "GPIO21/35/36 作 ADC"、"主控给扩展板供电"、"6 路风扇"、"100×70mm"、"README 中 4 路口径" 的残留表述。
5. 产出一份 `hardware/docs/changelog-v1.2.md`，逐项勾选 H-01~H-17 的完成状态与验证证据（命令+输出摘录）。
6. 固件构建：`idf.py build` 通过 —— **已于 2026-08-25 实测完成**（ESP-IDF v5.3.5，bin 0x11EA90 / 分区余 25%，证据见 `docs/changelog-modules-v1.2.md` §8）。

## 6. 明确不做的事

- 不为扩展板做任何供电/兼容电路或专用固件逻辑（D1）。
- 不做超过 8 路的风扇扩展（D2 的资源边界）。
- 固件非引脚类问题（编译错误、MQTT/OTA/告警逻辑等）及 agent/web/ha/test/docs 的整改，全部由 `docs/module-remediation-plan-v1.2.md` 承接（依据 `docs/module-review-report.md` 的 75 条发现，2026-08-24）。本清单保留的固件改动仅 H-03 一项（引脚同步）。

---

**版本：** v1.2.2（2026-08-26）

**修订记录：**
- v1.2.2（2026-08-26）：新增决策 D6（嘉立创 EDA 为唯一硬件真源，旧 KiCad 工程移入 `hardware/legacy/` 归档，不参与 grep 验收）；H-01/H-02 目标改为嘉立创 EDA 工程；H-04/H-07 验收命令修正自噬缺陷（原命令命中本计划自身，且 GPIO13 已是合法 FAN1_TACH、"GPIO35/36 作 ADC"字样存在于审查档案中，均无法清零——现统一排除计划自身、审查档案与 legacy/）；H-07 明确 v1.1 旧文档需删除或归档；H-15 从"删除备份"改为"legacy 归档 + git 不跟踪"；§5-6 固件构建标注已实测通过；同日补充：验收命令统一排除 changelog-v1.2.md（销号日志与计划同为元文档，其中引用的旧字符串/验收命令原文不参与扫描）。
- v1.2.1（2026-08-24）：吸收模块审查报告（`docs/module-review-report.md`）增量——H-03 扩展（分压比 ÷5.7、console 路由 USB-CDC、五处路数硬编码、构建先决条件）；H-06/H-07 勘误（README 现状为 4 路而非 6 路；`hardware/BOM.csv` 实际存在需同步重写）；新增 H-17（PWM 下拉电阻，源自 MA-19）；§6 范围交接给模块整改清单。
- v1.2（2026-08-23）：初版。

**上游依据：** 2026-08-23 硬件审查报告；2026-08-24 模块审查报告（75 条发现）；嘉立创免费打样规则（2026-08 核实：[规则变更公告](https://www.jlc.com/portal/q7i59056.html)、[免费打样文档](https://wiki.lceda.cn/zh-hans/design-production/free-pcb.html)）
