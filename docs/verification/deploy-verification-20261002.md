# Smart Fan Controller —— 非硬件部分部署验证报告

| 项 | 值 |
|---|---|
| 验证日期 | 2026-10-02（Asia/Shanghai） |
| 目标服务器 | **192.168.3.131**（Ubuntu 24.04.2 LTS，hostname `ai`，40 vCPU / 38 GB，root） |
| 仓库 | `https://github.com/OneAsmallFish/smart-fans-system.git` |
| HEAD | `a55928fb82c10547ca8364b2582dad27f11bd750`（与任务给定 a55928f 一致） |
| 克隆路径 | `/opt/smart-fan/smart-fans-system` |
| 组件版本 | Mosquitto 2.0.18 · Go 1.22.2（实际构建工具链 1.25.0）· Node v22.22.1 · npm 10.9.4 |
| 冒烟结果 | **PASS: 25　FAIL: 0**，退出码 0（连跑 3 次一致） |
| 仓库改动 | **无**（`git status --porcelain` 为空，HEAD 未变） |
| 未执行 | `test/e2e/integration_test.sh`（按任务要求禁止） |

---

## 0. 结论速览

服务端链路 **全部打通**：MQTT Broker → Web 后端 → WebSocket → 浏览器控制台 → Go Agent 周期采集发布，端到端数据流经实测验证。

冒烟测试 **25/25 全部通过，无失败项**。但部署过程中发现 **1 个阻断性缺陷（P0）** 和 **1 个高危文档/代码不符（P1）**，二者都会让"照着 deploy.md 做"的人卡住：

- **P0**：`agent/smart-fan-agent.service` 的 `Group=nobody` 在 Ubuntu 24.04 上不存在 → 服务完全起不来（systemd 退出码 216/GROUP），无限重启。
- **P1**：deploy.md 声明 "Go 1.22+"，但 `agent/go.mod` 要求 `go 1.25.0` → 仅靠 Go 的联网自动下载工具链才能构建成功，离线/受限网络必失败。

详细清单见 §8。

---

## 1. 逐步结果

| 步骤 | 内容 | 结果 |
|---|---|---|
| 1 | 克隆仓库 + 通读 docs/deploy.md | ✅ |
| 2 | Mosquitto 安装配置（1883 / 局域网） | ✅ |
| 3 | Web 后端 npm ci + build + 常驻 | ✅ |
| 4 | Web 前端 npm ci + build + dev 服务 | ✅ |
| 5 | Go Agent 构建 + systemd 安装启动 | ⚠️ 首次失败（P0）→ 主机侧绕过 → ✅ |
| 6 | 冒烟测试 `./test/smoke_test.sh localhost localhost` | ✅ 25/25 |
| 7 | `test/e2e/integration_test.sh` | ⛔ 按要求未执行 |

### 步骤 1 —— 克隆与文档

```
$ git clone https://github.com/OneAsmallFish/smart-fans-system.git /opt/smart-fan/smart-fans-system
$ git rev-parse HEAD
a55928fb82c10547ca8364b2582dad27f11bd750
$ git status --porcelain      # 空
```

GitHub HTTPS 直连可用（无需 ssh://git@ssh.github.com:443 备选）。`docs/deploy.md` 已通读（271 行），后续部署以其为准。

### 步骤 2 —— Mosquitto（deploy.md §2 原样执行）

```bash
cat > /etc/mosquitto/conf.d/fan-ctrl.conf << 'EOF'
listener 1883
allow_anonymous true
EOF
systemctl restart mosquitto && systemctl enable mosquitto
```

验证结果：

```
LISTEN 0  100  0.0.0.0:1883  0.0.0.0:*  users:(("mosquitto",pid=496689,fd=5))
LISTEN 0  100     [::]:1883     [::]:*  users:(("mosquitto",pid=496689,fd=6))
mosquitto: active / enabled

$ mosquitto_sub -h localhost -t "fan-controller/+" -v -C 1 &
$ mosquitto_pub -h localhost -t "fan-controller/verify" -m "hello-from-deploymd" -q 1
SUB_GOT: fan-controller/verify hello-from-deploymd      ← 收到
$ mosquitto_pub -h 192.168.3.131 -t "test" -m "lan-ok" -q 1 && echo LAN_OK
LAN_OK                                                  ← 经局域网 IP 可达
```

> 注：deploy.md §2 自带的验证片段订阅 `fan-controller/+` 却发布到 `test`，两者不匹配，按原文执行**不会打印任何东西**（见 §8 F3）。上表用匹配的 topic 复验。

### 步骤 3 —— Web 后端

```bash
cd /opt/smart-fan/smart-fans-system/web/backend
npm ci          # package-lock.json 已提交，故用 ci 而非 install
npm run build   # tsc → dist/
```

常驻方式（deploy.md 未提供，任务允许 pm2/systemd，此处取 systemd）：
`/etc/systemd/system/smart-fan-web-backend.service`，`Environment=MQTT_BROKER=mqtt://localhost:1883`、`Environment=PORT=3001`、`ExecStart=/usr/bin/node dist/server.js`。

```
smart-fan-web-backend: active / enabled
LISTEN 0  511  *:3001  *:*  users:(("node",pid=496755,fd=21))

$ curl -s http://localhost:3001/health
{"ok":true,"uptime":3.145642913}          ← 满足 {"ok":true} 验收条件

journalctl -u smart-fan-web-backend:
  Smart Fan Backend: http://localhost:3001  (MQTT: mqtt://localhost:1883)
  [mqtt] connected to mqtt://localhost:1883
```

### 步骤 4 —— Web 前端

```bash
cd /opt/smart-fan/smart-fans-system/web/frontend
npm ci
npm run build     # tsc && vite build
```

```
dist/index.html                  0.57 kB │ gzip:   0.39 kB
dist/assets/index-ly3Okv64.js  600.57 kB │ gzip: 170.25 kB
✓ built in 4.27s
```

按 deploy.md §4.3「开发模式」启动（nginx 未安装，见 §8 F6）：

```
smart-fan-web-frontend: active / enabled
LISTEN 0  511  0.0.0.0:5173  0.0.0.0:*  users:(("node",pid=497130,fd=22))

$ curl -o /dev/null -w "%{http_code}" http://localhost:5173/            → 200
$ curl -o /dev/null -w "%{http_code}" http://localhost:5173/src/main.tsx → 200
$ curl -s http://localhost:5173/health                                   → 200（vite 代理生效）
$ curl -s http://localhost:5173/api/devices                              → {"ok":true,"data":[...]}  ← 代理 /api 生效
```

**控制台端到端验证（模拟浏览器 WebSocket 客户端）：**

```
WS OPEN -> ws://localhost:3001
[1] type=connected  bytes=58
[2] type=devices    bytes=1420  devices=1 first=smoke-test-device
[3] type=devices    bytes=1420  devices=1 first=smoke-test-device
[4] type=devices    bytes=1420  devices=1 first=smoke-test-device
TOTAL MESSAGES IN 7s: 4          ← 2s 推送周期，与 WS_PUSH_INTERVAL_MS=2000 一致
```

即 MQTT 发布 → 后端缓存 → WebSocket 推送链路真实可用。

### 步骤 5 —— Go Agent（唯一出现问题的步骤）

**5.1 构建（成功，但依赖联网自动换工具链）**

```
$ cd /opt/smart-fan/smart-fans-system/agent && make build
go build -o build/smart-fan-agent ./cmd/agent
go: downloading go1.25.0 (linux/amd64)          ← 关键：自动下载新工具链
Built: build/smart-fan-agent                    → 9,495,965 bytes
```

**5.2 写入配置（deploy.md §3.2 原文，broker 改指本机）**

`/etc/smart-fan-agent/config.yaml`：`broker: "mqtt://localhost:1883"`、`interval: 5`、`gpu_enabled: true`。

**5.3 `sudo bash install.sh` 成功，但服务启动失败（P0 阻断）**

```
$ systemctl start smart-fan-agent
$ systemctl status smart-fan-agent
     Active: activating (auto-restart) (Result: exit-code)
    Process: 490017 ExecStart=/usr/local/bin/smart-fan-agent (code=exited, status=216/GROUP)

$ journalctl -u smart-fan-agent
  /etc/systemd/system/smart-fan-agent.service:8: Special user nobody configured, this is not safe!
  (an-agent)[489638]: smart-fan-agent.service: Failed to determine group credentials: No such process
  systemd[1]: smart-fan-agent.service: Main process exited, code=exited, status=216/GROUP
  systemd[1]: Failed with result 'exit-code'.   ← Restart=always 导致无限重启
```

**根因定位：**

```
$ getent passwd nobody
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
$ getent group nobody
（空）                                    ← Ubuntu 24.04 没有 nobody 组
$ getent group 65534
nogroup:x:65534:                         ← 该 gid 的组名是 nogroup
```

即 `agent/smart-fan-agent.service` 第 9 行 `Group=nobody` 引用了不存在的组。**这不是本机特例，Debian/Ubuntu 系一律如此。**

**处置：**遵守"不修改仓库代码"约束，**未改动仓库**，改为在主机侧加 systemd drop-in 绕过，以便继续验证其余链路：

```
/etc/systemd/system/smart-fan-agent.service.d/10-verify-group-workaround.conf
[Service]
Group=nogroup
```

**5.4 绕过后的结果（全部正常）**

```
smart-fan-agent: active / enabled  (Main PID 496934)

journalctl -u smart-fan-agent:
  Smart Fan Agent starting — broker=mqtt://localhost:1883 hostname=ai serial=/dev/ttyACM0 relay=false
  [mqtt] connected to mqtt://localhost:1883
  [gpu] nvidia-smi available, GPU monitoring enabled
```

**周期发布已确认（mosquitto_sub 抓包，interval=5s）：**

```
system-monitor/ai/sensor/system {"collector":"system","timestamp":1790872466,"metrics":{"cpu_utilization_pct":0,"disk_total_gb":1006.97,"disk_used_gb":620.68,"load_15m":0.55,"load_1m":0.82,"load_5m":0.8,"memory_avail_kb":39044544,"memory_total_kb":45963676,"memory_used_pct":15.05}}
system-monitor/ai/sensor/gpu    {"collector":"gpu","timestamp":1790872467,"metrics":{"gpu0.memory_total_mb":16384,"gpu0.memory_used_mb":0,"gpu0.power_w":45.63,"gpu0.temperature_c":50,"gpu0.utilization_pct":0}}
system-monitor/ai/sensor/system {...timestamp":1790872471...}
system-monitor/ai/sensor/gpu    {...timestamp":1790872472...}
```

**Agent 订阅侧也已验证**（订阅 `fan-controller/+/sensor/#` 与 `+/alert`）——冒烟测试期间 journal 实时命中：

```
[sensor] fan-controller/smoke-test-device/sensor/bme280
[alert]  fan-controller/smoke-test-device/alert {"...","alert_type":"temperature_high","severity":"critical",...}
[sensor] fan-controller/smoke-test-device/sensor/bme280/buffered    ← 五级 topic 也吃到
```

**环境相关说明（均属正常）：**
- 未启用 `--relay`：`/dev/ttyACM0` 不存在（无真机），符合预期。
- 本机**有** NVIDIA Tesla V100-SXM2-16GB 且 `nvidia-smi` 可用，故 GPU 采集**真实启用**而非降级；`fan.speed` 字段因 V100 返回 `[N/A]` 被 `ParseFloat` 跳过（`gpu.go:74`），属优雅降级，无报错。

### 步骤 6 —— 冒烟测试

**冷重启全部 4 个服务后**从仓库根目录执行：

```bash
cd /opt/smart-fan/smart-fans-system
./test/smoke_test.sh localhost localhost
```

```
mosquitto                    active / enabled
smart-fan-web-backend        active / enabled
smart-fan-agent              active / enabled
smart-fan-web-frontend       active / enabled
```

完整输出（ANSI 已剥离）：

```text
[INFO] Starting Smart Fan Controller smoke test
[INFO] Broker: localhost, API: http://localhost:3001/api

[INFO] CP1: Web backend health check
[PASS] CP1: Web backend /health → ok
[INFO] CP2: MQTT Broker connectivity
[PASS] CP2: MQTT Broker reachable at localhost
[INFO] CP3: Simulate device online status
[PASS] CP3: Device online message published
[INFO] CP4: Web backend subscribes and caches device
[PASS] CP4: Web API /api/devices shows simulated device
[INFO] CP5: Simulate BME280 sensor data
[PASS] CP5: BME280 sensor data published
[INFO] CP6: Simulate fan state data
[PASS] CP6: Fan state data published
[INFO] CP7: REST API fan speed control → MQTT command
[PASS] CP7: Fan speed control API returned ok
[PASS] CP7: command/fan payload captured with duty_pct=75
[INFO] CP8: Simulate alert and verify API
[PASS] CP8: Alert message published
[INFO] CP9: OTA trigger via REST API
[PASS] CP9: OTA trigger API ok
[INFO] CP10: Zod validation rejects invalid input
[PASS] CP10: Invalid fan speed (999) returns HTTP 400
[INFO] CP11: Home Assistant YAML files existence and format
[PASS] CP11: ha/sensors.yaml exists
[PASS] CP11: ha/fans.yaml exists
[PASS] CP11: ha/alerts.yaml exists
[PASS] CP11: ha/README.md exists
[PASS] CP11: ha/sensors.yaml has 17 state_topic entries (≥5)
[INFO] CP12: Protocol documentation completeness
[PASS] CP12: Protocol doc topic definitions present (Topic sections=18, template refs=31)
[PASS] CP12: Protocol doc has 17 sensor references
[INFO] CP13: Curve command via REST API → command/curve
[PASS] CP13: command/curve payload has protocol §4.2 fields
[PASS] CP13: Invalid temperature_source rejected (HTTP 400)
[INFO] CP14: reset command semantics (confirm flag)
[PASS] CP14: protocol §4.4 documents command/reset + confirm gate
[PASS] CP14: reset (confirm:false) published — device must ignore
[INFO] CP15: alert rules endpoint → config/alert
[PASS] CP15: config/alert payload with dual thresholds captured
[INFO] CP16: ota/status progress → web backend cache
[PASS] CP16: ota/status progress cached and exposed via REST
[INFO] CP17: buffered topic ingestion (sensor/# subscription)
[PASS] CP17: buffered (5-level) sensor topic ingested via sensor/#

================================================
  Smoke Test Summary
================================================
  PASS: 25    FAIL: 0
================================================
✓ All 25 checks PASSED

[root@192.168.3.131 /root]$
```

**结果：PASS 25 / FAIL 0，退出码 0。连续 3 次运行结果一致（无 flaky）。**

**失败项分析：无。** 25 项全部通过，无跳过、无重试、无偶发。

> 需要说明的是，25 项中有 **8 项是静态断言**（CP11 的 5 项检查 HA YAML 文件与计数、CP12 的 2 项 grep 协议文档、CP14 的 1 项 grep 文档），它们与运行时部署状态无关。真正覆盖运行时链路的是其余 **17 项**（CP1–CP10 中的 12 项 + CP7 的报文捕获、CP13 的 2 项、CP14 的发布、CP15/CP16/CP17）。所以"25/25"应理解为"运行时 17 项 + 静态 8 项全通过"。

---

## 2. 最终部署状态

| 组件 | 单元 | 状态 | 监听 |
|---|---|---|---|
| MQTT Broker | `mosquitto` | active / enabled | `0.0.0.0:1883` + `[::]:1883` (anon) |
| Web 后端 | `smart-fan-web-backend` | active / enabled | `*:3001` |
| Web 前端 | `smart-fan-web-frontend` | active / enabled | `0.0.0.0:5173` |
| Go Agent | `smart-fan-agent` | active / enabled（含 drop-in） | 无监听（发布方） |

访问入口：控制台 `http://192.168.3.131:5173`；API `http://192.168.3.131:3001/api`；Broker `mqtt://192.168.3.131:1883`。

---

## 3. 仓库完整性

```
$ git rev-parse HEAD
a55928fb82c10547ca8364b2582dad27f11bd750     ← 与克隆时一致
$ git status --porcelain
（空）                                        ← 无修改
$ git diff HEAD --stat
（空）
```

验证过程中唯一被触碰的仓库文件是 `test/smoke_test.sh` 的**权限位**——因为 deploy.md §验证命令要求 `chmod +x test/smoke_test.sh`，而该文件在 git 中记录为 `100644`：

```
$ git ls-files -s test/smoke_test.sh
100644 19a5908d10c9dae0ef1de8a2b1c3ca044d80170a 0   test/smoke_test.sh
$ git diff HEAD -- test/smoke_test.sh
old mode 100644
new mode 100755
```

验证结束后已 `chmod 644` 还原，现工作区与 HEAD 完全一致。**内容零改动**。</br>
（这本身是 deploy.md 的一个小缺陷，见 §8 F4。）

---

## 4. 未运行 / 未覆盖

| 项 | 原因 |
|---|---|
| `test/e2e/integration_test.sh` | 任务明确禁止：需真机固件上报，无设备必然 FAIL |
| `firmware` 编译与烧录（deploy.md §1） | 非硬件部分，无 ESP32-S3 / ESP-IDF |
| Home Assistant 集成（deploy.md §5） | 环境无 HA 实例 |
| nginx 反向代理（deploy.md §4.3） | 目标机未安装 nginx；已做静态审查并列出问题（F5/F6） |
| OTA 实际升级流程（deploy.md §6） | 需真机接收 `command/ota` 并回滚验证 |

---

## 5. 环境差异说明

- 目标机预装 Node v22.22.1（非 deploy.md 建议的 nodesource 20.x），构建与运行均正常，满足"Node 20+"要求。
- Ubuntu 24.04 的 `apt install golang-go` 实际给 **1.22.2**，与 go.mod 的 1.25.0 要求冲突（F2）。
- GPU 环境与任务假设不同：本机有真 V100，故 GPU 采集走"可用"分支而非降级分支；降级分支通过源码审查确认（`gpu.go:25-28` 在找不到 nvidia-smi 时仅打日志并禁用，不会崩溃）。

---

## 6. 对交付目标"PASS=25 FAIL=0"的达成情况

**达成。** 25/25 全部通过，退出码 0，且冷重启后复现一致。无失败项需要逐条记录。

---

## 7. 复现命令（从零到绿）

```bash
# 1) 依赖
apt-get update && apt-get install -y mosquitto mosquitto-clients golang-go make
# （Node 20+ 已存在或按 deploy.md 装）

# 2) 克隆
git clone https://github.com/OneAsmallFish/smart-fans-system.git /opt/smart-fan/smart-fans-system
cd /opt/smart-fan/smart-fans-system && git checkout a55928f

# 3) Broker（deploy.md §2）
printf 'listener 1883\nallow_anonymous true\n' > /etc/mosquitto/conf.d/fan-ctrl.conf
systemctl restart mosquitto && systemctl enable mosquitto

# 4) 后端
cd web/backend && npm ci && npm run build
MQTT_BROKER=mqtt://localhost:1883 PORT=3001 npm start   # 或用 systemd 常驻

# 5) 前端
cd ../frontend && npm ci && npm run build
npm run dev -- --host 0.0.0.0 --port 5173               # 局域网访问需 --host

# 6) Agent
cd ../../agent && make build
mkdir -p /etc/smart-fan-agent   # 先写 config.yaml（broker 指向本机），install.sh 不会覆盖已存在的配置
bash install.sh
# ⚠ 此处会踩 P0：Group=nobody 不存在。绕过：
mkdir -p /etc/systemd/system/smart-fan-agent.service.d
printf '[Service]\nGroup=nogroup\n' > /etc/systemd/system/smart-fan-agent.service.d/10-group.conf
systemctl daemon-reload && systemctl restart smart-fan-agent

# 7) 冒烟
cd /opt/smart-fan/smart-fans-system
./test/smoke_test.sh localhost localhost     # 期望 PASS: 25  FAIL: 0
```

**回滚：**
```bash
systemctl disable --now smart-fan-agent smart-fan-web-backend smart-fan-web-frontend
rm -rf /etc/systemd/system/smart-fan-agent.service.d /etc/systemd/system/smart-fan-web-*.service
rm -rf /etc/smart-fan-agent /usr/local/bin/smart-fan-agent /etc/mosquitto/conf.d/fan-ctrl.conf
systemctl daemon-reload && systemctl restart mosquitto
```

---

## 8. deploy.md 需修订之处清单

按严重度排序。"证据"均为本次实测。

### F1 🔴 P0 阻断 —— §第三步（Go Agent 部署）：systemd 单元 `Group=nobody` 在 Ubuntu/Debian 上不存在

- **现象**：`systemctl start smart-fan-agent` 后服务无限重启，agent 从未运行。
- **证据**：
  - `Failed to determine group credentials: No such process`
  - `Main process exited, code=exited, status=216/GROUP`
  - `getent group nobody` 为空；`getent group 65534` → `nogroup:x:65534:`
  - 另有警告：`Special user nobody configured, this is not safe!`
- **涉及文件**：`agent/smart-fan-agent.service:9`（`Group=nobody`）、`agent/install.sh`
- **建议**：
  1. 仓库侧把 `Group=nobody` 改为 `Group=nogroup`（或在 install.sh 中探测并回退）；
  2. deploy.md §3 增加一句说明与排障条目（FAQ 表加一行 "agent 启动即退出 / status=216"）；
  3. `User=nobody` 亦建议改为专用低权用户（systemd 已就此告警）。
- **备注**：这是本次部署**唯一**需要主机侧干预才能继续的问题。

### F2 🟠 P1 高危 —— §前置条件：Go 版本要求与实际不符

- **现象**：deploy.md 写 "Go 1.22+"，`sudo apt install golang-go` 在 Ubuntu 24.04 装的是 **1.22.2**；但 `agent/go.mod:3` 要求 `go 1.25.0`。
- **证据**：
  - 构建时出现 `go: downloading go1.25.0 (linux/amd64)`，即靠 GOTOOLCHAIN=auto 联网补下工具链才成功；
  - 强制本地工具链即失败：`GOTOOLCHAIN=local go build` → `go: go.mod requires go >= 1.25.0 (running go 1.22.2; GOTOOLCHAIN=local)`，退出码 1。
- **影响**：离线 / 内网 / `proxy.golang.org` 不可达的环境**必然构建失败**；且 `go version` 仍显示 1.22.2，排障时极易误判。
- **建议**：前置条件表改为 "Go 1.25+"，或注明需允许 `GOTOOLCHAIN=auto` 自动下载；同时补 `GOFLAGS/GOPROXY` 说明（国内建议 `GOPROXY=https://goproxy.cn,direct`，实测可达）。

### F3 🟡 P2 —— §第二步：自带验证命令的订阅与发布 topic 不匹配，无法自证

- **原文**：
  ```bash
  mosquitto_sub -h localhost -t "fan-controller/+" -v &
  mosquitto_pub -h localhost -t "test" -m "hello"
  ```
- **问题**：发布到 `test`，订阅的是 `fan-controller/+`，永远收不到 —— 配置正确时也"看起来没反应"，会误导排障。
- **建议**：改为 `mosquitto_pub -h localhost -t "fan-controller/verify" -m "hello"`（本次已按此复验成功）。

### F4 🟡 P2 —— §验证命令：`chmod +x test/smoke_test.sh` 会弄脏工作区

- **证据**：`git ls-files -s test/smoke_test.sh` → `100644`；执行 chmod 后 `git diff HEAD` → `old mode 100644 / new mode 100755`。
- **影响**：脚本带 shebang 却未以可执行位提交，照文档操作后 `git status` 不再是干净树，CI 的"工作区必须干净"检查会误报。
- **建议**：二选一 —— ① 把该文件以 `100755` 提交（`git update-index --chmod=+x`）；② 文档改写为 `bash test/smoke_test.sh …` 并删掉 chmod 步骤。

### F5 🟡 P2 —— §4.3 nginx：`root` 路径与克隆位置对不上

- **原文**：`root /opt/smart-fan/web/frontend/dist;`
- **问题**：deploy.md 通篇未规定克隆到哪；常规 `git clone` 得到的是 `<目录>/smart-fans-system/web/frontend/dist`。本次实际路径为 `/opt/smart-fan/smart-fans-system/web/frontend/dist`，与文档字面差一级。
- **建议**：文档显式给出克隆目标（如 `git clone … /opt/smart-fan/smart-fans-system`），并把 `root` 更正为对应路径。

### F6 🟡 P2 —— §4.3 nginx 方案不完整：缺 nginx 安装步骤，且前端 WebSocket 绕过代理直连 3001

- **证据 A**：目标机 `nginx` 未安装，文档未给 `apt install nginx`；且该节标注"可选"，读者易以为 `npm run dev` 之外无代价。
- **证据 B**：前端 5 个页面硬编码 WS 地址
  ```
  web/frontend/src/pages/{Dashboard,Fans,Alerts,History,Devices}.tsx:
    const WS_URL = `ws://${window.location.hostname}:3001`
  ```
  因此即便前面挂了 nginx，浏览器仍需**直连 3001**，反向代理并未真正收口；这与 §「Web 层安全声明」希望避免直接暴露 3001 的意图相矛盾。
- **证据 C**：硬编码 `ws://` 在 HTTPS 部署下会被浏览器按混合内容拦截（应为 `wss://`）。
- **建议**：① 补 `apt install nginx` 与 reload 步骤；② 若确要走 nginx 收口，需给 nginx 加 `location /ws { proxy_pass http://localhost:3001; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }`，并把前端 WS_URL 改为相对路径（`(location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws'`）；③ 或在文档中明确声明"3001 必须对浏览器可达"，不要暗示 nginx 能替代它。

### F7 🟢 P3 —— §3.2 配置示例含已删除字段 `port: 1883`

- **证据**：`agent/internal/config/config.go` 的 `MQTTConfig` 已无 `Port` 字段（注释标注 AG-06 已把端口并入 broker URL）。yaml.v3 忽略未知键，故按文档原样写也能启动（本次实测启动正常），但属误导。
- **另**：文档示例缺 `username` / `password`，而仓库 `agent/config.yaml` 里有这两个字段。
- **建议**：§3.2 示例直接与 `agent/config.yaml` 对齐，删除 `port`，补 `username`/`password`。

### F8 🟢 P3 —— §验证命令未给出冒烟测试的通过标准

- 只写了命令，没写期望结果。建议补一句"期望输出 `PASS: 25  FAIL: 0`，任一 FAIL 退出码非 0"，便于自动化/人工判断。

### F9 🟢 P3 —— §4.1 用 `npm install`、且未给后端常驻方案

- 两个 lockfile 均已提交（`web/backend/package-lock.json`、`web/frontend/package-lock.json`），可复现性应以 `npm ci` 为准。
- `npm start` 是前台进程；文档未给 pm2/systemd 落地示例（任务本身也提到"或 pm2/systemd 常驻"）。建议补 systemd 单元样例。

### F10 🟢 P3 —— §4.3 开发模式未提 `--host`，局域网访问不了

- 文档写"前端: `http://localhost:5173`"，但 vite 默认只绑 localhost；作为"局域网控制台"需要 `npm run dev -- --host`。本次实测加 `--host 0.0.0.0` 后才监听 `0.0.0.0:5173`。

### F11 🟢 P3 —— §前置条件未列 `git` / `curl`

- 后续步骤依赖 `git clone` 与 `curl`（§4.1 之外，冒烟脚本自身也要求 `mosquitto_pub/sub`、`curl`）。建议在依赖表补齐。

---

## 9. 文档与实际不符（deploy.md 之外）

### D1 —— `docs/protocol.md` §"Go Agent侧" 漏记 `system` 采集 topic

- **文档**（protocol.md:527）：只写了 `发布GPU/CPU数据到自定义Topic \`system-monitor/{hostname}/sensor/gpu\``。
- **实际**：agent 同时发布 **两个** topic，本次实抓：
  ```
  system-monitor/ai/sensor/system
  system-monitor/ai/sensor/gpu
  ```
  `system-monitor` 在 protocol.md 全文仅出现 **1 次**，`.../sensor/system` 未被文档化。
- **建议**：protocol.md 与 `agent/internal/mqtt/client.go:86` 对齐，明确 collector 名即 topic 末段（`system` / `gpu`）。

### D2 —— Agent 指标不会出现在 Web 控制台（数据流"断点"，建议在文档中显式说明）

- **实测**：agent 发布到 `system-monitor/#`；Web 后端只订阅 `fan-controller/#`（`web/backend/src/mqtt.ts:41-45`）。
- **结果**：`curl /api/devices` 中**没有** agent 主机（`ai`）—— agent 的 CPU/GPU 指标只对 MQTT 订阅方（如 HA）可见，Web 控制台看不到。
- **判断**：从 protocol.md 看这**很可能是设计如此**（agent 是服务端指标源，控制台面向 ESP32 设备），但 deploy.md 第 3、4 步连着写，读者极易以为"部署完 agent，控制台就能看到服务器 CPU/GPU"。
- **建议**：在 deploy.md §3 或 §4 加一句数据流说明，避免误判为部署失败。

### D3 —— 冒烟测试中 8/25 项是静态断言

- CP11（5 项）只检查 `ha/*.yaml` 存在与 `state_topic` 计数；CP12（2 项）只 grep `docs/protocol.md`；CP14 的 1 项也只 grep 文档。
- 这些检查在"Mosquitto/后端都没起来"的机器上同样会 PASS。若不看穿这一点，`25/25` 会被高估为"全链路已验证"。
- **建议**：deploy.md 的验证章节注明"其中 8 项为文档/静态资源断言，运行时链路以 CP1–CP10、CP13、CP15–CP17 为准"。

---

## 10. 其他观察（无需修订，供参考）

1. 后端 `/health` 返回 `{"ok":true,"uptime":…}`，冒烟用 `grep '"ok":true'` 判定，与 mode 无关，稳健。
2. `install.sh` 对已存在的 `/etc/smart-fan-agent/config.yaml` 采取"保留"策略（`install.sh:30-35`），与 deploy.md §3 先写配置再安装的顺序相容，本次实测输出 `Existing config preserved.`。
3. Agent 的 paho 客户端 `SetConnectRetry(true)` + `AutoReconnect`，冷重启 mosquitto 后能自动恢复；本次冷重启全链路复测 25/25 通过。
4. `ProtectSystem=strict` / `ProtectHome=yes` / `NoNewPrivileges=yes` 下 agent 读取 `/etc/smart-fan-agent/config.yaml` 与调用 `nvidia-smi` 均正常。
5. 前端产物 `dist/assets/index-*.js` 单包 600 kB（gzip 170 kB），vite 已给出 chunk 体积警告，属优化项非缺陷。

---

## 11. 附：验证过程中使用的主机侧改动（均不改仓库）

| 位置 | 内容 | 原因 |
|---|---|---|
| `/etc/systemd/system/smart-fan-agent.service.d/10-verify-group-workaround.conf` | `[Service] Group=nogroup` | 绕过 F1，使验证得以继续 |
| `/etc/systemd/system/smart-fan-web-backend.service` | 后端常驻单元 | deploy.md 未提供常驻方案 |
| `/etc/systemd/system/smart-fan-web-frontend.service` | 前端 vite dev 单元（`--host 0.0.0.0`） | 同上 |
| `/etc/mosquitto/conf.d/fan-ctrl.conf` | `listener 1883` / `allow_anonymous true` | deploy.md §2 原文 |
| `/etc/smart-fan-agent/config.yaml` | deploy.md §3.2 原文，broker 指向本机 | deploy.md §3 原文 |

> 另：曾在 129.204.51.198（wyu-lighthouse，Ubuntu 24.04）试部署，因改用 192.168.3.131 已**完整回滚**（卸载 mosquitto/mosquitto-clients/golang-go/nodejs，移除 nodesource 源与 /opt/smart-fan，删除临时克隆），该机 6 个 docker 工作负载与 docker.service 均正常未受影响。
