# Smart Fan Controller — 服务器智能风扇控制系统

## TL;DR

> **Quick Summary**: 构建基于 ESP32-S3 的服务器智能风扇控制系统（硬件PCB + ESP-IDF固件 + Go Linux Agent + Web控制中心）。MQTT统一通信协议，兼容 Home Assistant 并通过HA桥接实现米家联动。米家直接接入不可行（企业资质壁垒），详见米家分析章节。
>
> **Deliverables**:
> - PCB设计文件（原理图 + 布局 + Gerber）
> - ESP32-S3 固件（ESP-IDF, C语言）
> - Go Linux Agent 守护进程
> - Web APP（React前端 + Node.js后端）
> - Home Assistant MQTT 自动发现配置
> - 项目文档 + 部署指南
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: 协议定义 → 硬件原理图 → 固件核心驱动 → 主循环集成 → 端到端联调

---

## Context

### Original Request
用户需要为服务器制作一个智能风扇控制板，包含硬件和软件，支持4路PWM风扇、WiFi联网、温度监控、风扇曲线控制、自动告警，并希望接入小米米家（不可行则自制APP）。

### Interview Summary

**关键决策**:
- **MCU**: ESP32-S3 — 内置WiFi/BLE/USB-OTG，单芯片方案
- **风扇**: 4路 PWM 4Pin（PWM调速 + Tach转速反馈）
- **供电**: 15针 SATA电源接口，5V → 3.3V LDO（⚠️ SATA无3.3V，PWDIS信号替代）
- **传感器**: BME280板载(I2C) + DS18B20远程探头(OneWire)
- **显示**: 无屏幕，RGB LED状态指示
- **告警**: RGB LED + APP/Web推送
- **按键**: 2个（WiFi配网 + 系统重置）
- **历史数据**: ESP32 Flash循环存储 + 实时发送至上位机
- **固件框架**: ESP-IDF（官方C框架）
- **上位机Agent**: Go语言，单一二进制
- **风扇曲线**: 固定温度-转速查表 + PID自适应，用户可选
- **智能家居**: MQTT混合方案，兼容Home Assistant + 自制Web APP
- **米家**: ❌ 不可行（需企业资质注册小米IoT平台）
- **测试**: ESP-IDF Unity 单元测试 + Go go test + Agent QA验证
- **额外功能**: 板载BME280、ESP32内部温度、风扇停转检测、断电保护电容、电源电压监控
- **PCB**: 不纠结嘉立创免费打板限制，按最佳设计

---

### 🏠 米家接入可行性分析 (Dedicated Analysis)

> **用户原始需求**: *"希望接入小米米家进行控制（无法实现则退选到制作控制APP）"*

#### 直接接入米家：不可行

| 方案 | 需要的门槛 | 个人可行？ | 详情 |
|------|-----------|:---:|------|
| **小米IoT开发者平台** | 企业营业执照 + 品牌授权书 + 产品送检认证 | ❌ | 平台硬性要求企业法人身份。个人开发者无法注册为设备制造商，无法获取PID/Token。 |
| **MIoT-ESP32-SDK** | 平台颁发的PID + Token + 设备证书 | ❌ | GitHub有开源SDK，但需要从开发者平台获取唯一凭据。凭据绑定到已认证企业账号。 |
| **米家BLE广播协议** | 破解 MiBeacon v2/v3 私有加密 | ❌ | 小米BLE设备使用出厂烧录的密钥进行加密广播。逆向协议不可行且违反ToS。 |
| **局域网miio协议** | 每台设备独有的Token | ❌ | miio用于**控制已有小米设备**，不是让DIY设备"变成"米家设备。方向反了。 |

> **结论**: 所有路径因政策壁垒 / 加密认证 / 商业授权而不可行。这不是技术能力问题，是平台准入门槛问题。

#### 选择方案：Home Assistant 桥接 → 米家联动

```
┌──────────────┐   MQTT    ┌─────────────────┐  官方HA插件    ┌─────────────┐
│ ESP32-S3     │◄────────►│ Home Assistant  │◄────────────►│ 米家 APP     │
│ + Go Agent   │           │ + Mosquitto     │ ha_xiaomi_home│ (联动控制)   │
└──────────────┘           └─────────────────┘              └─────────────┘
                                   │
                                   ▼ 同时支持
                          ┌─────────────────┐
                          │ 自制 Web APP     │
                          │ (PWA, 局域网直连) │
                          └─────────────────┘
```

#### 功能覆盖对比

| 需求 | 米家原生 | HA桥接 | 自制Web APP |
|------|:---:|:---:|:---:|
| 查看温度/风扇转速 | ✅ | ✅ HA APP | ✅ PWA |
| 远程调速 | ✅ | ✅ | ✅ |
| 告警推送 | ✅ | ✅ | ✅ |
| 定时/自动化 | ✅ | ✅ (HA更强大) | ✅ |
| 小爱同学语音控制 | ✅ | ✅ (巴法云桥接) | ❌ |
| 米家APP内显示 | ✅ 原生设备 | ⚠️ HA实体 | ❌ |
| 固件OTA更新 | ❌ | ❌ | ✅ |
| 不依赖云服务 | ❌ | ✅ 局域网 | ✅ |

#### 额外收益 (HA桥接方案独有)

- HA自动化远超米家（复杂条件、模板变量、Node-RED流程）
- 可同时接入 Apple HomeKit（通过 HA Bridge）
- 数据完全本地化，不经过小米云
- 开源生态，未来不会被厂商锁定

#### 小爱同学语音控制实现路径

如需语音控制，可通过以下方式实现（不包含在首期计划中）：
- **巴法云 MQTT 桥接**：HA → 巴法云 → 小爱同学（无需破解）
- **Node-RED + 小爱自定义技能**
- 此功能标记为 **V2 增强项**

---

### 🔴 Metis 审查关键纠正

| 错误 | 纠正 | 严重性 |
|------|------|--------|
| SATA 3.3V供电假设 | SATA Pin3是PWDIS，必须从5V经LDO获取3.3V | 🔴 致命 |
| PWM直接3.3V输出 | 需要74AHCT125做3.3V→5V电平转换 | 🔴 致命 |
| Tach上拉3.3V | 必须10kΩ上拉到5V（Intel风扇规范） | 🔴 致命 |
| ADC使用ADC2 | ADC2与WiFi冲突，仅用ADC1 | 🟡 重要 |
| Flash频繁写入 | 需Wear Levelling + 30-60s间隔减少擦写 | 🟡 重要 |
| Type-C缺少CC下拉 | 需5.1kΩ CC下拉电阻才能供电 | 🔴 致命 |
| 缺少模拟/数字电源隔离 | 需独立LDO或磁珠隔离降噪 | 🟡 次要 |

### 研究关键发现
- ESP32-S3 LEDC: 8通道，全部可共享一个25kHz定时器，~10bit分辨率
- ESP32-S3 PCNT: 8个脉冲计数器单元读取tach信号
- USB-CDC: 原生支持，无需外部USB转串口芯片
- `eclipse/paho.mqtt.golang` 为Go MQTT推荐库
- ADC1分辨率约9-10 ENOB，电压监测建议加ADS1115可选焊盘
- SATA供电: Pin3=PWDIS, Pin7/8/9=5V, Pin13/14/15=12V

### 🧬 从 Medication-Reminder-System 项目复用的经验

> 该项目也使用 ESP32-S3 + ESP-IDF v5.3.5，以下为经过硬件验证的实战经验：

#### ESP-IDF v5.x 关键陷阱（已踩坑，计划已规避）

| # | 陷阱 | 症状 | 正确做法 |
|---|------|------|---------|
| 1 | `esp_timer_get_time()` 用 `uint32_t` 接收 | 运行~72分钟后所有延时崩溃 | **必须 `int64_t`**！64位计数器溢出32位导致DHT11/延时逻辑全部失效 |
| 2 | SNTP在 `WIFI_EVENT_STA_CONNECTED` 启动 | NTP永远不同步 | 必须在 `IP_EVENT_STA_GOT_IP` 启动（DHCP先完成） |
| 3 | `esp_mqtt_client_start()` 在WiFi事件处理器中调用 | 递归互斥锁断言崩溃 | 必须用FreeRTOS Timer延迟执行 |
| 4 | `idf.py fullclean` 后 `sdkconfig` 残留 | 旧配置污染新编译 | 改defaults后手动删除 `sdkconfig` 或 `idf.py set-target` 重来 |
| 5 | `sscanf` 解析JSON | 布尔值、空字符串解析错误 | **始终用 `cJSON` 库解析所有JSON** |
| 6 | 事件处理器内 `vTaskDelay` | Task WDT触发 | 用 `esp_rom_delay_us()` 替代 |
| 7 | `ledc_set_fade_with_time()` 与WiFi并发 | 看门狗触发或PWM抖动 | 风扇调速用 `ledc_set_duty()` 手动步进（独立任务），不使用LEDC硬件渐变 |
| 8 | I2C总线死锁（BME280长时间不响应） | `i2c_master_cmd_begin()` 永久阻塞 | 设置`I2C_MASTER_TIMEOUT_MS=1000`超时，错误后重新调用`i2c_driver_delete()`再重初始化 |

#### 可复用的代码模式（参考路径）

| 模式 | 参考源 | 用途 |
|------|--------|------|
| WiFi管理器 + 指数退避重连 | `firmware/main/wifi/wifi_manager.c` | T15 WiFi管理器的基础模板 |
| FreeRTOS Timer定时器架构 | `firmware/main/main.c:42-47` | T22主循环的Timer模式参考 |
| NVS配置持久化 | `firmware/main/storage/nvs_manager.c` | T18 Flash存储的NVS操作模式 |
| ADC电压读取 | `firmware/main/config.h:42-44` (BATTERY_ADC) | T9电源监控的ADC分压参考 |
| 按键消抖 + 长按检测 | `firmware/main/buttons/` | T15按键处理的消抖逻辑 |
| cJSON构建/解析 | `firmware/main/main.c` (多处) | T16 MQTT客户端JSON构造 |
| NTP时间同步 | `firmware/main/wifi/wifi_manager.c` (start_sntp) | T15 WiFi管理器中NTP配置 |
| 分区表工厂分区 | `firmware/partitions.csv` (3MB factory) | T2分区表设计参考（我们需加OTA分区） |
| sdkconfig.defaults | `firmware/sdkconfig.defaults` (完整配置) | T2 ESP-IDF配置模板 |

#### 已验证的硬件设计经验

- ESP32-S3-N16R8 (16MB Flash + 8MB PSRAM) 稳定可靠，直接复用
- 4.7kΩ上拉电阻是I2C/OneWire/DHT11数据线的标准选择
- 霍尔传感器用轮询(50ms)比ISR ANYEDGE更可靠（避免中断风暴）
- 自由任务栈 ≥4096 bytes（BLE/WiFi回调会消耗大量栈空间）
- ADC在无电池时读数为0mV → USB供电时需要mock处理

---

## Work Objectives

### Core Objective
构建完整的服务器智能风扇控制系统：硬件采集温度/转速 → 固件智能控制 → MQTT上行 → Go Agent补充GPU/系统数据 → Web APP可视化与控制。

### Concrete Deliverables (独立文件夹结构)

每个子系统有独立顶层目录，互不嵌套：

| 目录 | 内容 | 独立性 |
|------|------|:---:|
| `hardware/` | KiCad/EasyEDA原理图 + PCB布局 + Gerber + BOM | ✅ 独立 |
| `firmware/` | ESP-IDF项目（components/ 子目录按驱动划分） | ✅ 独立可编译 |
| `agent/` | Go守护进程（cmd/ + internal/） | ✅ 独立可编译 |
| `web/` | React前端 + Node.js后端（monorepo或独立package） | ✅ 独立可部署 |
| `ha/` | Home Assistant MQTT自动发现YAML配置 | ✅ 独立配置 |
| `docs/` | 硬件组装 + 固件烧录 + 部署指南 | ✅ 独立文档 |
| `test/` | 端到端集成测试脚本 + 冒烟测试 | ✅ 独立可运行 |

### Definition of Done
- [ ] PCB Gerber可交付嘉立创生产，BOM可采购
- [ ] 固件编译通过，Unity测试全部PASS
- [ ] Go Agent编译为二进制，systemd服务可运行
- [ ] Web APP可访问，Dashboard实时显示温度/转速
- [ ] MQTT协议数据流通：固件 ↔ Broker ↔ Agent ↔ Web APP
- [ ] Home Assistant可自动发现设备并显示传感器实体

### Must Have
- 4路PWM风扇独立控制，25kHz PWM + 转速反馈
- BME280环境温湿度 + DS18B20远程探头
- SATA 5V → 3.3V LDO供电（非3.3V直取）
- 3.3V→5V PWM电平转换（74AHCT125）
- WiFi MQTT通信 + USB-CDC串口双通道
- 风扇曲线：固定查表 + PID自适应双模式
- 电源电压监控（12V/5V/3.3V，ADC1 + 分压）
- 风扇停转检测 + 断电保护电容
- Go Agent: GPU温度(nvidia-smi) + 系统状态采集
- Web APP: 仪表盘 + 风扇控制 + 告警配置 + 历史图表 + OTA
- OTA固件更新（MQTT触发下载）
- Home Assistant MQTT自动发现

### Must NOT Have (Guardrails)
- ❌ 不使用SATA 3.3V引脚（虽然Pin1-3输出3.3V，但电流受限且有PWDIS兼容性问题，5V→LDO方案更可靠）
- ❌ 不直接3.3V驱动风扇PWM（必须电平转换至5V）
- ❌ 不使用ADC2（与WiFi冲突）
- ❌ OLED/LCD屏幕（已明确排除）
- ❌ 蜂鸣器（已明确排除）
- ❌ 小米米家直连（不可行）
- ❌ 授权/付费SDK依赖（全部开源方案）
- ❌ 超过8路风扇（超出ESP32-S3 LEDC通道数）
- ❌ 使用 `uint32_t` 接收 `esp_timer_get_time()` 返回值（64位值，32位变量72分钟后溢出）
- ❌ 在WiFi事件处理器中调用 `esp_mqtt_client_start()`（递归互斥锁死锁，必须用Timer延迟）
- ❌ 使用 `sscanf` 解析JSON（布尔值和空字符串错误，始终用 `cJSON`）
- ❌ 事件处理器内调用 `vTaskDelay`（触发Task WDT，用 `esp_rom_delay_us`）
- ❌ FreeRTOS任务栈 < 4096 bytes（WiFi/BLE回调消耗大栈空间）
- ❌ SNTP 在 `WIFI_EVENT_STA_CONNECTED` 启动（必须在 `IP_EVENT_STA_GOT_IP`，DHCP先完成）
- ❌ 修改 `sdkconfig.defaults` 后不删除 `sdkconfig` 文件（旧配置污染）
- ❌ WS2812B使用5V供电时用3.3V GPIO直驱DIN（VIH_min=3.5V > ESP32 VOH=3.0V，改用3.3V供电LED或增加电平转换）
- ❌ 12V ADC分压使用10kΩ+3.3kΩ（输出2.97V接近ESP32-S3 ADC上限，改用100kΩ+20kΩ确保≤2.0V）
- ❌ AI slop: 避免过度抽象、避免无意义JSDoc、避免`any`类型

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — 所有验证由Agent执行，无人为操作。

### Test Decision
- **Infrastructure exists**: NO（全新项目）
- **Automated tests**: YES — 固件: ESP-IDF Unity + Go: go test + Agent QA
- **Framework**: Unity (ESP-IDF内置) + Go testing + Playwright (Web UI)
- **Test setup**: 项目脚手架任务中包含测试框架配置

### QA Policy
每个任务必须包含 Agent-Executed QA Scenarios。证据保存至 `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`。

- **固件/底层**: Bash (idf.py build + test) — 编译验证 + 单元测试
- **API/Web**: Bash (curl) — 发送请求，验证响应
- **Web UI**: Playwright — 浏览器自动化验证
- **Go Agent**: Bash (go test + go build) — 测试 + 编译

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — MAX PARALLEL, 8 tasks):
├── T1: MQTT协议规范 + 项目README [writing]
├── T2: ESP-IDF固件项目脚手架 [quick]
├── T3: Go Agent项目脚手架 [quick]
├── T4: Web APP项目脚手架 [quick]
├── T5: 硬件: 电源 + ESP32核心原理图 [unspecified-high]
├── T6: 硬件: 风扇驱动电路原理图 [unspecified-high]
├── T7: 硬件: 传感器 + I/O原理图 [unspecified-high]
├── T8: 硬件: 保护 + 监控电路原理图 [unspecified-high]

Wave 2 (Firmware核心驱动 — MAX PARALLEL, 8 tasks):
├── T9: 固件: 电源与电压监控驱动 [deep]
├── T10: 固件: 风扇PWM驱动(LEDC) [deep]
├── T11: 固件: 风扇Tach驱动(PCNT) [deep]
├── T12: 固件: BME280传感器驱动 [deep]
├── T13: 固件: DS18B20传感器驱动 [deep]
├── T14: 固件: RGB LED状态驱动 [quick]
├── T15: 固件: WiFi管理器 + 按键处理 [deep]
├── T16: 固件: MQTT客户端模块 [deep]

Wave 3 (固件集成 + Go Agent — MAX PARALLEL, 8 tasks):
├── T17: 固件: USB-CDC串口控制台 [quick]
├── T18: 固件: Flash存储(NVS + 循环日志) [deep]
├── T19: 固件: 风扇曲线引擎(LUT + PID) [deep]
├── T20: 固件: 告警管理器 [deep]
├── T21: 固件: OTA更新处理 [deep]
├── T22: 固件: 主循环集成 [deep]
├── T23: Go Agent: GPU + 系统监控采集器 [unspecified-high]
├── T24: Go Agent: MQTT发布/订阅 + USB中继 [unspecified-high]

Wave 4 (Web APP + PCB布局 — 6 tasks):
├── T25: Go Agent: 配置/systemd/安装脚本 [quick]
├── T26: Web后端: API服务器 + MQTT客户端 [unspecified-high]
├── T27: Web后端: REST API端点 [unspecified-high]
├── T28: Web前端: 仪表盘 + 风扇控制页 [visual-engineering]
├── T29: Web前端: 告警配置 + 历史 + 设备管理 [visual-engineering]
├── T30: PCB布局: 元件布局 + 布线 + Gerber导出 [unspecified-high]

Wave 5 (集成 + HA — 5 tasks):
├── T31: Home Assistant MQTT自动发现配置 [quick]
├── T32: 端到端: 固件 ↔ Go Agent ↔ MQTT [unspecified-high]
├── T33: 端到端: Web APP ↔ MQTT ↔ 固件 [unspecified-high]
├── T34: 全系统冒烟测试 [unspecified-high]
├── T35: 文档: 部署指南 + 硬件组装指南 [writing]

Wave FINAL (4 parallel reviews → user okay):
├── F1: 计划合规审计 (oracle)
├── F2: 代码质量审查 (unspecified-high)
├── F3: 实际QA执行 (unspecified-high + playwright)
└── F4: 范围一致性检查 (deep)
→ 呈现结果 → 等待用户明确"okay"
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| T1 | — | T2-T35 | 1 |
| T2 | T1 | T9-T22 | 1 |
| T3 | T1 | T23-T25 | 1 |
| T4 | T1 | T26-T29 | 1 |
| T5 | T1 | T30 | 1 |
| T6 | T1 | T30 | 1 |
| T7 | T1 | T30 | 1 |
| T8 | T1 | T30 | 1 |
| T9 | T2, T5 | T22 | 2 |
| T10 | T2, T6 | T19, T22 | 2 |
| T11 | T2, T6 | T19, T22 | 2 |
| T12 | T2, T7 | T22 | 2 |
| T13 | T2, T7 | T22 | 2 |
| T14 | T2 | T20, T22 | 2 |
| T15 | T2 | T22 | 2 |
| T16 | T1, T2, T15 | T22, T24, T26 | 2 |
| T17 | T2 | T22, T24 | 3 |
| T18 | T2 | T22 | 3 |
| T19 | T10, T11, T12, T16 | T22 | 3 |
| T20 | T14, T16 | T22 | 3 |
| T21 | T16 | T22 | 3 |
| T22 | T9-T21 | T32 | 3 |
| T23 | T3 | T24 | 3 |
| T24 | T3, T16, T17, T23 | T25, T32 | 3 |
| T25 | T24 | — | 4 |
| T26 | T1, T4, T16 | T27 | 4 |
| T27 | T26 | T28, T29 | 4 |
| T28 | T4, T27 | T33 | 4 |
| T29 | T4, T27 | T33 | 4 |
| T30 | T5-T8 | — | 4 |
| T31 | T1 | T33 | 5 |
| T32 | T22, T24 | T34 | 5 |
| T33 | T28, T29, T31 | T34 | 5 |
| T34 | T32, T33 | F1-F4 | 5 |
| T35 | T34 | — | 5 |

**Critical Path**: T1 → T2+T5 → T10+T11 → T19 → T22 → T32 → T34 → F1-F4
**Parallel Speedup**: ~65% vs sequential
**Max Concurrent**: 8 (Waves 1, 2, 3)

### Agent Dispatch Summary

- **Wave 1**: 8 — T1→`writing`, T2/T3/T4→`quick`, T5-T8→`unspecified-high`
- **Wave 2**: 8 — T9-T13/T15/T16→`deep`, T14→`quick`
- **Wave 3**: 8 — T17→`quick`, T18-T22→`deep`, T23/T24→`unspecified-high`
- **Wave 4**: 6 — T25→`quick`, T26/T27→`unspecified-high`, T28/T29→`visual-engineering`, T30→`unspecified-high`
- **Wave 5**: 5 — T31→`quick`, T32-T34→`unspecified-high`, T35→`writing`
- **FINAL**: 4 — F1→`oracle`, F2/F3→`unspecified-high`, F4→`deep`

---

## TODOs

### Wave 1 — 基础层 (Foundation)

- [ ] 1. **MQTT协议规范 + 项目README**

  **What to do**:
  - 定义MQTT Topic Schema（统一命名空间，如 `fan-controller/{device_id}/...`）
  - 定义JSON消息格式（传感器数据上报、风扇控制指令、告警消息）
  - 定义设备发现协议（Home Assistant MQTT Discovery兼容格式）
  - 定义风扇曲线配置的JSON Schema
  - 编写项目README：架构图（ASCII art）、目录结构、快速开始
  - 创建 `.gitignore`（ESP-IDF build, Go vendor, node_modules, gerber）

  **Must NOT do**:
  - 不要实现任何代码，仅规范文档
  - 不要依赖特定MQTT Broker实现（保持Broker无关性）

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, blocks T2-T35

  **Acceptance Criteria**:
  - [ ] `docs/protocol.md` — 完整MQTT Topic定义和消息格式
  - [ ] `docs/protocol.md` — 至少包含 sensor/status/command/alert/config/ota 6类Topic
  - [ ] `docs/protocol.md` — 所有JSON消息包含 `timestamp` 和 `device_id` 字段
  - [ ] `README.md` — 包含项目架构ASCII图和目录结构说明

  **QA Scenarios**:
  ```
  Scenario: 协议文档完整性验证
    Tool: Bash (grep)
    Steps:
      1. grep -c "Topic:" docs/protocol.md → 确认Topic定义章节存在
      2. grep -c "sensor" docs/protocol.md → ≥3
      3. grep -c "command" docs/protocol.md → ≥2
      4. grep -c "discovery" docs/protocol.md → ≥1
    Expected Result: 所有grep返回≥指定数值
    Failure Indicators: 任何grep返回0
    Evidence: .sisyphus/evidence/task-1-protocol.md

  Scenario: README完整性验证
    Tool: Bash (grep)
    Steps:
      1. grep -c "##" README.md → ≥4 (至少4个章节)
      2. grep -c "arch" README.md (case-insensitive) → ≥1
      3. grep -c "目录" README.md → ≥1
    Expected Result: README结构完整
    Evidence: .sisyphus/evidence/task-1-readme.md
  ```

  **Commit**: YES — `docs: MQTT protocol spec and project README`
  - Files: `docs/protocol.md`, `README.md`, `.gitignore`

- [ ] 2. **ESP-IDF固件项目脚手架**

  **What to do**:
  - 初始化ESP-IDF项目：`idf.py create-project firmware` 目标芯片 `esp32s3`
  - 配置 `CMakeLists.txt` 添加所需组件：ledc, pcnt, i2c, adc, nvs_flash, spi_flash, wifi, mqtt, esp_https_ota
  - 创建 `partitions.csv`：factory(1M), ota_0(1.5M), ota_1(1.5M), nvs(64K), storage(256K), coredump(64K)
  - 配置 `sdkconfig.defaults`：启用WiFi、MQTT、USB-CDC、FreeRTOS、Wear Levelling
  - 创建 `components/` 目录结构，每个驱动作为独立component
  - 创建 `main/main.c` 入口骨架：init_nvs, init_wifi, init_mqtt, 创建FreeRTOS任务
  - 配置Unity测试框架在 `test/` 目录

  **Must NOT do**:
  - 不要在 `main.c` 中实现任何驱动逻辑（仅骨架框架）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T9-T22

  **Acceptance Criteria**:
  - [ ] `firmware/CMakeLists.txt` — EXTRA_COMPONENT_DIRS指向components/
  - [ ] `firmware/partitions.csv` — 包含factory, ota_0, ota_1, nvs, storage分区
  - [ ] `firmware/sdkconfig.defaults` — CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y
  - [ ] `firmware/main/main.c` — 可编译通过 `idf.py build`
  - [ ] `firmware/test/` — Unity测试目录存在

  **QA Scenarios**:
  ```
  Scenario: 固件脚手架可编译
    Tool: Bash
    Preconditions: ESP-IDF环境已安装 (idf.py可用)
    Steps:
      1. cd firmware && idf.py set-target esp32s3
      2. idf.py build
    Expected Result: BUILD SUCCESS, 无错误
    Failure Indicators: 编译错误
    Evidence: .sisyphus/evidence/task-2-build.txt

  Scenario: 分区表验证
    Tool: Bash (grep)
    Steps:
      1. grep "factory" firmware/partitions.csv → 存在
      2. grep "ota_0" firmware/partitions.csv → 存在
      3. grep "storage" firmware/partitions.csv → 存在
    Expected Result: 所有关键分区存在
    Evidence: .sisyphus/evidence/task-2-partitions.txt
  ```

  **Commit**: YES — `chore(fw): ESP-IDF project scaffold for ESP32-S3`
  - Files: `firmware/`

- [ ] 3. **Go Agent项目脚手架**

  **What to do**:
  - 初始化Go模块：`go mod init github.com/user/smart-fan-agent`
  - 创建项目结构：`cmd/agent/main.go`, `internal/monitor/`, `internal/mqtt/`, `internal/config/`, `internal/usb/`
  - 添加依赖：`github.com/eclipse/paho.mqtt.golang`, `gopkg.in/yaml.v3`
  - 创建 `config.yaml` 模板（MQTT broker地址、设备串口路径、采样间隔）
  - 创建 `agent.service` systemd unit文件模板
  - 编写 `internal/config/config.go` 配置加载模块
  - 编写 `cmd/agent/main.go` 入口：加载配置 → 初始化MQTT → 初始化监控 → 启动

  **Must NOT do**:
  - 不实现实际监控逻辑（仅骨架+配置加载）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T23-T25

  **Acceptance Criteria**:
  - [ ] `agent/go.mod` — module声明 + mqtt dependency
  - [ ] `agent/cmd/agent/main.go` — 可编译 `go build ./cmd/agent/`
  - [ ] `agent/config.yaml` — 包含mqtt.broker, serial.port, monitor.interval字段
  - [ ] `agent/agent.service` — WorkingDirectory + ExecStart正确

  **QA Scenarios**:
  ```
  Scenario: Go模块可编译
    Tool: Bash
    Steps:
      1. cd agent && go build ./cmd/agent/
    Expected Result: 无错误输出
    Failure Indicators: 编译错误
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: 配置模板结构验证
    Tool: Bash (grep)
    Steps:
      1. grep "mqtt" agent/config.yaml → 存在
      2. grep "serial" agent/config.yaml → 存在
      3. grep "interval" agent/config.yaml → 存在
    Expected Result: 所有配置段存在
    Evidence: .sisyphus/evidence/task-3-config.txt
  ```

  **Commit**: YES — `chore(agent): Go agent project scaffold`
  - Files: `agent/`

- [ ] 4. **Web APP项目脚手架**

  **What to do**:
  - 初始化前端：Vite + React + TypeScript (`npm create vite@latest web -- --template react-ts`)
  - 初始化后端：Node.js + Express + TypeScript
  - 创建项目结构：`web/frontend/` (Vite React), `web/backend/` (Express API)
  - 添加前端依赖：react-router-dom, recharts (图表), @emotion/react (样式)
  - 添加后端依赖：express, mqtt (mqtt.js), cors, ws (WebSocket), tsx (dev)
  - 创建 `web/package.json` workspace配置（如用monorepo）或独立配置
  - 配置vite proxy指向后端API (localhost:3001)
  - 创建基础路由：`/` (Dashboard), `/fans` (Fan Control), `/alerts` (Alert Config), `/history` (History), `/devices` (Device Management)
  - 每个路由创建占位组件

  **Must NOT do**:
  - 不实现实际UI和API逻辑（仅骨架+路由）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T26-T29

  **Acceptance Criteria**:
  - [ ] `web/frontend/package.json` — 包含react, react-router-dom, recharts依赖
  - [ ] `web/backend/package.json` — 包含express, mqtt依赖
  - [ ] `cd web/frontend && npm install && npm run build` — 构建成功
  - [ ] `cd web/backend && npm install && npx tsx src/server.ts` — 启动无错误
  - [ ] 前端5个路由均可导航（`/`, `/fans`, `/alerts`, `/history`, `/devices`）

  **QA Scenarios**:
  ```
  Scenario: 前端构建成功
    Tool: Bash
    Steps:
      1. cd web/frontend && npm install (timeout: 120s)
      2. npm run build
    Expected Result: BUILD SUCCESS, dist/目录生成
    Failure Indicators: 构建错误或dist/不存在
    Evidence: .sisyphus/evidence/task-4-frontend-build.txt

  Scenario: 后端启动成功
    Tool: Bash
    Steps:
      1. cd web/backend && npm install (timeout: 120s)
      2. timeout 5 npx tsx src/server.ts || true
    Expected Result: 进程启动无崩溃，监听端口日志
    Failure Indicators: import错误或进程崩溃
    Evidence: .sisyphus/evidence/task-4-backend-start.txt
  ```

  **Commit**: YES — `chore(web): React + Express web app scaffold`
  - Files: `web/`

- [ ] 5. **硬件: 电源 + ESP32核心原理图**

  **What to do**:
  - 创建 `hardware/` 目录，使用KiCad或EasyEDA
  - SATA 15pin电源输入电路：
    - Pin7/8/9 (5V) → AMS1117-3.3 LDO → 3.3V (ESP32 + 传感器)
    - Pin13/14/15 (12V) → 风扇供电直连
    - ⚠️ Pin3是PWDIS，不连接（非3.3V）
  - 3.3V电源轨：AMS1117-3.3，输入/输出各100μF电解+100nF陶瓷去耦电容
  - 5V电源轨：直接通过SATA 5V，加100μF+100nF去耦
  - 12V电源轨：直接通过SATA 12V，加100μF+100nF去耦（风扇用电）
  - ESP32-S3核心电路：
    - 芯片 + 40MHz晶振 + 去耦电容（每个VDD引脚100nF）
    - EN引脚：10kΩ上拉 + 100nF延时电容 + 按键到GND
    - IO0引脚：10kΩ上拉 + 按键到GND（烧录模式）
    - 外部Flash: 内置8MB Octal PSRAM配置
  - 断电保护：12V轨并联470μF-1000μF电解电容（维持~100ms，供安全关断用）
  - Type-C USB：
    - CC1/CC2各5.1kΩ下拉到GND（供电识别）
    - D+/D-直连ESP32-S3 USB-OTG引脚(IO19/IO20)
    - VBUS检测分压 → ADC监测
  - 电源电压监控分压网络：
    - 12V: **100kΩ+20kΩ分压** → ADC1_CHx（12V→~2.0V at ADC，安全裕量防止超出ESP32-S3 ADC上限3.1V）
    - 5V: 10kΩ+10kΩ分压 → ADC1_CHx（5V→~2.5V at ADC）
    - 3.3V: 10kΩ+10kΩ分压 → ADC1_CHx（3.3V→~1.65V at ADC）

  **Must NOT do**:
  - ❌ 不连接SATA Pin3（PWDIS，非3.3V源）
  - ❌ 不使用ADC2通道（与WiFi冲突）
  - ❌ 不分压低阻值到<5kΩ总阻（功耗过大）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T30

  **Acceptance Criteria**:
  - [ ] `hardware/power.sch` — SATA接口 + LDO + 去耦网络 + 断电电容
  - [ ] `hardware/esp32-core.sch` — ESP32-S3核心电路 + Type-C + 分压监控
  - [ ] SATA Pin3标注为NC（不连接），注释说明PWDIS原因
  - [ ] ADC分压均使用ADC1通道
  - [ ] Type-C CC1/CC2各有5.1kΩ下拉
  - [ ] BOM列出所有电阻/电容/LDO型号和封装

  **QA Scenarios**:
  ```
  Scenario: 原理图关键连接验证
    Tool: Bash (grep on schematic file)
    Steps:
      1. grep "PWDIS\|NC.*Pin3\|SATA.*3.*NC" hardware/power.sch → 确认PWDIS不连接
      2. grep "AMS1117-3.3\|LDO.*3.3" hardware/power.sch → 确认3.3V LDO存在
      3. grep "CC1.*5.1k\|5.1k.*CC" hardware/esp32-core.sch → 确认CC下拉
      4. grep "ADC1" hardware/esp32-core.sch → 确认使用ADC1
    Expected Result: 所有grep匹配
    Failure Indicators: 任何关键连接缺失
    Evidence: .sisyphus/evidence/task-5-schematic-review.txt

  Scenario: BOM完整性
    Tool: Bash (grep)
    Steps:
      1. grep -c "^" hardware/BOM.csv → ≥15 (至少15个元件)
      2. grep "AMS1117" hardware/BOM.csv → 存在
      3. grep "100nF\|0.1uF" hardware/BOM.csv → ≥3 (多处去耦)
    Expected Result: BOM包含核心元件
    Evidence: .sisyphus/evidence/task-5-bom.txt
  ```

  **Commit**: YES — `feat(hw): power supply and ESP32-S3 core schematic`
  - Files: `hardware/power.sch`, `hardware/esp32-core.sch`, `hardware/BOM.csv`

- [ ] 6. **硬件: 风扇驱动电路原理图**

  **What to do**:
  - 4路风扇接口电路（每路独立）：
    - 4Pin风扇座：Pin1=GND, Pin2=12V, Pin3=TACH, Pin4=PWM
    - 12V供电：直接来自SATA 12V轨，每路加100μF去耦电容
  - PWM电平转换（3.3V→5V）：
    - 使用74AHCT125四路缓冲器（或2x 74AHCT1G125单路）
    - ESP32 GPIO(3.3V) → 74AHCT125输入 → 输出(5V) → 风扇PWM引脚
    - 74AHCT125 VCC接5V
  - Tach转速反馈（5V→3.3V）：
    - 风扇Tach开路集电极输出 → 10kΩ上拉至5V
    - 电阻分压5V→3.3V（2.2kΩ+3.3kΩ）送入ESP32 GPIO
    - ⚠️ 不使用3.3V上拉（Intel规范要求5V上拉）
  - GPIO分配规划（记录在原理图注释中）：
    - 4x PWM输出: 各1个GPIO (LEDC通道0-3)
    - 4x Tach输入: 各1个GPIO (PCNT通道0-3)
    - 风扇12V电源开关(可选): 每个风扇座加MOSFET开关（AO3400 N-MOS + GPIO控制）

  **Must NOT do**:
  - ❌ 不直接ESP32 3.3V驱动风扇PWM（必须经74AHCT125电平转换）
  - ❌ Tach不上拉到3.3V（必须5V上拉 + 分压回3.3V）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T30

  **Acceptance Criteria**:
  - [ ] `hardware/fan-driver.sch` — 4路风扇驱动，每路含PWM电平转换 + Tach上拉/分压
  - [ ] 每个风扇PWM路径: ESP32 GPIO → 74AHCT125 → 风扇PWM引脚
  - [ ] 每个风扇Tach路径: 风扇Tach → 10kΩ上拉到5V → 分压(2.2k+3.3k) → ESP32 GPIO
  - [ ] GPIO分配表在原理图注释中明确标注
  - [ ] BOM更新：74AHCT125(或等效) x1、4Pin风扇座 x4、10kΩ电阻 x4、2.2kΩ+3.3kΩ各x4

  **QA Scenarios**:
  ```
  Scenario: 电平转换电路验证
    Tool: Bash (grep)
    Steps:
      1. grep "74AHCT125\|74LVC125\|SN74LVC" hardware/fan-driver.sch → 确认电平转换芯片
      2. grep "VCC.*5V\|5V.*VCC" hardware/fan-driver.sch → 确认芯片5V供电
      3. grep "10k.*5V\|5V.*10k" hardware/fan-driver.sch → 确认Tach 5V上拉
    Expected Result: 电平转换和上拉电路正确
    Failure Indicators: 缺少电平转换或错误上拉电压
    Evidence: .sisyphus/evidence/task-6-fan-driver.txt

  Scenario: GPIO分配完整性
    Tool: Bash (grep)
    Steps:
      1. grep -c "GPIO" hardware/fan-driver.sch → ≥8 (4 PWM + 4 Tach)
      2. grep "LEDC\|PWM.*GPIO" hardware/fan-driver.sch → ≥4
      3. grep "PCNT\|TACH.*GPIO" hardware/fan-driver.sch → ≥4
    Expected Result: 8个以上GPIO分配明确
    Evidence: .sisyphus/evidence/task-6-gpio.txt
  ```

  **Commit**: YES — `feat(hw): 4-channel fan driver with level shifting schematic`
  - Files: `hardware/fan-driver.sch`, `hardware/BOM.csv`

- [ ] 7. **硬件: 传感器 + I/O原理图**

  **What to do**:
  - BME280环境传感器电路：
    - I2C接口：SCL + SDA，各4.7kΩ上拉到3.3V
    - VCC接3.3V，GND接GND
    - 可选地址选择：SDO接GND(0x76)或VCC(0x77)
  - DS18B20远程温度探头接口：
    - 3Pin接线端子（VCC, DQ, GND）或3.5mm音频插座
    - DQ引脚：4.7kΩ上拉到3.3V（OneWire总线）
    - 留2个并联接口（同一OneWire总线，传感器地址自动识别）
    - 可选：每个接口加ESD保护（TVS管到GND）
  - RGB LED状态指示：
    - WS2812B-2020 (1mm封装，最小占PCB面积)
    - 单GPIO控制（RMT或SPI模拟）
    - **VCC接3.3V**（AMS1117-3.3输出），加100nF去耦
    - ⚠️ 若使用5V供电，需74AHCT1G125电平转换（3.3V GPIO→5V DIN），否则VIH不足
  - 物理按键：
    - 配网键：GPIO + 10kΩ上拉 → GND（按下为低）
    - 重置键：接ESP32 EN引脚（与T5的EN电路共用）

  **Must NOT do**:
  - ❌ BME280不使用SPI模式（固定I2C）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T30

  **Acceptance Criteria**:
  - [ ] `hardware/sensors-io.sch` — BME280 + DS18B20接口 + RGB LED + 按键
  - [ ] BME280 I2C上拉电阻4.7kΩ
  - [ ] DS18B20 DQ上拉4.7kΩ + 2个接线端子
  - [ ] WS2812B-2020 LED，5V供电100nF去耦
  - [ ] 2个按键均有10kΩ上拉
  - [ ] BOM更新：BME280、DS18B20座子、WS2812B-2020、按键、电阻

  **QA Scenarios**:
  ```
  Scenario: I2C上拉验证
    Tool: Bash (grep)
    Steps:
      1. grep "4.7k\|4k7" hardware/sensors-io.sch → ≥3 (SCL, SDA, DQ)
      2. grep "BME280" hardware/sensors-io.sch → 存在
      3. grep "WS2812" hardware/sensors-io.sch → 存在
    Expected Result: 所有传感器外围正确
    Evidence: .sisyphus/evidence/task-7-sensors.txt

  Scenario: 按键电路验证
    Tool: Bash (grep)
    Steps:
      1. grep -c "SW_\|BUTTON\|按键" hardware/sensors-io.sch → ≥2
      2. grep "10k.*PULLUP\|上拉.*10k" hardware/sensors-io.sch → ≥2
    Expected Result: 2个按键且均有上拉
    Evidence: .sisyphus/evidence/task-7-buttons.txt
  ```

  **Commit**: YES — `feat(hw): sensor, LED, and button I/O schematic`
  - Files: `hardware/sensors-io.sch`, `hardware/BOM.csv`

- [ ] 8. **硬件: 保护 + 监控电路原理图**

  **What to do**:
  - 电源输入保护：
    - SATA 12V/5V输入各加一个自恢复保险丝（PTC fuse, 如MF-MSMF系列）
    - 12V: 2A保险丝, 5V: 1A保险丝
    - 反向保护：加肖特基二极管防反接
  - ESD保护：
    - Type-C D+/D-加TVS管阵列（如SRV05-4）
    - 风扇Tach输入加TVS管（保护GPIO）
    - DS18B20 DQ加TVS管
  - 电压监控（完善T5中的分压网络）：
    - 12V/5V/3.3V分压到ADC1_CH0/CH1/CH2
    - 每个分压点加100nF滤波电容到GND（ADC采样稳定）
    - 可选：ADS1115 16-bit I2C ADC焊盘（高精度模式，与ADC1分压共存）
  - 断电保护电路：
    - 12V轨大电容（470μF-1000μF, 25V耐压）
    - 12V → 分压到ADC1_CH3（检测断电，电压下降触发中断）
    - 断电时：关断风扇12V MOSFET（减少电容负载）
  - 散热设计注意事项（原理图注释）：
    - AMS1117功耗：(5V-3.3V)*0.5A≈0.85W，需铜皮散热或TO-252封装
    - 74AHCT125功耗微小，TSSOP封装即可
    - 风扇12V MOSFET: 4风扇*0.5A=2A, 选AO4407 (P-MOS, 12A)或类似

  **Must NOT do**:
  - ❌ 不省略任何电源轨的保险丝
  - ❌ 不要忽略AMS1117散热（标注所需铜面积或推荐封装）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 1, depends on T1, blocks T30

  **Acceptance Criteria**:
  - [ ] `hardware/protection.sch` — 保险丝 + ESD + 电压监控 + 断电保护
  - [ ] 每路电源有自恢复保险丝
  - [ ] 每个关键信号有ESD保护标注
  - [ ] ADC滤波电容 + 断电检测分压
  - [ ] ADS1115可选焊盘标注
  - [ ] 散热设计和注意事项在原理图注释中

  **QA Scenarios**:
  ```
  Scenario: 保护电路完整性
    Tool: Bash (grep)
    Steps:
      1. grep -c "FUSE\|PTC\|保险丝\|MF-MSMF" hardware/protection.sch → ≥2 (12V+5V)
      2. grep -c "TVS\|ESD\|SRV05" hardware/protection.sch → ≥3 (USB + Tach + DS18B20)
      3. grep "肖特基\|SCHOTTKY\|防反接" hardware/protection.sch → ≥1
    Expected Result: 完整的保护措施
    Evidence: .sisyphus/evidence/task-8-protection.txt

  Scenario: 断电检测验证
    Tool: Bash (grep)
    Steps:
      1. grep "1000uF\|470uF\|大电容\|BULK" hardware/protection.sch → ≥1
      2. grep "ADC.*12V\|12V.*ADC\|断电" hardware/protection.sch → ≥1
    Expected Result: 断电保护电路存在
    Evidence: .sisyphus/evidence/task-8-power-fail.txt
  ```

  **Commit**: YES — `feat(hw): protection, monitoring, and power-fail circuit`
  - Files: `hardware/protection.sch`, `hardware/BOM.csv`

---

### Wave 2 — 固件核心驱动

- [ ] 9. **固件: 电源与电压监控驱动**

  **What to do**:
  - 创建 `firmware/components/power_monitor/` component
  - 实现ADC1多通道电压采样（12V/5V/3.3V分压点）
  - 实现原始ADC值 → 实际电压换算（使用分压比反算）
  - 实现均值滤波（连续采样16次取平均，降噪）
  - 实现断电检测：监测12V分压ADC，连续3次低于阈值(如<10V)判为断电
  - 导出函数：`power_monitor_read_all(float *v12, float *v5, float *v33)`
  - 导出回调注册：`power_monitor_on_power_fail(void (*cb)(void))`
  - ESP32内部温度传感器读取
  - 编写 `test/test_power_monitor.c` Unity测试：验证ADC值换算、滤波算法、断电检测阈值

  **Must NOT do**:
  - ❌ 不使用ADC2（WiFi冲突）
  - ❌ 分压比不硬编码（使用宏定义）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2,T5

  **Acceptance Criteria**:
  - [ ] 分压比宏定义：VOLTAGE_DIVIDER_12V, VOLTAGE_DIVIDER_5V, VOLTAGE_DIVIDER_3V3
  - [ ] `idf.py build` 编译通过
  - [ ] `idf.py test` Unity测试PASS (3+用例)

  **QA Scenarios**:
  ```
  Scenario: 编译和单元测试
    Tool: Bash
    Steps:
      1. cd firmware && idf.py build
      2. idf.py test
    Expected Result: BUILD SUCCESS, ALL TESTS PASSED
    Failure Indicators: 编译错误或测试失败
    Evidence: .sisyphus/evidence/task-9-build-test.txt

  Scenario: ADC1使用检查
    Tool: Bash (grep)
    Steps:
      1. grep "ADC2" firmware/components/power_monitor/power_monitor.c → 0 (不使用ADC2)
      2. grep "ADC1" firmware/components/power_monitor/power_monitor.c → ≥1
    Expected Result: 仅使用ADC1通道
    Evidence: .sisyphus/evidence/task-9-adc-check.txt
  ```

  **Commit**: YES — `feat(fw): power monitor driver with ADC1 voltage sensing`
  - Files: `firmware/components/power_monitor/`, `firmware/test/test_power_monitor.c`

- [ ] 10. **固件: 风扇PWM驱动(LEDC)**

  **What to do**:
  - 创建 `firmware/components/fan_pwm/` component
  - 配置LEDC定时器：25kHz, 10-bit分辨率（0-1023 duty）
  - 配置4个LEDC通道，各绑定到对应GPIO
  - 实现 `fan_pwm_set_duty(uint8_t fan_index, uint8_t percent)` (0-100%)
  - 实现 `fan_pwm_get_duty(uint8_t fan_index) → uint8_t`
  - 实现软启动：从0%平滑过渡到目标值（每10ms递增1%，防止电流冲击）
  - 编写 `test/test_fan_pwm.c` Unity测试：占空比边界、软启动逻辑

  **Must NOT do**:
  - ❌ 不做PID逻辑（T19风扇曲线引擎负责）
  - ❌ 不直接GPIO操作（使用LEDC API）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2,T6

  **Acceptance Criteria**:
  - [ ] 25kHz PWM, LEDC_LOW_SPEED_MODE (ESP32-S3规范)
  - [ ] 软启动10ms步进实现
  - [ ] `idf.py build` + `idf.py test` PASS

  **QA Scenarios**:
  ```
  Scenario: LEDC配置规范验证
    Tool: Bash (grep)
    Steps:
      1. grep "25000\|25.*kHz" firmware/components/fan_pwm/fan_pwm.c → 25kHz
      2. grep "LEDC_LOW_SPEED_MODE" firmware/components/fan_pwm/fan_pwm.c → 确认
    Expected Result: LEDC配置符合ESP32-S3
    Evidence: .sisyphus/evidence/task-10-ledc-config.txt
  ```

  **Commit**: YES — `feat(fw): fan PWM driver using LEDC at 25kHz`
  - Files: `firmware/components/fan_pwm/`, `firmware/test/test_fan_pwm.c`

- [ ] 11. **固件: 风扇Tach驱动(PCNT)**

  **What to do**:
  - 创建 `firmware/components/fan_tach/` component
  - 配置4个PCNT单元，上升沿计数（每转2脉冲）
  - RPM计算：`pulses * 60 / (2 * 1.0)` (1秒采样窗口)
  - 实现停转检测：RPM < 200持续3秒 → `fan_tach_on_stall()` 回调
  - 编写 `test/test_fan_tach.c`：脉冲→RPM换算数学验证

  **Must NOT do**:
  - ❌ 不使用GPIO中断计数（PCNT硬件保证不丢脉冲）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2,T6

  **Acceptance Criteria**:
  - [ ] RPM公式：(pulses * 60) / (2 * 1.0)
  - [ ] 停转检测阈值<200 RPM, 持续3秒确认
  - [ ] `idf.py build` + `idf.py test` PASS

  **QA Scenarios**:
  ```
  Scenario: RPM公式验证
    Tool: Bash (grep)
    Steps:
      1. grep "\* 60\|60 \*" firmware/components/fan_tach/fan_tach.c → 转换公式
      2. grep "STALL\|stall\|停转\|200" firmware/components/fan_tach/fan_tach.c → 检测逻辑
    Expected Result: 计算和检测逻辑完整
    Evidence: .sisyphus/evidence/task-11-rpm-logic.txt
  ```

  **Commit**: YES — `feat(fw): fan tachometer driver using PCNT`
  - Files: `firmware/components/fan_tach/`, `firmware/test/test_fan_tach.c`

- [ ] 12. **固件: BME280传感器驱动**

  **What to do**:
  - 创建 `firmware/components/bme280/` component
  - I2C初始化（I2C_NUM_0, 100kHz/400kHz）
  - 实现BME280寄存器操作 + Bosch补偿算法（温度/湿度/气压）
  - 精度：0.01°C, 0.008%RH, 0.18Pa
  - 编写 `test/test_bme280.c`：补偿算法数学验证

  **Must NOT do**:
  - ❌ 不使用SPI接口（固定I2C模式）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2,T7

  **Acceptance Criteria**:
  - [ ] 温度/湿度/气压三类数据读取
  - [ ] 补偿算法使用int64_t防溢出
  - [ ] `idf.py build` + `idf.py test` PASS

  **Commit**: YES — `feat(fw): BME280 I2C temperature/humidity/pressure driver`
  - Files: `firmware/components/bme280/`, `firmware/test/test_bme280.c`

- [ ] 13. **固件: DS18B20传感器驱动**

  **What to do**:
  - 创建 `firmware/components/ds18b20/` component
  - OneWire总线驱动：RMT外设确保精确时序（复位480μs, 读/写槽60μs）
  - ROM搜索算法（自动发现总线所有设备）+ CRC8校验
  - 支持至少4个传感器同时在线
  - 12-bit分辨率 (0.0625°C)
  - 编写 `test/test_ds18b20.c`：CRC、时序参数验证

  **Must NOT do**:
  - ❌ 不依赖外部库（自研保证时序可控）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2,T7

  **Acceptance Criteria**:
  - [ ] RMT外设驱动OneWire
  - [ ] CRC8校验 + ROM搜索
  - [ ] `idf.py build` + `idf.py test` PASS

  **Commit**: YES — `feat(fw): DS18B20 OneWire temperature sensor driver`
  - Files: `firmware/components/ds18b20/`, `firmware/test/test_ds18b20.c`

- [ ] 14. **固件: RGB LED状态驱动**

  **What to do**:
  - 创建 `firmware/components/status_led/` component
  - WS2812B-2020驱动：RMT外设编码 (T0H/T1H/T0L/T1L时序)
  - 预设模式：NORMAL(绿呼吸), WARNING(黄闪), ERROR(红快闪), WIFI_DISCONNECTED(蓝慢闪), OTA(紫呼吸)
  - 编写 `test/test_status_led.c`：颜色编码验证

  **Must NOT do**:
  - ❌ 不使用bit-bang GPIO（必须RMT保证无抖动）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2

  **Acceptance Criteria**:
  - [ ] 5种预设状态模式
  - [ ] RMT外设 + WS2812时序正确
  - [ ] `idf.py build` + `idf.py test` PASS

  **Commit**: YES — `feat(fw): WS2812B RGB LED status driver via RMT`
  - Files: `firmware/components/status_led/`, `firmware/test/test_status_led.c`

- [ ] 15. **固件: WiFi管理器 + 按键处理**

  **What to do**:
  - 创建 `firmware/components/wifi_manager/` component
  - WiFi STA模式：从NVS读取SSID/Password，自动连接
  - WiFi AP模式：长按配网键3秒 → 启动AP(WiFi名称: `FanCtrl-XXXX`, 密码: 8位随机)
  - AP模式下运行HTTP Captive Portal (配网Web页面)
  - 配网Web页面：WiFi扫描列表 + SSID/Password表单 → 保存到NVS → 重启
  - 断线重连：指数退避 (1s, 2s, 4s, 8s... max 60s)
  - 连接状态回调：`on_wifi_connected()`, `on_wifi_disconnected()`
  - 按键处理：短按(<1s)忽略，长按(3s)启动配网，超长按(10s)恢复出厂设置
  - 编写 `test/test_wifi_manager.c`：NVS存储逻辑测试

  **Must NOT do**:
  - ❌ 不断连后立即重连（退避策略必须实现）
  - ❌ 不将WiFi凭据硬编码在固件中

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T2

  **Acceptance Criteria**:
  - [ ] STA+AP双模式，按键切换
  - [ ] Captive Portal配网页面（HTTP Server）
  - [ ] 指数退避重连策略
  - [ ] 恢复出厂设置功能（清除NVS）
  - [ ] `idf.py build` 编译通过

  **QA Scenarios**:
  ```
  Scenario: WiFi栈编译验证
    Tool: Bash
    Steps:
      1. cd firmware && idf.py build
    Expected Result: 无WiFi相关编译错误
    Evidence: .sisyphus/evidence/task-15-build.txt

  Scenario: NVS凭据存储逻辑
    Tool: Bash (grep)
    Steps:
      1. grep "nvs.*wifi\|wifi.*nvs\|ssid.*nvs" firmware/components/wifi_manager/wifi_manager.c → NVS使用
      2. grep "factory_reset\|恢复出厂\|CLEAR.*NVS" firmware/components/wifi_manager/wifi_manager.c → 恢复功能
    Expected Result: NVS存储和恢复逻辑
    Evidence: .sisyphus/evidence/task-15-nvs-logic.txt
  ```

  **Commit**: YES — `feat(fw): WiFi manager with AP provisioning and reconnect`
  - Files: `firmware/components/wifi_manager/`, `firmware/test/test_wifi_manager.c`

- [ ] 16. **固件: MQTT客户端模块**

  **What to do**:
  - 创建 `firmware/components/mqtt_client/` component
  - 基于ESP-IDF `esp_mqtt` 组件实现
  - MQTT 3.1.1协议，支持QoS 0/1, Keep-alive 60s
  - 发布函数：`mqtt_publish(topic, json_payload)` — 用于传感器数据/告警上报
  - 订阅函数：`mqtt_subscribe(topic, callback)` — 用于接收控制指令
  - 自动重连：MQTT断开后自动重连，继承WiFi连接状态
  - Last Will Testament (LWT)：设备上线/离线通知
  - 消息队列：网络断开时缓存最多50条消息（Flash存储），重连后批量发送
  - 编写 `test/test_mqtt_client.c`：JSON构造验证、Topic合规检查、消息队列逻辑

  **Must NOT do**:
  - ❌ 不硬编码MQTT Broker地址（从NVS/Kconfig读取）
  - ❌ 不使用明文密码（如有认证）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 2, depends on T1,T2,T15

  **Acceptance Criteria**:
  - [ ] MQTT publish + subscribe双功能
  - [ ] LWT遗嘱消息 (`fan-controller/{id}/status` = "online"/"offline")
  - [ ] Flash离线消息队列 (≥50条)
  - [ ] 遵循T1定义的Topic Schema
  - [ ] `idf.py build` + `idf.py test` PASS

  **QA Scenarios**:
  ```
  Scenario: Topic格式合规检查
    Tool: Bash (grep)
    Steps:
      1. grep "fan-controller/" firmware/components/mqtt_client/mqtt_client.c → 命名空间
      2. grep "LWT\|last_will\|遗嘱" firmware/components/mqtt_client/mqtt_client.c → LWT支持
      3. grep "QUEUE\|queue\|队列.*50\|50.*队列" firmware/components/mqtt_client/mqtt_client.c → 消息队列
    Expected Result: Topic命名空间、LWT、队列实现
    Evidence: .sisyphus/evidence/task-16-mqtt-compliance.txt
  ```

  **Commit**: YES — `feat(fw): MQTT client with LWT, offline queue, and reconnect`
  - Files: `firmware/components/mqtt_client/`, `firmware/test/test_mqtt_client.c`

---

### Wave 3 — 固件集成 + Go Agent

- [ ] 17. **固件: USB-CDC串口控制台**

  **What to do**:
  - 创建 `firmware/components/usb_console/` component
  - 配置USB-CDC (TinyUSB CDC-ACM)：VID/PID自定义，设备描述符
  - 实现命令行解析器：接收 `\n` 分隔的文本命令
  - 支持命令：
    - `status` — 打印全部传感器/风扇/网络状态的JSON
    - `fan N speed X` — 手动设置风扇N转速X%
    - `fan N auto` — 恢复自动模式
    - `wifi SSID PASS` — WiFi凭据设置
    - `reboot` — 重启设备
    - `ota URL` — 触发OTA更新
    - `help` — 命令列表
  - 命令响应格式：JSON `{"ok": true, "data": {...}}` 或 `{"ok": false, "error": "..."}`
  - 添加 `console.h` 导出 `console_register_command(cmd, handler)` 供其他模块注册自定义命令

  **Must NOT do**:
  - ❌ 不阻塞式等待（命令解析异步处理）
  - ❌ 不使用UART转USB桥接（ESP32-S3原生USB-OTG）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T2

  **Acceptance Criteria**:
  - [ ] USB枚举为CDC-ACM串口设备
  - [ ] ≥6条命令可解析并返回JSON响应
  - [ ] `idf.py build` 编译通过

  **QA Scenarios**:
  ```
  Scenario: 命令表完整性
    Tool: Bash (grep)
    Steps:
      1. grep -c "REGISTER_COMMAND\|register_command\|CMD_" firmware/components/usb_console/usb_console.c → ≥6
      2. grep "status" firmware/components/usb_console/usb_console.c → 存在
      3. grep "fan.*speed\|speed.*fan" firmware/components/usb_console/usb_console.c → 存在
      4. grep "ota" firmware/components/usb_console/usb_console.c → 存在
    Expected Result: 所有核心命令注册
    Evidence: .sisyphus/evidence/task-17-commands.txt
  ```

  **Commit**: YES — `feat(fw): USB-CDC serial console with command parser`
  - Files: `firmware/components/usb_console/`

- [ ] 18. **固件: Flash存储(NVS + 循环日志)**

  **What to do**:
  - 创建 `firmware/components/flash_storage/` component
  - NVS分区：存储WiFi凭据、MQTT配置、风扇曲线配置、设备ID
  - Wear Levelling分区（storage, ≥256KB）：循环日志缓冲区
  - 实现 `log_sensor_data(timestamp, temps[], fan_speeds[], voltages[])` 写入循环缓冲区
  - 日志格式：二进制结构体（紧凑），每条记录≤128字节
  - 读写API：
    - `storage_write_config(key, value)` / `storage_read_config(key) → value`
    - `storage_get_recent_logs(count) → log_entry[]` 读取最近N条
    - `storage_get_log_count() → uint32_t`
  - 日志间隔：30-60秒（减少Flash擦写），使用Wear Levelling API分散擦写
  - 编写 `test/test_flash_storage.c`：读写一致性、循环覆盖逻辑

  **Must NOT do**:
  - ❌ 不直接操作Flash原始地址（使用NVS + Wear Levelling API）
  - ❌ 日志间隔不低于30秒（延长Flash寿命）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T2

  **Acceptance Criteria**:
  - [ ] NVS配置读写操作
  - [ ] Wear Levelling循环日志 + 日志丢失时不会溢出
  - [ ] `idf.py build` + `idf.py test` PASS

  **QA Scenarios**:
  ```
  Scenario: 循环覆盖逻辑验证
    Tool: Bash (grep)
    Steps:
      1. grep "WL_\|wear_level\|wled" firmware/components/flash_storage/flash_storage.c → Wear Levelling API
      2. grep "SECTOR\|ERASE\|erase" firmware/components/flash_storage/flash_storage.c → 擦写操作
      3. grep "overwrite\|覆盖\|WRAP" firmware/components/flash_storage/flash_storage.c → 循环逻辑
    Expected Result: Wear Levelling和循环覆盖实现
    Evidence: .sisyphus/evidence/task-18-wear-leveling.txt
  ```

  **Commit**: YES — `feat(fw): NVS config and wear-levelled circular log storage`
  - Files: `firmware/components/flash_storage/`, `firmware/test/test_flash_storage.c`

- [ ] 19. **固件: 风扇曲线引擎(LUT + PID)**

  **What to do**:
  - 创建 `firmware/components/fan_curve/` component
  - 固定查表模式（LUT）：
    - 默认曲线：`{30°C: 20%, 40°C: 40%, 50°C: 60%, 60°C: 80%, 70°C: 100%}`
    - 支持NVS自定义曲线（最多10个温度-转速点）
    - 线性插值计算中间值
  - PID自适应模式：
    - 目标温度（Setpoint）可配置
    - PID参数：Kp, Ki, Kd (默认: Kp=2.0, Ki=0.1, Kd=0.5)
    - 输出限幅：[0%, 100%]
    - Anti-windup：积分饱和限幅
    - 最小更新间隔：1秒（防止频繁调速）
  - 温度源选择：支持选择不同传感器为目标（板载BME280 / DS18B0探头N / 主机上报GPU温度）
  - 每路风扇独立曲线配置
  - 紧急模式：温度超过安全阈值(默认80°C) → 所有风扇100%
  - 编写 `test/test_fan_curve.c`：LUT插值、PID阶跃响应仿真、紧急模式触发

  **Must NOT do**:
  - ❌ PID不直接控制PWM（通过T10的 `fan_pwm_set_duty` 接口）
  - ❌ 不实现传感器数据采集（那是T9/T12/T13的职责）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T10,T11,T12,T16

  **Acceptance Criteria**:
  - [ ] LUT线性插值正确（验证端点值和中间值）
  - [ ] PID参数可配置，Anti-windup实现
  - [ ] 紧急模式：温度>80°C → 100% duty
  - [ ] `idf.py build` + `idf.py test` PASS (≥5用例)

  **QA Scenarios**:
  ```
  Scenario: LUT插值验证
    Tool: Bash (grep)
    Steps:
      1. grep "interpolat\|插值\|lerp" firmware/components/fan_curve/fan_curve.c → 插值实现
      2. grep "default.*curve\|默认.*曲线\|30.*20\|50.*60" firmware/components/fan_curve/fan_curve.c → 默认曲线
      3. grep "80.*100\|EMERGENCY\|紧急" firmware/components/fan_curve/fan_curve.c → 紧急模式
    Expected Result: LUT + 紧急模式实现
    Evidence: .sisyphus/evidence/task-19-curve-logic.txt

  Scenario: PID防积分饱和
    Tool: Bash (grep)
    Steps:
      1. grep "anti.windup\|积分.*饱和\|integral.*clamp\|I_MAX" firmware/components/fan_curve/fan_curve.c → Anti-windup
      2. grep "Kp\|Ki\|Kd\|PID" firmware/components/fan_curve/fan_curve.c → PID参数
    Expected Result: PID + Anti-windup
    Evidence: .sisyphus/evidence/task-19-pid.txt
  ```

  **Commit**: YES — `feat(fw): fan curve engine with LUT and PID modes`
  - Files: `firmware/components/fan_curve/`, `firmware/test/test_fan_curve.c`

- [ ] 20. **固件: 告警管理器**

  **What to do**:
  - 创建 `firmware/components/alert_manager/` component
  - 告警规则引擎（可配置阈值）：
    - 温度过高：任意传感器 > 阈值（默认75°C）
    - 风扇停转：任意风扇RPM < 200（利用T11回调）
    - 电压异常：12V偏离±10%, 5V偏离±5%, 3.3V偏离±5%
    - WiFi断开超过60秒
  - 告警状态机：NORMAL → WARNING → CRITICAL
  - 告警输出：
    - 更新RGB LED状态（调用T14预设模式）
    - 通过MQTT发布告警消息（调用T16）
    - 记录到Flash日志（调用T18）
  - 告警去重：同一告警2分钟内不重复发送MQTT
  - 告警恢复通知：状态从异常→正常时发送 `alert_cleared` 消息
  - 编写 `test/test_alert_manager.c`：规则触发逻辑、状态转换

  **Must NOT do**:
  - ❌ 不直接读取传感器（通过回调获取数据）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T14,T16

  **Acceptance Criteria**:
  - [ ] 4类告警规则（温度/风扇/电压/WiFi）
  - [ ] 三级状态机（NORMAL/WARNING/CRITICAL）
  - [ ] 告警去重（2分钟窗口）
  - [ ] `idf.py build` + `idf.py test` PASS

  **QA Scenarios**:
  ```
  Scenario: 告警规则覆盖
    Tool: Bash (grep)
    Steps:
      1. grep -c "ALERT_RULE\|alert_check\|RULE_" firmware/components/alert_manager/alert_manager.c → ≥4
      2. grep "dedup\|去重\|DUPLICATE\|2.*min" firmware/components/alert_manager/alert_manager.c → 去重
      3. grep "cleared\|恢复\|CLEAR" firmware/components/alert_manager/alert_manager.c → 恢复通知
    Expected Result: 完整告警生命周期
    Evidence: .sisyphus/evidence/task-20-alert-rules.txt
  ```

  **Commit**: YES — `feat(fw): alert manager with threshold rules and dedup`
  - Files: `firmware/components/alert_manager/`, `firmware/test/test_alert_manager.c`

- [ ] 21. **固件: OTA更新处理**

  **What to do**:
  - 创建 `firmware/components/ota_handler/` component
  - 基于ESP-IDF `esp_https_ota` 组件
  - OTA触发方式：
    - MQTT命令：`fan-controller/{id}/command/ota` payload: `{"url": "https://..."}`
    - USB-CDC命令：`ota URL`
  - OTA流程：
    1. 验证固件URL + TLS证书验证
    2. 设置LED为OTA模式（紫色呼吸）
    3. 下载固件到ota_1分区
    4. CRC校验 + 固件版本检查
    5. 设置启动分区为ota_1
    6. 重启 → 新固件运行
  - **回滚保护（分阶段确认）**：
    1. 新固件启动后30秒内标记"启动成功"（否则立即回滚）
    2. WiFi连接成功后标记"网络正常"（2分钟内，否则回滚）
    3. MQTT首次发布后标记"通信正常"（5分钟内，否则回滚）
    - 三阶段全部通过后OTA确认完成，删除回滚标记
  - 编写 `test/test_ota_handler.c`：分区切换逻辑、版本比较

  **Must NOT do**:
  - ❌ 不跳过TLS证书验证（安全要求）
  - ❌ 不下载到factory分区（永远保留factory恢复分区）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T16 (MQTT消息触发)

  **Acceptance Criteria**:
  - [ ] MQTT + USB双重触发OTA
  - [ ] 下载 → 校验 → 切换分区 → 重启流程完整
  - [ ] 回滚保护（5分钟看门狗确认）
  - [ ] `idf.py build` 编译通过

  **QA Scenarios**:
  ```
  Scenario: OTA流程完整性
    Tool: Bash (grep)
    Steps:
      1. grep "esp_https_ota\|esp_ota" firmware/components/ota_handler/ota_handler.c → OTA API
      2. grep "ota_0\|ota_1\|boot_partition" firmware/components/ota_handler/ota_handler.c → 分区切换
      3. grep "rollback\|回滚\|ROLLBACK" firmware/components/ota_handler/ota_handler.c → 回滚保护
    Expected Result: 完整OTA流程
    Evidence: .sisyphus/evidence/task-21-ota-flow.txt
  ```

  **Commit**: YES — `feat(fw): OTA update handler with rollback protection`
  - Files: `firmware/components/ota_handler/`, `firmware/test/test_ota_handler.c`

- [ ] 22. **固件: 主循环集成**

  **What to do**:
  - 修改 `firmware/main/main.c`：将所有组件集成
  - FreeRTOS任务分配：
    - `sensor_task` (优先级3, 栈4KB)：1秒周期 — 读取BME280 + DS18B20 + 电压监控 + 内部温度 → 发布MQTT
    - `fan_control_task` (优先级3, 栈4KB)：1秒周期 — 输入温度 → 风扇曲线计算 → 更新PWM → 发布MQTT
    - `tach_monitor_task` (优先级3, 栈3KB)：1秒周期 — 读取Tach RPM → 发布MQTT + 告警检测
    - `alert_task` (优先级2, 栈3KB)：5秒周期 — 检查所有规则 → 更新LED + 发布MQTT
    - `usb_console_task` (优先级1, 栈4KB)：阻塞式 — 等待USB-CDC输入 → 解析命令
    - `mqtt_task` (优先级2, **栈8KB**)：事件驱动 — MQTT连接维护 + 消息收发（TLS需要更大栈）
    - `ota_task` (优先级1, **栈12KB**)：按需创建 — OTA下载（HTTP Client需要更大栈）
    - `wifi_task` (优先级4, **栈5KB**)：WiFi连接维护 + 按键检测（事件处理器回调需要）
  - 启动顺序：NVS → WiFi → MQTT → 传感器 → 风扇 → 告警 → USB
  - 配置数据管理：开机从NVS加载所有配置，运行时通过MQTT/USB更新后保存

  **Must NOT do**:
  - ❌ 不阻塞主循环（所有操作异步FreeRTOS任务化）
  - ❌ 任务栈不分配过小导致溢出（保守估计，每个栈≥3KB）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T9-T21

  **Acceptance Criteria**:
  - [ ] 8个FreeRTOS任务 + 正确的优先级和栈大小
  - [ ] 启动顺序：NVS→WiFi→MQTT→传感器→风扇→告警→USB
  - [ ] 固件编译通过 `idf.py build`

  **QA Scenarios**:
  ```
  Scenario: 任务架构验证
    Tool: Bash (grep)
    Steps:
      1. grep -c "xTaskCreate\|xTaskCreatePinnedToCore" firmware/main/main.c → ≥6 (至少6个任务)
      2. grep "sensor_task\|fan_control_task\|mqtt_task\|alert_task" firmware/main/main.c → 识别所有关键任务
      3. grep "configMINIMAL_STACK_SIZE\|4096\|8192" firmware/main/main.c → 栈大小分配
    Expected Result: 完整的FreeRTOS多任务架构
    Evidence: .sisyphus/evidence/task-22-rtos-tasks.txt

  Scenario: 编译完整性
    Tool: Bash
    Steps:
      1. cd firmware && idf.py build
    Expected Result: 全固件编译无错误
    Failure Indicators: 链接错误、未定义引用
    Evidence: .sisyphus/evidence/task-22-full-build.txt
  ```

  **Commit**: YES — `feat(fw): main loop integration with FreeRTOS task scheduling`
  - Files: `firmware/main/main.c`

- [ ] 22.5. **固件: HAL Mock测试（主机侧运行）**

  **What to do**:
  - 创建 `firmware/test/host/` 目录，用于在开发机（无硬件）上运行固件逻辑测试
  - 创建硬件抽象层Mock：
    - `mocks/mock_adc.h/c` — 模拟ADC读取（可注入指定电压值）
    - `mocks/mock_ledc.h/c` — 模拟LEDC占空比（记录设置值供断言）
    - `mocks/mock_pcnt.h/c` — 模拟PCNT脉冲计数（注入RPM值）
    - `mocks/mock_i2c.h/c` — 模拟I2C响应（注入BME280寄存器数据）
    - `mocks/mock_rmt.h/c` — 模拟RMT输出（DS18B20/WS2812B时序存根）
  - 编写主机侧测试（使用CMake + Unity，不依赖ESP-IDF）:
    - `test_fan_curve_host.c`：PID阶跃响应仿真、LUT插值边界、Anti-windup
    - `test_alert_manager_host.c`：所有告警规则触发路径、状态机转换、去重逻辑
    - `test_power_monitor_host.c`：分压比换算（含100kΩ+20kΩ 12V分压）
  - 创建 `firmware/test/host/CMakeLists.txt` 独立编译配置

  **Must NOT do**:
  - ❌ 不Mock所有函数（仅Mock真正的硬件I/O，保留纯逻辑代码原样）
  - ❌ 不替代板上Unity测试（两者互补）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T19,T20 (逻辑已稳定后补充)

  **Acceptance Criteria**:
  - [ ] `cd firmware/test/host && cmake . && make && ./run_tests` — 全部PASS
  - [ ] 至少3个Mock硬件驱动
  - [ ] 至少10个主机侧测试用例（PID/LUT/告警/分压）

  **QA Scenarios**:
  ```
  Scenario: 主机侧测试全部通过
    Tool: Bash
    Steps:
      1. cd firmware/test/host && cmake -B build && cmake --build build
      2. ./build/run_tests
    Expected Result: ALL TESTS PASSED, 0 failures
    Evidence: .sisyphus/evidence/task-22_5-host-tests.txt
  ```

  **Commit**: YES — `test(fw): HAL mock host-side unit tests`
  - Files: `firmware/test/host/`

- [ ] 23. **Go Agent: GPU + 系统监控采集器**

  **What to do**:
  - 实现 `internal/monitor/gpu.go`：
    - 调用 `nvidia-smi --query-gpu=... --format=csv,noheader` 采集GPU数据
    - 采集字段：温度、利用率、显存使用、功耗、风扇转速
    - JSON解析nvidia-smi输出
    - 容错：无NVIDIA GPU时优雅跳过（不崩溃）
  - 实现 `internal/monitor/system.go`：
    - CPU温度：读取 `/sys/class/thermal/thermal_zone*/temp` 或 `/sys/class/hwmon/`
    - CPU利用率：`/proc/stat` 解析（计算差值）
    - 内存使用：`/proc/meminfo` 解析
    - 磁盘使用：`syscall.Statfs` 系统调用
    - 系统负载：`/proc/loadavg`
  - 所有采集器实现统一接口：`type Collector interface { Collect() (MetricBatch, error) }`
  - 编写 `internal/monitor/*_test.go` 单元测试（mock nvidia-smi输出）

  **Must NOT do**:
  - ❌ 不依赖cgo（纯Go实现，便于交叉编译）
  - ❌ GPU监控失败不要导致整体崩溃

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T3

  **Acceptance Criteria**:
  - [ ] GPU采集：温度、利用率、显存、功耗、风扇转速
  - [ ] 系统采集：CPU温度、CPU利用率、内存、磁盘、负载
  - [ ] 无GPU时优雅降级（日志警告，继续运行）
  - [ ] `go build ./...` + `go test ./...` PASS

  **QA Scenarios**:
  ```
  Scenario: 采集器接口一致性
    Tool: Bash (grep)
    Steps:
      1. grep "Collector interface\|type Collector" agent/internal/monitor/*.go → 统一接口
      2. grep "nvidia-smi" agent/internal/monitor/gpu.go → GPU采集
      3. grep "thermal_zone\|hwmon\|cpu.*temp" agent/internal/monitor/system.go → CPU温度
    Expected Result: 统一接口 + GPU/系统双采集器
    Evidence: .sisyphus/evidence/task-23-collectors.txt

  Scenario: 编译和测试
    Tool: Bash
    Steps:
      1. cd agent && go build ./...
      2. go test ./... -v
    Expected Result: BUILD SUCCESS, TESTS PASSED
    Evidence: .sisyphus/evidence/task-23-build-test.txt
  ```

  **Commit**: YES — `feat(agent): GPU and system monitoring collectors`
  - Files: `agent/internal/monitor/gpu.go`, `agent/internal/monitor/system.go`, `agent/internal/monitor/*_test.go`

- [ ] 24. **Go Agent: MQTT发布/订阅 + USB中继**

  **What to do**:
  - 实现 `internal/mqtt/client.go`：
    - 基于 `paho.mqtt.golang` 连接MQTT Broker
    - 发布传感器数据：按T1协议格式，定时发布（间隔由config.yaml配置）
    - 订阅控制指令：`fan-controller/+/command/#` 通配订阅
    - 指令中继：收到MQTT指令 → 通过USB串口转发到ESP32
  - 实现 `internal/usb/relay.go`：
    - 打开USB-CDC串口（`/dev/ttyACM*` 或 `COM*`）
    - 发送JSON命令 + 读取JSON响应
    - 断线重连：串口断开后自动重试（指数退避）
  - 双向通信：USB→MQTT（ESP32上报数据转发到Broker），MQTT→USB（控制指令下发）
  - 设备状态心跳：定期发布Agent自身状态到MQTT
  - 编写 `internal/mqtt/*_test.go`, `internal/usb/*_test.go`

  **Must NOT do**:
  - ❌ 不实现新的MQTT Broker（使用外部Mosquitto/EMQX等）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 3, depends on T3,T16,T17,T23

  **Acceptance Criteria**:
  - [ ] MQTT连接 + 自动重连
  - [ ] 串口打开 + JSON命令/响应
  - [ ] 双向数据中继（USB↔MQTT）
  - [ ] `go build ./...` + `go test ./...` PASS

  **QA Scenarios**:
  ```
  Scenario: MQTT消息格式合规
    Tool: Bash (grep)
    Steps:
      1. grep "fan-controller/" agent/internal/mqtt/client.go → 命名空间
      2. grep "paho.mqtt\|MQTT" agent/internal/mqtt/client.go → paho库使用
      3. grep "serial\|usb\|CDC\|ttyACM" agent/internal/usb/relay.go → 串口中继
    Expected Result: MQTT+USB双通道实现
    Evidence: .sisyphus/evidence/task-24-mqtt-usb.txt
  ```

  **Commit**: YES — `feat(agent): MQTT publish/subscribe and USB-CDC relay`
  - Files: `agent/internal/mqtt/`, `agent/internal/usb/`, `agent/internal/*_test.go`

---

### Wave 4 — Web APP + PCB布局

- [ ] 25. **Go Agent: 配置/systemd/安装脚本**

  **What to do**:
  - 完善 `agent/config.yaml`：
    - `mqtt.broker`, `mqtt.port`, `mqtt.client_id`, `mqtt.topic_prefix`
    - `serial.port`, `serial.baud_rate`
    - `monitor.interval` (默认5s), `monitor.gpu_enabled` (默认true)
  - 完善 `agent/agent.service` systemd单元：
    - `After=network.target multi-user.target`
    - `Restart=always`, `RestartSec=10`
    - `User=nobody` (安全)
  - 创建 `agent/install.sh`：复制二进制 → `/usr/local/bin/smart-fan-agent`，复制service → `/etc/systemd/system/`，`systemctl enable`
  - 创建 `agent/Makefile`：`make build`, `make test`, `make install`

  **Must NOT do**:
  - ❌ 不要以root用户运行（systemd服务使用nobody用户）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 4, depends on T24

  **Acceptance Criteria**:
  - [ ] config.yaml包含所有必要配置项
  - [ ] agent.service可被systemd加载
  - [ ] install.sh自动化安装流程
  - [ ] `make build` 成功生成二进制

  **QA Scenarios**:
  ```
  Scenario: systemd配置验证
    Tool: Bash (grep)
    Steps:
      1. grep "After=network" agent/agent.service → 启动依赖
      2. grep "Restart=always" agent/agent.service → 自动重启
      3. grep "User=" agent/agent.service → 非root用户
    Expected Result: systemd配置安全可靠
    Evidence: .sisyphus/evidence/task-25-systemd.txt

  Scenario: 编译和打包
    Tool: Bash
    Steps:
      1. cd agent && make build
      2. ls -la build/smart-fan-agent → 二进制存在
    Expected Result: 可执行文件生成
    Evidence: .sisyphus/evidence/task-25-make-build.txt
  ```

  **Commit**: YES — `feat(agent): config, systemd unit, and install scripts`
  - Files: `agent/config.yaml`, `agent/agent.service`, `agent/install.sh`, `agent/Makefile`

- [ ] 26. **Web后端: API服务器 + MQTT客户端**

  **What to do**:
  - 实现 `web/backend/src/server.ts`：
    - Express HTTP服务器 (port 3001)
    - CORS配置（允许前端localhost:5173/vite）
    - WebSocket (ws库) 用于实时推送（传感器数据流）
  - 实现 `web/backend/src/mqtt.ts`：
    - 基于 `mqtt.js` 连接MQTT Broker
    - 订阅所有传感器Topic → 缓存最新值到内存Map
    - 通过WebSocket推送给前端（每2秒批量推送）
    - 发布控制指令：`fan-controller/{id}/command/fan` 等
  - 内存数据结构：
    ```typescript
    interface DeviceState {
      deviceId: string
      online: boolean
      lastSeen: number
      sensors: { bme280: SensorData, ds18b20: SensorData[], voltages: VoltageData }
      fans: FanState[]
      alerts: Alert[]
    }
    ```
  - 设备发现：监听 `fan-controller/+/status` 自动注册设备

  **Must NOT do**:
  - ❌ 不持久化数据到数据库（实时展示即可）
  - ❌ 不认证用户（内网使用场景）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 4, depends on T1,T4,T16

  **Acceptance Criteria**:
  - [ ] HTTP服务器 + WebSocket启动
  - [ ] MQTT连接 + 自动订阅 + 数据缓存
  - [ ] WebSocket实时推送（2秒间隔）
  - [ ] `npm run build` 通过

  **QA Scenarios**:
  ```
  Scenario: 服务器启动验证
    Tool: Bash
    Steps:
      1. cd web/backend && npx tsx src/server.ts &
      2. sleep 3 && curl http://localhost:3001/health → 200 OK
      3. kill %1
    Expected Result: 服务器启动并响应健康检查
    Failure Indicators: 端口冲突、导入错误
    Evidence: .sisyphus/evidence/task-26-server-start.txt

  Scenario: MQTT客户端代码验证
    Tool: Bash (grep)
    Steps:
      1. grep "mqtt.connect\|mqtt.*Client" web/backend/src/mqtt.ts → MQTT连接
      2. grep "fan-controller" web/backend/src/mqtt.ts → Topic订阅
      3. grep "WebSocket\|websocket\|ws" web/backend/src/server.ts → WebSocket
    Expected Result: MQTT + WebSocket双协议就绪
    Evidence: .sisyphus/evidence/task-26-mqtt-ws.txt
  ```

  **Commit**: YES — `feat(web): Express API server with MQTT client and WebSocket`
  - Files: `web/backend/src/server.ts`, `web/backend/src/mqtt.ts`

- [ ] 27. **Web后端: REST API端点**

  **What to do**:
  - 实现REST API路由：
    - `GET /api/devices` — 返回所有在线设备列表
    - `GET /api/devices/:id` — 返回设备完整状态
    - `GET /api/devices/:id/history?from=&to=` — 返回历史数据（远期数据由Go Agent存储时提供）
    - `POST /api/devices/:id/fan/:fanIdx` body: `{speed: 50}` — 设置风扇速度
    - `POST /api/devices/:id/fan/:fanIdx/curve` body: `{mode: "lut"|"pid", points: [...], pid: {...}}` — 风扇曲线配置
    - `POST /api/devices/:id/alert` body: `{rules: [...]}` — 告警规则配置
    - `POST /api/devices/:id/ota` body: `{url: "..."}` — 触发OTA更新
    - `POST /api/devices/:id/reboot` — 重启设备
  - API响应统一格式：
    ```json
    { "ok": true, "data": {...} } 或 { "ok": false, "error": "message" }
    ```
  - 参数校验（Zod schema验证每个端点输入）

  **Must NOT do**:
  - ❌ 不使用数据库（内存存储，重启丢失。历史数据功能预留接口）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 4, depends on T26

  **Acceptance Criteria**:
  - [ ] ≥8个REST端点
  - [ ] Zod参数校验（每个端点）
  - [ ] 统一JSON响应格式
  - [ ] `npm run build` 通过

  **QA Scenarios**:
  ```
  Scenario: API端点验证
    Tool: Bash (curl)
    Steps:
      1. curl http://localhost:3001/api/devices → JSON数组
      2. curl -X POST http://localhost:3001/api/devices/test/fan/0 -H "Content-Type: application/json" -d '{"speed":50}' → JSON响应
      3. curl http://localhost:3001/api/unknown → 404
    Expected Result: 端点响应正确JSON格式和状态码
    Evidence: .sisyphus/evidence/task-27-api-endpoints.txt

  Scenario: Zod验证存在
    Tool: Bash (grep)
    Steps:
      1. grep -c "z.object\|z.string\|z.number" web/backend/src/routes/*.ts → ≥5
      2. grep "safeParse\|parse" web/backend/src/routes/*.ts → Zod调用
    Expected Result: Zod验证应用于所有端点
    Evidence: .sisyphus/evidence/task-27-zod-validation.txt
  ```

  **Commit**: YES — `feat(web): REST API endpoints with Zod validation`
  - Files: `web/backend/src/routes/`

- [ ] 28. **Web前端: 仪表盘 + 风扇控制页**

  **What to do**:
  - 实现 `web/frontend/src/pages/Dashboard.tsx`：
    - 设备在线状态卡片（绿色/灰色指示）
    - 实时温度仪表盘（BME280 + DS18B20，recharts Gauge图或弧形仪表）
    - 风扇状态卡片（每路风扇: 转速RPM + 占空比% 条形图）
    - 电压监控面板（12V/5V/3.3V，数值+进度条）
    - 告警通知横幅（最近告警，红色/黄色背景）
    - WebSocket连接实时数据刷新（2秒间隔）
  - 实现 `web/frontend/src/pages/Fans.tsx`：
    - 4路风扇独立控制滑块（0%-100%，实时生效）
    - AUTO/MANUAL模式切换
    - 风扇曲线可视化编辑器（recharts LineChart，拖拽编辑温度-转速点）
    - PID参数配置面板（Kp/Ki/Kd + Setpoint）
    - 温度源选择（板载BME280 / DS18B20 / GPU）
  - 编写组件 `TemperatureGauge`, `FanCard`, `VoltageBar`, `CurveEditor`
  - WebSocket Hook：`useWebSocket(url)` 封装

  **Must NOT do**:
  - ❌ 不使用Redux/Zustand（数据从WebSocket直接获取，无需全局状态）
  - ❌ 不实现历史图表（T29的职责）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: `[]`

  **Parallelization**: Wave 4, depends on T4,T27

  **Acceptance Criteria**:
  - [ ] Dashboard页面：温度仪表 + 风扇状态 + 电压 + 告警
  - [ ] Fans页面：滑块调速 + AUTO/MANUAL + 曲线编辑器 + PID面板
  - [ ] WebSocket实时更新（2秒间隔）
  - [ ] `npm run build` 通过

  **QA Scenarios**:
  ```
  Scenario: Dashboard渲染 (Playwright)
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:5173/
      2. Wait for page to load (timeout: 5s)
      3. Assert: page contains "Dashboard" or "仪表盘"
      4. Assert: at least 1 temperature gauge component rendered
      5. Screenshot: dashboard-loaded.png
    Expected Result: Dashboard完整渲染
    Evidence: .sisyphus/evidence/task-28-dashboard.png

  Scenario: 风扇控制页渲染 (Playwright)
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:5173/fans
      2. Assert: 4 fan control sliders visible
      3. Assert: AUTO/MANUAL toggle exists
      4. Assert: curve editor area visible
    Expected Result: 风扇控制页面完整
    Evidence: .sisyphus/evidence/task-28-fans.png
  ```

  **Commit**: YES — `feat(web): dashboard and fan control pages with WebSocket`
  - Files: `web/frontend/src/pages/Dashboard.tsx`, `web/frontend/src/pages/Fans.tsx`, `web/frontend/src/components/`

- [ ] 29. **Web前端: 告警配置 + 历史 + 设备管理**

  **What to do**:
  - 实现 `web/frontend/src/pages/Alerts.tsx`：
    - 告警规则列表（温度/风扇/电压/WiFi，每类可开关+配置阈值）
    - 告警历史时间线（最近100条）
    - 通知设置面板
  - 实现 `web/frontend/src/pages/History.tsx`：
    - 时间范围选择器（1h/6h/24h/7d）
    - 多传感器温度趋势图（recharts LineChart，多线叠加）
    - 风扇转速历史图
    - 数据导出按钮（CSV下载）
  - 实现 `web/frontend/src/pages/Devices.tsx`：
    - 设备列表（名称/ID/在线状态/IP/固件版本）
    - OTA固件更新触发（URL输入 + 进度条）
    - 设备重启按钮（确认对话框）
    - WiFi配置编辑
  - 编写组件：`AlertRuleEditor`, `TimeRangeSelector`, `DeviceCard`, `OTAProgress`

  **Must NOT do**:
  - ❌ 不修改后端API（使用T27已实现的端点）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: `[]`

  **Parallelization**: Wave 4, depends on T4,T27

  **Acceptance Criteria**:
  - [ ] Alerts页面：规则编辑 + 历史时间线
  - [ ] History页面：图表 + 时间范围 + CSV导出
  - [ ] Devices页面：列表 + OTA + 重启 + WiFi配置
  - [ ] `npm run build` 通过

  **QA Scenarios**:
  ```
  Scenario: 告警页面渲染 (Playwright)
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:5173/alerts
      2. Assert: alert rules section visible
      3. Assert: at least one toggle/switch for enable/disable
    Expected Result: 告警配置页面完整
    Evidence: .sisyphus/evidence/task-29-alerts.png

  Scenario: 历史页面图表 (Playwright)
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:5173/history
      2. Assert: chart/line area visible
      3. Assert: time range buttons present (1h/6h/24h/7d)
    Expected Result: 历史图表页面完整
    Evidence: .sisyphus/evidence/task-29-history.png
  ```

  **Commit**: YES — `feat(web): alerts, history, and device management pages`
  - Files: `web/frontend/src/pages/Alerts.tsx`, `web/frontend/src/pages/History.tsx`, `web/frontend/src/pages/Devices.tsx`, `web/frontend/src/components/`

- [ ] 30. **PCB布局: 元件布局 + 布线 + Gerber导出**

  **What to do**:
  - 基于T5-T8原理图，在KiCad/EasyEDA中完成PCB布局
  - 元件布局原则：
    - 电源区（SATA接口 → LDO → 风扇座）在板边缘，粗走线(≥1mm)
    - ESP32核心在中央，天线区域留空(≥15mm无铜皮)
    - 传感器在板边（DS18B20端子靠近边缘，BME280远离热源）
    - Type-C USB在板边
    - 按键 + RGB LED在板边（便于操作和观察）
  - 布线规则：
    - 12V风扇电源：≥1.5mm走线宽度（4风扇×0.5A=2A）
    - 5V电源：≥1mm走线宽度
    - 3.3V数字信号：0.25mm标准走线
    - 差分对：USB D+/D-等长等距布线
    - I2C(SCL/SDA)：短走线，远离高功率区域
    - OneWire(DS18B20)：远离噪声源
    - 模拟地(AGND)与数字地(DGND)分离，单点连接
  - 覆铜：底层完整GND覆铜，顶层局部GND覆铜
  - 丝印标注：接口名称、GPIO编号、版本号
  - 生成Gerber文件 + 钻孔文件 + BOM + 坐标文件（Pick-and-Place）
  - DRC检查通过（设计规则检查）

  **Must NOT do**:
  - ❌ 天线区域不走线/不覆铜（ESP32-S3天线性能要求）
  - ❌ 12V大电流不走细线（发热烧毁风险）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 4, depends on T5-T8

  **Acceptance Criteria**:
  - [ ] PCB布局完成（.kicad_pcb或.json）
  - [ ] DRC检查无错误
  - [ ] Gerber文件（.gbr + .drl）在 `hardware/gerber/`
  - [ ] BOM.csv更新（含封装和LCSC编号）
  - [ ] 天线区域≥15mm×15mm无铜皮

  **QA Scenarios**:
  ```
  Scenario: Gerber文件完整性
    Tool: Bash (ls + grep)
    Steps:
      1. ls hardware/gerber/*.gbr → ≥6个Gerber层文件
      2. ls hardware/gerber/*.drl → 钻孔文件存在
    Expected Result: 可交付制板的Gerber包
    Failure Indicators: 缺少层文件
    Evidence: .sisyphus/evidence/task-30-gerber-files.txt

  Scenario: 天线区域约束检查
    Tool: Bash (grep)
    Steps:
      1. grep "ANTENNA\|antenna.*keepout\|15mm\|天线" hardware/*.kicad_pcb → 天线约束标注
    Expected Result: 天线区域设计约束记录在案
    Evidence: .sisyphus/evidence/task-30-antenna-keepout.txt
  ```

  **Commit**: YES — `feat(hw): PCB layout, routing, and Gerber export`
  - Files: `hardware/*.kicad_pcb`, `hardware/gerber/`, `hardware/BOM.csv`

---

### Wave 5 — 集成 + Home Assistant + 文档

- [ ] 31. **Home Assistant MQTT自动发现配置**

  **What to do**:
  - 创建 `ha/` 目录 + YAML配置文件
  - MQTT Discovery配置（自动创建HA实体）：
    - `ha/sensors.yaml` — 温度(BME280/DS18B20/GPU/CPU)、湿度、气压、电压(12V/5V/3.3V)
    - `ha/fans.yaml` — 4路风扇（百分比调速 + RPM反馈 + 开关）
    - `ha/alerts.yaml` — 二进制传感器（温度告警/风扇停转/电压异常/WiFi断开）
    - `ha/device.yaml` — 设备在线状态 + 固件版本
  - 每个实体的Discovery消息格式：
    ```json
    {
      "name": "Fan Controller - Temperature",
      "state_topic": "fan-controller/abc123/sensor/bme280",
      "value_template": "{{ value_json.temperature }}",
      "unit_of_measurement": "°C",
      "device_class": "temperature",
      "unique_id": "fan_ctrl_abc123_temp",
      "device": { "identifiers": ["fan_ctrl_abc123"], "name": "Smart Fan Controller", "manufacturer": "DIY" }
    }
    ```
  - 编写 `ha/README.md`：HA集成步骤（安装Mosquitto → 复制YAML → 重启HA）
  - 测试：在固件模拟环境下验证Discovery消息格式

  **Must NOT do**:
  - ❌ 不依赖HA插件或Custom Component（纯MQTT Discovery标准协议）
  - ❌ 不使用HA API（仅MQTT协议）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: Wave 5, depends on T1

  **Acceptance Criteria**:
  - [ ] ≥4类实体配置（温度/风扇/告警/设备）
  - [ ] 所有实体遵循HA MQTT Discovery规范
  - [ ] Discovery消息JSON可被HA正确解析

  **QA Scenarios**:
  ```
  Scenario: Discovery消息格式验证
    Tool: Bash (grep + jq)
    Steps:
      1. grep -c "state_topic" ha/sensors.yaml → ≥5
      2. grep -c "unique_id" ha/sensors.yaml → ≥5
      3. grep -c "device_class" ha/sensors.yaml → ≥3
    Expected Result: HA Discovery规范合规
    Evidence: .sisyphus/evidence/task-31-ha-discovery.txt

  Scenario: README步骤完整性
    Tool: Bash (grep)
    Steps:
      1. grep "Mosquitto\|MQTT.*Broker" ha/README.md → Broker安装
      2. grep "重启\|restart" ha/README.md → 重启步骤
    Expected Result: 集成指南完整
    Evidence: .sisyphus/evidence/task-31-readme.txt
  ```

  **Commit**: YES — `feat(ha): Home Assistant MQTT auto-discovery configuration`
  - Files: `ha/`

- [ ] 32. **端到端: 固件 ↔ Go Agent ↔ MQTT**

  **What to do**:
  - 集成测试脚本：启动Mosquitto → 烧录固件 → 运行Go Agent
  - 验证数据流：
    1. 固件发布MQTT传感器数据 → Go Agent订阅并缓存
    2. Go Agent发布GPU/系统数据 → 验证Topic和JSON格式
    3. Go Agent通过USB发送命令 → 固件接收并响应
  - 异常场景测试：
    - WiFi断开 → 固件重连 → 离线队列消息补发
    - USB串口拔插 → Go Agent自动重连
    - MQTT Broker重启 → 双方自动重连
  - 创建 `test/e2e/` 目录 + `integration_test.sh` 脚本（自动化验证）

  **Must NOT do**:
  - ❌ 不需要模拟真实硬件传感器（用mock数据测试协议流）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 5, depends on T22,T24

  **Acceptance Criteria**:
  - [ ] MQTT数据流：固件→Agent方向正常
  - [ ] MQTT数据流：Agent→固件方向正常（命令中继）
  - [ ] 离线/断连恢复测试通过
  - [ ] `test/e2e/integration_test.sh` 自动化脚本

  **QA Scenarios**:
  ```
  Scenario: MQTT端到端数据流
    Tool: Bash (mosquitto_sub + 脚本)
    Steps:
      1. Start mosquitto broker
      2. Subscribe: mosquitto_sub -t "fan-controller/+/sensor/#" -v -C 5
      3. Verify: 5 messages received with valid JSON
      4. Verify: each message has timestamp and device_id fields
    Expected Result: 5条有效JSON消息
    Evidence: .sisyphus/evidence/task-32-e2e-mqtt.txt
  ```

  **Commit**: YES — `test(e2e): firmware-agent-MQTT integration tests`
  - Files: `test/e2e/`

- [ ] 33. **端到端: Web APP ↔ MQTT ↔ 固件**

  **What to do**:
  - 集成测试：Web后端连接MQTT → Web前端连接WebSocket → 模拟固件MQTT消息
  - 验证：
    1. Dashboard实时数据显示（WebSocket推送验证）
    2. 风扇控制：前端滑块 → API → MQTT → 验证Topic和Payload
    3. 曲线配置：前端编辑 → API → MQTT → 验证保存到固件NVS
    4. OTA触发：前端URL输入 → API → MQTT → 验证固件开始下载
  - 创建 `test/e2e/web_integration_test.sh`
  - 使用Playwright录制：Dashboard加载 → 风扇调速 → 曲线编辑 → 告警配置

  **Must NOT do**:
  - ❌ 不测试固件的实际OTA下载（仅验证MQTT指令到达）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 5, depends on T28,T29,T31

  **Acceptance Criteria**:
  - [ ] WebSocket实时数据流验证
  - [ ] 前后端控制链路（前端→API→MQTT）验证
  - [ ] Playwright录制回放通过

  **QA Scenarios**:
  ```
  Scenario: 控制链路端到端 (Playwright + mosquitto_sub)
    Tool: Playwright + Bash
    Steps:
      1. Playwright: Navigate to /fans
      2. Playwright: Drag slider to 75%
      3. Bash: mosquitto_sub -t "fan-controller/+/command/fan" -C 1
      4. Verify: message contains {"speed": 75}
    Expected Result: UI操作转化为正确的MQTT指令
    Evidence: .sisyphus/evidence/task-33-control-flow.json
  ```

  **Commit**: YES — `test(e2e): web-app-MQTT-firmware integration tests`
  - Files: `test/e2e/`

- [ ] 34. **全系统冒烟测试**

  **What to do**:
  - 完整部署模拟环境：
    1. 启动Mosquitto MQTT Broker
    2. 烧录固件（或使用模拟器）
    3. 启动Go Agent
    4. 启动Web后端 + 前端
  - 冒烟测试检查清单：
    - [ ] 固件WiFi连接 + MQTT连接成功
    - [ ] 固件传感器数据每1秒发布MQTT
    - [ ] Go Agent启动 + MQTT连接
    - [ ] Go Agent发布GPU/系统数据
    - [ ] Web后端订阅所有Topic
    - [ ] Web前端WebSocket连接 + Dashboard数据刷新
    - [ ] 风扇控制：前端调速 → MQTT → 固件PWM输出变化
    - [ ] 告警：模拟温度超阈值 → LED状态变化 + MQTT告警消息
    - [ ] 历史数据：Flash循环日志写入 + 读取
    - [ ] OTA流程：MQTT触发 → 分区切换 → 重启
    - [ ] HA Discovery：新设备上线 → MQTT Discovery消息发布
  - 创建 `test/smoke_test.sh` 全自动化冒烟测试脚本

  **Must NOT do**:
  - ❌ 不跳过任何检查点（全部必须PASS）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: Wave 5, depends on T32,T33

  **Acceptance Criteria**:
  - [ ] 12+检查点全部PASS
  - [ ] 自动化脚本 `smoke_test.sh` 可重复运行
  - [ ] 每个FAIL有明确错误信息和日志

  **QA Scenarios**:
  ```
  Scenario: 全系统冒烟测试
    Tool: Bash
    Steps:
      1. chmod +x test/smoke_test.sh
      2. ./test/smoke_test.sh 2>&1 | tee .sisyphus/evidence/task-34-smoke.log
      3. grep -c "PASS" .sisyphus/evidence/task-34-smoke.log → ≥12
      4. grep "FAIL" .sisyphus/evidence/task-34-smoke.log → 0
    Expected Result: 全部检查点PASS, 0 FAIL
    Failure Indicators: 任何FAIL
    Evidence: .sisyphus/evidence/task-34-smoke.log
  ```

  **Commit**: YES — `test: full system smoke test`
  - Files: `test/smoke_test.sh`

- [ ] 35. **文档: 部署指南 + 硬件组装指南**

  **What to do**:
  - 编写 `docs/deploy.md`：
    - 系统架构图和组件说明
    - 先决条件（MQTT Broker安装、Go编译器、Node.js）
    - 固件烧录步骤（esptool命令 + 接线说明）
    - Go Agent安装步骤（make install + systemctl enable）
    - Web APP部署步骤（npm install + npm run build + nginx反向代理配置）
    - Home Assistant集成步骤
    - 首次配网流程（按键触发AP → 浏览器配网）
    - 故障排查FAQ
  - 编写 `docs/hardware-assembly.md`：
    - BOM采购清单（含LCSC编号和淘宝备用链接）
    - 焊接顺序（先焊接电源 → 再焊接ESP32核心 → 最后传感器和接口）
    - SATA供电连接说明
    - 风扇连接说明（Pin定义：GND/12V/Tach/PWM）
    - Type-C注意事项
    - 上电前检查清单（短路测试、极性确认）
  - 在README.md中添加文档导航链接

  **Must NOT do**:
  - ❌ 不编写API文档（Swagger/OpenAPI用代码注释生成）
  - ❌ 不编写开发者贡献指南（非开源协作项目）

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: `[]`

  **Parallelization**: Wave 5, depends on T34

  **Acceptance Criteria**:
  - [ ] `docs/deploy.md` — 5+章节，含命令示例
  - [ ] `docs/hardware-assembly.md` — BOM + 焊接顺序 + 上电检查
  - [ ] README.md 含文档导航

  **QA Scenarios**:
  ```
  Scenario: 文档完整性
    Tool: Bash (grep)
    Steps:
      1. wc -l docs/deploy.md → ≥80行
      2. grep -c "##" docs/deploy.md → ≥5个章节
      3. grep -c "##" docs/hardware-assembly.md → ≥5个章节
      4. grep "esptool\|烧录\|flash" docs/deploy.md → 固件烧录步骤
    Expected Result: 两篇文档结构完整，含实操步骤
    Evidence: .sisyphus/evidence/task-35-docs.txt
  ```

  **Commit**: YES — `docs: deployment guide and hardware assembly guide`
  - Files: `docs/deploy.md`, `docs/hardware-assembly.md`, `README.md`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `idf.py build` + `go build ./...` + `go test ./...` + `npm run build` + `npm test`. Review all changed files for: AI slop patterns, unused imports, magic numbers, hardcoded credentials. Check firmware: stack sizes, ISR safety, FreeRTOS task priorities.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration. Verify MQTT message flow end-to-end. Test Web APP with Playwright: dashboard loads, fan control works, alert config saves.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **T1-T4** (Wave 1 foundation): `chore: project scaffolding and protocol spec` — README.md, protocol.md, scaffold files
- **T5-T8** (Hardware schematics): `feat(hw): power, fan, sensor, and protection schematics` — hardware/*.sch
- **T9-T16** (Firmware drivers): Individual commits per driver — `feat(fw): [driver name] driver`
- **T17-T22** (Firmware integration): `feat(fw): USB console, storage, fan curves, alerts, OTA, main loop`
- **T23-T25** (Go Agent): `feat(agent): GPU/system monitors, MQTT, config, systemd`
- **T26-T29** (Web APP): `feat(web): API server, endpoints, dashboard, controls`
- **T30** (PCB Layout): `feat(hw): PCB layout and Gerber export`
- **T31-T35** (Integration + HA + Docs): `feat: HA integration, e2e tests, documentation`
- **F1-F4** (Verification): `chore: final verification wave`

---

## Success Criteria

### Verification Commands
```bash
# Firmware
cd firmware && idf.py build                        # Expected: BUILD SUCCESS
cd firmware && idf.py test                         # Expected: ALL TESTS PASSED

# Go Agent
cd agent && go build ./...                         # Expected: no errors
cd agent && go test ./...                          # Expected: PASS
cd agent && go vet ./...                           # Expected: no warnings

# Web APP
cd web && npm install && npm run build             # Expected: BUILD SUCCESS
cd web && npm test                                 # Expected: ALL TESTS PASSED

# PCB
# Gerber files present in hardware/gerber/
# BOM present in hardware/BOM.csv
```

### Final Checklist
- [ ] 4路PWM风扇25kHz，可独立控制
- [ ] 转速反馈正确读取（RPM计算）
- [ ] BME280温度/湿度/气压数据正确
- [ ] DS18B20远程探头温度正确
- [ ] SATA 5V → 3.3V LDO，电压监控正常
- [ ] 风扇停转检测 + 断电保护工作
- [ ] WiFi MQTT稳定连接（含断线重连）
- [ ] USB-CDC串口双向通信正常
- [ ] 风扇曲线：固定查表 + PID双模式可选
- [ ] Go Agent: GPU温度(nvidia-smi) + 系统状态采集
- [ ] Web APP仪表盘实时数据刷新
- [ ] OTA固件更新功能可用
- [ ] Home Assistant自动发现实体
- [ ] 所有"Must NOT Have"确认未实现
