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
| Go | 1.22+ | `sudo apt install golang-go` |
| Node.js | 20+ | `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -` |
| Mosquitto | 2.0+ | `sudo apt install mosquitto mosquitto-clients` |

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

# 可用命令:
status          → 查看系统状态 JSON
fan 0 speed 75  → 设置风扇0转速 75%
fan 0 auto      → 恢复风扇0自动模式
ota https://... → 触发 OTA 更新
reboot          → 重启设备
help            → 命令列表
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

# 验证连接
mosquitto_sub -h localhost -t "fan-controller/+" -v &
mosquitto_pub -h localhost -t "test" -m "hello"
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
  broker: "mqtt://localhost:1883"
  port: 1883
  client_id: "smart-fan-agent"
  topic_prefix: "fan-controller"

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

---

## 第四步：Web 控制台部署

### 4.1 后端启动

```bash
cd web/backend
npm install
export MQTT_BROKER="mqtt://localhost:1883"
export PORT=3001
npm run build
npm start
```

### 4.2 前端构建

```bash
cd web/frontend
npm install
npm run build
# 生成 dist/ 目录
```

### 4.3 Nginx 反向代理（可选，生产部署）

```nginx
server {
    listen 80;
    root /opt/smart-fan/web/frontend/dist;
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

```bash
# 开发模式（前后端热重载）
cd web/frontend && npm run dev &
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
  -t "fan-controller/esp32-XXXXXX/command/ota" \
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

# 系统冒烟测试
chmod +x test/smoke_test.sh
./test/smoke_test.sh localhost localhost 2>&1 | tee smoke.log
grep "PASS\|FAIL" smoke.log
```
