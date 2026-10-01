<div align="center">

# 🌀 Smart Fan Controller

**服务器智能风扇控制系统**

*ESP32-S3 powered server fan management — 8-channel PWM, multi-sensor, MQTT, Web dashboard, Home Assistant*

[![ESP-IDF](https://img.shields.io/badge/ESP--IDF-v5.3%2B-E7352C?logo=espressif&logoColor=white)](https://github.com/espressif/esp-idf)
[![Go](https://img.shields.io/badge/Go-1.22%2B-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![MQTT](https://img.shields.io/badge/MQTT-3.1.1-660066?logo=mqtt&logoColor=white)](https://mqtt.org)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-MQTT%20Packages-41BDF5?logo=homeassistant&logoColor=white)](https://www.home-assistant.io)
[![License](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)
[![PCB](https://img.shields.io/badge/PCB-99×99mm_4Layer-f59e0b)](hardware/)

[🌐 Project Page](https://oneasmallfsh.github.io/smart-fans-system/) · [📖 Deploy Guide](docs/deploy.md) · [🔧 Hardware Guide](docs/hardware-assembly.md) · [📡 MQTT Protocol](docs/protocol.md)

</div>

---

## 目录 / Contents

- [功能特性](#-功能特性)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
- [硬件规格](#-硬件规格)
- [软件组件](#-软件组件)
- [Web 控制台](#-web-控制台)
- [Home Assistant 集成](#-home-assistant-集成)
- [项目结构](#-项目结构)
- [开发指南](#-开发指南)
- [许可证](#-许可证)

---

## 🏗️ 系统架构

```
┌──────────────────────────────────── 服务器机柜 ─────────────────────────────────────┐
│                                                                                      │
│  ┌─────────────────────────────┐     USB-CDC      ┌──────────────────────────────┐  │
│  │     ESP32-S3-N16R8 (固件)    │ ◄──────────────► │   Go Agent (Linux 守护进程)   │  │
│  │                             │                  │                              │  │
│  │  8× 25kHz PWM 风扇控制       │      MQTT        │  · nvidia-smi  GPU 监控      │  │
│  │  8× PCNT Tach 转速反馈       │ ◄──────────────► │  · /proc/stat  CPU 利用率    │  │
│  │  BME280  温湿度气压           │                  │  · /proc/meminfo 内存        │  │
│  │  DS18B20 远程温度探头         │                  │  · systemd 服务自启动        │  │
│  │  12V/5V/3.3V 电源监控        │                  └──────────────────────────────┘  │
│  │  WS2812B RGB 状态 LED        │                                                    │
│  │  OTA 固件空中升级             │                                                    │
│  └─────────────────────────────┘                                                    │
│               │ SATA 15Pin (12V + 5V)                                               │
└───────────────┼─────────────────────────────────────────────────────────────────────┘
                │ WiFi  ───  MQTT Broker (Mosquitto)
                │                    │
          ┌─────┴──────┐   ┌─────────┼──────────┐   ┌─────────────────────┐
          │  Web APP   │   │  Home   │          │   │   其他 MQTT 客户端   │
          │ React+Node │   │Assistant│ packages │   │  (Node-RED / 脚本)  │
          └─────┬──────┘   └─────────┴──────────┘   └─────────────────────┘
                │ WebSocket 实时推送
                └── Dashboard · 风扇控制 · 告警配置 · 历史图表 · 设备管理
```

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🌡️ **多传感器温度** | BME280 板载（温湿度气压）+ DS18B20 远程探头 + ESP32 内部温度 + GPU/CPU（Go Agent） |
| 🌀 **8路独立风扇** | 25 kHz PWM 精准调速 + PCNT 转速反馈（RPM），停转检测 |
| 📈 **双模控制曲线** | 固定查表（LUT）线性插值 + PID 自适应，每路独立配置 |
| ⚡ **电源监控** | 12V / 5V / 3.3V 实时采样，欠压/过压告警，断电保护电容 |
| 🔔 **智能告警** | 4类规则（温度/停转/电压/WiFi），三级状态机，2分钟去重，LED+MQTT通知 |
| 🌐 **Web 控制台** | React 仪表盘，实时 WebSocket 推送，风扇曲线编辑器，历史趋势图 |
| 🏠 **Home Assistant** | ha/ 手动 packages 集成（17个传感器 + 8路风扇控制 + 5个告警/在线传感器；Discovery 为规划项） |
| 🔄 **OTA 固件更新** | MQTT / USB-CDC 双触发，3阶段回滚保护（启动/网络/MQTT确认） |
| 🖥️ **Go Linux Agent** | nvidia-smi GPU 监控 + /proc 系统采集，单二进制，systemd 服务 |
| 🔌 **SATA 直取供电** | 服务器 SATA 电源口供电，5V→AMS1117-3.3V LDO，12V 直供风扇 |

---

## 🚀 快速开始

### 前置要求

```bash
# ESP-IDF v5.3+（固件编译）
. $IDF_PATH/export.sh

# Go 1.22+（Agent）
go version  # go version go1.22 linux/amd64

# Node.js 20+（Web 控制台）
node --version  # v20.x.x

# Mosquitto（MQTT Broker）
mosquitto -v  # 2.x.x
```

### 1 — 烧录固件

```bash
cd firmware
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
# 首次上电后长按配网键(3s)，连接 FanCtrl-XXXXXX 热点配网
```

### 2 — 部署 Go Agent（Linux 服务器）

```bash
cd agent
make build
sudo bash install.sh    # 安装到 /usr/local/bin + systemd 服务
# 编辑配置
sudo nano /etc/smart-fan-agent/config.yaml  # 填入 MQTT broker 地址和串口路径
sudo systemctl start smart-fan-agent
```

### 3 — 启动 Web 控制台

```bash
# 后端
cd web/backend && npm install && npm start   # http://localhost:3001
# 前端（开发模式）
cd web/frontend && npm install && npm run dev  # http://localhost:5173
```

### 4 — Home Assistant 集成（手动 packages）

```bash
# 1. 获取 device_id（订阅 status topic 或看固件启动日志）
mosquitto_sub -t 'fan-controller/+/status' -v
# 2. 复制 YAML 到 HA 并替换占位符（详见 ha/README.md）
cp -r ha/ /config/packages/fan-controller/
sed -i 's/__DEVICE_ID__/esp32-a1b2c3/g' /config/packages/fan-controller/*.yaml
# 3. configuration.yaml 启用 packages 后重启 HA
```

> 固件不实现 MQTT Discovery 自动发现（规划中）；必须替换 `__DEVICE_ID__` 占位符，
> 否则控制实体无法下发命令。

> 完整部署说明见 [docs/deploy.md](docs/deploy.md)

---

## 🔧 硬件规格

| 参数 | 规格 |
|------|------|
| **主控** | ESP32-S3-N16R8（16MB Flash + 8MB Octal PSRAM） |
| **供电** | SATA 15Pin（12V + 5V），板载 AMS1117-3.3 LDO |
| **风扇** | 8路 4Pin 25kHz PWM（Intel 规范），SATA 12V 直供 |
| **传感器** | BME280（I2C, GPIO17/18）+ DS18B20（1-Wire, GPIO16, 最多4个，不支持寄生供电） |
| **电平转换** | 74AHCT125（ESP32 3.3V → 5V PWM 信号），Tach 5V→3.3V 分压 |
| **LED** | WS2812B-2020 RGB（3.3V 供电，GPIO45 RMT，5种状态模式） |
| **按键** | WiFi 配网（GPIO47，长按3s/10s；AP 配网需输入串口日志打印的4位确认码），复位（EN 引脚） |
| **通信** | WiFi 802.11b/g/n + USB-CDC 原生（无需转串口芯片） |
| **保护** | PTC 保险丝 + 肖特基防反接 + TVS ESD + 断电保护电容 |
| **PCB** | 99mm × 99mm，4 层 FR4（L2 完整 GND），嘉立创免费打样档 |

### 🔑 关键硬件设计决策

- **12V ADC 分压**：`100kΩ + 20kΩ`（ADC 输入≤2.0V，防止超出 ESP32-S3 ADC 上限3.1V）
- **WS2812B 3.3V 供电**：3.3V 时 VIH_min=2.31V < ESP32 VOH=3.0V ✅；若5V供电则逻辑电平不足
- **不使用 SATA 3.3V 引脚**：改用 5V→LDO 方案，电流裕量更大且无 PWDIS 兼容性问题

---

## 💻 软件组件

```
smart-fans-system/
├── firmware/                  # ESP32-S3 固件（ESP-IDF v5.3, C语言）
│   ├── components/            # 13个独立驱动组件
│   │   ├── power_monitor/     # ADC1 电源监控（仅ADC1，避开ADC2/WiFi冲突）
│   │   ├── fan_pwm/           # LEDC 25kHz PWM（LEDC_LOW_SPEED_MODE）
│   │   ├── fan_tach/          # PCNT 转速计（RPM = pulses×60÷2）
│   │   ├── bme280/            # I2C BME280（Bosch 补偿算法，int64_t 防溢出）
│   │   ├── ds18b20/           # OneWire DS18B20（CRC8 + ROM 搜索）
│   │   ├── status_led/        # WS2812B RMT（5种模式：正常/警告/错误/配网/OTA）
│   │   ├── wifi_manager/      # WiFi STA+AP + Captive Portal + 指数退避重连
│   │   ├── mqtt_client/       # MQTT（LWT 遗嘱 + 50条 Flash 离线队列）
│   │   ├── usb_console/       # USB-CDC 串口控制台（7命令：help/status/reboot/ota/fan/wifi/mqtt）
│   │   ├── flash_storage/     # NVS配置 + Wear Levelling 循环日志
│   │   ├── fan_curve/         # LUT插值 + PID Anti-windup + 紧急模式(>80°C)
│   │   ├── alert_manager/     # 4类告警规则 + NORMAL/WARNING/CRITICAL状态机
│   │   └── ota_handler/       # esp_https_ota + 3阶段回滚保护
│   └── test/                  # 13个 Unity 测试文件（未接入 idf.py 构建，见下方说明）
│
├── agent/                     # Go Linux Agent
│   ├── internal/monitor/      # GPU（nvidia-smi）+ 系统（/proc）采集器
│   ├── internal/mqtt/         # MQTT 发布/订阅（paho.mqtt.golang）
│   └── internal/usb/          # USB-CDC 串口双向中继
│
├── web/                       # Web 控制台
│   ├── backend/               # Express + MQTT + WebSocket（2秒推送）
│   │   └── src/routes/        # 8+端点 + Zod 参数校验
│   └── frontend/              # React + TypeScript + Vite + Recharts
│       ├── pages/             # Dashboard · Fans · Alerts · History · Devices
│       └── components/        # TemperatureGauge · FanCard · VoltageBar · CurveEditor
│
├── ha/                        # Home Assistant 手动 packages 配置（__DEVICE_ID__ 占位）
├── hardware/                  # 硬件设计文件（嘉立创 EDA 工程 + BOM + Gerber；旧 KiCad 工程归档 legacy/）
├── test/                      # 端到端集成测试 + 冒烟测试脚本
└── docs/                      # 部署指南 + 硬件组装指南 + MQTT协议规范
```

---

## 📊 Web 控制台

浏览器访问 `http://server-ip:5173`（开发）或 nginx 反代后访问。

- **Dashboard** — 实时温度仪表（RadialBarChart）、风扇 RPM/占空比图表、电压进度条、告警横幅
- **Fans** — 8路独立调速滑块（AUTO/MANUAL 切换）、LUT 曲线可视化编辑、PID 参数面板
- **Alerts** — 4类告警规则开关+阈值配置、告警历史时间线（最近100条）
- **History** — 温度/转速趋势图（Recharts LineChart）、时间范围选择（1h/6h/24h/7d）、CSV 导出
- **Devices** — 在线状态监控、OTA 固件更新触发、设备重启（二次确认）

---

## 🏠 Home Assistant 集成（手动 packages）

通过 `ha/` 目录的 YAML packages 手动集成（MQTT Discovery 自动发现为规划项，当前不实现）：

| 实体类型 | 数量 | 说明 |
|----------|:---:|------|
| 传感器（Sensor） | 17 | BME280×3 + DS18B20×2（按 address 匹配）+ MCU温度 + 电压×3 + 风扇RPM×8 |
| 风扇（Fan） | 8 | 0~100% 调速控制（command_topic 指令） |
| 二进制传感器 | 5 | 温度告警 / 停转告警 / 电压异常 / WiFi告警 / 设备在线（per-type retained 状态 topic） |

安装步骤与 `__DEVICE_ID__` 占位符替换方法见 [ha/README.md](ha/README.md)。
全部实体带 availability 联动（设备 LWT 下线即不可用）。

---

## 🛠️ 开发指南

### ESP-IDF 已知陷阱（来自实战踩坑）

| # | 陷阱 | 正确做法 |
|---|------|---------|
| 1 | `esp_timer_get_time()` 用 `uint32_t` 接收 | **必须 `int64_t`**，72分钟后溢出 |
| 2 | SNTP 在 `WIFI_EVENT_STA_CONNECTED` 启动 | 必须在 `IP_EVENT_STA_GOT_IP` 启动 |
| 3 | `esp_mqtt_client_start()` 在WiFi事件处理器中 | 用 FreeRTOS Timer 延迟调用 |
| 4 | `sscanf` 解析 JSON | 始终用 `cJSON` 库 |
| 5 | `vTaskDelay` 在事件处理器内 | 改用 `esp_rom_delay_us()` |
| 6 | LEDC 硬件渐变 + WiFi 并发 | 手动步进（独立任务），不用 `ledc_set_fade_with_time()` |

### 运行单元测试 / 构建

```bash
# 固件（⚠️ firmware/test/ 的 13 个 Unity 测试文件未接入 idf.py 构建——DESCOPE，
# 见 docs/changelog-modules-v1.2.md DOC-06；当前固件验证以 build + 冒烟为准）
cd firmware && idf.py build

# agent（Linux 交叉编译）
cd agent && GOOS=linux go build ./... && go vet ./...

# web（真实构建命令；无 jest 测试套件，README 此前的 `cd web && npm test` 不存在）
cd web/backend  && npm ci && npm run build   # 产出 dist/server.js
cd web/frontend && npm ci && npm run build   # 产出 dist/index.html
```

### 运行冒烟测试

```bash
chmod +x test/smoke_test.sh
./test/smoke_test.sh <mqtt_host> <api_host>
# 预期输出: PASS=25 FAIL=0（含 TST-04 协议命令用例）
```

---

## 📄 许可证

[MIT License](LICENSE) — 自由使用、修改和分发。

本项目为个人 DIY 项目，不提供任何形式的商业支持或质量保证。

---

<div align="center">

Made with ❤️ for homelab enthusiasts · [⭐ Star on GitHub](https://github.com/OneAsmallFish/smart-fans-system)

</div>
