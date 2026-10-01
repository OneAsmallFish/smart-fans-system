# 模块整改清单 v1.2（Module Remediation Plan）

> 依据：`docs/module-review-report.md` v1.0（2026-08-24，75 条发现：12 Critical / 32 Major / 27 Minor / 4 Info）。
> 硬件部分（原理图/PCB/BOM/硬件文档）由 `hardware/docs/remediation-plan-v1.2.md`（v1.2.1）承接，
> 本清单只负责固件非引脚类问题与 agent / web / ha / test / docs——唯一例外是指针项 Phase 0-7（执行硬件清单 H-03）。
> 本文档是给整改执行 agent 的**唯一权威依据**；与审查报告"建议修法"冲突时以本文档的裁决为准。

---

## 0. 执行总则（防偷懒硬规则）

| # | 规则 |
|---|------|
| E1 | **逐项销号**：§2~§5 每个整改项（FW/AG/WEB/HA/TST/DOC 编号）必须在 `docs/changelog-modules-v1.2.md` 中逐项勾选，附验证证据（命令+输出摘录，或 file:line）。§7 映射表 75 条发现必须有去向，不得出现"已处理"但无对应项编号。 |
| E2 | **阶段门**：Phase 0 全绿前不得开始 Phase 1；Phase 1 全绿前不得开始 Phase 2。每阶段完成后先跑 §6 对应验收再进入下一阶段。 |
| E3 | **环境缺失即 BLOCKED**：`idf.py build` 需 ESP-IDF v5.3+（审查时 BLOCKED，整改必须补做）；agent 构建需 Go 1.22+（建议 Linux 或 GOOS=linux 交叉）；web 需 Node 18+。缺环境时该项标 `BLOCKED:<原因>` 并继续其他项，**不得**推断结果。 |
| E4 | **裁决表是协议冲突的唯一裁决**（§1）。执行中不得自行改判"协议改还是实现改"；发现裁决表未覆盖的新冲突时，停下来在 changelog 中登记为"待裁决"，不要擅自处理。 |
| E5 | **最小改动**：只改整改项涉及的行为；禁止顺手重构、禁止引入新依赖（唯一例外：AG-01 允许升级 paho.mqtt.golang）；禁止删除测试。 |
| E6 | **协议修订集中一次完成**：所有 protocol.md 的修改归入 DOC-01，按 §1 裁决表逐条执行，禁止散落各处自行改协议。 |

---

## 1. 协议裁决表（protocol.md 为真源；每条裁决给出执行方向）

| # | 冲突点（审查报告证据） | 裁决 | 执行方向 |
|---|------------------------|------|----------|
| ADJ-1 | timestamp 开机秒 vs Unix 秒（MA-12/MC-12） | **实现改协议** | 固件全部 `time(NULL)`；SNTP 未同步时值仍为 Unix 早期，web 判 `timestamp < 1000000000` 显示"时间未同步"（WEB-07） |
| ADJ-2 | alert_type 数字 vs 字符串+severity+sensor（MA-10/表5） | **实现改协议** | 固件建 type 枚举→字符串映射，payload 补 `severity`/`sensor`；web types 与 Alerts 页、ha/alerts.yaml 跟随（FW-16/WEB-06/HA-03） |
| ADJ-3 | OTA 触发 topic `{id}/ota`（协议§7）vs `command/ota`（固件/web/deploy 三方现状，MF-06） | **协议改实现** | protocol.md §7 改为 `command/ota`（与命令命名空间一致）；`ota/status` 反馈 topic 位置不变（DOC-01） |
| ADJ-4 | curve PID 嵌套（web）vs 平铺（协议§4.2）（MC-06） | **web 改协议** | devices.ts CurveSchema 的 pid 字段平铺到顶层 |
| ADJ-5 | temperature_source 字符串（协议/web）vs 数字 0-3（固件）（MC-06） | **协议为准，固件加映射** | 协议枚举 4 个合法值 `bme280` / `ds18b20_0` / `ds18b20_1` / `internal`；固件 fan_curve 增加字符串→源编号映射函数（FW-20） |
| ADJ-6 | ds18b20 发 index vs 协议 address/valid（表4） | **实现改协议** | 固件按协议发 ROM 地址字符串 + `valid` 字段，无效项也上报（不跳过）；HA 按 address 匹配（FW-18/HA-04） |
| ADJ-7 | voltage/internal_temp 上报 1s vs 协议 5s（表4） | **实现改协议** | 固件改为 5s（同时降低离线队列/NVS 压力，配合 FW-07）；bme280/ds18b20 维持 1s（FW-19） |
| ADJ-8 | `alert/cleared` 幽灵 topic（MA-23）+ HA 四实体互踩（MD-03） | **协议补录新 topic** | 固件改发 **per-type retained 状态 topic** `fan-controller/{id}/alert/{type}/state`，payload `{active, severity, timestamp}`，retain=true；`alert` 事件 topic 保留（web 消费）；`alert/cleared` topic 删除。protocol.md §5 补录（FW-17/HA-03/DOC-01） |
| ADJ-9 | `config/{wifi,mqtt,alert,curve}` 全线未实现（表1#13） | **分级裁决** | `command/curve` 与 `command/reset`：实现（核心功能，FW-20）；`config/alert`：最小可用——set 保存 NVS+应用、get 回读（FW-20）；`config/wifi`/`config/mqtt`：**降级为 USB console 命令**（FW-22），protocol.md §6 对应小节标注"规划中，现行经 USB console 配置" |
| ADJ-10 | "HA 自动发现"虚假承诺（MA-23/MF-03，protocol §8/§11 亦含此承诺） | **裁剪** | 不实现 Discovery。README/ha/README 删除"自动发现"表述；protocol.md §8/§11 标注"规划中，现行方案为 ha/ 手动 packages"（DOC-01/DOC-04） |
| ADJ-11 | 文档教用的 console 命令 `fan`/`wifi` 不存在（MF-04） | **固件实现 fan/wifi/mqtt** | console 命令集扩展为 help/status/reboot/ota/**fan/wifi/mqtt**（FW-22）；deploy.md/assembly.md 命令示例对齐实际（DOC-02） |
| ADJ-12 | `/buffered` 离线补发两端未实现（MA-15） | **按协议实现** | 固件 flush 时 topic 加 `/buffered` 后缀 + payload `buffered:true`；web backend 订阅改 `sensor/#`（FW-07/WEB-04） |
| ADJ-13 | 风扇路数全项目 15 处口径 {2,4,4,...}（表2） | **统一为 8** | 唯一基准 = 硬件决策 D2（8 路）。固件宏/循环、web、ha、protocol 示例、README 全部改 8（H-03 连带 + WEB-03/HA-02/DOC-01/DOC-03） |
| ADJ-14 | 告警阈值四方四种口径（表5：78.5/80、单/双阈值等） | **以固件现行双阈值为准** | 12V 10.8–13.2V、5V ±0.25V、3.3V ±0.165V、温度 75°C 警告 / 80°C critical、停转 <200RPM 且 duty>5%、WiFi 断连 >60s。protocol 示例与 web 规则编辑器（AlertRuleEditor）改为双阈值模型（DOC-01/WEB-11） |

---

## 2. Phase 0 — 让"能构建"成立（P0，审查报告认定的最先决条件）

> 这 6 项 + 硬件 H-03 不修完，后续任何整改都无法验证（审查报告 §9.5 建议 1/2）。

**FW-01（MA-01）status_led 返回值类型**
- 动作：`status_led_init` 签名 `void` → `esp_err_t`（返回 ESP_OK / 底层错误），与其它组件风格一致；`main.c:371` 的 `ESP_ERROR_CHECK` 保持不变即合法。
- 验收：`idf.py build` 不再报该处编译错误（静态可先验：头文件与实现签名一致）。

**FW-02（MA-02）main 组件依赖**
- 动作：`firmware/main/CMakeLists.txt` 的 `REQUIRES` 补齐全部 13 个自定义组件：fan_pwm, fan_tach, fan_curve, alert_manager, bme280, ds18b20, power_monitor, status_led, wifi_manager, mqtt_client, usb_console, flash_storage, ota_handler。
- 验收：`idf.py build` 通过（与 FW-01 联合验证）。

**AG-01（MB-01）agent 编译修复**
- 动作：`gpu.go` 删除未用的 `"bytes"` import；生成并提交 `go.sum`。依赖卡点处理（creack/gopty 上游被删）：优先升级 `github.com/eclipse/paho.mqtt.golang` 到最新版后 `go mod tidy`；仍被阻断则 `go mod tidy -e` 生成 go.sum 并验证可构建；再不行 `go mod vendor` 提交 vendor 目录。
- 验收：`GOOS=linux go build ./... && go vet ./...` 通过；go.sum（或 vendor/）已入库。

**WEB-01（MC-02）web backend 构建链**
- 动作：新建 `web/backend/tsconfig.json`（module commonjs / target es2022 / outDir dist / strict / esModuleInterop / moduleResolution node / skipLibCheck / include src）；确认 `npm run build` 产出 `dist/server.js`，`npm start` 指向 dist 产物。
- 验收：`npm ci && npm run build` 后 `dist/server.js` 存在；类型检查通过（显式参数检查当前已通过，配置补齐后走正式脚本）。

**WEB-02（MC-01）web frontend 四件套**
- 动作：补 `web/frontend/tsconfig.json`、`vite.config.ts`（React 插件、dev server 代理 `/api` → backend 3001）、`index.html`、`src/main.tsx`（挂载 App，含全局样式如有）。
- 验收：`npm ci && npm run build` 产出 `dist/index.html` 与 assets；`npx tsc --noEmit` 通过。

**TST-01（ME-01）测试脚本自毁修复**
- 动作：两个脚本中所有 `((PASS++))` 改为 `PASS=$((PASS+1))`（`set -e` 下安全）。
- 验收：`grep -rn "((PASS++))" test/` 为空；脚本可执行到末尾输出汇总（无外部工具时按脚本自身前置检查跳过并注明）。

**Phase 0-7（指针项，MA-07/MA-21/MA-34）硬件引脚同步**
- 动作：执行 `hardware/docs/remediation-plan-v1.2.md` §4 H-03（v1.2.1 扩展版：引脚数组 + 分压比 ÷5.7/÷6.0 + console 路由 USB-CDC + 五处路数硬编码）。
- 验收：硬件清单 H-03 的 8 条 grep 全部通过。

---

## 3. Phase 1 — 通信链路与安全（P1：设备能收到命令、OTA 不回滚、告警不漏报、上电安全）

### MQTT 链路

**FW-03（MA-03）订阅时机**
- 动作：订阅逻辑移入 `MQTT_EVENT_CONNECTED` 事件处理（或在 `mqtt_subscribe` 中缓存 topic、连接后补订）。修复后设备必须能收到 command 下行。
- 验收：代码中订阅调用位于连接建立路径；真机或 mosquitto 模拟环境下发 `command/fan` 能触发 handler（无环境则 BLOCKED 标注）。

**FW-04（MA-35）订阅范围与 device_id 校验**
- 动作：订阅串由 `fan-controller/+/command/#` 改为 `fan-controller/{device_id}/command/#`（协议 §11 本来如此定义）；handler 增加防御性校验（topic 中的 device_id 与本机一致才执行）。
- 验收：`grep -n "command/#" firmware/main/main.c` 显示订阅串含具体 device_id 变量而非 `+`。

**FW-05（MA-04）定时器句柄误传**
- 动作：WiFi 连接定时器回调改为真正以 `NULL` 调用 `mqtt_client_connect(NULL)`（用 pvTimerGetTimerID 传参或独立标志位），删除"Pass NULL"与实际不符的注释。
- 验收：代码审查确认无 `TimerHandle_t` 被当作 `broker_url` 传递的路径。

**FW-06（MA-13）NVS 误擦除**
- 动作：离线队列 flush 不得 `nvs_erase_all`（会把 broker_url 一并删除）。队列条目改用独立 key 前缀或独立 namespace，flush 时逐 key 删除。
- 验收：`grep -n "erase_all" firmware/components/mqtt_client/` 为空（wifi_manager 的 MA-28 是另一项，见 FW-28）。

**FW-07（MA-14 + MA-15 + ADJ-7/ADJ-12）离线队列与 buffered 重发**
- 动作：① 启用已创建的 `s_queue_mutex` 保护 push/flush 并发；② 队列改环形 key 复用（固定 N 个 key 轮转），消除满队后每条消息重写 50 blob 的写放大；③ 入队降频（sensor 类消息离线时最多 30s 一条，协议 §10 口径）；④ flush 时 topic 加 `/buffered` 后缀、payload 加 `buffered:true`（ADJ-12）。
- 验收：代码审查 + `grep -n "buffered" firmware/components/mqtt_client/mqtt_client_wrapper.c` 命中后缀与标记逻辑。

### OTA 链路

**FW-08（MA-05）OTA 确认接线**
- 动作：`MQTT_EVENT_CONNECTED`（或连接后首次成功 publish）时，若当前运行分区处于 pending-verify 状态则调用 `ota_handler_confirm_mqtt()`，杜绝 5 分钟回滚循环。
- 验收：`grep -rn "ota_handler_confirm_mqtt" firmware/` 出现非定义/非声明的调用点。

**FW-09（MA-17）OTA TLS 证书**
- 动作：`esp_http_client_config_t` 增加 `.crt_bundle_attach = esp_crt_bundle_attach`，sdkconfig 启用证书 bundle；删除"证书验证已启用"的失真注释（现在才为真）。
- 验收：grep `crt_bundle` 命中 ota_handler.c 与 sdkconfig。

**FW-10（MA-22）ota/status 进度上报**
- 动作：ota_task 周期发布 `fan-controller/{id}/ota/status`（协议 §7 的 state/progress_pct/message），连接成功后生效。
- 验收：grep 命中 `ota/status` 发布代码；WEB-04 订阅后前端可见进度。

### 告警与上电安全

**FW-11（MA-06）停转告警条件反转**
- 动作：告警条件由 `rpm > 0 && rpm < 200` 改为 `duty > 5 && rpm < 200`（完全堵转 0 RPM 必须告警；0% 占空比合法停转除外）。fan_pwm 提供当前 duty 的 getter 或 alert_manager 接收 duty。
- 验收：代码审查；条件表达式中不存在 `rpm > 0` 前置。

**FW-12（MA-18）初始化顺序（风扇安全先于联网）**
- 动作：app_main 顺序调整为：LEDC/PWM → Tach → 曲线 → status_led/alert → 传感器 → usb_console → WiFi/MQTT 最后。WiFi/MQTT 初始化失败不再 abort/重启循环：记日志、进入本地模式、后台重试。
- 验收：代码顺序 diff；`ESP_ERROR_CHECK(wifi_manager_*)` 移除改错误日志。

**FW-13（MA-19 固件侧）上电安全态**
- 动作：app_main 最早（任何外设/网络初始化之前）配置 8 路 LEDC 通道 duty=0，缩短缓冲输入悬空窗口；与硬件下拉（硬件清单 H-17）双保险。
- 验收：LEDC 初始化位于 app_main 前几行（代码审查）。

### Payload 语义

**FW-14（MA-11）LWT/online 字段补全**
- 动作：LWT payload 与协议 §1.2 逐字段对齐（status/device_id/timestamp）；online 报文补齐 §1.1 的 timestamp/firmware_version/ip_address/uptime_seconds。
- 验收：与 protocol.md §1 逐字段比对表贴入 changelog。

**FW-15（MA-12 + ADJ-1）timestamp 语义**
- 动作：全部上报点 `esp_timer_get_time()/1000000` → `time(NULL)`。
- 验收：`grep -rn "esp_timer_get_time" firmware/main/ firmware/components/mqtt_client/` 中 timestamp 用途为空。

### agent 与 HA

**AG-02（MB-02）agent main.go 接线**
- 动作：完成空壳 TODO：加载配置 → MQTT 连接（含重连循环）→ 按采集周期发布 `system-monitor/{hostname}/sensor/{gpu,cpu,...}`（hostname 用 `os.Hostname()`，不用 ClientID）→ 订阅 `fan-controller/+/sensor/#` 与 `+/alert`（协议 §11，用途：告警转发系统日志）→ 信号处理优雅退出。USB relay 按 AG-08 定位为可选功能（默认关闭）。
- 验收：`go build` 通过；Linux 环境跑 `./agent` 连本地 broker，`mosquitto_sub -t 'system-monitor/#'` 能收到周期数据（无环境 BLOCKED）。

**HA-01（MD-01）占位 device_id 机制**
- 动作：`ha/*.yaml` 的 `esp32-placeholder` 统一改为显眼占位 `__DEVICE_ID__`；ha/README 增加"获取 device_id（订阅 status topic 或看固件启动日志）+ sed 批量替换"的安装步骤。注意：FW-04 修复通配订阅后，不替换 device_id 的 HA 配置将真正失效（当前是两个缺陷互相掩盖）。
- 验收：`grep -rn "esp32-placeholder" ha/` 为空；README 含替换说明。

---

## 4. Phase 2 — 协议对齐（P1，按 §1 裁决表执行）

### 固件

**FW-16（ADJ-2 / MA-10）alert schema**
- 动作：type 枚举→字符串映射表（temperature_high/fan_stall/voltage_abnormal/wifi_disconnected）；payload 补 `severity`（warning/critical，按 alert_manager 级别映射）与 `sensor` 字段；发送协议 §5 的完整字段。

**FW-17（ADJ-8 / MA-23）per-type 告警状态 topic**
- 动作：新增 `fan-controller/{id}/alert/{type}/state`（retain=true，payload `{active, severity, timestamp}`），告警触发/恢复时更新；删除 `alert/cleared` topic 的发布代码（web/HA 均不消费，由状态 topic 取代）。

**FW-18（ADJ-6）ds18b20 address/valid**
- 动作：上报改为协议 §2.2 的 `address`（ROM 地址字符串）+ `valid` + `temperature_c`；无效读数不再跳过，`valid:false` 一并上报（消除 HA 按数组位置取值的索引移位问题）。

**FW-19（ADJ-7）上报频率**
- 动作：voltage 与 internal_temp 改为 5s 周期（协议 §2.3/§2.4）；bme280/ds18b20 维持 1s。

**FW-20（ADJ-9 / MA-09 / MA-20 / ADJ-5）命令处理器补全 + 曲线持久化**
- 动作：① `command/curve` handler：解析协议 §4.2 schema（LUT points 数组、PID 平铺字段、`temperature_source` 字符串按 ADJ-5 映射为源编号）；② `fan_curve_set_lut/set_pid/set_temp_source` 接入调用并实现 NVS 持久化（复用 flash_storage 的 storage_write_config 基础设施）；③ `command/reset` handler（协议 §4.4：无 `confirm:true` 忽略，有则擦除配置并重启）；④ `config/alert` 最小可用：订阅 `config/#`，set 保存阈值到 NVS 并应用到 alert_manager，get 回读发布；⑤ fan_index 越界（≥8）与 duty 越界（>100）直接丢弃并记日志。
- 验收：smoke 测试新增用例覆盖 curve/reset/config（TST-04）。

**FW-21（MA-16）fan state 补 mode 字段**
- 动作：`fan/{index}/state` payload 补 `mode`（"auto"/"manual"，从 fan_curve 运行状态读）。

**FW-22（ADJ-11）console 命令扩展**
- 动作：usb_console 增加三组命令：`fan <0-7> <duty 0-100>`（验收流程依赖）、`wifi status|reset`、`mqtt status|set <url>`（顺带补上 MA-13 指出的"USB 侧无法配置 broker"缺口）。帮助文本同步。
- 验收：console help 输出与 deploy.md/assembly.md 命令示例一致（DOC-02）。

### web

**WEB-03（MC-03 / ADJ-13）风扇数量**
- 动作：backend `mqtt.ts` 的 `length: 4` / `idx < 4` 改为常量 `FAN_COUNT = 8`（导出供 routes 复用）；History/Fans 页覆盖 8 路。
- 验收：`grep -rn "length: 4\|idx < 4" web/backend/src/` 为空。

**WEB-04（MC-04 + ADJ-12）订阅补齐**
- 动作：订阅增加 `fan-controller/+/ota/status`；`sensor/+` 改为 `sensor/#`（吃到 `/buffered` 五级 topic）；OTA 进度经 WebSocket 转发前端（OTAProgress 接真实数据）。

**WEB-05（MC-05 / MC-06 / ADJ-4 / ADJ-5）命令与 schema 对齐**
- 动作：① alert 规则端点由 `command/alert`（协议不存在）改为发布 `config/alert`（配 FW-20）；② CurveSchema 的 pid 字段平铺（ADJ-4）；③ `temperature_source` 用 zod enum 约束 4 个合法字符串（ADJ-5）。

**WEB-06（MC-11 / ADJ-2）告警严重度上色**
- 动作：Alerts 页颜色映射键由 `alert_type` 改为 `severity`（依赖 FW-16 落地）；温度告警不得再显示绿点。

**WEB-07（MC-12 / ADJ-1）History 页**
- 动作：8 路序列全覆盖；`timestamp < 1000000000` 时显示"时间未同步"而非 1970 日期。

**WEB-08（MC-13）滑块受控回显**
- 动作：Fans 页内联 FanCard 的滑块值用 useEffect 同步设备推送的最新 duty（stale state 修复）；拖动结束提交逻辑保持。

### ha

**HA-02（MD-02 / ADJ-13）**：fans.yaml 生成 8 个控制实体（`__DEVICE_ID__` 占位，见 HA-01）；ha/README "风扇 0-3"口径同步改 0-7。
**HA-03（MD-03 / ADJ-8）**：alerts.yaml 四个 binary_sensor 改订阅 `alert/{type}/state`（retained，互不干扰）；模板按 `value_json.active` 判定。
**HA-04（MD-04 / ADJ-6）**：DS18B20 实体按 `address` 匹配（不再 `sensors[0]` 按位取）；补第二探头实体与 3.3V 电压实体。
**HA-05（MD-05）**：全部实体补 `availability_topic = fan-controller/{id}/status` + availability 模板（LWT 联动）。

### docs

**DOC-01（ADJ-1~14 汇总 / MF-06）protocol.md 集中修订**
- 动作（一次性完成，逐条对应裁决表）：§7 OTA topic → `command/ota`（ADJ-3）；§5 补录 `alert/{type}/state`、删除对 `alert/cleared` 的依赖描述（ADJ-8）；§4.2 `temperature_source` 枚举 4 值（ADJ-5）；§6 wifi/mqtt 小节标注"规划中，现行经 USB console 配置"（ADJ-9）；§8/§11 Discovery 标注"规划中，现行方案为 ha/ 手动 packages"（ADJ-10）；§11 固件订阅示例维持 `{device_id}` 具体订阅（现状即正确）；§5/§6.2 示例阈值与门限改为 ADJ-14 的双阈值口径；§12 增加 v1.0.1 修订记录（列出上述变更）。
- 验收：`docs/protocol.md` 无 `alert/cleared` 的消费方依赖表述；OTA 章节与固件/网/deploy 三方 topic 一致。

**DOC-02（MF-04）操作文档命令对齐**
- 动作：deploy.md §63-69/§233 与 hardware-assembly.md 验收示例的串口命令改为 FW-22 落地后的真实命令集（fan/wifi/mqtt 可用，help 输出示例与实现一致）。

---

## 5. Phase 3 — 健壮性与清理（P2）

### 固件 minors

**FW-23（MA-08）软启动任务竞态**：每次 set_duty 派生任务的模型改为常驻控制器任务 + 目标值队列（或互斥保护 + 旧任务终止）。
**FW-24（MA-24）ds18b20 口径**：头注释改为 bit-bang 实现的如实描述（RMT 迁移为可选优化，不强制）；README 声明不支持寄生供电。
**FW-25（MA-25）**：fan_stall 恢复时补 clear_rule 分支（on_clear 触发）。
**FW-26（MA-26）**：DS18B20 两路探头温度参与温度告警（三源最大值或分别设阈值，实现取简）。
**FW-27（MA-27）**：`s_wifi` 初值改 false（或 check_all 直接查 `wifi_manager_is_connected()`），从未联网也能报 wifi_disconnected。
**FW-28（MA-28）**：恢复出厂（`wifi reset` / command/reset）统一清理各 namespace（fan_ctrl、fan_mqtt 队列、曲线配置），与 FW-06/FW-20 联动。
**FW-29（MA-29）**：AP 配网 portal 加最低限度确认机制（如随机 4 位码印在串口日志里），README/deploy 声明该限制。
**FW-30（MA-30）**：bme280 calib 读取检查返回值、fail-fast；删除"出错后重初始化"的虚假注释。
**FW-31（MA-31）**：删除 main.c:45,61 的死代码 payload 缓冲。
**FW-32（MA-32）**：partitions.csv 三槽尺寸对齐（factory 与 ota_0/ota_1 同尺寸，建议统一 0x180000）；启用 CONFIG_ESP_COREDUMP（to-flash，对应 coredump 分区）或删除该分区。
**FW-33（MA-33）**：`fan_curve_set_lut` 校验 temp_c 严格递增，乱序拒绝。
**FW-34（MA-34 Info，可选）**：MQTT_EVENT_DATA 处理分片重组（current_data_offset/total_data_len）；不实施则登记 DESCOPE。

### agent

**AG-03（MB-03）**：`agent.service` 改名 `smart-fan-agent.service`（与 install.sh/Makefile 引用统一），install.sh 验证可完整跑通。
**AG-04（MB-04）**：订阅范围按协议 §11（`+/sensor/#`、`+/alert`），删除 `command/#` 订阅；发布 topic 用 hostname（AG-02 已含，此处验收）。
**AG-05（MB-05）**：service 增加 `SupplementaryGroups=dialout`（串口权限）；ReadWritePaths 与实际写路径一致（或删除）。
**AG-06（MB-06）**：config.go 删除未用的 `port` 字段或合并进 broker URL；broker URL 校验 scheme 前缀；config.yaml 同步。
**AG-07（MB-07）**：`token.WaitTimeout` 判断修正为 `!token.WaitTimeout(...) || token.Error() != nil`。
**AG-08（MB-08）**：relay.go Open() 有限次重试后返回错误；relay 定位为可选功能（`--relay` 标志，默认关闭），README 说明架构定位（不承诺"读 ESP32 JSON 上报"——固件 console 无此行为）。

### web

**WEB-09（MC-07）**：deploy.md 补 web 层安全声明（0.0.0.0 + CORS 全开 + 无鉴权的局域网假设）；可选加简单 token（不强制）。
**WEB-10（MC-08）**：history 端点占位实现明确标注"未接通"并在 UI 提示，或接通 agent/固件日志通道（二选一，登记决定）。
**WEB-11（MC-09 / ADJ-14）**：pages/ 内联实现抽回 components/ 统一（7 个死组件复活，删除内联版，两套实现不再分叉）；AlertRuleEditor 改双阈值模型（ADJ-14）。
**WEB-12（MC-10）**：CurveEditor 输入 clamp（duty 0-100、温度数值）、点位排序、点数上限 10（与固件一致）。

### test

**TST-02（ME-02）**：integration_test.sh T4 真正订阅捕获 payload 并断言字段；删除创建后未读的 `T_OUT`。
**TST-03（ME-03）**：smoke_test.sh 删除未用的 jq 依赖声明；CP7 补 SUB_OUT 内容断言；CP12 的 TOPICS 计算修正（`**Topic**:` 匹配 0 的问题）或删除；脚本头部注明"必须从仓库根运行"。
**TST-04（ME-04）**：按协议命令清单补测：curve、reset、config/alert、ota/status、buffered（依赖 FW-20/FW-07/FW-10 完成）。

### docs 与仓库根

**DOC-03（MF-01/02/05）**：README 与 docs/index.html 口径更新——4 路→8 路、80×60 双层→99×99mm 4 层（MF-01/02，与硬件清单 H-07 联动）、console 命令数与 Unity 测试数如实（MF-05，DOC-06 完成后同步）、`npm test` 命令修正为真实路径。
**DOC-04（MF-03）**：README/ha/README 删除"HA 自动发现/无需手动配置"表述，改为"手动 packages（ha/ 目录）+ Discovery 规划中"（ADJ-10）。
**DOC-05（MF-08）**：`.omo/` 与 `.sisyphus/`（字节级相同的 AI 过程产物）移出 git 跟踪：`git rm -r --cached .omo .sisyphus`，`.gitignore` 增加 `.omo/`、`.sisyphus/`（顺带补 H-15 要求的 `*.bak`、`*.v7backup`）。
**DOC-06（MF-05 连带）**：`firmware/test/` 13 个 Unity 测试接入构建（ESP-IDF 测试组件规范，`idf.py build`/`idf.py flash test` 可运行），断言更新到 v1.2 引脚与 8 路；若工作量超出 P2 预算，允许降级为"README 如实标注未接入构建"并在 changelog 登记 DESCOPE。

---

## 6. 总验收门（整改完成的定义）

### 6.1 构建矩阵（全部真实执行，输出贴入 changelog）

| 命令 | 期望 |
|------|------|
| `cd firmware && idf.py build` | 成功（需 ESP-IDF v5.3+，审查时 BLOCKED，必须补做） |
| `cd agent && GOOS=linux go build ./... && go vet ./...` | 成功；go.sum 或 vendor 入库 |
| `cd web/backend && npm ci && npm run build` | 产出 `dist/server.js` |
| `cd web/frontend && npm ci && npm run build` | 产出 `dist/index.html` |
| `bash -n test/smoke_test.sh test/e2e/integration_test.sh` | 通过 |
| `python -c "import yaml,glob; [yaml.safe_load(open(f,encoding='utf-8')) for f in glob.glob('ha/*.yaml')]"` | YAML OK |

### 6.2 grep 门（在仓库根执行，全部为空或符合注释）

```bash
grep -rn "((PASS++))" test/                                     # 空
grep -rn "esp32-placeholder" ha/                                # 空（占位改 __DEVICE_ID__）
grep -rn "length: 4\|idx < 4" web/backend/src/                  # 空
grep -rn "FAN_PWM_COUNT 4\|FAN_CURVE_FANS 4\|fan_rpm\[4\]" firmware/  # 空
grep -n "CONSOLE_UART" firmware/sdkconfig.defaults              # 空
grep -rn "erase_all" firmware/components/mqtt_client/           # 空
grep -rn "esp_timer_get_time" firmware/main/main.c | grep -i timestamp  # 空（timestamp 用 time(NULL)）
grep -rn "alert/cleared" firmware/ docs/protocol.md             # 空（已由 state topic 取代）
grep -rn "esp32-XXXXXX/command/ota" docs/deploy.md              # topic 前缀为 command/（ADJ-3 后无歧义表述）
grep -rn "自动发现" README.md ha/README.md                       # 空（或全部带"规划中"限定语）
```
（硬件侧的 grep 门见硬件清单 §4 H-03/H-07，不在本表重复。）

### 6.3 一致性复验

按 `docs/module-review-plan.md` §8 的六张矩阵格式复跑，结果写入新文件 `docs/module-recheck.md`：
- 表1（19 行 topic）、表2（15 处路数）、表3（9 条命令）、表4（17 项字段）、表5（8 个告警维度）、表6（34 行引脚）全部 ✓，或明确标注 `DESCOPE(ADJ-n)` / `BLOCKED:<原因>`。
- 冒烟：`test/smoke_test.sh` 在具备 broker 的环境完整跑完输出 PASS 汇总（无环境标 BLOCKED）。

### 6.4 交付物

`docs/changelog-modules-v1.2.md`：逐项勾选本清单全部编号（Phase 0~3）+ 每项验证证据 + DESCOPE/BLOCKED 清单 + §7 映射表 75 条发现的最终销号状态。

---

## 7. 发现→整改项映射表（75 条全覆盖，销号依据）

### A：firmware（35 条）

| 发现 | 去向 | 发现 | 去向 |
|------|------|------|------|
| MA-01 | FW-01 | MA-19 | FW-13 + 硬件 H-17 |
| MA-02 | FW-02 | MA-20 | FW-20 |
| MA-03 | FW-03 | MA-21 | 硬件 H-03（v1.2.1） |
| MA-04 | FW-05 | MA-22 | FW-10 |
| MA-05 | FW-08 | MA-23 | FW-17（ADJ-8） |
| MA-06 | FW-11 | MA-24 | FW-24 |
| MA-07 | 硬件 H-03（v1.2.1） | MA-25 | FW-25 |
| MA-08 | FW-23 | MA-26 | FW-26 |
| MA-09 | FW-20 | MA-27 | FW-27 |
| MA-10 | FW-16（ADJ-2） | MA-28 | FW-28 |
| MA-11 | FW-14 | MA-29 | FW-29 |
| MA-12 | FW-15（ADJ-1） | MA-30 | FW-30 |
| MA-13 | FW-06 | MA-31 | FW-31 |
| MA-14 | FW-07 | MA-32 | FW-32 |
| MA-15 | FW-07 + WEB-04 | MA-33 | FW-33 |
| MA-16 | FW-21 | MA-34 | FW-34（分片）+ 硬件 H-03（console 路由）* |
| MA-17 | FW-09 | MA-35 | FW-04 |

> *报告内部编号小冲突备注：审查报告的覆盖矩阵/表6 把"console 路由走 UART0"也标为 MA-34，而发现表中 MA-34 是 MQTT 分片处理。本清单按内容归位：console 路由 → 硬件 H-03 v1.2.1 增量；分片重组 → FW-34。

### B：agent（8 条）

| 发现 | 去向 | 发现 | 去向 |
|------|------|------|------|
| MB-01 | AG-01 | MB-05 | AG-05 |
| MB-02 | AG-02 | MB-06 | AG-06 |
| MB-03 | AG-03 | MB-07 | AG-07 |
| MB-04 | AG-02/AG-04 | MB-08 | AG-08 |

### C：web（13 条）

| 发现 | 去向 | 发现 | 去向 |
|------|------|------|------|
| MC-01 | WEB-02 | MC-08 | WEB-10 |
| MC-02 | WEB-01 | MC-09 | WEB-11 |
| MC-03 | WEB-03 | MC-10 | WEB-12 |
| MC-04 | WEB-04 | MC-11 | WEB-06 |
| MC-05 | WEB-05 | MC-12 | WEB-07 |
| MC-06 | WEB-05 | MC-13 | WEB-08 |
| MC-07 | WEB-09 | | |

### D：ha（5 条）

| 发现 | 去向 | 发现 | 去向 |
|------|------|------|------|
| MD-01 | HA-01 | MD-04 | HA-04 |
| MD-02 | HA-02 | MD-05 | HA-05 |
| MD-03 | HA-03 | | |

### E：test（4 条）

| 发现 | 去向 | 发现 | 去向 |
|------|------|------|------|
| ME-01 | TST-01 | ME-03 | TST-03 |
| ME-02 | TST-02 | ME-04 | TST-04 |

### F：docs 与仓库根（10 条）

| 发现 | 去向 | 发现 | 去向 |
|------|------|------|------|
| MF-01 | DOC-03 | MF-06 | DOC-01（ADJ-3） |
| MF-02 | DOC-03 | MF-07 | 硬件清单 H-07 承接 |
| MF-03 | DOC-04（ADJ-10） | MF-08 | DOC-05 |
| MF-04 | FW-22 + DOC-02 | MF-09 | 硬件清单 H-06/H-16 承接 |
| MF-05 | DOC-03 + DOC-06 | MF-10 | 不修（Info，无需动作） |

---

## 8. 执行顺序与依赖提示

```
Phase 0（构建+H-03） ──► Phase 1（链路与安全） ──► Phase 2（协议对齐） ──► Phase 3（清理）
                │                │                      │
                │                └─ AG-02 依赖 AG-01    ├─ WEB-06 依赖 FW-16
                │                └─ FW-08~10 相互独立   ├─ HA-03 依赖 FW-17
                │                                         ├─ HA-04 依赖 FW-18
                └─ WEB-02 的页面改造可在 Phase 2 开始    ├─ WEB-04 的 OTA 进度依赖 FW-10
                                                          └─ TST-04 依赖 FW-20/FW-07/FW-10
```

- 硬件整改（H-01/H-02 等）与本清单可并行执行，互不阻塞；H-03 属于本清单 Phase 0 门。
- 固件项全部完成后，`idf.py build` + 真机冒烟（`test/smoke_test.sh`）是 Phase 1/2 的最终验证。

---

**版本：** v1.2（2026-08-24）
**上游文档：** `docs/module-review-report.md` v1.0（75 条发现）｜`hardware/docs/remediation-plan-v1.2.md` v1.2.1（硬件承接方）
**验收交付物：** `docs/changelog-modules-v1.2.md` + `docs/module-recheck.md`
