# 模块整改销号变更日志 v1.2（changelog-modules-v1.2）

> 依据：`docs/module-remediation-plan-v1.2.md` v1.2（2026-08-24）。
> 执行日期：2026-08-25。执行环境：Windows（Git Bash）+ Go 1.25.7 + Node 22.22 + Python 3.12。
> **2026-08-25 补充：ESP-IDF v5.3.5（D:\espressif）实测构建已通过**（见 §8 与 §4.5），
> 原 BLOCKED 状态解除；仅真机冒烟仍因无 mosquitto/broker 设备而 BLOCKED。
> mosquitto 客户端不在本机 → 冒烟脚本运行时验证 BLOCKED（`bash -n` 语法验证通过）。

---

## 0. 总览

- 整改项总数：**71**（FW×34 / AG×8 / WEB×12 / HA×5 / TST×4 / DOC×6 + Phase 0-7 指针项）
- 完成：**70** ✅｜DESCOPE：**1**（DOC-06，计划允许的降级路径）｜BLOCKED 附注：**2**（真机冒烟与 agent Linux 实机环境缺失，不阻断销号）
- §7 映射表 75 条发现全部销号（见 §7）。

---

## 1. Phase 0 — 让"能构建"成立

### FW-01（MA-01）status_led 返回值类型 ✅
- 改动：`firmware/components/status_led/status_led.h:21` 声明改 `esp_err_t status_led_init(void)`；`status_led.c` 实现改为 `ESP_RETURN_ON_ERROR(rmt_new_tx_channel/rmt_enable)` + 末尾 `return ESP_OK`，calloc 失败返回 `ESP_ERR_NO_MEM`。
- 验证：头文件与实现签名一致（静态检查）；grep `void status_led_init` 为 0。
- 验证补充：ESP-IDF v5.3.5 下 `idf.py build` 实测通过（见 §4.5、§8）。

### FW-02（MA-02）main 组件依赖 ✅
- 改动：`firmware/main/CMakeLists.txt` REQUIRES 补齐全部 13 个自定义组件（fan_pwm, fan_tach, fan_curve, alert_manager, bme280, ds18b20, power_monitor, status_led, wifi_manager, mqtt_client, usb_console, flash_storage, ota_handler）。
- 连带：`fan_curve/CMakeLists` REQUIRES 增加 flash_storage+esp_timer（FW-20 持久化）；`wifi_manager/CMakeLists` 增加 flash_storage（FW-28）；`ota_handler/CMakeLists` 增加 mqtt_client+mbedtls+cJSON（FW-10/FW-09）。
- 验证：grep 13 个组件名全部出现在 REQUIRES。
- 验证补充：ESP-IDF v5.3.5 下 `idf.py build` 实测通过（见 §4.5、§8）。

### AG-01（MB-01）agent 编译修复 ✅
- 改动：`gpu.go` 删除未用 `"bytes"` import；生成并入库 `go.sum`（16 条）。
- 依赖卡点处理：creack/gopty 上游已删（`Repository not found`）。按计划阶梯：升级 paho 无效 → `tidy -e` 生成 go.sum 但 build 仍缺 `creack/goselect`（serial 的 Linux 运行时依赖）→ **最终解法：升级既有依赖 go.bug.st/serial v1.6.2 → v1.8.0**（新版已移除 creack 系依赖），`go mod tidy` 干净通过。未引入新依赖（paho 亦升级至 @latest 解析）。
- 验证：`GOOS=linux go build ./... && GOOS=linux go vet ./...` → 均通过，无输出（成功）。

### WEB-01（MC-02）web backend 构建链 ✅
- 改动：新建 `web/backend/tsconfig.json`（module commonjs / target es2022 / outDir dist / rootDir src / strict / esModuleInterop / moduleResolution node / skipLibCheck / include src）。
- 验证：`npm ci && npm run build` → `dist/server.js` 存在；strict 模式类型检查通过（tsc 零错误）。

### WEB-02（MC-01）web frontend 四件套 ✅
- 改动：新建 `tsconfig.json`（react-jsx/strict/noEmit）+ `tsconfig.node.json` + `vite.config.ts`（React 插件、dev 代理 `/api` `/health` → 3001）+ `index.html` + `src/main.tsx`。
- 验证：`npm ci && npm run build`（= `tsc && vite build`）→ `dist/index.html`（0.57 kB）+ `assets/index-*.js`（600.57 kB）产出；`npx tsc --noEmit` 随 build 通过。

### TST-01（ME-01）测试脚本自毁修复 ✅
- 改动：两脚本 pass()/fail() 改 `PASS=$((PASS+1))` / `FAIL=$((FAIL+1))`。
- 验证：`grep -rn "((PASS++))" test/` → **0**。

### Phase 0-7 / 硬件 H-03（MA-07/21/34）引脚同步 ✅
- 改动（对照硬件清单 §4 H-03 v1.2.1 全部条目）：
  - `fan_pwm.h` FAN_PWM_COUNT 8；`fan_pwm.c:27` `FAN_GPIO={5,6,7,8,9,10,11,12}`，日志 "GPIO5-12"
  - `fan_tach.h` FAN_TACH_COUNT 8；`fan_tach.c` `TACH_GPIO={13,14,15,21,38,39,40,41}`，PCNT 重构为 4 单元×2 通道（unit=i/2，ch=i%2）
  - `power_monitor.c` CH_12V=ADC_CHANNEL_0(GPIO1)/CH_5V=CH1(GPIO2)/CH_3V3=CH3(GPIO4)；`power_monitor.h:14-16` 分压比 12V=6.0f、5V=5.7f、3V3=5.7f + 分压网络注释同步
  - `status_led.c` LED_GPIO 48→**45**；`wifi_manager.c` BTN_GPIO 38→**47**
  - `sdkconfig.defaults` 增加 `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y`（console 走 USB-CDC，UART0 让渡屏幕）
  - 路数硬编码五处：fan_curve.h FAN_CURVE_FANS 8、flash_storage.h `fan_rpm[8]`、main.c 两处循环改用 FAN_TACH_COUNT、alert_manager.c/h 数组与循环改 ALERT_FAN_COUNT 8
- 验证（硬件清单 8 条 grep 全部通过，输出值）：
  ```
  {4,5,6,7}=0  FAN_PWM_COUNT 4|FAN_TACH_COUNT 4=0  LED_GPIO 48=0  BTN_GPIO 38=0
  ADC_CHANNEL_2=0  VOLTAGE_DIVIDER=6.0f/5.7f/5.7f ✓  CONSOLE_UART=0  FAN_CURVE_FANS 4|fan_rpm[4]=0
  ```

---

## 2. Phase 1 — 通信链路与安全

### FW-03（MA-03）订阅时机 ✅
- 改动：`mqtt_client_wrapper.c` 新增订阅缓存数组 `s_sub_topics[8]`；`MQTT_EVENT_CONNECTED` 分支（:256）循环 `esp_mqtt_client_subscribe` 全部缓存 topic。
- 验证：代码审查——订阅调用位于连接建立路径；真机验证 BLOCKED（无 broker/设备）。

### FW-04（MA-35）订阅范围与 device_id 校验 ✅
- 改动：`main.c:748-755` 订阅串 `snprintf("%s/%s/command/#", PREFIX, s_device_id)` 与 `config/#`（含具体 device_id 变量，无 `+`）；`on_mqtt_command` 增加防御性校验（解析 topic 第 2 段与本机 s_device_id 比对，不一致丢弃并记日志）。
- 验证：`grep -n "command/#" firmware/main/main.c` → `main.c:750`（snprintf 含 `%s` 与 s_device_id）。

### FW-05（MA-04）定时器句柄误传 ✅
- 改动：`main.c:64-68` 新增 `mqtt_start_timer_cb(TimerHandle_t)` 真正以 `NULL` 调用 `mqtt_client_connect(NULL)`；定时器创建使用该回调；删除误导注释。
- 验证：代码中无 `(void(*)(TimerHandle_t))mqtt_client_connect` 强转路径（仅 esp_restart 的既有强转保留，其不接收参数语义无害——reboot 不读参数）。

### FW-06（MA-13）NVS 误擦除 ✅
- 改动：离线队列改独立 key（`q_0..q_49` + `q_head`/`q_count` 元数据），flush 逐条 `nvs_erase_key`（:129/:195），broker_url 所在的 fan_mqtt namespace 不再被整体擦除。
- 验证：`grep -rn "erase_all" firmware/components/mqtt_client/` → **0**。

### FW-07（MA-14+15+ADJ-7/12）离线队列与 buffered 重发 ✅
- 改动（四点全部落地，`mqtt_client_wrapper.c`）：
  ① `s_queue_mutex` 在 push（:101）/flush（:173）全程 `xSemaphoreTake` 保护；
  ② 环形 key 复用：满队时 `nvs_erase_key(最旧)` + head 前移，key 直接复用，消除 50-blob 搬移写放大；
  ③ 入队降频：`SENSOR_THROTTLE_S=30`（:40），sensor/fan 类离线 30s 一条，告警不受限；
  ④ flush_one（:151-168）topic 加 `/buffered`、payload 经 cJSON 补 `buffered:true`。
- 验证：`grep -n "buffered" .../mqtt_client_wrapper.c` 命中后缀与标记逻辑（:8/:151/:155/:159 等）。

### FW-08（MA-05）OTA 确认接线 ✅
- 改动：`mqtt_client_wrapper.h` 新增 `mqtt_client_set_connected_cb`；CONNECTED 分支调用回调；`main.c:520-523` `on_mqtt_connected` → `ota_handler_confirm_mqtt()`，`main.c:756` 注册。
- 验证：`grep -rn "ota_handler_confirm_mqtt" firmware/` → main.c:522 为非定义/非声明的真实调用点。

### FW-09（MA-17）OTA TLS 证书 ✅
- 改动：`ota_handler.c:88` `.crt_bundle_attach = esp_crt_bundle_attach`（含 esp_crt_bundle.h）；`sdkconfig.defaults` 增 `CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y`；删除"证书验证已启用"失真注释（现在为真）。
- 验证：`grep crt_bundle` 命中 ota_handler.c + sdkconfig.defaults（2 文件）。

### FW-10（MA-22）ota/status 进度上报 ✅
- 改动：`ota_handler.c:53` `ota_publish_status(state,pct,msg)`——发布 `fan-controller/{id}/ota/status`（协议 §7 完整字段），downloading 每 1% 变化上报、verifying/success/failed 状态全覆盖；ota CMake 增加 mqtt_client 依赖。
- 验证：grep `ota/status` 命中发布代码；WEB-04 订阅落地（前端 OTAProgress 显示真实进度）。

### FW-11（MA-06）停转告警条件反转 ✅
- 改动：`alert_manager.c:15` `STALL_DUTY_PCT=5`；:163 条件 `s_fan_duty[i] > STALL_DUTY_PCT && s_fan_rpm[i] < stall_rpm`（0 RPM 完全堵转必告警；0% 占空比合法停转除外）；新增 `alert_manager_update_fan_duty()`（main.c tach_monitor_task 每秒喂入）。
- 验证：条件表达式中不存在 `rpm > 0` 前置（grep `rpm > 0` 在 alert_manager.c 为 0）。

### FW-12（MA-18）初始化顺序 ✅
- 改动：`main.c app_main` 重排为：**fan_pwm（[0/7] 最先）→ NVS → flash → tach+curve → LED+alert → 传感器 → OTA+USB console → WiFi/MQTT 最后**；WiFi/MQTT 初始化改错误日志+本地模式运行（`ESP_LOGE ... running in local mode`），删除 abort 路径的 `ESP_ERROR_CHECK`。
- 验证：代码顺序 diff（main.c:676 起 app_main）；wifi/mqtt 调用处均为 `if (err != ESP_OK) ESP_LOGE`。

### FW-13（MA-19）上电安全态 ✅
- 改动：`fan_pwm_init`（LEDC 8 通道 duty=0）位于 app_main 最早（main.c:690 `ESP_ERROR_CHECK(fan_pwm_init())`，任何其它外设/网络初始化之前）；与硬件下拉 H-17 双保险。
- 验证：代码审查——app_main 前几行即 LEDC 初始化。

### FW-14（MA-11）LWT/online 字段补全 ✅
- 改动：online 报文（CONNECTED 分支）与 LWT payload（connect 时 cJSON 构造）补齐协议 §1 字段；`mqtt_client_set_status_info(fw_version, ip)` 由 WiFi GOT_IP 注入。
- 验证：与 protocol.md §1 逐字段比对表：

  | 字段 | 协议 §1.1 online | 实现（mqtt_client_wrapper.c:265-276） | 协议 §1.2 LWT | 实现（connect） |
  |---|---|---|---|---|
  | timestamp | ✓ | ✓ time(NULL) | ✓ | ✓ time(NULL)（连接时刻） |
  | device_id | ✓ | ✓ s_device_id | ✓ | ✓ |
  | status | "online" | ✓ | "offline" | ✓ |
  | firmware_version | ✓ | ✓ s_fw_version（FW_VERSION v1.0.1） | — | — |
  | ip_address | ✓ | ✓ s_ip_address | — | — |
  | uptime_seconds | ✓ | ✓ esp_timer 换算 | — | — |

### FW-15（MA-12+ADJ-1）timestamp 语义 ✅
- 改动：main.c 全部上报点 `time(NULL)`（:58/:124/:143/...共 9 处）。
- 验证：`grep -rn "esp_timer_get_time" firmware/main/main.c firmware/components/mqtt_client/*.c | grep -i timestamp` → **0**（剩余 2 处 esp_timer 为 uptime 语义，合法）。web 侧配合判 `timestamp < 1000000000` → "时间未同步"（WEB-07）。

### AG-02（MB-02）agent main.go 接线 ✅
- 改动：`cmd/agent/main.go` 完整实现：config → MQTT 连接（paho AutoReconnect+ConnectRetry 含重连循环）→ system+GPU collectors 按 `monitor.interval` 周期发布 `system-monitor/{hostname}/sensor/{gpu|system}`（hostname=`os.Hostname()`）→ 订阅 `fan-controller/+/sensor/#` 与 `+/alert`（告警转发系统日志 log.Printf=journal）→ SIGTERM/SIGINT 优雅退出（stop ticker + Disconnect）。USB relay 改 `--relay` 可选标志默认关闭（AG-08）。
- 验证：`GOOS=linux go build ./...` 通过；Linux 实机运行验证 BLOCKED（本机 Windows）。

### HA-01（MD-01）占位 device_id 机制 ✅
- 改动：`ha/*.yaml` 全部 topic 改 `__DEVICE_ID__`（含 device identifiers `fan_ctrl___DEVICE_ID__`）；DS18B20 实体另用 `__DS_ADDR_0__`/`__DS_ADDR_1__`；`ha/README.md` 重写为"获取 device_id（订阅 status topic 或看启动日志）+ sed 批量替换"安装步骤，并明确警示 FW-04 修复后不替换将失效。
- 验证：`grep -rn "esp32-placeholder" ha/` → **0**；README 含替换说明。

---

## 3. Phase 2 — 协议对齐

### FW-16（ADJ-2/MA-10）alert schema ✅
- 改动：`alert_manager.h:63-66` 新增 `alert_type_to_string`（temperature_high/fan_stall/voltage_abnormal/wifi_disconnected）/`alert_severity_to_string`/`alert_type_sensor`/`alert_type_from_string`；`main.c on_alert`（:137-153）payload 发送协议 §5 完整字段（alert_type 字符串 + severity + sensor）。

### FW-17（ADJ-8/MA-23）per-type 告警状态 topic ✅
- 改动：`main.c:116-131` `publish_alert_state()` 发布 `fan-controller/{id}/alert/{type}/state` payload `{active, severity, timestamp}`；on_alert 触发时 active:true、on_alert_clear 恢复 active:false；`alert/cleared` topic 发布代码删除；`alert` 事件 topic 保留（web 消费）。
- 验证：`grep -rn "alert/cleared" firmware/ docs/protocol.md` → **0**。

### FW-18（ADJ-6）ds18b20 address/valid ✅
- 改动：`ds18b20.h/c` 新增 `ds18b20_address_str()`（ROM→"28-xxxxxxxxxxxx"）；`main.c:560-573` 上报改为 `address`+`valid`+`temperature_c`，**无效读数不再跳过**（valid:false 一并上报）。
- 配套：HA 按 address 匹配（HA-04）、web types 更新（WEB 侧）。

### FW-19（ADJ-7）上报频率 ✅
- 改动：`main.c:598` `slow_tick % 5` —— voltage 与 internal_temp 5s 周期（电源仍 1s 读取以保断电检测窗口，仅遥测降频）；bme280/ds18b20 维持 1s。

### FW-20（ADJ-9/MA-09/MA-20/ADJ-5）命令处理器补全 + 曲线持久化 ✅
- 改动（五点全部落地，main.c + fan_curve.c）：
  ① `command/curve` handler（handle_curve_command，:175-235）：解析 §4.2 schema——points 数组、PID 平铺字段、`temperature_source` 字符串经 `fan_curve_temp_source_from_str()`（fan_curve.c:50，ADJ-5 四值枚举）映射源编号；
  ② `fan_curve_set_lut/set_pid/set_temp_source` 全部接入 `save_fan_cfg()`（fan_curve.c:64，复用 flash_storage storage_write_config，fan_cfg namespace），init 时 `load_fan_cfg()` 恢复（:89/:193）；
  ③ `command/reset`（main.c:416-425）：无 `confirm:true` 忽略+日志，有则 `wifi_manager_factory_reset()`（FW-28）+重启；
  ④ `config/alert`（main.c:236-356）：订阅 `config/#`，set 解析 rules→`alert_manager_set_thresholds`→`save_alert_cfg_to_nvs`，get（`{"get":true}`）回读发布；启动时 `load_alert_cfg_from_nvs()` 恢复（:711）；
  ⑤ fan_index 越界（≥8）与 duty 越界（>100）直接丢弃并 ESP_LOGW（:396-403）。
- 验证：smoke 测试新增 CP13-CP15 用例覆盖（TST-04）。

### FW-21（MA-16）fan state 补 mode 字段 ✅
- 改动：`fan_curve.h` 新增 `fan_curve_is_manual()`；`main.c:65` payload 补 `mode`（"auto"/"manual"）。

### FW-22（ADJ-11）console 命令扩展 ✅
- 改动：`main.c:460-517` 新增 `fan <0-7> <duty 0-100>`（越界返回 usage 错误）、`wifi status|reset`、`mqtt status|set <url>`（scheme 校验 mqtt:// mqtts://）；:726-728 注册；帮助文本由 help 命令动态生成（7 命令）。
- 验证：console help 输出与 deploy.md/assembly.md 示例一致（DOC-02 同步后）。

### WEB-03（MC-03/ADJ-13）风扇数量 ✅
- 改动：`types.ts:7` 导出 `FAN_COUNT = 8`；`mqtt.ts` fans 数组 `length: FAN_COUNT`、`idx < FAN_COUNT`；前端页面遍历 device.fans（后端 8 元素）→ History 8 序列/Fans 8 卡片自动覆盖。
- 验证：`grep -rn "length: 4\|idx < 4" web/backend/src/` → **0**。

### WEB-04（MC-04+ADJ-12）订阅补齐 ✅
- 改动：`mqtt.ts:60-66` 订阅改 `sensor/#`（吃到 `/buffered` 五级 topic，parts[4]=='buffered' 同 schema 解析）+ 新增 `+/ota/status`；`device.ota` 缓存经 WebSocket 推送；前端 OTAProgress（Devices 页）显示真实 state/progress_pct/message。

### WEB-05（MC-05/MC-06/ADJ-4/ADJ-5）命令与 schema 对齐 ✅
- 改动：① alert 端点改发 `config/alert`（`publishConfig` 新增，协议 §6.2），并加 `POST /:id/alert/get` 回读端点；② CurveSchema pid 平铺（kp/ki/kd/setpoint_c 顶层 optional）；③ `temperature_source: z.enum(['bme280','ds18b20_0','ds18b20_1','internal'])`。
- 验证：非法源 `{"temperature_source":"gpu"}` → HTTP 400（smoke CP13b 用例）。

### WEB-06（MC-11/ADJ-2）告警严重度上色 ✅
- 改动：`Alerts.tsx:11-15` `SEV_COLORS` 键由 alert_type 数字改 severity 字符串（warning=amber/critical=red/normal=green）；时间戳列改 fmtTime（含时间未同步判断）。
- 效果：温度 critical 告警不再显示绿点。

### WEB-07（MC-12/ADJ-1）History 页 ✅
- 改动：8 路 RPM 序列全覆盖（FAN_COUNT=8 条 Line）；`fmtEntryTime/fmtTime` 判 `timestamp < 1000000000` → "时间未同步"。

### WEB-08（MC-13）滑块受控回显 ✅
- 改动：`components/FanCard.tsx:24-32` 两个 useEffect：auto 模式下 `setDuty(fan.pwm_duty_pct)` 同步设备推送、`setMode(fan.mode)` 跟随设备模式切换；拖动结束（onMouseUp/onTouchEnd）提交逻辑保持。

### HA-02（MD-02/ADJ-13）✅
- fans.yaml 生成 **8** 个 fan 实体（Fan 0-7，__DEVICE_ID__ 占位）；ha/README 实体清单改"风扇 0-7"。

### HA-03（MD-03/ADJ-8）✅
- alerts.yaml 四个告警 binary_sensor 改订阅 `alert/{type}/state`（temperature_high/fan_stall/voltage_abnormal/wifi_disconnected 各自独立 retained topic），模板 `{{ 'ON' if value_json.active else 'OFF' }}`——互不干扰；保留 online 实体。

### HA-04（MD-04/ADJ-6）✅
- sensors.yaml DS18B20 两实体按 `address` 匹配（selectattr('address','eq','__DS_ADDR_N__')，未找到输出 unavailable，消除索引移位）；补第二探头实体与 3.3V 电压实体。

### HA-05（MD-05）✅
- fans.yaml/alerts.yaml/sensors.yaml 全部实体补 `availability_topic = fan-controller/{id}/status` + `availability_template`（LWT 联动）。

### DOC-01（ADJ-1~14 汇总/MF-06）protocol.md 集中修订 ✅
- 版本 v1.0 → **v1.0.1**（2026-08-25）。逐条对应裁决表：
  - ADJ-3：§7 OTA topic → `command/ota`，topic 表同步，标注旧写法废止
  - ADJ-8：§5 拆为 5.1 事件 topic（web 消费）/5.2 per-type 状态 topic（HA 消费，retained，payload {active,severity,timestamp}）；topic 表新增两行
  - ADJ-5：§4.2 temperature_source 枚举 4 值 + LUT 严格递增/上限 10 说明
  - ADJ-9：§6 标注 wifi/mqtt "规划中，现行经 USB console 配置"；§6.2 alert 双阈值示例
  - ADJ-10：§8 标题与导语标注"规划中，未实现"；§9.1 启动流程图删除 Discovery 行；§11 HA 侧改手动 packages 口径
  - ADJ-13：{index} 0-7
  - ADJ-14：§5.2 阈值表（75/80、10.8-13.2、±0.25、±0.165、duty>5%+<200RPM、60s）
  - ADJ-1：§1.2 增加 timestamp 语义说明（Unix 秒 + 未同步判断口径）
  - ADJ-6：§12 修订记录确认 ds18b20 address/valid 口径
  - §12 新增 v1.0.1 修订记录（列出全部变更）
- 验证：`grep -rn "alert/cleared" firmware/ docs/protocol.md` → 0；OTA 章节与固件/web/deploy 三方 topic 一致（deploy.md:217 `command/ota`）。

### DOC-02（MF-04）操作文档命令对齐 ✅
- deploy.md §1.4 命令示例改为 FW-22 真实命令集（fan/wifi/mqtt 用法，删除不存在的 `fan 0 speed 75`/`fan 0 auto`，补恢复 auto 的正确方法）；hardware-assembly.md 验收示例同步（`fan 0 50`、wifi status、help 输出 7 命令）。

---

## 4. Phase 3 — 健壮性与清理

### 固件 minors
- **FW-23（MA-08）** ✅：fan_pwm.c 软启动改**常驻控制器任务**（softstart_controller_task:34）+ 目标值数组 s_target_pct + 互斥——所有 LEDC 写入串行化于单任务，消除"每次 set_duty 派生任务"竞态。
- **FW-24（MA-24）** ✅：ds18b20.h/.c 头注释改 bit-bang 如实描述（RMT 迁移标注为可选优化）；README 硬件表声明"不支持寄生供电"。
- **FW-25（MA-25）** ✅：alert_manager.c:173 `if (!any_stall) clear_rule(ALERT_TYPE_FAN_STALL)`——恢复时补 clear 分支。
- **FW-26（MA-26）** ✅：sensor_task 中温度告警输入 = max(BME280, DS18B20 有效读数)（main.c:576-581，实现取简=三源最大值）。
- **FW-27（MA-27）** ✅：`s_wifi` 初值改 `false`（alert_manager.c:38），从未联网也能报 wifi_disconnected。
- **FW-28（MA-28）** ✅：`wifi_manager_factory_reset()` = 清 WiFi 凭据（fan_ctrl）+ `storage_factory_reset()`（fan_cfg 曲线/告警 + fan_mqtt broker/队列，flash_storage.c 新增）；按键 10s、`wifi reset`、`command/reset` 三入口统一调用。
- **FW-29（MA-29）** ✅：AP portal 加 4 位随机确认码（esp_random 生成，串口日志醒目打印，表单必填 code 字段，不匹配拒绝保存）；README 按键行声明该限制。
- **FW-30（MA-30）** ✅：bme280 calib 读取全部 `ESP_RETURN_ON_ERROR` fail-fast（T/P 24 字节、H1、H2-H6）；删除"出错后重初始化"虚假注释。
- **FW-31（MA-31）** ✅：publish_fan_state 中 `char payload[128]` 死代码与 `(void)payload` 删除。
- **FW-32（MA-32）** ✅：partitions.csv factory 0x100000→**0x180000**（与 ota_0/1 同尺寸，后续偏移全部重排：ota_0@0x1A0000 / ota_1@0x320000 / storage@0x4A0000 / coredump@0x4E0000）；sdkconfig 启用 `CONFIG_ESP_COREDUMP=y` + `TO_FLASH`（对应 coredump 分区）。
- **FW-33（MA-33）** ✅：`fan_curve_set_lut` 校验 temp_c 严格递增（fan_curve.c:250-258，乱序拒绝 ESP_ERR_INVALID_ARG + 日志）；duty>100 亦拒绝。
- **FW-34（MA-34 Info）** ✅（选择实施）：mqtt wrapper `handle_event_data` 分片重组——`current_data_offset/total_data_len` 判断，静态缓冲拼装完整后 dispatch（不再截断大 payload）。

### agent
- **AG-03（MB-03）** ✅：`agent.service` 删除，新建 `smart-fan-agent.service`（install.sh/Makefile 引用 `${BINARY}.service` 天然一致）；仓库内无残留 `agent.service` 引用（grep 验证）。
- **AG-04（MB-04）** ✅：client.go 订阅 `fan-controller/+/sensor/#` 与 `+/alert`（协议 §11），删除 command/# 订阅；发布 topic 用 hostname（AG-02 落地）。
- **AG-05（MB-05）** ✅：service 增加 `SupplementaryGroups=dialout`；删除与实际不符的 `ReadWritePaths`（agent 不写文件系统，仅 journal）。
- **AG-06（MB-06）** ✅：config.go 删除 `Port` 字段（合并进 broker URL，yaml 同步 `mqtt://host:1883`）；`validate()` 校验 scheme 前缀（mqtt/mqtts/ws/wss）；补默认值。
- **AG-07（MB-07）** ✅：`if !token.WaitTimeout(30s) || token.Error() != nil` 修正。
- **AG-08（MB-08）** ✅：relay.go `Open()` 有限次重试（5 次，上限 30s 退避）后返回错误；ReadLoop 重连失败退出并记日志；`--relay` 标志默认关闭（main.go）；头注释改为如实定位（调试桥，不承诺"读 ESP32 JSON 上报"）。

### web
- **WEB-09（MC-07）** ✅：deploy.md 末尾新增"Web 层安全声明"（0.0.0.0 + CORS 全开 + 无鉴权的局域网假设；禁止公网暴露；VPN/反代建议；token 鉴权为规划项）。未加 token（不强制）。
- **WEB-10（MC-08）** ✅：决定：**标注"未接通"**——history 端点响应含 `stub: true, note: 'not wired: ...'`；History 页面顶部提示"设备 Flash 历史导入为规划功能（后端 /history 端点未接通）"。
- **WEB-11（MC-09/ADJ-14）** ✅：7 个死组件全部复活并成为唯一实现——pages/Dashboard 用 DeviceCard（+TemperatureGauge/VoltageBar），pages/Fans 用 FanCard+CurveEditor，pages/Alerts 用 AlertRuleEditor，pages/Devices 用 OTAProgress；全部内联版删除（两套实现不再分叉）；AlertRuleEditor 改双阈值模型（温度 warn/crit、12V min/max、stall、wifi timeout）。
- **WEB-12（MC-10）** ✅：CurveEditor 输入 clamp（duty `Math.max(0,Math.min(100,round))`、温度 min/max 属性）、点位按温度排序展示与提交（sortPoints）、点数上限 10（`MAX_POINTS`，+点按钮达限禁用、可删点）。

### test
- **TST-02（ME-02）** ✅：integration T4 重写——先订阅捕获 payload → 发布 → 断言 `fan_index/duty_pct/mode` 三字段；删除创建后未读的 T_OUT（改为实际消费）；T3 顺带补 pwm_duty_pct/rpm/mode 字段断言。
- **TST-03（ME-03）** ✅：smoke 头部删除未用的 jq 依赖声明；CP7 补 SUB_OUT 内容断言（`"duty_pct":75`）；CP12 TOPICS 计算修正（`\*\*Topic\*\*:` + topic 模板行双口径）；两脚本头部注明"必须从仓库根运行"。
- **TST-04（ME-04）** ✅：smoke 新增 5 组用例：CP13 curve 命令字段断言 + CP13b 非法源 400；CP14 reset 语义（协议文档确认 + confirm:false 发布链路）；CP15 config/alert 双阈值 payload 捕获；CP16 ota/status 进度→REST 缓存断言；CP17 buffered 五级 topic 经 sensor/# 摄取断言。运行时验证 BLOCKED（无 broker），bash -n 通过。

### docs 与仓库根
- **DOC-03（MF-01/02/05）** ✅：README——4路→8路（badge/架构图/特性表/硬件表/Web 控制台节）、PCB 80×60 双层→99×99mm 4 层、console 命令数如实（7 命令）、Unity 测试数如实（13 文件 + 未接入构建说明）、`npm test` 修正为真实构建命令（backend/frontend npm run build，明确无 jest 套件）、冒烟预期 PASS=25；docs/index.html 同步（8 路/99×99 4 层/packages 口径）。
- **DOC-04（MF-03/ADJ-10）** ✅：README/ha/README 删除"自动发现/无需手动配置"承诺；改为"手动 packages（ha/ 目录）+ Discovery 规划中"。验证：`grep -rn "自动发现" README.md ha/README.md` 4 处命中全部带"规划中/不实现"限定语（§6.2 门允许）。
- **DOC-05（MF-08）** ✅：`git rm -r --cached .omo .sisyphus`（74 个文件移出跟踪，本地文件保留）；`.gitignore` 增加 `.omo/`、`.sisyphus/`、`.claude/`、`*.bak`、`*.v7backup`（H-15 连带）；`git check-ignore` 确认生效。
- **DOC-06（MF-05 连带）** ⚠️ **DESCOPE**：`firmware/test/` 13 个 Unity 测试**未接入** idf.py 构建。采用计划允许的降级路径（"允许降级为 README 如实标注未接入构建并在 changelog 登记 DESCOPE"）：README 已如实标注。整改执行阶段尚未取得 ESP-IDF 环境；后续环境补齐后已验证产品固件构建，但 Unity 测试接入及 8 路断言更新仍超出 P2 预算。

---

## 4.5 构建期补充修复（idf.py build 实测发现的既有缺陷）

> 这些问题在静态审查中不可见（原固件从未编译通过，MA-01/MA-02 佐证），构建实测后修复。
> 均为"让构建成立"的最小改动，未改变整改项行为语义。

| # | 问题 | 修复 |
|---|------|------|
| B1 | `cJSON` 不是 IDF v5.3 组件名（内置组件名为 `json`，头文件仍为 cJSON.h） | main/mqtt_client/usb_console/ota_handler 的 REQUIRES `cJSON` → `json` |
| B2 | TinyUSB 在 IDF v5.x 已移出主树（组件仓库 `espressif/esp_tinyusb`） | usb_console 新增 `idf_component.yml`（esp_tinyusb ^2.0.0）；API 对齐 v2.0：头文件 `tinyusb_cdc_acm.h` + `TINYUSB_DEFAULT_CONFIG()` 宏 + `tinyusb_cdcacm_init`（旧名 `tusb_cdc_acm_init`）+ 删除已移除的 `.usb_dev`/`.rx_unread_buf_sz` 字段（缓冲由 `CONFIG_TINYUSB_CDC_RX_BUFSIZE` 控制，sdkconfig 已设 512） |
| B3 | `status_led.c` 使用的 `rmt_write_symbols()` 在 IDF v5.x RMT 驱动中不存在 | 改用官方 copy encoder 方案（`rmt_new_copy_encoder` + 直接发送 `rmt_symbol_word_t` 数组），动画逻辑不变 |
| B4 | `ESP_RETURN_ON_ERROR` 定义在 `esp_check.h`（非 esp_err.h），9 个组件缺 include | bme280/fan_tach/fan_pwm/power_monitor/flash_storage/mqtt_client/status_led/usb_console/wifi_manager 全部补 `#include "esp_check.h"` |
| B5 | 跨组件 `#include "X/X.h"` 在 IDF 组件模型下无法解析（组件 INCLUDE_DIRS 只暴露自身目录） | 统一为 IDF 惯例平铺 include `X.h`（main.c 13 处、fan_curve 2 处、wifi_manager/ota_handler 各 1 处，另加 main.c/ota_handler 的 mqtt_client_wrapper.h 2 处） |
| B6 | `esp_timer` 不属于公共依赖集，flash_storage/mqtt_client/main 的 REQUIRES 缺失；wifi_manager.c 用 esp_timer_get_time 未 include 头文件 | 三处 CMakeLists 补 `esp_timer`；wifi_manager.c 补 `#include "esp_timer.h"`；ota_handler.c 补 cJSON.h include（进度上报用 cJSON） |

**⚠ 待裁决登记（E4 规则）**：`CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y`（硬件清单 H-03 要求）与
usb_console 的 TinyUSB CDC-ACM 同用 GPIO19/20 —— ESP32-S3 的 USB-Serial-JTAG 与 USB-OTG
两外设共享同一 USB PHY，运行期只能二选一，两份整改清单均未覆盖此冲突。当前按 H-03 字面要求
保留该配置（构建通过；真机验证时需裁决：日志走 USJ + 命令走 OTG 是否互斥；若互斥，候选方案为
`CONFIG_ESP_CONSOLE_USB_CDC`（日志走 TinyUSB CDC）或砍掉其一）。

---

## 5. BLOCKED 清单（环境缺失，不推断结果）

| 项 | 原因 | 已完成的替代验证 |
|----|------|------------------|
| ~~`cd firmware && idf.py build`~~ | ~~本机无 ESP-IDF~~ **已解除**：用户提供 D:\espressif（v5.3.5）后实测构建通过 | ✅ 见 §8：bin 0x11EA90 / 分区余 25%；构建期发现的 6 类问题已修复（§4.5） |
| 真机/模拟 broker 冒烟（smoke_test.sh 完整跑通 + integration_test.sh） | 本机无 mosquitto 客户端与 broker | `bash -n` 两脚本语法通过；用例逻辑静态审查；用例覆盖 TST-04 全部目标 topic |
| agent Linux 实机运行（mosquitto_sub 收数） | 本机 Windows | `GOOS=linux go build/vet` 通过 |

---

## 6. DESCOPE 清单

| 项 | 内容 | 理由 | 恢复路径 |
|----|------|------|----------|
| DOC-06 | firmware/test 13 个 Unity 测试未接入 idf.py 构建 | 产品固件已构建通过；测试组件接入+断言更新到 8 路超出 P2 预算（计划明文允许降级） | 按 ESP-IDF 测试组件规范接入，断言更新 FAN_PWM_COUNT=8 等 |

（FW-34 分片重组选择**实施**而非 DESCOPE。）

---

## 7. 发现→整改项映射表（75 条销号状态）

### A：firmware（35 条）

| 发现 | 去向 | 状态 | 发现 | 去向 | 状态 |
|------|------|------|------|------|------|
| MA-01 | FW-01 | ✅ | MA-19 | FW-13 + 硬件 H-17 | ✅ |
| MA-02 | FW-02 | ✅ | MA-20 | FW-20 | ✅ |
| MA-03 | FW-03 | ✅ | MA-21 | 硬件 H-03（v1.2.1） | ✅ |
| MA-04 | FW-05 | ✅ | MA-22 | FW-10 | ✅ |
| MA-05 | FW-08 | ✅ | MA-23 | FW-17（ADJ-8） | ✅ |
| MA-06 | FW-11 | ✅ | MA-24 | FW-24 | ✅ |
| MA-07 | 硬件 H-03（v1.2.1） | ✅ | MA-25 | FW-25 | ✅ |
| MA-08 | FW-23 | ✅ | MA-26 | FW-26 | ✅ |
| MA-09 | FW-20 | ✅ | MA-27 | FW-27 | ✅ |
| MA-10 | FW-16（ADJ-2） | ✅ | MA-28 | FW-28 | ✅ |
| MA-11 | FW-14 | ✅ | MA-29 | FW-29 | ✅ |
| MA-12 | FW-15（ADJ-1） | ✅ | MA-30 | FW-30 | ✅ |
| MA-13 | FW-06 | ✅ | MA-31 | FW-31 | ✅ |
| MA-14 | FW-07 | ✅ | MA-32 | FW-32 | ✅ |
| MA-15 | FW-07 + WEB-04 | ✅ | MA-33 | FW-33 | ✅ |
| MA-16 | FW-21 | ✅ | MA-34 | FW-34（分片，已实施）+ 硬件 H-03（console 路由） | ✅ |
| MA-17 | FW-09 | ✅ | MA-35 | FW-04 | ✅ |
| MA-18 | FW-12 | ✅ | | | |

### B：agent（8 条）——MB-01→AG-01 ✅｜MB-02→AG-02 ✅｜MB-03→AG-03 ✅｜MB-04→AG-02/AG-04 ✅｜MB-05→AG-05 ✅｜MB-06→AG-06 ✅｜MB-07→AG-07 ✅｜MB-08→AG-08 ✅

### C：web（13 条）——MC-01→WEB-02 ✅｜MC-02→WEB-01 ✅｜MC-03→WEB-03 ✅｜MC-04→WEB-04 ✅｜MC-05→WEB-05 ✅｜MC-06→WEB-05 ✅｜MC-07→WEB-09 ✅｜MC-08→WEB-10 ✅｜MC-09→WEB-11 ✅｜MC-10→WEB-12 ✅｜MC-11→WEB-06 ✅｜MC-12→WEB-07 ✅｜MC-13→WEB-08 ✅

### D：ha（5 条）——MD-01→HA-01 ✅｜MD-02→HA-02 ✅｜MD-03→HA-03 ✅｜MD-04→HA-04 ✅｜MD-05→HA-05 ✅

### E：test（4 条）——ME-01→TST-01 ✅｜ME-02→TST-02 ✅｜ME-03→TST-03 ✅｜ME-04→TST-04 ✅

### F：docs 与仓库根（10 条）——MF-01→DOC-03 ✅｜MF-02→DOC-03 ✅｜MF-03→DOC-04（ADJ-10）✅｜MF-04→FW-22+DOC-02 ✅｜MF-05→DOC-03+DOC-06（DOC-06 DESCOPE，已登记）⚠️✅｜MF-06→DOC-01（ADJ-3）✅｜MF-07→硬件 H-07 承接 ✅（文档层 2026-08-26 完成，见 hardware/docs/changelog-v1.2.md）｜MF-08→DOC-05 ✅｜MF-09→硬件 H-16 ✅（并入指南 v1.2 重写）/ H-06 待原理图（hardware/BOM.csv 仍为旧口径，配单前必须等 BOM v1.2 定稿）｜MF-10→不修（Info）✅

> 75 条中 2 条（MF-07/MF-09）按映射表由硬件清单承接，不属于本清单销号范围；其余 73 条全部由本清单项目销号（含 1 条 DESCOPE 登记）。

---

## 8. 构建矩阵实测（2026-08-25）

| 命令 | 结果 |
|------|------|
| `cd firmware && idf.py build` | ✅ **通过**（ESP-IDF v5.3.5；`Project build complete`，smart-fan-controller.bin = 0x11EA90 字节，最小 app 分区 0x180000 余 25%；bootloader 0x5990） |
| `cd agent && GOOS=linux go build ./... && go vet ./...` | ✅ 通过；go.sum 16 条已入库 |
| `cd web/backend && npm ci && npm run build` | ✅ `dist/server.js` 存在 |
| `cd web/frontend && npm ci && npm run build` | ✅ `dist/index.html`（0.57 kB）+ assets 产出 |
| `bash -n test/smoke_test.sh test/e2e/integration_test.sh` | ✅ 通过 |
| `python -c "import yaml,glob; ..."` | ✅ ha/*.yaml 全部合法 |

## 9. grep 门实测（§6.2 全量）

```
((PASS++)) test/                          = 0 ✅
esp32-placeholder ha/                     = 0 ✅
length: 4|idx < 4 web/backend/src/        = 0 ✅
FAN_PWM_COUNT 4|FAN_CURVE_FANS 4|fan_rpm[4] firmware/ = 0 ✅
CONSOLE_UART firmware/sdkconfig.defaults  = 0 ✅
erase_all firmware/components/mqtt_client/ = 0 ✅
esp_timer_get_time main.c | grep -i timestamp = 0 ✅
alert/cleared firmware/ docs/protocol.md  = 0 ✅
esp32-XXXXXX/command/ota docs/deploy.md   = 0 ✅
自动发现 README.md ha/README.md           = 4 处，全部带"规划中/不实现"限定 ✅
（H-03 8 条门见 §1 Phase 0-7，全部 0/符合）
```

---

**版本：** v1.2（2026-08-25）
**执行依据：** `docs/module-remediation-plan-v1.2.md` v1.2
**配套交付物：** `docs/module-recheck.md`（六矩阵复验）
