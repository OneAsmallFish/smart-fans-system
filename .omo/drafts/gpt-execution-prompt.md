# Smart Fan Controller — GPT 执行提示词

> 将此提示词完整复制给 GPT（ChatGPT/Claude/Gemini 等），即可启动执行。
> 完整工作计划见 `.sisyphus/plans/smart-fan-controller.md`（2122行，35任务+4审查）。

---

## 项目概述

构建一个基于 ESP32-S3 的**服务器智能风扇控制系统**，包含：

| 子系统 | 技术栈 | 目录 |
|--------|--------|------|
| 硬件PCB | KiCad/EasyEDA | `hardware/` |
| 固件 | ESP-IDF v5.x (C) | `firmware/` |
| Linux Agent | Go | `agent/` |
| Web控制中心 | React + Express + TypeScript | `web/` |
| 智能家居 | Home Assistant MQTT | `ha/` |
| 文档 | Markdown | `docs/` |

**工作区**: `E:\My_Opjects\smart-fans-system`（空项目，从零开始）

---

## 第一步：阅读完整计划

首先阅读 `.sisyphus/plans/smart-fan-controller.md`，理解：
- **Context** 部分：需求背景、Metis发现的5个致命硬件错误（必须规避）
- **米家接入可行性分析**：为什么直接接入不可行，HA桥接替代方案
- **Medication项目经验**：6个ESP-IDF v5.x陷阱 + 9个可复用代码模式
- **Dependency Matrix**：任务间依赖关系

---

## 🚨 执行前必读：致命错误清单

以下错误会导致硬件损坏或固件崩溃，**绝对禁止**：

| # | 禁止行为 | 正确做法 |
|---|---------|---------|
| 1 | SATA Pin3接3.3V | Pin3是PWDIS信号，悬空！3.3V从5V经AMS1117 LDO获取 |
| 2 | ESP32 GPIO直驱风扇PWM | 必须经74AHCT125做3.3V→5V电平转换 |
| 3 | Tach上拉3.3V | 必须10kΩ上拉5V + 分压回3.3V |
| 4 | 使用ADC2通道 | 仅用ADC1（ADC2与WiFi冲突） |
| 5 | Type-C无CC下拉 | CC1/CC2各5.1kΩ到GND |
| 6 | `uint32_t`接收`esp_timer_get_time()` | 必须`int64_t`（64位计数器72分钟后溢出32位） |
| 7 | SNTP在`WIFI_EVENT_STA_CONNECTED`启动 | 必须在`IP_EVENT_STA_GOT_IP`（DHCP先完成） |
| 8 | WiFi事件处理器内调`esp_mqtt_client_start()` | 递归锁死锁！用FreeRTOS Timer延迟执行 |
| 9 | `sscanf`解析JSON | 始终用`cJSON`库 |
| 10 | FreeRTOS任务栈<4096字节 | WiFi/BLE回调消耗大栈空间 |

---

## 执行策略：5波次并行

```
Wave 1 (立即并行8任务): 协议规范 + 4个项目脚手架 + 4张硬件原理图
Wave 2 (Wave1完成后并行8任务): 固件核心驱动（电源/PWM/Tach/BME280/DS18B20/LED/WiFi/MQTT）
Wave 3 (Wave2完成后并行8任务): 固件集成 + Go Agent
Wave 4 (Wave3完成后6任务): Web APP + PCB布局
Wave 5 (Wave4完成后5任务): 集成测试 + HA配置 + 文档
FINAL (Wave5完成后4并行审查): Oracle + 代码质量 + QA + 范围检查
```

---

## 现在开始 Wave 1（8个并行任务）

### T1: MQTT协议规范 + 项目README

**输出文件**: `docs/protocol.md`, `README.md`, `.gitignore`

**做什么**:
1. 创建 `docs/protocol.md`，定义MQTT Topic Schema：
   - 命名空间: `fan-controller/{device_id}/...`
   - 至少6类Topic: sensor, status, command, alert, config, ota
   - 所有JSON消息包含 `timestamp` 和 `device_id` 字段
   - 风扇控制指令格式: `{"fan_index": 0, "speed": 75}`
   - Home Assistant MQTT Discovery兼容格式
2. 创建 `README.md`：ASCII架构图 + 目录结构 + 快速开始
3. 创建 `.gitignore`：忽略 ESP-IDF build, Go vendor, node_modules, gerber文件

**必须包含的Topic示例**:
```
fan-controller/{id}/sensor/bme280          → {temp, humidity, pressure, timestamp}
fan-controller/{id}/sensor/ds18b20/{n}     → {temp, timestamp}
fan-controller/{id}/status                  → {online, wifi_rssi, uptime, firmware_version}
fan-controller/{id}/fan/{n}/status          → {duty, rpm}
fan-controller/{id}/command/fan             → {fan_index, speed} or {fan_index, mode: "auto"}
fan-controller/{id}/alert                   → {level, type, message, timestamp}
fan-controller/{id}/command/ota             → {url, version, checksum}
```

---

### T2: ESP-IDF固件项目脚手架

**输出目录**: `firmware/`

**做什么**:
1. `idf.py create-project firmware` 目标芯片 esp32s3
2. 配置 `CMakeLists.txt`：添加组件 ledc, pcnt, i2c, adc, nvs_flash, spi_flash, wifi, mqtt, esp_https_ota
3. 创建 `partitions.csv`：
   ```csv
   nvs,      data, nvs,     0x9000,  0x6000,
   phy_init, data, phy,     0xf000,  0x1000,
   factory,  app,  factory, 0x10000, 0x200000,
   ota_0,    app,  ota_0,   0x210000,0x200000,
   ota_1,    app,  ota_1,   0x410000,0x200000,
   storage,  data, fat,     0x610000,0x40000,
   coredump, data, coredump,0x650000,0x10000,
   ```
4. 创建 `sdkconfig.defaults`（参考 Medication 项目的配置模板）：
   - `CONFIG_FREERTOS_HZ=1000`
   - `CONFIG_ESP_MAIN_TASK_STACK_SIZE=8192`
   - WiFi STA启用，SoftAP禁用
   - NVS启用，Wear Levelling启用
   - `CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y`
   - `CONFIG_PARTITION_TABLE_CUSTOM=y`
5. 创建 `components/` 目录结构（每个驱动作为独立component）
6. 创建 `main/main.c` 入口骨架：init_nvs → init_wifi → init_mqtt → 创建FreeRTOS任务
7. 创建 `test/` 目录，配置Unity测试框架

**验证**: `cd firmware && idf.py set-target esp32s3 && idf.py build` → BUILD SUCCESS

---

### T3: Go Agent项目脚手架

**输出目录**: `agent/`

**做什么**:
1. `go mod init github.com/user/smart-fan-agent`
2. 创建目录结构:
   ```
   agent/
   ├── cmd/agent/main.go
   ├── internal/
   │   ├── monitor/     (gpu.go, system.go)
   │   ├── mqtt/        (client.go)
   │   ├── config/      (config.go)
   │   └── usb/         (relay.go)
   ├── config.yaml
   ├── agent.service
   └── Makefile
   ```
3. 添加依赖: `github.com/eclipse/paho.mqtt.golang`, `gopkg.in/yaml.v3`
4. 配置模板：
   ```yaml
   mqtt:
     broker: "tcp://localhost:1883"
     client_id: "smart-fan-agent"
     topic_prefix: "fan-controller"
   serial:
     port: "/dev/ttyACM0"
     baud_rate: 115200
   monitor:
     interval: 5
     gpu_enabled: true
   ```
5. systemd unit: `After=network.target`, `Restart=always`, `User=nobody`
6. `cmd/agent/main.go` 入口：加载配置 → 初始化MQTT → 初始化监控 → 启动

**验证**: `cd agent && go build ./cmd/agent/` → 无错误

---

### T4: Web APP项目脚手架

**输出目录**: `web/`

**做什么**:
1. 前端: `npm create vite@latest frontend -- --template react-ts`
2. 后端: 创建 `backend/`，Express + TypeScript
3. 项目结构:
   ```
   web/
   ├── frontend/
   │   ├── src/
   │   │   ├── pages/   (Dashboard, Fans, Alerts, History, Devices)
   │   │   ├── components/
   │   │   └── hooks/   (useWebSocket)
   │   └── package.json
   └── backend/
       ├── src/
       │   ├── server.ts
       │   ├── mqtt.ts
       │   └── routes/
       └── package.json
   ```
4. 前端依赖: react-router-dom, recharts, @emotion/react
5. 后端依赖: express, mqtt, cors, ws, zod, tsx
6. Vite代理配置: `/api` → `localhost:3001`
7. 5个路由占位组件: `/`, `/fans`, `/alerts`, `/history`, `/devices`

**验证**: `cd web/frontend && npm install && npm run build` + `cd web/backend && npm install && npx tsx src/server.ts`

---

### T5-T8: 硬件原理图（4张，可并行）

> **使用 KiCad 或 EasyEDA。原理图务必包含以下细节。**

#### T5: 电源 + ESP32核心原理图 → `hardware/power.sch` + `hardware/esp32-core.sch`

- **SATA 15pin**: Pin3=PWDIS标注为NC(不连接)，注释说明原因
- **5V → 3.3V**: AMS1117-3.3 LDO，输入/输出各100μF电解+100nF陶瓷
- **断电保护**: 12V轨并联470μF-1000μF电解电容
- **ESP32-S3核心**: 40MHz晶振 + 所有VDD引脚100nF去耦 + EN上拉10kΩ+100nF延时
- **Type-C USB**: CC1/CC2各5.1kΩ到GND，D+/D-直连ESP32 USB-OTG (IO19/IO20)
- **电压分压监控** (仅用ADC1):
  - 12V: 10kΩ+3.3kΩ分压 → ADC1_CHx
  - 5V: 10kΩ+10kΩ分压 → ADC1_CHx
  - 3.3V: 10kΩ+10kΩ分压 → ADC1_CHx
- BOM含AMS1117、电阻、电容封装

#### T6: 风扇驱动电路 → `hardware/fan-driver.sch`

- 4路4Pin风扇座: Pin1=GND, Pin2=12V, Pin3=TACH, Pin4=PWM
- **PWM电平转换**: ESP32 GPIO → 74AHCT125 (VCC=5V) → 风扇PWM
- **Tach反馈**: 风扇Tach → 10kΩ上拉5V → 2.2kΩ+3.3kΩ分压 → ESP32 GPIO
- GPIO分配在注释中标注（4 PWM + 4 Tach = 8 GPIO）

#### T7: 传感器 + I/O → `hardware/sensors-io.sch`

- **BME280**: I2C (SCL+SDA各4.7kΩ上拉3.3V)，SDO=GND(地址0x76)
- **DS18B20接口** ×2: 3Pin端子，DQ上拉4.7kΩ到3.3V，ESD TVS管保护
- **WS2812B-2020 RGB LED**: 单GPIO控制RMT，VCC=5V+100nF去耦
- **按键** ×2: 配网键(IO0)+重置键(EN)，各10kΩ上拉

#### T8: 保护 + 监控电路 → `hardware/protection.sch`

- 12V+5V各加自恢复保险丝（12V:2A, 5V:1A）
- 肖特基二极管防反接
- Type-C D+/D-加TVS管(SRV05-4)
- 风扇Tach、DS18B20 DQ加TVS管
- ADC分压点各100nF滤波电容
- 可选ADS1115 I2C ADC焊盘
- AMS1117散热标注（~0.85W功耗，TO-252封装或铜皮散热）

---

## 执行规则

1. **严格按波次执行**: Wave 1 全部完成后才能开始 Wave 2
2. **波次内最大并行**: Wave 1 的8个任务可以完全并行执行
3. **每个任务完成后**: 运行其QA Scenarios验证，保存证据到 `.sisyphus/evidence/`
4. **Git提交**: 每个任务完成后按commit message格式提交
5. **遇到问题**: 参考 `Medication-Reminder-System\.sisyphus\session-summary.md` 中的经验和解决方案
6. **完整计划**: 任何时候不确定任务细节，阅读 `.sisyphus/plans/smart-fan-controller.md` 中对应任务的完整说明

---

## 快速启动命令

```bash
# 确认工作区
cd E:\My_Opjects\smart-fans-system

# 创建目录结构
mkdir -p docs firmware/components firmware/main firmware/test
mkdir -p agent/cmd/agent agent/internal/{monitor,mqtt,config,usb}
mkdir -p web/frontend/src/{pages,components,hooks}
mkdir -p web/backend/src/routes
mkdir -p hardware test/e2e ha

# 开始执行 Wave 1 的 8 个任务
# T1: 先写协议文档（其他任务依赖）
# T2-T4: 项目脚手架（可并行）
# T5-T8: 硬件原理图（可并行）
```

---

> **下一步**: Wave 1 全部完成后，告诉我"Wave 1完成"，我会提供 Wave 2 的详细执行提示词。
