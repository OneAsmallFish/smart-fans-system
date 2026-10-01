# 硬件整改销号日志 v1.2（changelog-v1.2）

> 依据：`hardware/docs/remediation-plan-v1.2.md`（v1.2.2）。
> 记录硬件侧整改项 H-01~H-17 的完成状态与验证证据。执行日期：2026-08-25 ~ 2026-08-26。

---

## 0. 总览

- 状态：H-03/H-04/H-07/H-15/H-16 **完成**；H-01/H-02（原理图/PCB 重绘）由用户在嘉立创 EDA
  手工绘制中（决策 D6）；H-05/H-06/H-08~H-14/H-17 为随图项，待原理图/PCB 完成后验收。

---

## 1. 已完成项

### H-03 固件引脚同步 ✅（2026-08-25，随模块整改完成）
- fan_pwm 8 路 GPIO5-12、fan_tach 8 路 GPIO13(FAN1_TACH)/14/15/21/38/39/40/41（PCNT 4单元×2通道）、
  power_monitor CH_12V=CH0/CH_5V=CH1/CH_3V3=CH3、分压比 6.0/5.7/5.7、LED_GPIO 45、
  BTN_GPIO 47、console 走 USB-Serial-JTAG、五处路数硬编码清理。
- 验证：硬件清单 H-03 的 8 条 grep 全部通过；`idf.py build` 实测通过
  （ESP-IDF v5.3.5，bin 0x11EA90 / 分区余 25%）。证据：`docs/changelog-modules-v1.2.md` §1/§8。

### 计划文档修订 v1.2.2 ✅（2026-08-26）
- 新增决策 D6（嘉立创 EDA 唯一真源 + KiCad 归档 legacy/）；H-01/H-02 目标改嘉立创 EDA；
  H-04/H-07 验收命令修正自噬（排除计划自身/审查档案/legacy）；H-15 改归档口径；
  §5-6 标注固件构建实测通过。

### 旧 KiCad 工程归档 ✅（2026-08-26，配合 D6）
- `hardware/legacy/`：kicad_pro/sch/pcb + 5 个文本 .sch 占位图 + 旧 gerber/ +
  test-v10-format.txt（18 文件 git rename）；`.v7backup` 脱离 git 跟踪（磁盘保留）。
- 验证：`git ls-files hardware/legacy/ | grep -E "bak|v7backup"` → 0。

### H-04 扩展板矛盾清理（文档层）✅（2026-08-26）
- 动作：design-guide 重写为 v1.2（扩展板全部改为 D1 口径：成品板独立 SATA 供电、
  接一路风扇座、无专用电路/信号/固件逻辑，建议 Fan8/J10）；checklist 第 8 节改 D1 口径；
  删除"扩展板专用 PWM 信号经某 GPIO 缓冲输出"行、"扩展板 PH2.0 12V 供电"行、"扩展板特殊固件逻辑"等全部表述。
- 验证（v1.2.2 修正后的验收命令）：
```bash
grep -rn "EXT_PWM" hardware/docs/ --exclude=remediation-plan-v1.2.md            # 空 ✓
grep -rn "GPIO13" hardware/docs/ --exclude=remediation-plan-v1.2.md | grep -v "FAN1_TACH"   # 空 ✓
# GPIO13 仅以 FAN1_TACH 身份出现（design-guide-v1.2.md 与 checklist 的 Tach 引脚行）
grep -rn "扩展板" hardware/docs/ --exclude=remediation-plan-v1.2.md | grep "12V\|供电\|PWM"
# 命中均为 D1 口径表述（"独立 SATA 供电"），人工确认无"主控板给扩展板供电" ✓
```

### H-07 全部文档同步 ✅（2026-08-26，文档层）
- `hardware-design-guide-v1.2.md`（新）：8 路、99×99mm 4 层（L2 完整 GND/L3 电源）、
  GPIO v1.2 权威表镜像（ADC=GPIO1/2/4、WS2812=GPIO45、按键=GPIO47、屏幕=GPIO42/43/44/48）、
  电源架构（F1≥3A、D2/D3 二极管或）、Tach 网络 3R+1nF×8、PWM 下拉×8、USBLC6 VCC=+5V、
  载流按 IPC-2150（12V 走 L3 铺铜；旧"2mm=6A"错误表述废除）、J13 定义、
  嘉立创免费档工艺、EDA 操作流程。
- `schematic-review-checklist.md`（v1.2）：引脚表与计划 §1 对齐；新增 PWM 下拉/OE 全接地/
  USBLC6 VCC/F1 选型/GPIO35-37 NC 等检查项；常见错误速查更新（10 条致命错误）。
- `docs/hardware-assembly.md`（v1.2 重写）：BOM 核心件表更新（U3×2、J3~J10×8、F1≥3A、
  D2/D3、U5 USBLC6、J11/J12、J13）；焊接顺序按 v1.2 位号重排；
  **删除不存在的 TVS 器件焊接表述**（旧文把不存在的器件型号列为 D3/D4~D8；Step 2 改为焊 U5 USBLC6 + D3 B5819W）。
- README.md / docs/index.html 的路数与板卡口径：已于模块整改 DOC-03 完成（2026-08-25）。
- v1.1 旧文档处置：`hardware-design-guide-v1.1.md`、`bom-main-board-v1.1.md`
  → `git mv` 至 `hardware/legacy/docs/`（选择"归档"路径，登记于此）。
- 验证（v1.2.2 修正后的验收命令）：
```bash
grep -rn "100×70\|100x70" hardware/ docs/ README.md \
  --exclude-dir=legacy --exclude=remediation-plan-v1.2.md            # 空 ✓
grep -rn "GPIO21.*ADC\|GPIO35.*ADC\|GPIO36.*ADC\|ADC.*GPIO21\|ADC.*GPIO35\|ADC.*GPIO36" hardware/ docs/ \
  --exclude-dir=legacy --exclude=remediation-plan-v1.2.md --exclude=module-review-plan.md \
  --exclude=module-review-report.md                                   # 空 ✓
grep -rn "6 路\|6路" hardware/docs/ README.md \
  --exclude=remediation-plan-v1.2.md --exclude=module-review-plan.md --exclude=module-review-report.md   # 空 ✓
```

### H-16 清理文档死链接 ✅（2026-08-26，并入指南 v1.2 重写）
- v1.1 指南附录引用的 `bom-*.xlsx`、`pcb-layout-example.png`、`test-procedure.md` 均不存在；
  v1.2 指南附录已改为指向实际存在的仓库文件（remediation-plan / checklist / changelog / BOM v1.2）。

---

## 2. 待完成项（依赖原理图/PCB，用户在嘉立创 EDA 绘制中）

| 项 | 内容 | 依赖 | 验收要点 |
|----|------|------|----------|
| **H-01** | 嘉立创 EDA v1.2 原理图（存 `hardware/lceda/`） | 用户绘制 | ERC 0/0；对照 checklist v1.2 全勾；无占位内容 |
| **H-02** | v1.2 PCB（99×99/4层/L2 GND/L3 12V 铺铜） | H-01 | DRC 0；keepout 存在；4×M3 安装孔 |
| **H-05** | USB/SATA 倒灌防护（D2/D3 二极管或） | 随 H-01 | VBUS 网络仅连 J2/USBLC6/D3 阳极 |
| **H-06** | BOM v1.2（md + 重写 hardware/BOM.csv + 位号对照表） | 随 H-01 | 位号集合==原理图；F1 含 ≥3A；csv 与 md 一致。**当前 hardware/BOM.csv 仍为旧口径，配单前必须等本项** |
| **H-08** | USBLC6 VCC=+5V | 随 H-01 | U5 Pin5 网络=+5V |
| **H-09** | 74AHCT125 使能/去耦完整 | 随 H-01 | 8 个 OE 全接 GND、VCC 各 100nF |
| **H-10** | F1 选型与 12V 载流 | 随 H-02/H-06 | BOM F1 ≥3A；12V 为 L3 铺铜 |
| **H-11** | Tach 网络补齐 | 随 H-01 | 每路 3R+1nF ×8；BOM 24+8 |
| **H-12** | SPI_CS 上拉与 strapping 标注 | 随 H-01 | GPIO44 10k 上拉；GPIO3/46 标 NC |
| **H-13** | AMS1117 热设计 | 随 H-02 | 散热 ≥4cm² + 过孔阵列 |
| **H-14** | WS2812 串阻 33~100Ω | 随 H-01 | BOM 含 1 只 |
| **H-17** | PWM 输入线下拉 10kΩ×8 | 随 H-01 | 原理图 8 个 PWM 网络各有下拉 |

（固件侧配套已全部就绪：FW-13 app_main 最早 LEDC duty=0，与 H-17 双保险。）

---

## 2.5 KiCad 参考稿（2026-09-06，非权威，D6 不变）

- 应用户要求，agent 用 KiCad 10 平行绘制一份 v1.2 原理图作**对比参照**：
  `hardware/kicad-reference/`（.kicad_sch + .kicad_pro + PDF 导出 + 网表 + 生成器脚本）。
- 定位：对比参照，**非权威**——嘉立创 EDA 工程仍是唯一真源；禁止用于配单/打样。
- 验证：KiCad 10.0.5 ERC 实测 **0 Errors / 11 Warnings**（10×74AHCT125 展平嵌入的
  外观性差异 + 1×BME280 SDO→GND 有意设计）；网表抽查全部网络与计划 §1 一一对应。
- 生成方式与差异说明见该目录 README.md。

## 2.6 嘉立创 EDA 参考稿（2026-09-06，非权威，D6 不变）

- 应用户要求通过 EasyEDA Pro API（run-api-gateway 扩展 + WebSocket 桥接）完成一次嘉立创版：
  本地工程 **SmartFan-v1.2-ref**（`C:\Users\OneAs\Documents\LCEDA-Pro\projects\`）。
- **原理图完整**：A0 页 95 个元件（位号/名称/全部引脚网络标签+电源标志），网络命名与
  remediation-plan §1 一致；元件选自嘉立创系统库并核实 LCSC 编号（C6186/C7519/C8678 等）。
  详细清单/脚本/注意事项见 `hardware/lceda-ref/README.md`。
- **DRC 修复**：158 致命 → **9 致命 / 320 警告 / 0 错误**（2026-09-07 三轮修复）：
  ① 约 149 个致命 = createNetLabel 图元与引脚无电气连接（网格吸附偏差）→ 改用
  带网络名的短导线（305 根）逐引脚接入；② 9 个致命 = SN74AHCT125D 多子部件
  位号重复/焊盘不对应 → 替换为单部件 74AHCT125D-Q100118（SO-14 同封装）；
  ③ pin.modify({noConnected}) API 未生效 → NC 引脚悬空降为警告级。
  剩余 9 致命需在编辑器中目视拖正标签（网格吸附偏差为 API 限制）。
- **PCB**：转换入口已通（DRC 确认框不再阻塞），等上述 9 致命目视修复后
  执行 Alt+I 导入 → 99×99 板框/四层/手工布线。
- 教训登记：EasyEDA API 的 createNetFlag 不写 Value 属性 → DRC 致命；批量遍历标志图元的
  get() 会触发 API 500；sch 坐标单位 10mil、pcb 单位 1mil。

## 3. 已知待裁决事项

- **USB PHY 互斥**（登记于 `docs/changelog-modules-v1.2.md` §4.5）：`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y`
  （H-03 按硬件清单字面要求）与 usb_console 的 TinyUSB CDC-ACM 共用 GPIO19/20，
  ESP32-S3 两 USB 外设共享 PHY 运行期互斥。真机验证时需二选一；若互斥，候选方案为
  `CONFIG_ESP_CONSOLE_USB_CDC`（日志与命令均走 TinyUSB CDC）。原理图侧 D+/D- 连接不受影响。

---

**版本：** v1.0（2026-08-26）
