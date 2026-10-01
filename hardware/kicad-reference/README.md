# hardware/kicad-reference — KiCad 参考稿（非权威）

> **定位（决策 D6）**：嘉立创 EDA 工程（`hardware/lceda/`，用户手绘）是**唯一硬件真源**。
> 本目录的 KiCad 工程是由整改 agent 生成的**对比参照稿**——用于和您在嘉立创中绘制的
> 版本对照电路结构、网络命名与引脚分配。**禁止用于配单、打样或作为设计依据。**

## 文件清单

| 文件 | 说明 |
|------|------|
| `smart-fan-controller-v1.2.kicad_sch` | v1.2 完整原理图（KiCad 10，A2 单页，全局标签建网） |
| `smart-fan-controller-v1.2.kicad_pro` | 配套工程文件（KiCad GUI 直接打开用） |
| `smart-fan-controller-v1.2-ref.pdf` | 原理图 PDF 导出（无需 KiCad 即可对照） |
| `nl.net` | KiCad 网表导出（网络连通性证据） |
| `generate_sch.py` | 生成器脚本（可复现：`python generate_sch.py`，需本机 KiCad 10 标准库） |

## 设计依据

与嘉立创版完全一致，均来自 `hardware/docs/remediation-plan-v1.2.md`（v1.2.2）§1~§3：

- 8 路风扇：GPIO5~12 → 74AHCT125 ×2（OE 全接地）→ FAN1~8_PWM_OUT；每路 PWM 线 10kΩ 下拉（H-17）
- 8 路 Tach：GPIO13/14/15/21/38/39/40/41，每路 10k 上拉(+5V)+10k 串联+10k 下拉+1nF（3R+1C）
- ADC：GPIO1(÷6, 100k/20k)、GPIO2(÷5.7, 47k/10k)、GPIO4(÷5.7, 47k/10k)
- 电源：SATA → F1(≥3A)+D1 → +12V；SATA 5V→F2+D2 与 USB VBUS→D3 二极管或 → +5V → AMS1117-3.3
- USB：USB_C_Receptacle + USBLC6-2P6（VCC=**+5V**，H-08）+ CC 5.1k×2
- WS2812B-2020（GPIO45，串 33R）；BME280（SDO→GND=0x76，CSB→3V3）；DS18B20×2 端子（J11/J12）
- J13 屏幕排针（GPIO42/43/44+10k上拉/48 + I2C）；EN/BOOT 按键+上拉+去抖；WiFi 按键 GPIO47
- GPIO3/46 与 USB-C 未用脚（TX/RX/SBU）全部 no_connect；GPIO35/36/37 no_connect（N16R8 不可用）

## ERC 结果（KiCad 10.0.5 实测）

```
0 Errors / 11 Warnings
```

- 10 × `lib_symbol_mismatch`（74AHCT125）：生成器把 `extends 74LS125` 的继承符号展平嵌入，
  与库文件逐字节不同但引脚/电气完全一致——外观性差异，可忽略。
- 1 × `pin_to_pin`（U5/BME280 SDO ↔ GND）：**有意设计**（SDO 接地选 I2C 地址 0x76），非缺陷。

网表抽查（`nl.net`）：FAN1_PWM={U2.5,U3.2,R4.1}、FAN8_TACH={U2.34,R41.2,R42.1,C20.1}、
RESET={U2.3,R1.2,SW1.1,C6.1}、DS18B20_DQ={U2.9,R52.2,J11.2,J12.2} 等均与设计一一对应。

## 与嘉立创版对照时请以本表为准的差异说明

- 本稿为单页 A2、全局标签建网（无导线），元件摆放按功能分区，不代表 PCB 布局意图。
- 位号与 v1.2 规范一致：J1 SATA、J2 USB-C、J3~J10 风扇座、J11/J12 DS18B20、J13 屏幕、
  U3/U4 为两片 74AHCT125、U5 BME280、U6 USBLC6（注意：设计指南中 USBLC6 记作 U5，此稿为 U6）。
- 去耦电容数量为示意（ESP32 画了 4 只，BOM 要求 ≥8 分布 VDD）。
- 本稿无 PCB。布局/叠层请完全以嘉立创版与设计指南 v1.2 §PCB 约束为准。

## 复现方法

```bash
cd hardware/kicad-reference
python generate_sch.py    # 重新生成 .kicad_sch（覆盖）
# 验证（路径需绝对路径 + .kicad_sch 扩展名）：
"D:/Program Files/KiCad/10.0/bin/kicad-cli.exe" sch erc --output erc.rpt \
  "E:/My_Opjects/smart-fans-system/hardware/kicad-reference/smart-fan-controller-v1.2.kicad_sch"
```
