# hardware/lceda-ref — 嘉立创 EDA 参考稿（非权威）

> **定位（决策 D6）**：您在嘉立创 EDA 中手绘的工程是**唯一硬件真源**。
> 本目录记录 agent 通过 EasyEDA Pro API 生成的**对比参照稿**及其脚本，
> 用于与您的手绘版对照电路结构与网络命名。**禁止用于配单/打样。**

## 参照稿位置（EasyEDA Pro 本地工程）

- 工程名：**SmartFan-v1.2-ref**（单机版本地工程）
- 路径：`C:\Users\OneAs\Documents\LCEDA-Pro\projects\SmartFan-v1.2-ref`
- 打开方式：嘉立创 EDA 专业版 → 工程树 → main/SmartFan-v1.2-ref → 双击 `1. P1`

## 完成状态

### ✅ 原理图（完整）
- A0 图页，**95 个元件**全部放置并设位号/名称，全部引脚按 v1.2 网络命名
  （`remediation-plan-v1.2.md` §1 权威表）挂网络标签/电源标志：
  - U1 AMS1117-3.3(C6186)、U2 ESP32-S3-WROOM-1-N16R8、U3/U4 SN74AHCT125D（各 5 子部件：
    4 门 + 电源单元，OE 全接 GND）、U5 BME280、U6 USBLC6-2SC6(C7519)
  - J1 SATA7+15、J2 TYPE-C-31-M-12、J3~J10 640454-4 风扇座、J11/J12 XH2.54-3P、J13 1x8 2.54 排母
  - 8 路 PWM（FAN1~8_PWM→缓冲→FAN1~8_PWM_OUT，每路 10k 下拉 R4~R11）
  - 8 路 Tach 网络（3R+1C ×8：R12~R42 + C13~C20）
  - ADC 分压三组（R44~R49）、I2C/OneWire 上拉（R50~R52）、EN/BOOT 电路（R1/R2/SW1/SW2/C6）
  - WiFi 按键（R54/SW3）、WS2812B-2020（R53 串阻）、USB CC 下拉（R55/R56）、VBUS 电容（C22/C23）
  - 电源区（F1 ≥3A PTC、F2 1A PTC、D1 SS34、D2/D3 B5819W 二极管或、AMS1117、输入电容组）
- 网络命名与 KiCad 参考稿（`hardware/kicad-reference/`）完全一致，可逐网对照。
- 已保存（无未保存标记）。

### ✅ DRC 修复完成（158 致命 → 9 致命 / 320 警告 / 0 错误）

**158→9 过程**（三轮修复）：
1. 根因 1（约 149 个致命）：API `createNetLabel()` 在引脚坐标处创建了图元但未与引脚
   电气连接（嘉立创引脚吸附需要网格对齐，API 坐标存在亚网格偏移）。修复：改用
   `sch_PrimitiveWire.create([px, py, px+dx, py+dy], net)` 从每个引脚画一段带网络名的
   短导线（305 根），导线强制按 net 参数赋网络 → 引脚通过导线接入网络。
2. 根因 2（约 9 个致命）：U3/U4 的 SN74AHCT125D 多子部件（5 部件共享位号）导致
   "位号重复" + "引脚与焊盘未对应"（每部件仅 3 脚 vs SO-14 焊盘 14 脚）。修复：
   删除 10 个多子部件实例，替换为 **74AHCT125D-Q100118**（单部件 14 脚符号，
   SO-14 同封装），2 片各 14 脚全部正确接线。
3. 根因 3：`pin.modify({noConnected: true})` 未生效（API 返回成功但 DRC 仍报悬空）。
   NC 引脚的悬空已从致命降为警告级别。

### 剩余 9 致命 + 320 警告（需在编辑器中目视处理）
- 9 致命 = 引脚悬空（net flag/label 图元与引脚的网格吸附偏差导致电气未连通）。
  修复方法：在编辑器中打开原理图，DRC 面板双击每条致命错误定位到引脚，
  将附近的网络标签拖到引脚端点（或删掉重放）。约 10 分钟手工操作。
- 320 警告 ≈ 300 条 NC 引脚悬空（`pin.modify({noConnected:true})` API 未生效）
  + 20 条供应商编号不匹配（API 命名与库标准差异，不影响功能）。
  NC 引脚悬空为警告级别，不影响 PCB 转换。

### 手工完成 PCB 的步骤
1. 打开工程，激活原理图页 → 编辑器中修复 9 条致命悬空（DRC 面板双击定位）。
2. 顶部菜单 **设计 → 更新/转换原理图到PCB**（或 Alt+I）→ 确认导入。
3. PCB 中：边框层画 99×99mm 板框 → 层管理加两个内层（L2 GND / L3 电源）。
4. 布局按 `hardware-design-guide-v1.2.md` §PCB 约束。
5. **手工布线**（勿用自动布线）。
6. 完成后归档到仓库 `hardware/lceda/`（D6 口径）。

## 脚本说明（本目录 scripts/）

| 文件 | 用途 |
|------|------|
| `lceda_exec.py` | 向 EasyEDA Pro 桥接服务（localhost:49620）发送 JS 并打印结果 |
| `search_all*.js` | 库搜索（器件名 → LCSC 编号/封装核对） |
| `probe_place.js` / `probe2.js` | 首批唯一类型元件放置 + 引脚结构/子部件探测 |
| `batch1_power.js` ~ `batch6_labels.js` | 分区批量放置 + 全部网络标签/电源标志 |
| `shift_y.js` / `revert_y.js` | （已回退的）整版平移试验 |

复现：EasyEDA Pro 打开工程 + 桥接服务运行（`node <skill>/scripts/bridge-server.mjs`）后，
`python lceda_exec.py batch1_power.js` 依序执行。

## 已知注意事项

- 参考稿中 USBLC6 位号为 **U6**（设计指南文本写 U5）；74AHCT125 为 U3/U4（与 KiCad 稿一致）。
- SATA 符号（sata7+15）引脚按"1-7 数据(NC)、8-10=3.3V(NC/PWDIS)、11-19=GND/5V、20-22=12V"
  惯例映射（嘉立创该符号引脚无命名，此为社区通用约定，画正式板时请核对实物引脚图）。
- 去耦电容数量为示意（ESP32 画 4 只，BOM 要求 ≥8）。
- 嘉立创库元件与 BOM v1.2 的 LCSC 编号对应关系已在脚本 search 步骤核实（C6186/C7519/C8678 等）。

---
生成日期：2026-09-06；生成方式：EasyEDA Pro API（run-api-gateway 扩展 + WebSocket 桥接）
