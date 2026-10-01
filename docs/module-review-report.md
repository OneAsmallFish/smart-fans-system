# 模块审查报告（Module Review Report）

> 依据：`docs/module-review-plan.md` v1.0（2026-08-23）
> 审查日期：2026-08-24 · 审查 agent：ZCode（GLM-5.3）
> 硬件参照：`hardware/docs/remediation-plan-v1.2.md` §1 v1.2 引脚表（经核实 H-03 **尚未执行**，全文件 grep 证据见 §9.4-E）
> 规则遵守：R1 逐文件全文审查 ✓（覆盖矩阵 100%）｜R2 证据留痕 ✓｜R3 可执行验证真实执行 ✓（idf.py BLOCKED，其余已执行）｜R4 只报告不修复 ✓（本轮零代码提交）｜R5 逐行比对 ✓｜R6 数字矛盾全报 ✓｜R7 固定格式 ✓

---

## 执行摘要

全仓库 **6 个模块 90 个条目（88 个文件 + .omo/.sisyphus 两个目录级条目）全文审查完毕**。总体结论：**该项目当前处于"演示级脚手架"状态，六个模块中有四个无法通过各自的构建/运行验证**，且各模块之间存在系统性的协议偏差（协议真源 protocol.md 与各实现之间存在字段类型、topic 位置、数量口径三类漂移）。

| 模块 | 构建/运行验证结果 | Critical | Major |
|------|------------------|:--------:|:-----:|
| A firmware | `idf.py` BLOCKED（无环境）；**静态判定 2 处编译错误** | 6 | 17 |
| B agent | `go build` **失败**（unused import + go.sum 缺失）；main.go 为空壳 | 2 | 3 |
| C web | backend `tsc` **无配置不成编译**；frontend build **失败**（缺 tsconfig/index.html/入口） | 2 | 5 |
| D ha | YAML 语法 ✓；2 个风扇实体 vs 文档 4 路、占位 device_id | 1 | 2 |
| E test | `bash -n` ✓；**首个 PASS 即自毁**（set -e + `((PASS++))`） | 1 | 1 |
| F docs/root | — | 0 | 4 |

最严重的十个问题（详见 §9.2）：
1. **MA-01/02** 固件静态可判定的编译错误（`ESP_ERROR_CHECK(void)`、main 组件依赖缺失）——固件从未成功编译过。
2. **MA-03** MQTT 订阅在客户端创建前调用且无重订阅 → **设备永远收不到任何命令**。
3. **MA-04** WiFi 连接回调把 FreeRTOS 定时器句柄当 broker_url 指针解引用 → 首次连上 WiFi 即未定义行为。
4. **MA-05** OTA 三阶段确认的第三阶段（`ota_handler_confirm_mqtt`）全仓库零调用 → 任何 OTA 成功后 5 分钟必回滚，OTA 功能性死亡。
5. **MA-06** 停转告警条件 `rpm > 0 && rpm < 200` → 完全堵转（0 RPM）反而不告警。
6. **MB-01/02** agent 编译失败（gpu.go unused import + go.sum 缺失）+ main.go 空壳（MQTT/采集/串口全部是 TODO 注释）。
7. **MC-01/02** web 前后端构建链断裂（无 tsconfig；前端无 index.html/main.tsx/vite.config）。
8. **MA-07** H-03 未执行且波及面比整改清单更大（PCNT 单元耗尽、分压比常数 ×2.0 vs 硬件 ÷5.7、五处硬编码"4"）。
9. **MD-01 + MA-35** ha fans.yaml 用 `esp32-placeholder` 占位 device_id 发命令；固件订阅 `+/command/#` 通配且不校验 device_id——两个错误"负负得正"地互相掩盖。
10. **协议 timestamp 全面错误**：固件所有上报的 `timestamp` 是开机秒数而非 Unix 秒（MA-12），直接导致 web History 页时间显示为 1970 年附近（MC-12）。

---

## 9.1 覆盖矩阵

行数 = `wc -l` 实测。状态定义：`全文已读` = 完整阅读并审查；`+已验证` = 另有针对该文件执行过的验证命令（grep/构建/解析，证据见 §9.4）。

### 模块 A：firmware（44 文件）

| 文件 | 行数 | 状态 | 备注 |
|------|-----:|------|------|
| firmware/CMakeLists.txt | 8 | 全文已读 | EXTRA_COMPONENT_DIRS 指向 components ✓ |
| firmware/partitions.csv | 8 | 全文已读 | 总占用 0x470000=4.4MB ≤16MB ✓；factory 1MB/ota 1.5MB 不对称（MF-09） |
| firmware/sdkconfig.defaults | 72 | 全文已读 | 缺 USB-CDC console 路由（MA-34）；coredump 分区未启用对应配置（MF-09） |
| firmware/main/main.c | 389 | 全文已读+已验证 | H-03 grep 验证（§9.4-E） |
| firmware/main/CMakeLists.txt | 17 | 全文已读 | **REQUIRES 缺全部 13 个自定义组件（MA-02）** |
| components/alert_manager/alert_manager.c | 152 | 全文已读 | 停转规则反转（MA-06） |
| components/alert_manager/alert_manager.h | 42 | 全文已读 | |
| components/alert_manager/CMakeLists.txt | 5 | 全文已读 | |
| components/bme280/bme280.c | 185 | 全文已读 | 引脚 17/18 与 v1.2 一致 ✓ |
| components/bme280/bme280.h | 18 | 全文已读 | |
| components/bme280/CMakeLists.txt | 5 | 全文已读 | |
| components/ds18b20/ds18b20.c | 236 | 全文已读 | GPIO16 ✓；bit-bang 而非注释声称的 RMT（MA-24） |
| components/ds18b20/ds18b20.h | 30 | 全文已读 | |
| components/ds18b20/CMakeLists.txt | 5 | 全文已读 | |
| components/fan_curve/fan_curve.c | 177 | 全文已读 | set_lut/set_pid/set_temp_source 零调用方（MA-20） |
| components/fan_curve/fan_curve.h | 42 | 全文已读 | 声称"NVS 保存"未实现（MA-20） |
| components/fan_curve/CMakeLists.txt | 5 | 全文已读 | |
| components/fan_pwm/fan_pwm.c | 96 | 全文已读+已验证 | H-03 grep；软启动任务竞态（MA-18） |
| components/fan_pwm/fan_pwm.h | 22 | 全文已读+已验证 | |
| components/fan_pwm/CMakeLists.txt | 5 | 全文已读 | |
| components/fan_tach/fan_tach.c | 94 | 全文已读+已验证 | H-03 grep；8 路时 pcnt_new_unit 耗尽（MA-07） |
| components/fan_tach/fan_tach.h | 21 | 全文已读+已验证 | |
| components/fan_tach/CMakeLists.txt | 5 | 全文已读 | |
| components/flash_storage/flash_storage.c | 147 | 全文已读 | WL 日志 ✓；storage_write_config 运行时零调用 |
| components/flash_storage/flash_storage.h | 38 | 全文已读 | fan_rpm[4] 硬编码（MA-07 连带） |
| components/flash_storage/CMakeLists.txt | 5 | 全文已读 | |
| components/mqtt_client/mqtt_client_wrapper.c | 279 | 全文已读 | 订阅丢失/erase_all/队列竞态（MA-03/16/17） |
| components/mqtt_client/mqtt_client_wrapper.h | 41 | 全文已读 | MQTT_TOPIC_PREFIX="fan-controller" ✓ |
| components/mqtt_client/CMakeLists.txt | 5 | 全文已读 | |
| components/ota_handler/ota_handler.c | 155 | 全文已读 | confirm_mqtt 零调用（MA-05）；无证书配置（MA-22） |
| components/ota_handler/ota_handler.h | 22 | 全文已读 | |
| components/ota_handler/CMakeLists.txt | 5 | 全文已读 | |
| components/power_monitor/power_monitor.c | 130 | 全文已读+已验证 | H-03 grep；分压比 ×2.0 vs 硬件 ÷5.7（MA-21） |
| components/power_monitor/power_monitor.h | 34 | 全文已读+已验证 | |
| components/power_monitor/CMakeLists.txt | 5 | 全文已读 | |
| components/status_led/status_led.c | 161 | 全文已读+已验证 | LED_GPIO=48 vs v1.2=45 |
| components/status_led/status_led.h | 29 | 全文已读+已验证 | **void 返回值 vs ESP_ERROR_CHECK（MA-01）** |
| components/status_led/CMakeLists.txt | 5 | 全文已读 | |
| components/usb_console/usb_console.c | 168 | 全文已读 | 实际命令集 help/reboot/status/ota |
| components/usb_console/usb_console.h | 19 | 全文已读 | |
| components/usb_console/CMakeLists.txt | 5 | 全文已读 | |
| components/wifi_manager/wifi_manager.c | 319 | 全文已读+已验证 | H-03 grep；BTN_GPIO=38 vs v1.2=47 |
| components/wifi_manager/wifi_manager.h | 35 | 全文已读 | |
| components/wifi_manager/CMakeLists.txt | 6 | 全文已读 | |

计划外发现（不在 §2.1 清单、未列入矩阵，仅登记）：`firmware/test/` 13 个 .c 文件（Unity 测试），**未被任何 CMakeLists 引用、从不参与编译**；README 称"12 个"且称可 `idf.py flash test` 运行（MF-05）。

### 模块 B：agent（12 文件）

| 文件 | 行数 | 状态 | 备注 |
|------|-----:|------|------|
| agent/go.mod | 17 | 全文已读+已验证 | go.sum 缺失（MB-01）；module path 占位符 `github.com/user/...` 本身不阻断构建 |
| agent/Makefile | 28 | 全文已读 | install 目标引用不存在的 smart-fan-agent.service（MB-03） |
| agent/agent.service | 24 | 全文已读 | User=nobody 无串口权限（MB-05） |
| agent/install.sh | 49 | 全文已读 | set -euo pipefail ✓；service 文件名断链（MB-03） |
| agent/config.yaml | 15 | 全文已读 | 字段与 config.go 一一对应 ✓ |
| agent/cmd/agent/main.go | 40 | 全文已读 | **空壳：MQTT/采集/串口全部 TODO 注释（MB-02）** |
| agent/internal/config/config.go | 48 | 全文已读+已验证 | 无默认值/校验；port 字段死配置（MB-06） |
| agent/internal/monitor/collector.go | 25 | 全文已读+已验证 | |
| agent/internal/monitor/gpu.go | 82 | 全文已读+已验证 | **`"bytes"` unused（全平台编译错误）**（MB-01） |
| agent/internal/monitor/system.go | 179 | 全文已读+已验证 | Statfs 为 Linux-only（目标平台 OK，Windows 交叉验证受阻） |
| agent/internal/mqtt/client.go | 96 | 全文已读+已验证 | 订阅 command/# 偏离协议 §11（MB-04） |
| agent/internal/usb/relay.go | 79 | 全文已读 | Open() 无限阻塞重试（MB-08） |

### 模块 C：web（20 文件）

| 文件 | 行数 | 状态 | 备注 |
|------|-----:|------|------|
| web/backend/package.json | 26 | 全文已读+已验证 | build:"tsc" 无 tsconfig 可依（MC-02） |
| web/backend/src/server.ts | 39 | 全文已读+已验证 | 显式 tsc 通过 ✓ |
| web/backend/src/mqtt.ts | 101 | 全文已读+已验证 | fans 硬编码 4（MC-03）；缺 ota/status 订阅（MC-04） |
| web/backend/src/routes/devices.ts | 104 | 全文已读+已验证 | curve PID 嵌套结构偏离协议（MC-06） |
| web/backend/src/types.ts | 50 | 全文已读+已验证 | alert_type:number 跟随固件偏离协议 |
| web/frontend/package.json | 24 | 全文已读+已验证 | build:"tsc && vite build" 双断点（MC-01） |
| web/frontend/src/App.tsx | 34 | 全文已读+已验证 | |
| web/frontend/src/components/AlertRuleEditor.tsx | 91 | 全文已读 | 零引用死代码（MC-09） |
| web/frontend/src/components/CurveEditor.tsx | 138 | 全文已读 | 零引用死代码；无点数/占空比校验（MC-10） |
| web/frontend/src/components/DeviceCard.tsx | 107 | 全文已读 | 零引用死代码 |
| web/frontend/src/components/FanCard.tsx | 85 | 全文已读 | 零引用死代码 |
| web/frontend/src/components/OTAProgress.tsx | 87 | 全文已读 | 零引用死代码；无真实进度源 |
| web/frontend/src/components/TemperatureGauge.tsx | 32 | 全文已读 | 零引用死代码 |
| web/frontend/src/components/VoltageBar.tsx | 38 | 全文已读 | 零引用死代码；阈值与固件一致 ✓ |
| web/frontend/src/hooks/useWebSocket.ts | 56 | 全文已读+已验证 | 消息形状与 backend 逐字段一致 ✓ |
| web/frontend/src/pages/Alerts.tsx | 108 | 全文已读+已验证 | alert_type 误作 severity（MC-11） |
| web/frontend/src/pages/Dashboard.tsx | 132 | 全文已读+已验证 | 电压阈值与固件常数一致 ✓ |
| web/frontend/src/pages/Devices.tsx | 109 | 全文已读+已验证 | |
| web/frontend/src/pages/Fans.tsx | 200 | 全文已读+已验证 | 页头注释"4路"（表2）；滑块 stale state（MC-13） |
| web/frontend/src/pages/History.tsx | 105 | 全文已读+已验证 | 仅 fan0/fan1；时间显示受 MA-12 波及（MC-12） |

计划外发现：frontend 缺 `index.html`、`src/main.tsx`、`vite.config.ts`（vite 运行三要素全缺）；backend/frontend 均无 `tsconfig.json`。

### 模块 D：ha（4 文件）

| 文件 | 行数 | 状态 | 备注 |
|------|-----:|------|------|
| ha/README.md | 85 | 全文已读 | "自动发现无需配置"与固件无 discovery 代码矛盾（MA-23） |
| ha/fans.yaml | 37 | 全文已读+已验证 | YAML 解析 ✓；**仅 2 个风扇实体 + esp32-placeholder**（MD-01/02） |
| ha/sensors.yaml | 122 | 全文已读+已验证 | YAML ✓；10 实体（3v3 缺、DS 第二探头缺） |
| ha/alerts.yaml | 46 | 全文已读+已验证 | 模板逐消息翻转（MD-03） |

### 模块 E：test（2 文件）

| 文件 | 行数 | 状态 | 备注 |
|------|-----:|------|------|
| test/smoke_test.sh | 162 | 全文已读+已验证 | bash -n ✓；`((PASS++))` 自毁（ME-01） |
| test/e2e/integration_test.sh | 87 | 全文已读+已验证 | bash -n ✓；同病 + T4 无验证（ME-01/02） |

### 模块 F：docs 与仓库根（8 项）

| 文件 | 行数 | 状态 | 备注 |
|------|-----:|------|------|
| README.md | 277 | 全文已读 | 4 路/80×60 双层/HA"自动发现"等旧口径（MF-01~04） |
| docs/protocol.md | 497 | 全文已读 | 协议真源，作为 §9.3 各表左列 |
| docs/deploy.md | 255 | 全文已读 | 记载不存在的串口命令 fan/wifi（MF-06） |
| docs/hardware-assembly.md | 176 | 全文已读 | v1.1 口径；验收示例用不存在的 fan 命令（MF-07） |
| LICENSE | 21 | 全文已读 | MIT ✓ 与 README 徽章一致 |
| .gitignore | 60 | 全文已读 | 未忽略 `*.v7backup`（H-15 未落地）；.omo/.sisyphus 未忽略 |
| docs/index.html | 387 | 全文已读 | 计划外文件；80×60/4 路旧口径（MF-03） |
| .omo/ 与 .sisyphus/ | 163K×2 | 结构盘点 | `diff -rq` 字节级完全相同；旧 AI 执行计划+任务证据；双双被 git 跟踪（MF-08） |

**覆盖声明：§2~§7 文件清单 100% 覆盖，矩阵无空行。**

---

## 9.2 发现清单

格式：`编号 | 严重度 | 文件:行 | 证据摘录(≤3行) | 影响 | 建议修法`

### 模块 A：firmware

| 编号 | 严重度 | 文件:行 | 证据摘录 | 影响 | 建议修法 |
|------|:------:|---------|----------|------|----------|
| MA-01 | **Critical** | firmware/main/main.c:371 + components/status_led/status_led.h:20 | `ESP_ERROR_CHECK(status_led_init());` / `void status_led_init(void);` | ESP_ERROR_CHECK 需要 esp_err_t 返回值，void 函数套入为**编译错误**——固件无法编译 | status_led_init 改为返回 esp_err_t |
| MA-02 | **Critical** | firmware/main/CMakeLists.txt:4-16 | `REQUIRES nvs_flash esp_wifi ... cJSON`（无任何自定义组件） | main.c include 的 13 个组件头文件路径不通，**编译错误** | REQUIRES 补 fan_pwm/fan_tach/fan_curve/alert_manager/bme280/ds18b20/power_monitor/status_led/wifi_manager/mqtt_client/usb_console/flash_storage/ota_handler |
| MA-03 | **Critical** | components/mqtt_client/mqtt_client_wrapper.c:262-264 + main.c:354 | `if (s_client && s_connected) { esp_mqtt_client_subscribe(...)` ; 调用点在 `mqtt_client_init()` 之后、`mqtt_client_connect()` 之前 | 订阅时客户端未创建，被静默跳过；MQTT_EVENT_CONNECTED 中亦无重订阅 → **设备永远收不到任何下行命令**（fan/ota/reboot 全部失效） | 在 MQTT_EVENT_CONNECTED 中订阅，或 mqtt_subscribe 缓存 topic 待连接后补订 |
| MA-04 | **Critical** | main.c:78-83 | `xTimerCreate("mqtt_st", ..., (void(*)(TimerHandle_t))mqtt_client_connect)` | 定时器回调把 TimerHandle_t 当 `broker_url` 传入；mqtt_client_connect 判空后跳过 NVS 分支，把句柄指针当 URI 字符串使用 → **首次 WiFi 连接触发未定义行为/崩溃**。注释"Pass NULL"与实际传参不符 | 改用带 user_data 的 timer 或独立标志，真正传 NULL |
| MA-05 | **Critical** | components/ota_handler/ota_handler.c:148-155 | `void ota_handler_confirm_mqtt(void)` — 全仓库 grep 零调用（§9.4-F） | OTA 三阶段确认第三阶段永不到达 → 任何成功 OTA 在 5 分钟看门狗到点后 `mark_app_invalid_rollback_and_reboot()` → **OTA 无限回滚循环** | 在 MQTT_EVENT_CONNECTED（或首次成功 publish）调用 confirm_mqtt |
| MA-06 | **Critical** | components/alert_manager/alert_manager.c:114 | `if (s_fan_rpm[i] > 0 && s_fan_rpm[i] < STALL_RPM)` | 卡死风扇完全停转（RPM=0）**不触发告警**；仅 1-199 RPM 报。fan_tach 的 3 秒停转回调送入 rpm=0 后被此条件丢弃 | 条件改为结合占空比判断：`duty>5 && rpm<STALL_RPM`（0% 占空比合法停转除外），需把 duty 传入 alert_manager |
| MA-07 | **Major** | components/fan_pwm/fan_pwm.h:9 等（证据 §9.4-E） | `#define FAN_PWM_COUNT 4` / `FAN_GPIO={4,5,6,7}` / `TACH_GPIO={8,9,10,11}` / `LED_GPIO 48` / `BTN_GPIO 38` / `CH_12V ADC_CHANNEL_2(GPIO3)` | **H-03 未执行**：全部引脚与 v1.2 权威表冲突（逐行见表6）。连带：TACH GPIO8-11 在 v1.2 是 FAN4-7_PWM（PWM/Tach 直接冲突）；GPIO3 是 strapping 禁用脚；8 路化时 `pcnt_new_unit`×8 会耗尽 S3 的 4 个 PCNT 单元（fan_tach.c:59 现按 unit=i 分配）；`VOLTAGE_DIVIDER_5V/3V3=2.0`（power_monitor.h:14-15）与 v1.2 硬件 47k/10k=÷5.7 不符（**此点 H-03 清单未覆盖**）；fan_curve.h:10 `FAN_CURVE_FANS 4`、flash_storage.h:17 `fan_rpm[4]`、main.c:280,301 与 alert_manager.c:35,87,113 的硬编码 4 都需联动 | 执行整改清单 H-03 并补充：分压比常数 ÷5.7、PCNT 改 `unit=i/2, channel=i%2`、五处硬编码 4 改宏 |
| MA-08 | **Major** | components/fan_pwm/fan_pwm.c:83-88 | `softstart_args_t *a = malloc(...); xTaskCreate(softstart_task, ...)` | 每次 set_duty 都派生新任务；fan_control_task 每秒调用 → 同一风扇多个软启动任务并发读写 `s_duty_pct[]` 与 LEDC 寄存器（竞态+任务churn） | 改为常驻控制器任务+目标值队列，或加互斥并在 set_duty 前终止旧任务 |
| MA-09 | **Major** | main.c:158-175 | `if (strstr(topic_str, "/command/fan")) {...} else if ("/command/ota") {...} else if ("/command/reboot")` | **command/curve、command/reset、config/# 全部无处理器**：协议 §4.2/§4.4/§6 的功能在固件端为零；web 的曲线编辑器、告警规则页对设备是空操作（且 handler 不校验 fan_index 越界/百分比值——靠下层 clamp 兜底） | 补三类 handler；fan_index 越界直接丢弃 |
| MA-10 | **Major** | main.c:107-110 | `cJSON_AddNumberToObject(root, "alert_type", ev->type);`（无 severity/sensor 字段） | 协议 §5 要求 alert_type 为字符串（"temperature_high"）+severity+sensor；固件发数字且缺两字段 → web/HA 被迫跟随错误口径（MC-09/MD-03 的根因） | 建立 type 枚举→字符串映射表并补 severity/sensor 字段 |
| MA-11 | **Major** | components/mqtt_client/mqtt_client_wrapper.c:219,137-145 | LWT: `"{\"status\":\"offline\"}"` ; online: 仅 status+device_id | 与协议 §1.1/§1.2 逐字段比对：LWT 缺 timestamp/device_id；online 缺 timestamp/firmware_version/ip_address/uptime_seconds → web 端 firmware/ip 字段永远 undefined | 按 §1.1 补全字段 |
| MA-12 | **Major** | main.c:49 等（全部 AddNumber timestamp 处） | `cJSON_AddNumberToObject(root,"timestamp",(int)(esp_timer_get_time()/1000000));` | **timestamp 语义错误**：协议规定 Unix 秒，固件发开机秒数。SNTP 已启动（wifi_manager.c:165-168）但时间从未被使用 → web History 时间轴显示 1970+uptime（MC-10） | 改用 `time(NULL)`，无网络时回退 uptime 并在 payload 标注 |
| MA-13 | **Major** | components/mqtt_client/mqtt_client_wrapper.c:116 + 273-275 | `nvs_erase_all(nvs);`（flush 队列时）/ `NVS_KEY_BROKER "broker_url"` 存于同一 NS "fan_mqtt" | 离线队列 flush 会**把 broker_url 一并删除** → 重启后无法重连 MQTT（USB 侧也没有配置 broker 的命令可补救） | 队列改用独立子 key 前缀或独立 namespace；逐 key erase |
| MA-14 | **Major** | mqtt_client_wrapper.c:62-95,180 | `offline_queue_push` 每次 push 全队列 50 条 blob 搬移；`s_queue_mutex` 创建后从未使用 | 断线期间 sensor/fan 每秒 ~8 条消息入队：NVS 写放大（满队后每条消息重写 50 blob）加速 flash 磨损；多任务并发调用 mqtt_publish 无锁竞态损坏队列 | 降频入队（协议 §10 的 30s 口径）+环形 key 复用+启用已创建的互斥锁 |
| MA-15 | **Major** | mqtt_client_wrapper.c:97-119 + 协议 §10 | flush 直接按原 topic 重发 | 协议 §10 要求 `/buffered` 后缀+`buffered:true` 标记；两端都未实现，web 的 `sensor/+` 订阅也匹配不到 5 级 topic | 固件加后缀+标记，backend 订阅改 `sensor/#` |
| MA-16 | **Major** | main.c:43-62 | payload 无 `mode` 字段（协议 §3.1 要求 auto/manual） | 前端 FanState.mode 永远停在默认 'auto'，手动模式状态不回显 | publish_fan_state 补 mode（从 fan_curve 状态读） |
| MA-17 | **Major** | components/ota_handler/ota_handler.c:52-58 | `.http_config = &(esp_http_client_config_t){ .url, .timeout_ms, .keep_alive_enable }`（无 cert_pem/crt_bundle_attach） | ESP-IDF 默认拒绝无凭据的 TLS 连接 → HTTPS OTA 大概率在连接阶段失败；注释声称"TLS 证书验证已启用"名不符实 | http_config 加 `.crt_bundle_attach = esp_crt_bundle_attach` 并启用证书 bundle |
| MA-18 | **Major** | main.c:347-368 | `ESP_ERROR_CHECK(wifi_manager_init(...)); ESP_ERROR_CHECK(wifi_manager_start());` 在风扇初始化（step 6）之前 | 任一步失败即 abort/重启循环 → **风扇控制永远不初始化**；对"风扇安全先于联网"的原则反向依赖（plan §2.3 main.c 检查点） | 风扇/PWM/曲线初始化提前到 WiFi 之前；WiFi 失败降级为本地控制 |
| MA-19 | **Major** | components/fan_pwm/fan_pwm.c:62-73 + remediation §3 | LEDC 配置前 GPIO4-7 悬空；v1.2 硬件 74AHCT125 OE 恒使能且无输入下拉 | 上电窗口期缓冲输出不定 → **风扇可能满转/乱转数百毫秒**（软件无早初始化、硬件无上拉/下拉，两头都没处理） | 固件在 app_main 最早处先配 LEDC duty=0；硬件侧 PWM 线加下拉（建议 10kΩ，列入硬件整改后续） |
| MA-20 | **Major** | components/fan_curve/fan_curve.h:32-33 + fan_curve.c 全文 | `/** 设置 LUT 曲线点（保存到 NVS）*/` — 实现中无任何 NVS 调用；`fan_curve_set_lut/set_pid/set_temp_source` 零调用方（§9.4-F grep） | 曲线配置掉电即失；协议 §4.2 的配置通道两端都断 | 实现 NVS 持久化（storage_write_config 已有基础设施）+ 接入 command/curve |
| MA-21 | **Major** | components/power_monitor/power_monitor.h:14-15 | `#define VOLTAGE_DIVIDER_5V 2.0f` / `VOLTAGE_DIVIDER_3V3 2.0f` | v1.2 硬件为 47k/10k=÷5.7 → 读数偏差 2.85 倍（10V 显示 2.8V 级错误）。**H-03 清单只改通道号不改分压比**——即使执行 H-03 电压仍然全错 | 常数改 5.7；头注释的分压网络描述同步更新 |
| MA-22 | **Major** | components/ota_handler/ota_handler.c 全文 + 协议 §7 | 无任何 `ota/status` MQTT 发布（进度仅 ESP_LOGI） | 协议 §7 状态反馈（state/progress_pct/message）固件端为零；web 亦未订阅 → OTAProgress 组件只有不确定动画 | ota_task 周期发布 ota/status；backend 订阅并转发 WS |
| MA-23 | **Minor** | main.c:122 | `snprintf(topic,...,"%s/%s/alert/cleared",...)` | `alert/cleared` topic 不在协议定义中，消费方（web/HA）均不处理 | 协议补录该 topic 或改用 alert+cleared 字段 |
| MA-24 | **Minor** | components/ds18b20/ds18b20.c:2,31-35 + ds18b20.h:2 | 头注释"RMT 精确时序"；实现为 GPIO bit-bang（`esp_rom_delay_us`），`driver/rmt_tx.h` 引入未用 | 注释失真；bit-bang 时序对中断抢占敏感（CRC8 可兜底丢数据但读数失败率升高）；800ms vTaskDelay 阻塞采集周期至 ~1.8s；parasite power 未显式拒绝 | 文档改口径；迁移 RMT 或至少关中断窗口；README 声明不支持 parasite |
| MA-25 | **Minor** | components/alert_manager/alert_manager.c:113-120 | Rule 2 无 clear 分支（temperature/voltage/wifi 均有） | fan_stall 告警恢复后规则仍 active、on_clear 永不触发 | 恢复 RPM 时 clear_rule(ALERT_TYPE_FAN_STALL) |
| MA-26 | **Minor** | main.c:217-228 | 只有 BME280 温度进入 alert_manager_update_temperature | 两路 DS18B20 探头（机箱关键温度）不参与温度告警 | 取三源最大值或分别设阈值 |
| MA-27 | **Minor** | alert_manager.c:37,92-94 | `s_wifi = true`（初值）；断连计时依赖 on_disconnected 回调 | 开机起从未连上 WiFi 时不产生 wifi_disconnected 告警（无断连事件） | 初始化为 false 或在 check_all 判 wifi_manager_is_connected() |
| MA-28 | **Minor** | components/wifi_manager/wifi_manager.c:307-317 | `nvs_erase_all(nvs)`（NS fan_ctrl） | "恢复出厂"只清 WiFi 凭据，不清 broker URL/曲线/日志 | 汇总各 NS 统一清理 |
| MA-29 | **Minor** | wifi_manager.c:277-282 | AP `.authmode = WIFI_AUTH_OPEN`，portal 无鉴权 | 局域网内任何人可改写 WiFi 凭据（deploy.md 声明的局域网假设未覆盖此点） | portal 加一次性 token 或最低限度的确认机制 |
| MA-30 | **Minor** | components/bme280/bme280.c:4-5,130-142 | 头注释声称"出错后 rm_device+重初始化"（无此代码）；calib 读取返回值未检查 | 注释失真；I2C 瞬时失败时静默使用垃圾校准值 | 检查返回值并 fail-fast；删除虚假注释 |
| MA-31 | **Minor** | main.c:45,61 | `char topic[64], payload[128]; ... (void)payload;` | 死代码 | 删除 payload |
| MA-32 | **Minor** | firmware/partitions.csv:4-5 + sdkconfig.defaults | factory 0x100000 / ota_0/1 0x180000 | factory 与 OTA 槽容量不对称（新固件>1MB 时 factory 无法作回退镜像）；coredump 分区存在但 CONFIG_ESP_COREDUMP 未启用 | 对齐三槽尺寸；启用 coredump 或删除该分区 |
| MA-33 | **Info** | fan_curve.c:157-162 | set_lut 不校验 temp_c 单调递增 | 乱序点导致插值行为异常 | 排序或拒绝乱序 |
| MA-34 | **Info** | mqtt_client_wrapper.c:161-166 | MQTT_EVENT_DATA 不处理分片（current_data_offset/total_data_len） | >4KB payload 会被截断解析（当前 payload 均小，暂无实害） | 加分片重组判断 |
| MA-35 | **Major** | main.c:354,158-157 | `mqtt_subscribe("fan-controller/+/command/#", ...)` ; handler 不校验 payload 内 device_id 与本机是否一致 | 通配 `+` 使设备收到**总线上所有设备**的命令且照单全收：多设备部署时一台设备的控制指令会被所有设备执行（当前唯一"受益者"是 ha 的 esp32-placeholder，见 MD-01——两个缺陷互相掩盖） | 订阅改 `{prefix}/{device_id}/command/#`，handler 再校验 device_id 字段 |

### 模块 B：agent

| 编号 | 严重度 | 文件:行 | 证据摘录 | 影响 | 建议修法 |
|------|:------:|---------|----------|------|----------|
| MB-01 | **Critical** | agent/internal/monitor/gpu.go:6 + go.mod（§9.4-C 输出） | `import ( "bytes" ... )` — 全文无 bytes 使用；仓库无 go.sum | **编译失败（全平台）**：unused import；且干净检出无 go.sum 无法离线/CI 构建，`go mod tidy` 又因上游测试依赖 creack/gopty 仓库被删而失败 | 删除 bytes import；提交 go.sum（用 `go mod tidy -e` 生成）或 vendor |
| MB-02 | **Critical** | agent/cmd/agent/main.go:26-33 | `// TODO (T24): initialise MQTT client` / `// TODO (T23): ... collectors` / `// TODO (T24): ... USB relay` | **agent 是空壳**：加载配置后即挂起等信号，MQTT/采集/串口中继零功能；而 README/deploy.md 把它描述为已工作的 GPU 监控守护进程 | 完成接线（client.go/collector/relay 代码本身已存在且质量尚可） |
| MB-03 | **Major** | agent/install.sh:39 + agent/Makefile:23 | `install -Dm644 "${BINARY}.service"` → `smart-fan-agent.service`（仓库文件名为 `agent.service`） | 安装在 [4/4] 步必然 `set -e` 中止——**部署脚本从未成功跑通** | 统一文件名（建议 service 文件改名 smart-fan-agent.service） |
| MB-04 | **Major** | agent/internal/mqtt/client.go:47,75-76 | `topic := fmt.Sprintf("%s/+/command/#", ...TopicPrefix)` ; `"system-monitor/%s/sensor/%s", c.cfg.MQTT.ClientID` | 订阅命令偏离协议 §11（agent 应订阅 `+/sensor/#` 与 `+/alert`，未定义其消费 command）；发布 topic 用 ClientID 而非协议规定的 hostname | 订阅改 sensor/alert；发布用 os.Hostname() |
| MB-05 | **Major** | agent/agent.service:8-11 | `User=nobody` + `ReadWritePaths=/var/log/smart-fan-agent` | nobody 不在 dialout 组 → /dev/ttyACM0 打开必然 Permission denied（串口中继不可用）；且代码从不写 /var/log | 加 `SupplementaryGroups=dialout`；或指定专用用户 |
| MB-06 | **Minor** | agent/internal/config/config.go:38-48 + config.yaml:3 | `Port int \`yaml:"port"\`` — Port 从未被使用；broker URL 与 port 分离且无校验 | port 字段是死配置；填错 broker scheme 无提示 | 校验 broker URL 前缀；删除或合并 port |
| MB-07 | **Minor** | agent/internal/mqtt/client.go:64 | `if token.WaitTimeout(30*time.Second) && token.Error() != nil` | WaitTimeout 超时返回 false → 连接失败被当成功返回 | 改为 `!token.WaitTimeout(...) \|\| token.Error() != nil` |
| MB-08 | **Minor** | agent/internal/usb/relay.go:30-43 | `for attempt := 0; ; attempt++ { ... time.Sleep(delay) }` | Open() 永不返回错误：设备缺失时启动流程死等；且"读 ESP32 JSON 上报"与固件实现矛盾——固件 console 只应答命令、从不上报 JSON 行 | Open 有限次重试后返回错误；明确 relay 的架构定位或删除 |

### 模块 C：web

| 编号 | 严重度 | 文件:行 | 证据摘录 | 影响 | 建议修法 |
|------|:------:|---------|----------|------|----------|
| MC-01 | **Critical** | web/frontend/package.json:7 + 目录盘点（§9.4-D） | `"build": "tsc && vite build"` — 无 tsconfig.json、index.html、src/main.tsx、vite.config.ts | `tsc` 打印帮助退出 1，`&&` 短路 → vite 从不执行，**dist 永不生成**；deploy.md §4.2/nginx/README 快速开始全部不可复现 | 补 tsconfig/vite.config/index.html/main.tsx 四件套 |
| MC-02 | **Critical** | web/backend/package.json:7 + §9.4-B | `"build": "tsc"` — backend 无 tsconfig.json | `npx tsc --noEmit` 打印帮助（无编译动作）；`npm start` 需要的 dist/server.js 无生成路径——**backend 无可用的构建/生产启动链**（dev 模式 tsx 可跑） | 补 tsconfig.json（module commonjs/outDir dist） |
| MC-03 | **Major** | web/backend/src/mqtt.ts:18,74 | `fans: Array.from({ length: 4 }, ...)` ; `if (idx >= 0 && idx < 4)` | 风扇数硬编码 4（表2）：v1.2 为 8 路；H-03 改 FAN_PWM_COUNT 后前端只显示 4 路 | 常量化并随设备上报的 fan 数量伸缩 |
| MC-04 | **Major** | web/backend/src/mqtt.ts:39-42 | 订阅仅 status/sensor/+/fan/+/state/alert | 协议 topic 中 `ota/status` 与 `*/buffered` 无消费方：OTA 进度、离线补发消息在前端不可见 | 补订阅 `+/ota/status`、`sensor/#` |
| MC-05 | **Major** | web/backend/src/routes/devices.ts:80-84 | `publishCommand(req.params.id, 'alert', {...})` | `command/alert` 不在协议 action 集（协议为 `config/alert`），固件亦无 handler → 该端点对设备是空操作却返回 applied:true | 改发 config/alert 并等固件实现 |
| MC-06 | **Major** | routes/devices.ts:52-57 + protocol.md §4.2 | CurveSchema: `pid: z.object({kp,ki,kd,setpoint_c})`（嵌套） | 协议 PID payload 为平铺（setpoint_c/kp/ki/kd 在顶层）；且 `temperature_source` 用字符串（"bme280"）而固件 fan_curve 是数字源 0-3，无任何映射层 | 与协议对齐（平铺）；定义字符串→源编号映射 |
| MC-07 | **Minor** | web/backend/src/server.ts:10,13 | `const PORT = ... 3001` ; `app.use(cors())` | 0.0.0.0 监听+CORS 全开+无鉴权；deploy.md 仅声明 broker 匿名为"局域网使用"，web 裸奔未声明 | deploy.md 补安全声明或加简单 token |
| MC-08 | **Minor** | routes/devices.ts:31-36 | `// In production: query Go Agent ... res.json(ok({ ..., entries: [] }))` | history 端点是占位空实现，History 页的时间范围选择不触发任何后端查询 | 接通 agent 或固件 storage_get_recent_logs 通道 |
| MC-09 | **Minor** | grep（§9.4-G） | pages/ 对 components/ 的 import 数为 0 | components/ 下 7 个组件全部死代码（页面各自内联重实现，两套 FanCard/CurveEditor 行为已开始分叉） | 统一抽回 components 并删除页面内联版 |
| MC-10 | **Minor** | components/CurveEditor.tsx:92-114 + Fans.tsx:125-134 | 点位 input 无 0-100 校验、无增删点 UI（固定 5 点） | 用户可输入 200% 占空比/乱序温度；协议未定义点数上限（firmware FAN_CURVE_MAX_POINTS=10）两边不校验 | 输入 clamp + 点数上限统一为 10 |
| MC-11 | **Major** | web/frontend/src/pages/Alerts.tsx:15,93 | `const SEV_COLORS = { 0:'#22c55e', 1:'#f59e0b', 2:'#ef4444' }` ; `SEV_COLORS[a.alert_type]` | 把 alert_type（0=温度,1=停转,2=电压,3=wifi）误当 severity 用：**温度告警显示绿点、wifi 告警无色**；根因是 MA-10 缺 severity 字段 | 固件补 severity 字段后前端按 severity 取色 |
| MC-12 | **Minor** | web/frontend/src/pages/History.tsx:95 + Fans.tsx:22 | `new Date(a.timestamp * 1000)` | 因 MA-12（timestamp=uptime），告警时间显示 1970+开机时长；History 仅跟踪 fan0/fan1 两路 | 随 MA-12 修复；补足 8 路序列 |
| MC-13 | **Minor** | pages/Fans.tsx:17-23 内联 FanCard | `const [duty, setDuty] = useState(fanState.pwm_duty_pct)` | 滑块初值后不随设备推送更新（stale state）；onMouseUp 提交不支持触摸拖动 | useEffect 同步或受控回显 |

### 模块 D：ha

| 编号 | 严重度 | 文件:行 | 证据摘录 | 影响 | 建议修法 |
|------|:------:|---------|----------|------|----------|
| MD-01 | **Critical** | ha/fans.yaml:6,24 | `command_topic: "fan-controller/esp32-placeholder/command/fan"` | 占位 device_id：命令发往不存在的 `esp32-placeholder`——真实设备 ID 永不匹配；当前之所以"碰巧能通"全靠固件 MA-03/MA-14 的通配订阅缺陷，修复固件后 HA 控制立即断链 | 文档化 device_id 获取方式（status topic），模板化或安装时替换 |
| MD-02 | **Major** | ha/fans.yaml 全文 | 仅 "Fan 0"/"Fan 1" 两个实体 | 控制实体 2 个 vs RPM 传感器 4 个（sensors.yaml）vs 固件 4 路 vs v1.2 8 路——四层口径互不相同（表2）；ha/README.md:36 声称"风扇 0-3 转速控制"亦与 2 实体不符 | 路数统一后按实际数量生成 |
| MD-03 | **Major** | ha/alerts.yaml:7-8 | `{{ 'ON' if value_json.alert_type == 0 else 'OFF' }}` | 四个 binary_sensor 共用同一 state_topic、按消息内容即时翻转：**任何一条告警到达都会把其余三个传感器打成 OFF**；告警恢复也无对应消息（固件 alert/cleared 是另一 topic 且无人消费） | 固件发独立的 per-type 状态 topic，或使用 device_trigger/事件模型 |
| MD-04 | **Minor** | ha/sensors.yaml:47 | `value_template: "{{ value_json.sensors[0].temperature_c }}"` | 按数组位置取探头：固件跳过 invalid 传感器（main.c:238）导致索引移位、贴错标签；第二探头无实体；3.3V 电压无实体 | 固件按协议发 address/valid 后按地址匹配；补实体 |
| MD-05 | **Minor** | ha/*.yaml 全文 | 无任何 `availability_topic` | 协议 §8 要求 LWT 联动可用性（plan §5 检查点）；设备离线后实体状态停留在旧值 | 各实体加 availability_topic=`fan-controller/{id}/status`+availability 模板 |

### 模块 E：test

| 编号 | 严重度 | 文件:行 | 证据摘录 | 影响 | 建议修法 |
|------|:------:|---------|----------|------|----------|
| ME-01 | **Critical** | test/smoke_test.sh:7,17 + test/e2e/integration_test.sh:5,12 | `set -euo pipefail` + `pass() { echo ...; ((PASS++)); }` | `((PASS++))` 首次求值为 0 → 算术命令退出码 1 → **脚本在第一个通过的检查处立即退出（exit 1）**，后续检查全部不执行 | 改 `((++PASS))` 或 `PASS=$((PASS+1))` |
| ME-02 | **Major** | test/e2e/integration_test.sh:62-69 | T4 注释"verify device receives"，实际只 publish 后判成功，`T_OUT=$(mktemp)` 创建后从未读取 | 命令是否被设备接收/执行零验证——断言质量失真 | sub 捕获 payload 并断言字段；删无用 mktemp |
| ME-03 | **Minor** | test/smoke_test.sh:3,113-119,143-146 | 头部声明依赖 jq（全文未使用）；CP7 的 SUB_OUT 未校验；CP12 的 TOPICS 变量计算后弃用（且 `grep -c "Topic:"` 对 `**Topic**:` 实际匹配 0） | 依赖声明与断言均有水分；CP11/CP12 依赖相对路径，必须从仓库根运行但未说明 | 删 jq；补 SUB_OUT 内容断言；头部注明工作目录 |
| ME-04 | **Info** | smoke_test.sh CP1-CP10 vs 协议 | 覆盖：status/sensor/fan state/command fan/alert/OTA 触发/校验 | 协议命令 curve、reset、config、ota/status、buffered 均无任何测试（覆盖表见 §9.3 表3 附注） | 补测 |

### 模块 F：docs 与仓库根

| 编号 | 严重度 | 文件:行 | 证据摘录 | 影响 | 建议修法 |
|------|:------:|---------|----------|------|----------|
| MF-01 | **Major** | README.md:7,72,150 | "4-channel PWM"、"4路独立风扇"、"4路 4Pin 25kHz PWM" | 与 v1.2 硬件（D2=8 路）矛盾——R6 数字矛盾；注意整改清单 H-07 描述为"README 6路→8路"，实际现状是 4 路，整改执行者会被误导 | H-07 执行时以现状 4→8 为准 |
| MF-02 | **Major** | README.md:16,157 + docs/index.html:177,282,293 | `[PCB-80×60mm_2Layer]` / "80mm × 60mm，双层 FR4" | v1.2 决策 D3 为 99×99mm 4 层；index.html（GitHub Pages 门面）同错 | 随 H-07 一并更新 |
| MF-03 | **Major** | README.md:137,222 + ha/README.md:15 | "HA 自动发现设备，无需手动配置"/"固件启动后会自动发布 Discovery 消息" | 固件 grep `homeassistant` 为零（§9.4-F）——**Discovery 完全未实现**，文档承诺虚假；README 同页又给出手动 packages 步骤，两种说法并存 | 删除自动发现表述或实现 discovery 发布 |
| MF-04 | **Major** | docs/deploy.md:63-69,233 + docs/hardware-assembly.md:166-176 | `fan 0 speed 75`、`fan 0 auto`、`wifi status`；验收示例 help 输出含 "fan" | 固件 console 实际命令仅 help/status/reboot/ota（usb_console.c:145-146 + main.c:377-378）——**文档教的命令全部不存在**，组装验收流程照做必然失败 | deploy/assembly 文档命令表对齐实现（或补固件 fan/wifi 命令） |
| MF-05 | **Minor** | README.md:181,186,252 | "USB-CDC（6+命令…）"、"12个 Unity 单元测试"、`cd web && npm test` | 实际 4 命令、13 个测试文件且未接入构建、web 根无 package.json（npm test 报错） | 数字与命令对齐；测试接入 CMake 或删述 |
| MF-06 | **Minor** | docs/deploy.md:216-218 | `-t "fan-controller/esp32-XXXXXX/command/ota"` | deploy 记载的 OTA topic 与固件实现一致但与协议 §7（`{id}/ota`）不一致——实现/文档/协议三方分裂的实证（表1） | 借协议修订统一口径 |
| MF-07 | **Minor** | docs/hardware-assembly.md 全文 | J3-J6 四路风扇座、R13-R24 12 只 Tach 电阻、D3 SRV05-4、F1 MF-MSMF250、J7/J8 探头位号 | 整体为 v1.1 口径（8 路/24 电阻+8 电容/D3 二极管或/F1≥3A/J11/J12 均不符）——与 H-07 待改清单一致，作为整改前基线记录 | 执行 H-07 重写 |
| MF-08 | **Minor** | .omo/ 与 .sisyphus/ | `diff -rq` 输出为空（字节级相同），163K×2，均被 git 跟踪 | 同一份数据双份入库（历史 AI 执行计划+任务证据）；.gitignore 仅注释性提及 | `git rm -r` 保留一份或全部移出并加 ignore |
| MF-09 | **Minor** | hardware/docs/hardware-design-guide-v1.1.md:573-576 | `bom-main-board-v1.1.xlsx / bom-expansion-board-v1.0.xlsx / pcb-layout-example.png / test-procedure.md` | 附录引用的 4 个文件均不存在（死链，H-16 范围）；注：`hardware/BOM.csv` 实际**存在**（审查计划所列"已知死链"有误），但为 v1.1 旧口径 | 执行 H-16；计划文档该条勘误 |
| MF-10 | **Info** | LICENSE + 各模块 | 根 MIT（© 2026 OneAsmallFish），agent/web 无独立 license | 与 README 徽章一致，无冲突 | 无需动作 |

---

## 9.3 一致性矩阵（§8 六张表）

### 表1 MQTT topic（左列 = protocol.md 全部 topic 完整枚举）

| # | protocol.md topic（行号） | QoS/方向（协议） | firmware 实现 | web backend | agent | ha | 一致? |
|---|--------------------------|------------------|---------------|-------------|-------|-----|:-----:|
| 1 | `fan-controller/{id}/status`（:26,47,72） | 1 / 设备→Broker, LWT retain | ✓ pub（LWT:219 仅 status 字段；online:137 缺 4 字段 → MA-11） | ✓ 订阅 `+/status`（mqtt.ts:39） | ✗ 未实现（空壳） | ✓ 订阅（alerts.yaml:39） | ⚠ 字段不全 |
| 2 | `fan-controller/{id}/sensor/bme280`（:27,83） | 0 / 设备→Broker | ✓ pub 1s QoS0 ✓字段 | ✓ 订阅消费 | ✗ | ✓ 订阅 | ✓ |
| 3 | `.../sensor/ds18b20`（:27,98） | 0 / 设备→Broker | ⚠ pub 字段 index≠协议 address/valid（MA-28 关联） | ✓ 消费（按 index） | ✗ | ⚠ 按位置[0]取值 | ⚠ schema |
| 4 | `.../sensor/voltage`（:27,114） | 0 / 设备→Broker，**5s** | ⚠ pub 1s（频率不符，MA-29） | ✓ | ✗ | ✓（缺 3v3 实体） | ⚠ 频率 |
| 5 | `.../sensor/internal_temp`（:27,129） | 0 / 设备→Broker，**5s** | ⚠ pub 1s | ✓ | ✗ | ✓ | ⚠ 频率 |
| 6 | `.../fan/{index}/state`（:28,146）index 0-3 | 0 / 设备→Broker | ✓ pub 1s QoS0；缺 mode 字段（MA-16） | ✓ 订阅（idx<4 硬编码） | ✗ | ✓（fan/0-3） | ⚠ 字段 |
| 7 | `.../command/fan`（:29,173） | 1 / Broker→设备 | ✓ 处理（158-164）——但订阅链路断（MA-03） | ✓ 发布（devices.ts:44） | ✗ 订阅的是整个 command/# | ✓ payload_on/off/percentage 模板 | ⚠ 订阅断 |
| 8 | `.../command/curve`（:29,189） | 1 | ✗ **无 handler**（MA-09） | ✓ 发布（嵌套 PID schema 偏差 MC-06） | ✗ | — | ✗ |
| 9 | `.../command/reboot`（:29,225） | 1 | ✓ 处理（171-175） | ✓ 发布 | ✗ | — | ✓（链路受 MA-03 影响） |
| 10 | `.../command/reset`（:29,236） | 1 | ✗ 无 handler | ✗ 无端点 | ✗ | — | ✗ 双缺失 |
| 11 | `.../alert`（:30,250） | 1 / 设备→Broker | ⚠ pub（alert_type 数字、缺 severity/sensor，MA-10） | ✓ 订阅（按数字解析） | ✗ | ✓ 订阅（数字匹配） | ⚠ schema |
| 12 | `.../alert/cleared`（**协议未定义**） | — | ✓ 固件发布（main.c:122） | ✗ 不消费 | ✗ | ✗ | ✗ 幽灵 topic |
| 13 | `.../config/{wifi,mqtt,alert,curve}`（:31,281-306） | 1 / 双向 | ✗ 不订阅不发布 | ✗ 不订阅（alert 规则误发 command/alert，MC-05） | ✗ | — | ✗ 全线未实现 |
| 14 | `.../ota`（:32,312） | 1 / Broker→设备 | ✗ 固件不订阅此 topic（只听 command/ota） | ✗ 发的是 command/ota | ✗ | — | ✗ 三方分裂（deploy.md:217 站固件侧） |
| 15 | `.../ota/status`（:326） | 1 / 反馈 | ✗ 从不发布（MA-22） | ✗ 不订阅 | ✗ | ✗ | ✗ 全线未实现 |
| 16 | `homeassistant/{component}/{id}/{object}/config`（:33,351-390） | 1 / Discovery | ✗ 固件零 discovery 代码（MA-23） | — | — | —（ha/ 走手动 packages） | ✗ |
| 17 | `.../sensor/.../buffered`（:440-443） | — | ✗ 无后缀直发（MA-15） | ✗ `sensor/+` 匹配不到 5 级 topic | ✗ | ✗ | ✗ 全线未实现 |
| 18 | `system-monitor/{hostname}/sensor/gpu`（:470） | 0 / agent→Broker | — | — | ⚠ 代码用 ClientID 而非 hostname（MB-04），且 main 空壳未接线 | — | ⚠ |
| 19 | （固件私有）订阅 `fan-controller/+/command/#`（main.c:354） | — | ⚠ 通配+不校验 device_id（MA-14）；且因 MA-03 实际未生效 | — | ⚠ agent 同样订阅 command/#（协议未授权） | — | ✗ |

### 表2 风扇数量与索引（左 = 硬件 v1.2 = 8 路）

| 位置 | 数值 | file:line | 0/1-based | 与 8 路一致? |
|------|:----:|-----------|:---------:|:------------:|
| 硬件 v1.2（整改清单 D2） | **8** | remediation §1（GPIO5-12, 13-15/21/38-41） | Fan1=index0（:65） | 基准 |
| firmware FAN_PWM_COUNT | 4 | fan_pwm.h:9 | 0-based | ✗ |
| firmware FAN_TACH_COUNT | 4 | fan_tach.h:10 | 0-based | ✗ |
| firmware FAN_CURVE_FANS | 4 | fan_curve.h:10 | 0-based | ✗ |
| firmware main 循环 | 4（字面量） | main.c:280,301 | 0-based | ✗（且未用宏，H-03 连带） |
| firmware alert 数组 | 4 | alert_manager.c:35,87,113 | 0-based | ✗ |
| firmware 日志缓冲 | fan_rpm[4] | flash_storage.h:17 | 0-based | ✗ |
| protocol.md | 4（index 0,1,2,3） | protocol.md:37 | 0-based | ✗ 文档待更新 |
| web backend | 4 | mqtt.ts:18,74 | 0-based | ✗ |
| web Fans 页注释 | "4路" | Fans.tsx:1 | 0-based（"Fan 0"） | ✗ |
| web History 页 | 2（仅 fan0/fan1 曲线） | History.tsx:35-36,98-99 | 0-based | ✗ |
| ha fans.yaml 控制实体 | **2** | fans.yaml:4,22 | 0-based（"Fan 0/1"） | ✗ |
| ha sensors.yaml RPM | 4 | sensors.yaml:88-122 | 0-based | ✗ |
| ha README 声称 | 控制 4（"风扇 0-3"） | ha/README.md:36 | 0-based | ✗ 且与自身 2 实体矛盾 |
| README.md | 4 | README.md:7,72,150 | 0-based | ✗ |

**结论：全项目 15 处路数口径 = {2,4,4,4,...}，无一处为 8；索引风格 0-based 全局统一 ✓。**

### 表3 命令名与 payload（左 = usb_console 实际命令表 + protocol 命令并集）

| 命令 | 固件 usb_console | 固件 MQTT handler | protocol.md §4 | web backend | ha | deploy/assembly 文档 | 一致? |
|------|------------------|-------------------|----------------|-------------|-----|---------------------|:-----:|
| help | ✓（usb_console.c:145） | — | —（协议不定义 console） | — | — | ✓ 记载 | ✓（但 assembly:175 的 help 输出示例含不存在的 "fan"） |
| status | ✓（main.c:377） | — | — | — | — | ✓ | ✓ 字段一致（assembly:168 示例与 cmd_status 输出吻合） |
| reboot | ✓（usb_console.c:146） | ✓ command/reboot | ✓ §4.3 | ✓ POST /reboot | — | ✓ | ✓ |
| ota | ✓（main.c:378） | ⚠ command/ota（协议为 /ota） | ✓ §7（firmware_url/version/checksum） | ✓（仅 firmware_url，缺 version/checksum） | — | ✓ | ⚠ topic 位置+字段 |
| fan | ✗ **不存在** | ✓ command/fan（fan_index/duty_pct；忽略 mode 语义） | ✓ §4.1 | ✓（speed→duty_pct ✓ 0-100 校验 ✓） | ✓ payload/percentage 模板 | ✗ deploy.md:64-66、assembly:170 教用 | ✗ 文档虚构 |
| wifi | ✗ 不存在 | — | — | — | — | ✗ deploy.md:233 `wifi status` | ✗ 文档虚构 |
| curve | — | ✗ 无 handler | ✓ §4.2（LUT points / PID 平铺） | ⚠ 嵌套 PID + 字符串 temperature_source | — | — | ✗ schema 三方两版 |
| reset | — | ✗ 无 handler | ✓ §4.4（confirm） | ✗ 无端点 | — | — | ✗ 双缺失 |
| config/alert | — | ✗ 不订阅 config/# | ✓ §6.2 | ⚠ 发 command/alert（错位） | — | — | ✗ |

**测试覆盖附注（ME-04）**：smoke 覆盖 fan 命令链路（CP7）与 OTA 触发（CP9）；curve/reset/config/ota/status/buffered 零测试。

### 表4 传感器类型与单位（左 = protocol.md §2 完整枚举）

| 传感器/字段 | protocol.md | firmware 上报 | web backend/前端 | ha | 一致? |
|-------------|-------------|---------------|------------------|-----|:-----:|
| bme280.temperature_c (°C) | :91 | ✓ main.c:224 | ✓ types.ts:3 / Dashboard | ✓ sensors.yaml:10-11 | ✓ |
| bme280.humidity_pct (%) | :92 | ✓ | ✓ | ✓ device_class humidity | ✓ |
| bme280.pressure_hpa (hPa) | :93 | ✓ | ✓ | ✓ | ✓ |
| ds18b20.sensors[].address ("28-..") | :106 | ✗ 发 index（main.c:240） | ✗ types.ts:10 index | ✗ 位置[0] | ✗ |
| ds18b20.sensors[].valid (bool) | :106 | ✗ 无效项直接跳过不报 | ✗ 无 | ✗ 无 | ✗ |
| ds18b20.sensors[].temperature_c | :106 | ✓ | ✓ | ✓ | ✓ |
| voltage.voltage_12v (V) | :121 | ✓（值错 ÷5.7，MA-21） | ✓ VoltageBar 12V±10% | ✓ | ⚠ 数值精度 |
| voltage.voltage_5v (V) | :122 | ✓（值错） | ✓ ±5%=±0.25 与固件容差一致（Dashboard:93） | ✓ | ⚠ |
| voltage.voltage_3v3 (V) | :123 | ✓（值错） | ✓ ±5%=±0.165（Dashboard:94） | ✗ 无实体 | ⚠ |
| internal_temp.temperature_c (°C) | :136 | ✓ | ✓ | ✓ | ✓ |
| fan.pwm_duty_pct (0-100) | :162 | ✓ | ✓ | ✓（percentage_value_template） | ✓ |
| fan.rpm | :163 | ✓ | ✓ | ✓ | ✓ |
| fan.stalled (bool) | :164 | ✓（判定 rpm<200&&duty>5，与固件告警口径不同） | ✓ | —（仅 RPM 实体） | ✓ |
| fan.mode ("auto"/"manual") | :165 | ✗ 不发布（MA-16） | 类型有、值恒 'auto' | — | ✗ |
| alert.severity ("warning"/"critical") | :257-273 | ✗ 不发布（MA-10） | ✗ 无字段（误用 alert_type 上色） | ✗ 无 | ✗ |
| timestamp（Unix 秒） | :13 | ✗ 开机秒（MA-12） | History 按 epoch 展示 → 1970 年 | — | ✗ |
| 上报频率 bme280/ds18b20=1s, voltage/internal=5s | :84,99,116,131 | 1s/1s/1s/1s | — | — | ⚠ voltage/internal 快 5 倍 |

### 表5 告警级别（左 = firmware alert_manager）

| 维度 | firmware | protocol.md §5/§6.2 | web 前端 | ha/alerts.yaml | 一致? |
|------|----------|----------------------|----------|----------------|:-----:|
| 级别模型 | 3 级枚举 NORMAL/WARNING/CRITICAL（alert_manager.h:9） | 2 值字符串 warning/critical（:271） | SEV_COLORS {0绿,1黄,2红} 但**键是 alert_type**（Alerts.tsx:15） | 无级别概念（binary on/off） | ✗ 四方四种口径 |
| alert_type 表示 | 数字 0-3 | 字符串 4 种（:265-269） | 数字（跟随固件） | 数字比较 ==0/1/2（:8,19,30） | ✗ 类型+表达 |
| 阈值 temperature_high | 75°C 警告 / >80°C critical（alert_manager.c:13,103） | 示例 78.5°C 即 critical（:257） | 默认 75（AlertRuleEditor:11） | — | ⚠ critical 门限不一致 |
| 阈值 fan_stalled | <200RPM（且 rpm>0 才判，MA-06） | 示例 200（:302） | 默认 200 ✓ | — | ⚠ 判定逻辑 |
| 阈值 voltage_abnormal | 12V 10.8-13.2 / 5V ±0.25 / 3.3V ±0.165（:15-18） | 12v_min 10.8 + 12v_max 13.2（:303） | 单阈值 10.8（丢 max）（AlertRuleEditor:13）；Dashboard 判定与固件完全一致（:92-94） | — | ⚠ 单/双阈值 |
| 阈值 wifi_disconnected | >60s（:19） | 60s（:269） | 默认 60 ✓ | — | ✓ |
| 阈值可配置性 | 全部硬编码（config 通道未实现） | §6.2 定义运行时可配 | UI 可编辑但发到无人处理的 command/alert | — | ✗ 功能断链 |
| LED 颜色映射 | status_led.h:11-16（绿呼吸/黄慢闪/红快闪/蓝慢闪/紫呼吸） | §5 黄/红 两档 ✓ | — | — | ✓（协议仅覆盖两档） |

### 表6 硬件引脚（左 = 整改清单 §1 v1.2 权威表全 34 行；H-03 未执行）

| GPIO | v1.2 功能 | 固件 define/用法（file:line） | 一致? |
|:----:|-----------|-------------------------------|:-----:|
| EN | RESET，10k 上拉+SW1 | （无显式 define，依赖模组默认） | — |
| 0 | BOOT strapping | 未用 | ✓ |
| 1 | ADC_12V（CH0，÷6） | power_monitor.c:16 `CH_3V3=ADC_CHANNEL_0 /*GPIO1*/` | ✗ 功能错位 |
| 2 | ADC_5V（CH1，÷5.7） | power_monitor.c:17 `CH_5V=ADC_CHANNEL_1 /*GPIO2*/` | ✓ |
| 3 | **NC**（strapping 禁接） | power_monitor.c:18 `CH_12V=ADC_CHANNEL_2 /*GPIO3*/` | ✗ 违规占用 |
| 4 | ADC_3V3（CH3，÷5.7） | fan_pwm.c:23 `FAN_GPIO[0]=4`（v1.1 遗留）；ADC 侧未用 | ✗ 双重冲突 |
| 5 | FAN1_PWM | fan_pwm.c:23 ✓（LEDC_CH1 位） | ✓ 位置对、序号偏移见 H-03 |
| 6 | FAN2_PWM | fan_pwm.c:23 ✓ | ✓ |
| 7 | FAN3_PWM | fan_pwm.c:23 ✓ | ✓ |
| 8 | FAN4_PWM | fan_tach.c:16 `TACH_GPIO[0]=8` | ✗ PWM/Tach 冲突 |
| 9 | FAN5_PWM | fan_tach.c:16 TACH=9 | ✗ 冲突 |
| 10 | FAN6_PWM | fan_tach.c:16 TACH=10 | ✗ 冲突 |
| 11 | FAN7_PWM | fan_tach.c:16 TACH=11 | ✗ 冲突 |
| 12 | FAN8_PWM | 未用 | ✗ 缺失 |
| 13 | FAN1_TACH PCNT_U0_CH0 | 未用 | ✗ 缺失 |
| 14 | FAN2_TACH PCNT_U0_CH1 | 未用 | ✗ 缺失 |
| 15 | FAN3_TACH PCNT_U1_CH0 | 未用 | ✗ 缺失 |
| 16 | DS18B20_DQ | ds18b20.c:20 `OW_GPIO 16` ✓ | ✓ |
| 17 | I2C_SDA | bme280.c:16 `I2C_SDA_GPIO 17` ✓ | ✓ |
| 18 | I2C_SCL | bme280.c:17 `I2C_SCL_GPIO 18` ✓ | ✓ |
| 19 | USB_D- | TinyUSB 隐式使用（usb_console） | ✓（隐式） |
| 20 | USB_D+ | 同上 | ✓（隐式） |
| 21 | FAN4_TACH PCNT_U1_CH1 | 未用（v1.2 特意把 21 用作 PCNT；固件不知情） | ✗ 缺失 |
| 38 | FAN5_TACH PCNT_U2_CH0 | wifi_manager.c:34 `BTN_GPIO 38` | ✗ 按键/测速冲突 |
| 39 | FAN6_TACH PCNT_U2_CH1 | 未用 | ✗ 缺失 |
| 40 | FAN7_TACH PCNT_U3_CH0 | 未用 | ✗ 缺失 |
| 41 | FAN8_TACH PCNT_U3_CH1 | 未用 | ✗ 缺失 |
| 42 | SPI_SCK（屏幕预留） | 未用 | —（屏幕未实现） |
| 43 | SPI_MOSI（屏幕预留） | 未用；⚠ sdkconfig 未改默认 console=UART0，日志仍走 43/44 | ⚠ 隐患（MA-34） |
| 44 | SPI_CS（带上拉） | 同上 | ⚠ |
| 45 | WS2812B_DI | status_led.c:15 `LED_GPIO 48` | ✗ |
| 46 | NC（strapping） | 未用 | ✓ |
| 47 | BTN_WIFI_CFG | 未用（固件按键在 38） | ✗ |
| 48 | SPI_DC（屏幕预留） | status_led.c:15 占用 48 | ✗ |

**汇总：34 行中 ✗ 16 行、⚠ 3 行、✓ 12 行、— 3 行。一致率 35%（12/34）。** 引脚层面的全部 ✗ 均并入 MA-07（H-03 未执行），但 MA-21（分压比）与 MA-34（console 路由）为 H-03 清单未覆盖的增量项。

---

## 9.4 执行证据

### A. 固件构建 — BLOCKED

```
$ command -v idf.py → NOT FOUND；env | grep -i idf → (空)
```
`idf.py build` **BLOCKED：本机无 ESP-IDF 环境**。静态替代验证：MA-01/MA-02 为无需编译器即可判定的语法/依赖错误（C 语言层面成立）；其余固件结论均为全文代码审查所得，未做运行验证。

### B. web backend — 失败（无 tsconfig）

```
$ cd web/backend && npm install && npx tsc --noEmit
added 135 packages in 37s
（随后输出 tsc 通用帮助文本 ~140 行）→ 退出码 1
```
判定：目录无 tsconfig.json，tsc 无输入可编译。**补充验证**（显式参数）：
```
$ npx tsc --noEmit --esModuleInterop --module commonjs --target es2022 \
    --moduleResolution node --strict --skipLibCheck src/server.ts
→ 退出码 0（源码本身类型干净，问题纯在构建配置缺失）
```

### C. agent — 失败（两条独立证据）

```
$ cd agent && go build ./... && go vet ./...
internal\config\config.go:8:2: missing go.sum entry for module providing package gopkg.in/yaml.v3 ...
internal\mqtt\client.go:12:2: missing go.sum entry ... github.com/eclipse/paho.mqtt.golang
internal\usb\relay.go:11:2: missing go.sum entry ... go.bug.st/serial
```
临时副本 `go mod tidy -e`（不触碰仓库）后：
```
internal\monitor\system.go:136:19: undefined: syscall.Statfs_t        ← Windows 宿主，Linux 目标合法
internal\monitor\gpu.go:6:2: "bytes" imported and not used            ← 全平台编译错误
```
Linux 交叉编译 `GOOS=linux GOARCH=amd64 go build`：仍因 go.sum 缺传导依赖 `github.com/creack/goselect` 失败（其同族测试依赖 `creack/gopty` 上游仓库已被删除，普通 `go mod tidy` 无法自愈）。

### D. web frontend — 失败

```
$ cd web/frontend && npm run build ; echo EXIT=$?
> tsc && vite build
（tsc 帮助文本） → EXIT CODE: 1
```
`tsc` 退出 1 → `&&` 短路 → **vite build 从未执行**；且目录盘点确认无 `index.html`、`src/main.tsx`、`vite.config.ts`、`tsconfig.json`（vite 四要素全缺）。首轮流水分 析中 "FRONTEND BUILD DONE" 系管道吞掉退出码的假象，已用无管道重跑纠正。补充：显式参数 tsc 对 5 页面+App 类型检查退出码 0。

### E. H-03 执行状态 grep（整改清单 §H-03 验收命令原文照跑）

```
$ grep -rn "{ 4, 5, 6, 7 }" firmware/
firmware/components/fan_pwm/fan_pwm.c:23:static const int FAN_GPIO[FAN_PWM_COUNT] = { 4, 5, 6, 7 };   ← 非空
$ grep -rn "FAN_PWM_COUNT 4\|FAN_TACH_COUNT 4" firmware/
fan_pwm.h:9 / fan_tach.h:10                                                                            ← 非空
$ grep -n "LED_GPIO         48" status_led.c   → 15: 命中                                              ← 非空
$ grep -n "BTN_GPIO        38" wifi_manager.c  → 34: 命中                                              ← 非空
$ grep -rn "ADC_CHANNEL_2" power_monitor/      → :18 命中                                              ← 非空
```
**结论：H-03 五条验收全部不通过 → 整改未执行**（并入 MA-07）。

### F. 死代码/幽灵功能 grep（零调用方证实）

```
$ grep -rn "ota_handler_confirm_mqtt|fan_curve_set_lut|fan_curve_set_pid|fan_curve_set_temp_source|
           storage_write_config|power_monitor_on_power_fail" firmware/ --include=*.c --include=*.h
→ 上述符号仅剩 .h 声明 + .c 定义 + firmware/test/ 引用，main.c/组件运行路径零调用
$ grep -rn "homeassistant" firmware/ → 0 命中（Discovery 未实现实证）
$ grep -rn "availability" ha/ firmware/ web/backend/src/ → 0 命中
$ grep -rn "from '.*components/" web/frontend/src/pages/ → 0 命中（7 组件死代码实证）
```

### G. 语法/解析校验 — 通过

```
$ bash -n test/smoke_test.sh          → OK
$ bash -n test/e2e/integration_test.sh → OK
$ python -c "import yaml,glob; [yaml.safe_load(...) for f in glob.glob('ha/*.yaml')]" → YAML OK
```

### H. 其他盘点证据

```
$ diff -rq .omo .sisyphus → 无输出（字节级相同，退出码 0）；du：各 163K
$ wc -l（86 文件全量行数）→ 见 §9.1 覆盖矩阵
死链核验：bom-main-board-v1.1.xlsx / bom-expansion-board-v1.0.xlsx /
          pcb-layout-example.png / test-procedure.md → MISSING×4；
          hardware/BOM.csv → EXISTS（计划"已知死链"条目勘误，见 MF-09）
$ ls firmware/test/*.c | wc -l → 13；CMakeLists 无 test 引用 → 测试不参与构建
```

---

## 9.5 统计与结论

### 发现分桶

| 严重度 | 数量 | 编号 |
|:------:|:----:|------|
| Critical | 12 | MA-01,02,03,04,05,06 / MB-01,02 / MC-01,02 / MD-01 / ME-01 |
| Major | 32 | MA-07~22,35（17 项）/ MB-03,04,05 / MC-03,04,05,06,11 / MD-02,03 / ME-02 / MF-01,02,03,04 |
| Minor | 27 | MA-23~32（10 项）/ MB-06,07,08 / MC-07,08,09,10,12,13 / MD-04,05 / ME-03 / MF-05,06,07,08,09 |
| Info | 4 | MA-33,34 / ME-04 / MF-10（另：表4 中 voltage/internal_temp 上报频率偏差已并入 MA-29） |

编号规则：MA=firmware、MB=agent、MC=web、MD=ha、ME=test、MF=docs 与仓库根，共 75 条。

### 覆盖完成声明

- §2~§7 全部文件清单 **100% 逐文件全文审查**，覆盖矩阵无空行、无"抽样"。
- §8 六张矩阵左侧完整枚举：表1=19 行（协议全部 topic+实现私有 topic）、表2=15 处路数、表3=9 条命令、表4=17 项字段、表5=8 个维度、表6=34 行引脚（整改清单 §1 全表）。
- R6 数字矛盾全部登记：风扇路数 {2,4,8}、alert_type/severity 类型、timestamp 语义、PID payload 结构、曲线 temperature_source 字符串/数字、critical 门限 78.5/80、单/双电压阈值、`((PASS++))` 等。

### BLOCKED 清单

| 项 | 原因 | 后续 |
|----|------|------|
| `idf.py build` | 审查机无 ESP-IDF | 在有 IDF v5.3+ 的环境复跑；预计先撞 MA-01/02 |
| agent Linux 原生运行验证 | 仅交叉编译（且被 go.sum 阻断） | 补 go.sum 后在 Linux CI 复跑 |
| 真机端到端（MQTT/风扇/OTA） | 无硬件 | 固件编译修复后进行 |

### 结论与整改优先级建议

1. **P0（先让"能构建"成立）**：MA-01/02（固件编译）、MB-01（agent 编译+go.sum）、MC-01/02（web 构建配置）、ME-01（测试脚本自毁）。这 7 项不修，任何后续整改都无法验证。
2. **P0（执行中的硬件整改前置）**：H-03 按 MA-07 的扩展清单执行（原清单 + 分压比 ÷5.7 + PCNT unit=i/2 + 五处硬编码 4 + console 路由）。
3. **P1（通信链路）**：MA-03/04/14（订阅与回调）、MA-05（OTA 回滚）、MA-11/12（LWT/timestamp）、MD-01（占位 device_id）。
4. **P1（协议对齐）**：以表1/表3/表4 为对照单，一次性裁决"协议改还是实现改"（建议：alert schema、ota topic 位置、curve PID 结构、ds18b20 address 字段——协议向实现对齐成本低；timestamp/Unix 秒——实现向协议改）。
5. **P2**：死代码清理（components/×7、relay 定位）、文档口径统一（MF-01~04）、.omo/.sisyphus 去重。

---

**报告版本：** v1.0（2026-08-24）
**审查计划：** `docs/module-review-plan.md` v1.0
**上游文档：** `hardware/docs/remediation-plan-v1.2.md`（H-03 状态：**未执行**，证据 §9.4-E）
