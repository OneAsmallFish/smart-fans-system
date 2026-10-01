# 部署指南 — Smart Fan Controller

## 系统架构

```
ESP32-S3 (固件)
     │ SATA 12V/5V
     │ USB-CDC ←→ Go Agent (Linux) ←→ MQTT Broker ←→ Web APP
     │ WiFi ────────────────────────────────────────────┘
```

---

## 前置条件

| 工具 | 版本 | 安装 |
|------|------|------|
| ESP-IDF | v5.3+ | `./install.sh` [官方文档](https://docs.espressif.com/projects/esp-idf/zh_CN/latest/esp32s3/get-started/) |
| Go | 1.25+ | 官网安装包；Ubuntu 24.04 `apt install golang-go` 仅 1.22，依赖 `GOTOOLCHAIN=auto` 联网下载 1.25 工具链——离线/内网环境必须手动装 1.25+ |
| Node.js | 20+ | `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -` |
| Mosquitto | 2.0+ | `sudo apt install mosquitto mosquitto-clients` |
| git / curl | 任意 | `sudo apt install git curl`（克隆仓库与冒烟测试依赖） |

> 本文档假设仓库克隆至 `/opt/smart-fan/smart-fans-system`（§4.3 nginx 路径以此为准）。
> 国内拉取 Go 依赖建议：`go env -w GOPROXY=https://goproxy.cn,direct`。

---

## 第一步：固件烧录

### 1.1 编译固件

```bash
cd firmware
idf.py set-target esp32s3
idf.py build
```

预期输出: `Project build complete. Sending binaries to /build/`

### 1.2 首次烧录（完整擦除）

```bash
# 连接 Type-C USB 到电脑，按住 BOOT 键再插入
idf.py -p /dev/ttyACM0 flash monitor

# Windows 用户:
idf.py -p COM3 flash monitor
```

### 1.3 首次 WiFi 配网

1. 长按配网键（GPIO38）3秒，RGB LED 变为蓝色慢闪
2. 手机/电脑连接 WiFi 热点 `FanCtrl-XXXXXX`
3. 浏览器访问 `http://192.168.4.1`
4. 输入家庭 WiFi SSID 和密码，点击保存
5. 设备重启后自动连接 WiFi，LED 变为绿色呼吸

### 1.4 USB-CDC 串口调试

设备连接后可直接用串口终端（115200 波特率）发送命令：

```bash
# Linux/macOS
screen /dev/ttyACM0 115200

# 可用命令（与固件 FW-22 实现一致）
status            → 查看系统状态 JSON
fan <0-7> <0-100> → 设置风扇转速（如 fan 0 75 = 风扇0转速 75%，并切 MANUAL 模式）
wifi status       → 查看 WiFi 连接状态
wifi reset        → 恢复出厂（清除 WiFi/曲线/MQTT 配置后重启）
mqtt status       → 查看 MQTT broker 配置与连接状态
mqtt set <url>    → 设置 broker（如 mqtt set mqtt://192.168.1.100:1883，重启生效）
ota https://...   → 触发 OTA 更新
reboot            → 重启设备
help              → 命令列表

# 恢复某路风扇自动模式：发送曲线命令（REST/mosquitto）后设备回 auto，
# 或重启设备（曲线模式默认 LUT 自动）。
```

---

## 第二步：MQTT Broker 配置

```bash
# 启动 Mosquitto（允许匿名连接，局域网使用）
cat > /etc/mosquitto/conf.d/fan-ctrl.conf << 'EOF'
listener 1883
allow_anonymous true
EOF

sudo systemctl restart mosquitto
sudo systemctl enable mosquitto

# 验证连接（订阅端应打印: fan-controller/verify hello）
mosquitto_sub -h localhost -t "fan-controller/+" -v &
mosquitto_pub -h localhost -t "fan-controller/verify" -m "hello"
```

---

## 第三步：Go Agent 部署（Linux 服务器）

```bash
cd agent

# 1. 编译
make build

# 2. 编辑配置
sudo mkdir -p /etc/smart-fan-agent
cat > /etc/smart-fan-agent/config.yaml << 'EOF'
mqtt:
  broker: "mqtt://localhost:1883"   # 端口并入 URL（无独立 port 字段）
  client_id: "smart-fan-agent"
  topic_prefix: "fan-controller"
  username: ""                      # broker 启用鉴权时填写
  password: ""

serial:
  port: "/dev/ttyACM0"    # ESP32 USB-CDC 串口
  baud_rate: 115200

monitor:
  interval: 5             # 采集间隔(秒)
  gpu_enabled: true       # 有 NVIDIA GPU 才设为 true
EOF

# 3. 安装
sudo bash install.sh

# 4. 启动服务
sudo systemctl start smart-fan-agent
sudo systemctl status smart-fan-agent

# 5. 查看日志
journalctl -u smart-fan-agent -f
```

> **数据流说明**：Agent 采集的本机 CPU/内存/GPU 指标发布到
> `system-monitor/{hostname}/sensor/{system|gpu}`，**不会**出现在 Web 控制台
> （后端只订阅 `fan-controller/#`，控制台面向 ESP32 设备）。Agent 指标供 MQTT
> 订阅方（如 Home Assistant）消费；`/api/devices` 里看不到 agent 主机属正常现象。

---

## 第四步：Web 控制台部署

### 4.1 后端启动

```bash
cd web/backend
npm ci                # lockfile 已提交，用 ci 保证可复现
export MQTT_BROKER="mqtt://localhost:1883"
export PORT=3001
npm run build
npm start             # 前台运行；生产常驻建议 pm2 或 systemd 单元
```

### 4.2 前端构建

```bash
cd web/frontend
npm ci
npm run build
# 生成 dist/ 目录
```

### 4.3 Nginx 反向代理（可选，生产部署）

```nginx
server {
    listen 80;
    root /opt/smart-fan/smart-fans-system/web/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
    }

    location /health {
        proxy_pass http://localhost:3001;
    }
}
```

> ⚠️ 已知限制：前端 5 个页面硬编码 `ws://${hostname}:3001` 直连后端 WebSocket，
> 反向代理**并未收口** 3001 端口（须对浏览器可达），且 HTTPS 部署下会被混合内容
> 策略拦截（需改前端 WS_URL 为 wss 相对路径——规划项）。

```bash
# 开发模式（前后端热重载）
cd web/frontend && npm run dev -- --host 0.0.0.0 &   # --host 使局域网可访问（vite 默认只绑 localhost）
cd web/backend  && npm run dev &
# 前端: http://localhost:5173
# 后端: http://localhost:3001
```

---

## 第五步：Home Assistant 集成

```bash
# 1. 在 HA 中安装 Mosquitto broker 插件
# 2. 复制 ha/ 配置到 HA
scp -r ha/ homeassistant:/config/packages/fan-controller/

# 3. 在 configuration.yaml 中添加:
cat >> /config/configuration.yaml << 'EOF'
homeassistant:
  packages:
    fan_controller: !include_dir_named packages/fan-controller
EOF

# 4. 重启 HA → 设备自动出现在 集成 → MQTT
```

---

## 第六步：OTA 固件更新

OTA 更新支持两种方式：

**方式1：通过 Web APP**
1. 打开 `http://localhost:5173/devices`
2. 在目标设备行中输入固件 HTTPS URL
3. 点击 `Flash OTA`

**方式2：通过 MQTT 命令**
```bash
mosquitto_pub -h localhost \
  -t "fan-controller/esp32-a1b2c3/command/ota" \
  -m '{"firmware_url":"https://your-server.com/v1.1.0.bin","timestamp":0}'
```

回滚保护：新固件需在30秒内启动、2分钟内连网、5分钟内首次MQTT通信，否则自动回滚。

---

## 故障排查 FAQ

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| LED 蓝色慢闪 | WiFi 断连 | 检查路由器信号，或长按配网键重新配网 |
| LED 红色快闪 | 告警 (温度/停转) | 检查风扇接线和服务器温度 |
| ESP32 无法识别串口 | USB 驱动 | ESP32-S3 使用原生 USB-OTG，无需驱动，但需 Linux udev 规则：`echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="303a", MODE="0666"' | sudo tee /etc/udev/rules.d/99-esp32.rules` |
| Go Agent 找不到串口 | 串口路径错误 | `ls /dev/ttyACM*` 确认路径，更新 config.yaml |
| Agent 启动即退出（status=216/GROUP） | 旧版 service 的 `Group=nobody` 在 Debian/Ubuntu 上不存在（组名为 nogroup） | 更新仓库后重跑 `install.sh` 覆盖 unit；或临时 drop-in：`printf '[Service]\nGroup=nogroup\n' > /etc/systemd/system/smart-fan-agent.service.d/10-group.conf && systemctl daemon-reload` |
| go build 报 `go.mod requires go >= 1.25.0` | 系统工具链低于 go.mod 要求 | 安装 Go 1.25+；或保持默认 `GOTOOLCHAIN=auto` 允许联网下载工具链（离线环境必须手动装） |
| MQTT 数据不更新 | Broker 地址错误 | 检查 firmware NVS 中的 broker URL，USB 命令: `wifi status` |
| Web APP 无设备 | MQTT 未订阅 | 检查后端日志: `[mqtt] connected to ...` |

---

## 验证命令

```bash
# 固件
cd firmware && idf.py build         # BUILD SUCCESS

# Go Agent
cd agent && go build ./... && go test ./...   # PASS

# Web APP
cd web/backend  && npm run build    # 无错误
cd web/frontend && npm run build    # dist/ 生成

# 系统冒烟测试（脚本已带可执行位，无需 chmod）
./test/smoke_test.sh localhost localhost 2>&1 | tee smoke.log
grep "PASS\|FAIL" smoke.log
# 期望输出: PASS: 25  FAIL: 0（任一 FAIL 退出码非 0）
# 注: 25 项中 8 项为静态断言（CP11/CP12/CP14 部分只检查 ha/*.yaml 与文档），
#     与运行状态无关；运行时链路以其余 17 项为准
```


---

## Web 层安全声明（局域网假设）

Web 后端当前监听 `0.0.0.0:3001` 且 CORS 全开、REST API 无鉴权——**仅适用于
可信局域网**（homelab/内网机房）。请勿将 3001 端口直接暴露到公网；如需外网
访问，请置于反向代理 + VPN（如 Tailscale/WireGuard）之后。简单 token 鉴权
为规划项。
