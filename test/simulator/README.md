# 无硬件协议模拟器（test/simulator）

没有 ESP32-S3 真机时，用 Node.js 模拟一台 **智能风扇控制器** 设备，让
Web 后端/前端、Home Assistant、冒烟与联调链路可以跑通全链路。

- 协议真源：[`docs/protocol.md`](../../docs/protocol.md)（v1.0.1）
- 行为对齐：[`firmware/main/main.c`](../../firmware/main/main.c) 与
  `firmware/components/{mqtt_client,alert_manager,fan_curve,ota_handler}`
- 默认设备 ID：`esp32-sim0001`（可用 `SIM_DEVICE_ID` 覆盖）

> 模拟器只依赖 `mqtt` 包，不依赖固件工具链，可在 Windows/Linux/macOS 直接运行。

---

## 1. 快速开始

```bash
cd test/simulator
npm install                       # 安装 mqtt 依赖（首次）

# 默认连本机 mqtt://localhost:1883
npm start

# 指向指定 broker（例如轨道 A 的 Linux 服务器）
npm start -- -b mqtt://192.168.3.131:1883
# 等价写法：
MQTT_URL=mqtt://192.168.3.131:1883 node simulator.js
```

启动后应立即看到：

```
[...] 无硬件协议模拟器启动 — protocol v1.0.1 / 设备 esp32-sim0001 / 8 路风扇
[...] MQTT 已连接
[...] 已订阅 fan-controller/esp32-sim0001/command/#
```

`node simulator.js --help` 打印全部选项与环境变量。

---

## 2. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `MQTT_URL` | `mqtt://localhost:1883` | broker 地址（`-b/--broker` 优先） |
| `SIM_DEVICE_ID` | `esp32-sim0001` | 设备 ID（`-d/--device` 优先）；同时作为 MQTT clientId |
| `SIM_FW_VERSION` | `v1.0.1` | status 报文 `firmware_version`；OTA 成功后被 `version` 覆盖 |
| `SIM_IP_ADDRESS` | `192.168.1.100` | status 报文 `ip_address` |
| `SIM_TICK_MS` | `1000` | 采样/上报基准周期（传感器 + 8 路风扇） |
| `SIM_STATUS_INTERVAL_S` | `30` | status 心跳秒数（0 = 仅上线时发一次） |
| `SIM_ALERT_DEMO` | `1` | 是否注入周期性温升/电压跌落事件（0 = 关闭） |
| `SIM_ALERT_INTERVAL_S` | `120` | 告警演示重复周期（0 = 只注入首次事件） |
| `SIM_FIRST_ALERT_S` | `20` | 首次注入延迟 |
| `SIM_EXCURSION_S` | `45` | 温升事件持续秒数 |
| `SIM_ALERT_KIND` | `alternate` | `alternate`（首次 warning 后交替）/ `warning` / `critical` |
| `SIM_STALL_FAN` | `-1` | 强制停转的风扇路号（0-7，-1 关闭）→ 触发 `fan_stall` |
| `SIM_OTA_STEP_MS` | `700` | OTA 每步耗时 |
| `SIM_REBOOT_MS` | `2000` | 模拟重启的掉线时长 |
| `SIM_LOG` | `info` | `quiet` / `info` / `debug`（`--quiet/--verbose` 亦可） |

---

## 3. 上报契约（设备 → Broker）

| Topic | QoS | Retain | 周期 | 说明 |
|-------|:---:|:------:|------|------|
| `fan-controller/{id}/status` | 1 | ✅ | 上线 + 30s 心跳 | `timestamp/device_id/status/firmware_version/ip_address/uptime_seconds`（§1.1） |
| `fan-controller/{id}/sensor/bme280` | 0 | – | 1s | `temperature_c/humidity_pct/pressure_hpa`（§2.1） |
| `fan-controller/{id}/sensor/ds18b20` | 0 | – | 1s | `sensors[]`：`address/valid/temperature_c`，2 个探头（§2.2，ADJ-6） |
| `fan-controller/{id}/sensor/voltage` | 0 | – | 5s | `voltage_12v/voltage_5v/voltage_3v3`（§2.3，FW-19） |
| `fan-controller/{id}/sensor/internal_temp` | 0 | – | 5s | MCU 温度 `temperature_c`（§2.4） |
| `fan-controller/{id}/fan/{0-7}/state` | 0 | – | 1s | `fan_index/pwm_duty_pct/rpm/stalled/mode`，8 路独立发布（§3.1，ADJ-13） |
| `fan-controller/{id}/alert` | 1 | – | 事件触发 | 告警事件：`alert_type/severity/message/value/threshold/sensor`（§5.1） |
| `fan-controller/{id}/alert/{type}/state` | 1 | ✅ | 触发/恢复 | `{active, severity, timestamp}`，供 HA binary_sensor（§5.2，ADJ-8） |
| `fan-controller/{id}/ota/status` | 1 | – | OTA 期间 | `state/progress_pct/message`（§7） |

所有报文都带 `timestamp`（**Unix 秒**，FW-15）与 `device_id`。

DS18B20 地址固定为协议 §2.2 示例值：`28-00000a1b2c3d`、`28-00000e4f5g6h`
（HA 的 `__DS_ADDR_0__` / `__DS_ADDR_1__` 需替换成这两个）。

---

## 4. 命令契约（Broker → 设备，订阅 `command/#` 与 `config/#`）

| Topic | Payload | 模拟器行为 |
|-------|---------|-----------|
| `command/fan` | `{fan_index, mode, duty_pct, timestamp}` | 越界（index∉0-7 / duty∉0-100）**丢弃并告警**；合法则切 **MANUAL** 并下发 duty，`fan/{i}/state` 回执，RPM 按 0.45/s 一阶随动 |
| `command/curve` | `{fan_index, mode:"lut"\|"pid", temperature_source, points[] \| kp/ki/kd/setpoint_c}` | 切回 **AUTO**；LUT 线性插值（`temp_c` 必须严格递增、≤10 点，否则拒绝保留旧曲线）；PID 平铺字段（ADJ-4）；`temperature_source` 仅接受 `bme280/ds18b20_0/ds18b20_1/internal`（ADJ-5） |
| `command/reboot` | `{timestamp, device_id}` | 回执 = 立即发布 retained `status=offline` → 断开 → `SIM_REBOOT_MS` 后重连并发布 `status=online`（uptime 归零） |
| `command/reset` | `{confirm:true}` | 恢复默认阈值/曲线后重启；`confirm` 非 true 时忽略（协议 §4.4） |
| `command/ota` | `{firmware_url, version, checksum_sha256}` | 按协议 §7 回执：`downloading` 0→100（10% 步进）→ `verifying` → `success` → 模拟重启；重启后 `firmware_version` 变为 payload 的 `version`。缺少 `firmware_url` 时忽略（对齐固件） |
| `config/alert` | `{get:true}` / `{rules:[...]}` | get 回读当前阈值（字段名与固件 `publish_alert_cfg` 一致）；set 应用双阈值模型 |

**AUTO / MANUAL 语义**：与固件一致 —— `command/fan` 恒进入 MANUAL（固件忽略 payload 里的
`mode` 字段），回到 AUTO 走 `command/curve`（`lut`/`pid`）。Web 的 Fans 页
「AUTO/MANUAL」按钮正是这两条路径。

### 告警（对齐 `alert_manager.c`）

| 类型 | 触发条件 | 严重度 |
|------|---------|--------|
| `temperature_high` | max(BME280, DS18B20×2) > 75°C / > 80°C | warning / critical |
| `fan_stall` | duty > 5% 且 RPM < 200 | critical |
| `voltage_abnormal` | 12V 超出 10.8-13.2V，或 5V/3.3V 超出 ±5% | warning |
| `wifi_disconnected` | MQTT 长连接断开 > 60s（模拟器在线时恒不触发） | warning |

告警触发时同时发 `alert`（事件，web 消费）与 `alert/{type}/state`（retained，HA 消费）；
恢复时只更新 retained 状态（与固件 `on_alert_clear` 一致）。同一告警激活期间 **2 分钟去重**
（`DEDUP_INTERVAL_US`），因此温升场景中首次越限的严重度决定该次事件等级。

### 演示事件与故障注入

默认 `SIM_ALERT_DEMO=1` 时，模拟器周期性注入"散热异常"场景，让 History/Alerts 有数据：

- **温升事件**：环境温度爬升 → 触发 `temperature_high` → 回落 → 恢复；
  `SIM_ALERT_KIND=alternate`（默认）首次为 `warning`（缓升，曲线友好），之后与 `critical`
  （突发跃升 >80°C，触发 `fan_curve` 的 >80°C 紧急全速）交替。
- **电压跌落**：温升事件后段 12V 跌到 ~10.2V 持续 8s → `voltage_abnormal` → 恢复。
- **停转注入**：`SIM_STALL_FAN=3` 让 fan 3 恒 0 RPM → `fan_stall`。

---

## 5. 自检（协议契约，可作联调证据）

```bash
cd test/simulator
node selftest.js --broker mqtt://192.168.3.131:1883
```

`selftest.js` 会各自拉起一份模拟器子进程，分两个场景断言 **43 项**契约：

1. **场景 1（遥测/命令/OTA/重启/LWT）**：status 字段与 QoS1+retain、
   bme280/ds18b20/voltage/internal_temp 字段契约与周期、8 路 fan state 全覆盖、
   数值漂移、`command/fan` MANUAL 回执与 RPM 随动、`command/curve` 回 AUTO + LUT 插值校验、
   越界命令防御（index=9 / duty=150 / 非法 source 均被丢弃且设备存活）、
   `command/reboot` 的 offline→online 回执、OTA 进度单调 0→100 与新固件版本生效、
   以及 **SIGKILL 后 broker 自动发布 retained offline（LWT）**。
2. **场景 2（告警）**：`fan_stall` 与 `temperature_high` 事件字段/QoS、
   per-type retained 状态 topic 的 active=true→false 生命周期、电压跌落告警。

输出为 `PASS/FAIL` 计数与逐条证据，退出码非 0 即失败。

---

## 6. 与 Web / HA / 冒烟链路联调

### 6.1 Web（后端 + 前端）

```bash
# 1) 后端指向同一个 broker
cd web/backend
MQTT_BROKER=mqtt://192.168.3.131:1883 npm run dev      # http://localhost:3001

# 2) 前端（vite 代理 /api → 3001）
cd web/frontend
npm run dev                                            # http://localhost:5173

# 3) 模拟器
cd test/simulator
npm start -- -b mqtt://192.168.3.131:1883
```

预期：
- **Dashboard**：出现卡片 `esp32-sim0001`（online、固件版本、IP、BME280/DS18B20/三路电压/MCU 温度、8 路风扇 RPM）。
- **Fans**：8 张 FanCard；拖动滑块 → `POST /api/devices/esp32-sim0001/fan/{i}` → 后端发
  `command/fan` → 模拟器回 `fan/{i}/state`（duty 回显、RPM 随动）；AUTO/MANUAL 按钮走
  `command/fan` / `command/curve`；曲线编辑器 LUT/PID 下发后立即生效。
- **History**：页面按实时读数累积曲线（BME280/DS18B20/8 路 RPM）；温升事件在曲线上表现为明显隆起。
- **Alerts**：规则编辑器（双阈值）可下发 `config/alert`；时间线显示 `temperature_high` /
  `fan_stall` / `voltage_abnormal` 事件，颜色按 severity。
- **Devices / OTA**：`POST /api/devices/esp32-sim0001/ota` 可看到 OTA 进度条推进到 success 后设备重启上线。

快速校验（不需浏览器）：

```bash
curl -s localhost:3001/api/devices/esp32-sim0001 | head -c 400
```

### 6.2 Home Assistant

把 `ha/*.yaml` 的 `__DEVICE_ID__` 替换为 `esp32-sim0001`、
`__DS_ADDR_0__`/`__DS_ADDR_1__` 替换为上面的 DS 地址，即可用模拟器验证
实体可用性（availability 联动 LWT status）、8 路 fan 控制与 4 个告警 binary_sensor。

### 6.3 冒烟脚本

`./test/smoke_test.sh` 不依赖本模拟器（它自己伪造报文），但需要
`mosquitto_pub`/`mosquitto_sub`：

```bash
# 从仓库根目录运行；broker 指向轨道 A 的服务器
./test/smoke_test.sh 192.168.3.131 localhost
```

---

## 7. 与真实固件的差异（有意为之，便于测试）

| 项 | 真机固件 | 模拟器 |
|----|---------|--------|
| OTA 进度 | 每 1% 变化上报一次 | 10% 步进（`SIM_OTA_STEP_MS` 可调） |
| PID | `fan_curve.c` 增量式 PID | 简化位置式 PID（参数语义相同） |
| 告警评估周期 | `alert_task` 5s | 每 tick（1s），阈值/去重语义不变 |
| 重启耗时 | 真实重启（秒级） | `SIM_REBOOT_MS`（默认 2s） |
| 阈值/曲线持久化 | NVS 掉电保存 | 进程内存（重启后回默认；重启会丢失 MANUAL 运行态，与真机一致） |
| 离线缓存补发 | 断网缓存 50 条 + `/buffered` 补发 | 未实现（需要时用 `mosquitto_pub` 手工验证后端 `sensor/#` 订阅） |
| WiFi 配网 / USB console | 有 | 无（MQTT 链路即"已联网"） |

---

## 8. 故障排查

| 现象 | 处理 |
|------|------|
| `MQTT 错误: connect ECONNREFUSED` | broker 未启动或地址错误；确认 `MQTT_URL` 与 1883 端口可达 |
| `Not authorized` / `Connection refused: Not authorized` | broker 关闭了匿名访问；在 broker 侧加 `allow_anonymous true` 或提供凭据 |
| Web 页面无设备 | 后端 `MQTT_BROKER` 必须与模拟器指向**同一个** broker |
| Alerts 页始终为空 | 等待 `SIM_FIRST_ALERT_S`（默认 20s）后的首次注入，或设 `SIM_ALERT_INTERVAL_S=30` 加快 |
| 端口 3001/5173 被占用 | 分别用 `PORT` / vite `--port` 覆盖，并同步前端 `WS_URL` 与 vite 代理 |
