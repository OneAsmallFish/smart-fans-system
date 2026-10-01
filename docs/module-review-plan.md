# 模块审查方案（Module Review Plan）

> 适用范围：`firmware/`（逻辑与协议层）、`agent/`、`web/`、`ha/`、`test/`、`docs/` 及仓库根目录。
> 硬件部分已单独审查完毕，整改依据见 `hardware/docs/remediation-plan-v1.2.md`（下称"整改清单"）。
> 本方案的目标读者是**执行审查的 agent**。

---

## 0. 反偷懒强制规则（每一条都是硬性要求）

| # | 规则 | 违反判定 |
|---|------|----------|
| R1 | **逐文件全文审查**。§2~§7 给出每个模块的完整文件清单。每个文件必须在最终报告的"覆盖矩阵"（§9.1 格式）中占一行，状态只能填 `全文已读` / `全文已读+已验证`。禁止抽样、禁止"以点带面"、禁止只读 main 文件。 | 覆盖矩阵行数 < 文件清单数，或任何行状态为空。 |
| R2 | **证据留痕**。每个发现必须包含 `文件路径:行号` 和不超过 3 行的原文摘录。每个"通过"的检查项必须写明验证方式（读了哪些行 / 跑了什么命令）。无证据的检查项按"未检查"计。 | 发现条目缺 file:line 或摘录。 |
| R3 | **可执行验证必须真实执行**。§1 列出的构建/校验命令必须实际运行，报告粘贴关键输出（成功与失败都是有效证据）。环境缺失时写 `BLOCKED: <原因>`，**不得**推断结果或标记通过。 | 声称构建通过但无输出摘录。 |
| R4 | **只报告不修复**。本轮不修改任何被审查模块的代码；每条发现给出建议修法但不实施（固件引脚同步除外——那是整改清单 H-03 的任务，若已由硬件整改 agent 完成，验证即可）。 | 审查中出现代码提交。 |
| R5 | **交叉对照逐行比对**。§8 的一致性矩阵要求把两边的完整清单列出来逐行比对（例如 MQTT topic：左边列 protocol.md 全部 topic，右边列每个消费方实际使用 topic，一行一个），禁止"抽查几个典型"。 | 对照表缺少任一侧的完整枚举。 |
| R6 | **数字自相矛盾必报**。任何"路数/数量/索引上限"在两个文件中出现不同值（如风扇 4 vs 6 vs 8、索引 0-based vs 1-based）都必须报告，即使代码能跑。 | 明显不一致未列入发现。 |
| R7 | **报告语言与格式固定**。按 §9 的模板输出，发现条目用 `M<模块字母>-<序号>` 编号，方便后续整改引用。 | 自由发挥格式。 |

严重度定义：
- **Critical**：无法构建/崩溃/协议不一致导致通信必然失败/数据错误。
- **Major**：逻辑缺陷、资源冲突、边界条件错误、错误处理缺失导致的间歇性故障。
- **Minor**：健壮性、可维护性、非关键文档失真。
- **Info**：改进建议。

---

## 1. 环境准备与必须执行的命令

按可用性执行，全部留下输出证据；不可执行标注 BLOCKED：

```bash
# firmware（若无 ESP-IDF 环境则 BLOCKED，但仍必须完成静态审查）
cd firmware && idf.py build

# agent（Go）
cd agent && go build ./... && go vet ./...

# web backend / frontend
cd web/backend  && npm install && npx tsc --noEmit
cd web/frontend && npm install && npm run build

# test 脚本语法
bash -n test/smoke_test.sh
bash -n test/e2e/integration_test.sh

# ha YAML 语法
python -c "import yaml,glob; [yaml.safe_load(open(f,encoding='utf-8')) for f in glob.glob('ha/*.yaml')]; print('YAML OK')"
```

---

## 2. 模块 A：firmware

### 2.1 文件清单（全部逐文件审查，覆盖矩阵逐行登记）

```
firmware/CMakeLists.txt
firmware/partitions.csv
firmware/sdkconfig.defaults
firmware/main/main.c, main/CMakeLists.txt
firmware/components/alert_manager/{alert_manager.c,alert_manager.h,CMakeLists.txt}
firmware/components/bme280/{bme280.c,bme280.h,CMakeLists.txt}
firmware/components/ds18b20/{ds18b20.c,ds18b20.h,CMakeLists.txt}
firmware/components/fan_curve/{fan_curve.c,fan_curve.h,CMakeLists.txt}
firmware/components/fan_pwm/{fan_pwm.c,fan_pwm.h,CMakeLists.txt}
firmware/components/fan_tach/{fan_tach.c,fan_tach.h,CMakeLists.txt}
firmware/components/flash_storage/{flash_storage.c,flash_storage.h,CMakeLists.txt}
firmware/components/mqtt_client/{mqtt_client_wrapper.c,mqtt_client_wrapper.h,CMakeLists.txt}
firmware/components/ota_handler/{ota_handler.c,ota_handler.h,CMakeLists.txt}
firmware/components/power_monitor/{power_monitor.c,power_monitor.h,CMakeLists.txt}
firmware/components/status_led/{status_led.c,status_led.h,CMakeLists.txt}
firmware/components/usb_console/{usb_console.c,usb_console.h,CMakeLists.txt}
firmware/components/wifi_manager/{wifi_manager.c,wifi_manager.h,CMakeLists.txt}
```

### 2.2 硬件引脚一致性核对（对照整改清单 §1 的 v1.2 引脚表）

产出一张 31 行的表：每个已用 GPIO 一行，列 = `GPIO | v1.2 功能 | 固件中的 define/用法(文件:行) | 一致?`。
已知必须核对的点：
- `fan_pwm.c:23` FAN_GPIO 数组、`fan_tach.c:16` TACH_GPIO 数组、`power_monitor.c:16-18` ADC 通道映射、`status_led.c:15` LED_GPIO、`wifi_manager.c:34` BTN_GPIO、`bme280.c:16-17` I2C 引脚、`ds18b20.c:20` OW_GPIO。
- 若整改清单 H-03 尚未执行，则当前固件与 v1.2 表必然冲突——这本身记为发现（Major，引用整改清单 H-03），不要试图在审查中修复。
- 检查数组下标/路数常量与 GPIO 数组长度是否匹配（`FAN_PWM_COUNT` vs 实际初始化循环）。

### 2.3 组件级检查点（每项都要给出证据）

**fan_pwm**
- [ ] 8 路初始化是否会越界（ESP32-S3 LEDC 只有 8 通道 CH0-CH7；channel=i 是否会用到不存在的通道）。
- [ ] 共用 timer 时的频率/分辨率一致性；25kHz+10bit 的组合是否成立（LEDC 时钟源下 25kHz×1024 ≤ 时钟限制）。
- [ ] 占空比 0~100% 的边界值处理（1023 vs 1024 的 off-by-one）。
- [ ] 上电初始状态：LEDC 初始化前 GPIO 处于什么状态？风扇会不会在启动窗口满转或乱转（74AHCT125 输入悬空=高阻，输出状态不定——硬件上 OE 恒使能，这需要固件先初始化或硬件上拉，两边都要核对并报告）。

**fan_tach**
- [ ] PCNT 单元分配方式：S3 只有 4 单元×2 通道。当前代码 unit 怎么分配的？8 路时是否越界（对照 H-03）。
- [ ] RPM 公式（脉冲数/2×60）与采样周期的单位换算。
- [ ] 停转检测（200RPM 阈值、3 秒确认）逻辑、风扇 0% 占空比时停转告警是否误报（0% duty 风扇合法停转）。
- [ ] PCNT 计数器溢出/读取复位方式（16 位计数器，1 秒窗口内 100Hz×2=200 脉冲，安全；但若采样周期被阻塞拉长会不会溢出——给出分析）。

**power_monitor**
- [ ] ADC 通道号 ↔ GPIO 映射是否正确（ADC1_CH0=GPIO1 … CH9=GPIO10；GPIO35/36/21 无 ADC）。
- [ ] ADC_ATTEN_DB_11 的实际量程（约 0~3.1V，full-scale≈3.1V）与分压系数换算是否使用正确常数（12V 路应 ×6，5V/3.3V 路 ×5.7；校准常数在哪定义、是否与硬件分压一致）。
- [ ] 采样多次取平均/中位数滤波是否存在；ADC 原始值到电压的公式与整改清单 §3 一致性。

**bme280**
- [ ] I2C 地址 0x76（SDO→GND）；初始化序列、补偿计算（ datasheet 的整数补偿算法）；超时/NAK 处理；读数失败时上报什么。
- [ ] 是否做了 CRC（BME280 无 CRC，BME280 无需——若代码里写了 CRC 检查则报告错误实现）。

**ds18b20**
- [ ] OneWire 时序实现方式（GPIO 位操作延时是否依赖 CPU 频率/中断关闭）；两个探头地址发现逻辑；转换等待 750ms 的处理（阻塞还是轮询）； parasite power 未支持时是否显式拒绝。
- [ ] 读数校验 CRC8（DS18B20 scratchpad 有 CRC，必须检查）。

**mqtt_client**
- [ ] topic 前缀常量值（应与 protocol.md `fan-controller` 一致，grep 确认 `MQTT_TOPIC_PREFIX` 定义）。
- [ ] LWT payload 与 protocol.md §1.2 的离线报文逐字段比对。
- [ ] 离线队列的容量/溢出策略；断线重连的退避。
- [ ] QoS 使用与 protocol.md 声明（status=1? sensor=0?）逐 topic 比对。

**usb_console**
- [ ] 命令集与 `docs/protocol.md` §对照：实现里有哪些命令（help/status/fan/…），protocol.md 写了哪些，`docs/hardware-assembly.md` 验收示例用了哪些——三方列表逐个比对。
- [ ] 参数解析的越界（fan index 上限 8、百分比 0-100 校验）。
- [ ] USB-CDC 挂起/重枚举时 console 任务行为。

**ota_handler**
- [ ] 与 `partitions.csv` 的 ota_0/ota_1 布局核对；镜像校验（sha256?）；回滚逻辑；OTA 期间风扇控制是否保持（任务不被饿死）。
- [ ] 协议 §7 的 OTA 流程（topic、分块大小、进度上报）与实现比对。

**flash_storage**
- [ ] NVS namespace/key 与默认值；曲线配置写入频率（EEPROM 磨损类问题对 flash 的等价物：NVS 写放大）；损坏时回退行为。

**alert_manager / fan_curve / status_led / wifi_manager**
- [ ] 告警级别定义（0/1/2?）与 protocol.md §5、web 前端、ha/alerts.yaml 四方一致。
- [ ] 曲线插值算法（分段线性？出界 clamp？）、最少/最多点数限制与 protocol.md §4.2 的 schema 一致。
- [ ] WS2812 颜色状态映射表是否文档化。
- [ ] WiFi 配网按键（GPIO47）去抖、长按/短按语义。

**main.c**
- [ ] 任务清单：优先级、栈深、核绑定；初始化顺序（网络失败是否阻塞风扇控制——风扇安全必须先于联网）。
- [ ] 看门狗喂狗路径；传感器失败时控制回退策略（用哪个温度源）。

### 2.4 构建与配置
- [ ] `idf.py build` 结果（或 BLOCKED）。
- [ ] `partitions.csv` 与 N16R8（16MB flash / 8MB PSRAM）匹配性：分区总大小 ≤16MB？是否有 app 两份 OTA + NVS + storage 的布局；PSRAM 是否启用（sdkconfig.defaults 里 SPIRAM 相关项）。
- [ ] `sdkconfig.defaults` 关键项：flash size 16MB、USB CDC on boot、log level。

---

## 3. 模块 B：agent（Go）

文件清单：`go.mod`、`Makefile`、`agent.service`、`install.sh`、`config.yaml`、`cmd/agent/main.go`、`internal/config/config.go`、`internal/monitor/{collector.go,gpu.go,system.go}`、`internal/mqtt/client.go`、`internal/usb/relay.go`。

检查点：
- [ ] **module path**：`go.mod` 为 `github.com/user/smart-fan-agent`（`agent/internal/mqtt/client.go:13` 可见 import 引用）——占位符路径，构建是否真的通过？跑 `go build ./...` 验证；若因路径问题失败记 Critical。
- [ ] MQTT：agent 发布 topic 前缀是 `system-monitor/%s/sensor/%s`（`client.go:75`），与 protocol.md 的 `fan-controller/...` 命名空间不同——确认这是设计意图（agent 上报主机传感器）还是命名失控：protocol.md 是否定义了 agent 的 topic？没有定义则记发现（协议文档缺口）。
- [ ] agent 订阅 `+/command/#`（`client.go:47`）拿到命令后做什么？命令 schema 与 firmware 的 command 是否同一套？把 agent 处理的每种命令与 protocol.md 比对。
- [ ] `internal/usb/relay.go`：这是干什么的（USB 继电器？）？与主控板是什么关系？与 `docs/protocol.md`/`docs/deploy.md` 的架构描述是否自洽；找不到对应描述记 Minor（文档缺口）。
- [ ] `monitor/gpu.go`：GPU 指标采集的平台限定（nvidia-smi?）；命令执行错误处理；输出解析健壮性。
- [ ] `config.yaml` 默认值与 `internal/config/config.go` 的字段/默认值/校验一一比对（缺字段、多余字段、类型不匹配都算发现）。
- [ ] `agent.service`（systemd）：字段正确性（After/WantedBy/Restart）、路径与 install.sh 安装位置一致；`install.sh` 幂等性与错误处理（set -e 有没有）。
- [ ] `Makefile` 目标与实际可用性（build/cross-compile 目标引用的路径存在吗）。
- [ ] 并发：paho 回调 goroutine 与发布之间的竞态（go vet + 人工读）；context 取消路径。

---

## 4. 模块 C：web

文件清单：
- backend：`package.json`、`src/{server.ts,mqtt.ts,routes/devices.ts,types.ts}`
- frontend：`package.json`、`src/App.tsx`、`src/components/{AlertRuleEditor,CurveEditor,DeviceCard,FanCard,OTAProgress,TemperatureGauge,VoltageBar}.tsx`、`src/hooks/useWebSocket.ts`、`src/pages/{Alerts,Dashboard,Devices,Fans,History}.tsx`

检查点：
- [ ] 构建：backend `npx tsc --noEmit`、frontend `npm run build` 真实执行并贴输出（缺依赖 BLOCKED）。
- [ ] MQTT（`src/mqtt.ts`）：`TOPIC_PREFIX='fan-controller'`（:6）与 protocol.md §Topic 命名空间一致；订阅的 4 类 topic（:39-42）与 protocol.md 定义的全部 topic **逐个**比对——哪些 protocol topic 前端没消费？哪些前端订阅的 topic 协议没定义？各列一张表。
- [ ] 命令下发（:98 `${deviceId}/command/${action}`）的 action 集合与 payload 构造，与 protocol.md §4 的每个命令（fan/curve/reboot/reset/…）逐个比对字段名与单位。
- [ ] **风扇数量假设**：grep 前端所有硬编码的 fan 数量/数组（FanCard 渲染循环、Fans.tsx、types.ts 里的类型）；当前是多少？硬件 v1.2 为 8 路 → 记发现并列入 §8 表 2。
- [ ] WebSocket：`useWebSocket.ts` 的消息类型与 backend `server.ts` 推送的形状逐字段比对（前后端各列一份消息 schema 表）。
- [ ] units：温度 °C、电压 V、RPM、占空比 % 在 前端显示 ↔ backend 类型 ↔ protocol.md 字段（`temperature_c`、`rpm`、`duty_pct`…）三方一致；0-based/1-based fan 显示编号。
- [ ] CurveEditor：点数上下限、duty 0-100 校验、与 protocol.md §4.2 curve schema 一致。
- [ ] OTAProgress：进度 topic 与 firmware ota_handler 的上报格式比对。
- [ ] VoltageBar：3 路电压（12V/5V/3.3V）与 protocol §2.3 schema 比对（字段名、量程、告警阈值硬编码在哪）。
- [ ] 安全：backend 监听地址/端口、是否有鉴权（局域网假设是否在 deploy.md 声明）；未声明的裸奔端口记 Minor。

---

## 5. 模块 D：ha

文件清单：`README.md`、`fans.yaml`、`sensors.yaml`、`alerts.yaml`。

检查点：
- [ ] YAML 语法校验命令执行（§1）。
- [ ] `fans.yaml`：数出 fan 实体数量（当前可见 fan0、fan1…疑似 4 个）——与硬件 8 路、与 firmware `FAN_PWM_COUNT`、与 protocol.md 示例对照，记入 §8 表 2。
- [ ] discovery payload：与 protocol.md §8 的 MQTT Discovery 配置逐字段比对（`command_topic`/`state_topic` 模板、`unique_id`、availability topic=LWT）。
- [ ] `sensors.yaml`/`alerts.yaml`：每个 sensor 的 state_topic 与 protocol.md §2 的 topic 模板逐个比对；单位、device_class、icon 合理性。
- [ ] payload_on/off 或百分比速度语义与 firmware 命令 schema 是否匹配（HA fan percentage → fan-controller command/fan 的转换在哪发生）。

---

## 6. 模块 E：test

文件清单：`test/smoke_test.sh`、`test/e2e/integration_test.sh`。

检查点：
- [ ] `bash -n` 语法检查执行。
- [ ] 全文读每个脚本：引用的二进制/端口/设备路径/环境变量是否在仓库其他地方有定义（例如期望 `/dev/ttyACM0`、期望 MQTT broker 地址从哪来）。
- [ ] 测试覆盖 vs 协议命令清单：列出 protocol.md 全部命令/topic，标注每项"有测试/无测试"，产出覆盖表。
- [ ] 断言质量：脚本失败时是否真的会非零退出（`set -e`/显式判断），还是静默通过——逐个断言检查。
- [ ] smoke 与 e2e 的前置条件（需真实硬件？需 broker？）是否在脚本头部或 docs/deploy.md 说明。

---

## 7. 模块 F：docs 与仓库根

文件清单：`README.md`、`docs/protocol.md`、`docs/deploy.md`、`docs/hardware-assembly.md`、`LICENSE`、根目录其他非隐藏文件；另检查 `.omo/`、`.sisyphus/` 两个隐藏目录。

检查点：
- [ ] README 的系统描述（路数、架构图、模块清单）与 v1.2 硬件、与各模块实际实现一致性。
- [ ] `docs/protocol.md` 作为协议唯一真源：其全部 topic/命令/字段枚举成表（这是 §8 各表的左列来源）。
- [ ] `docs/deploy.md`：部署步骤引用的文件/服务名/端口是否与 agent（agent.service、config.yaml）、web（server.ts 监听端口）、固件烧录命令一致。
- [ ] 死链接/幽灵文件扫描：全仓库 grep 引用了但文件系统不存在的路径（已知例子：`hardware/BOM.csv`、`bom-*.xlsx`、`pcb-layout-example.png`、`test-procedure.md`、`hardware/docs/bom-expansion-board-v1.0.xlsx`），逐个列出。
- [ ] `.omo/`、`.sisyphus/`：内容是什么（旧计划/evidence），是否应入库或加入 `.gitignore`；两目录是否互相重复。
- [ ] LICENSE 与各模块声明的许可一致性（README 说 MIT？agent/web 有没有额外 license 文件）。

---

## 8. 跨模块一致性矩阵（必须全部产出）

| 表 | 左侧完整枚举来源 | 右侧对照方 | 要求 |
|----|------------------|-----------|------|
| 表1 MQTT topic | protocol.md 全部 topic（含通配模式） | firmware mqtt_client / usb_console（OTA）、web backend mqtt.ts、agent mqtt/client.go、ha 三个 yaml | 逐行：topic 字符串、QoS、方向、payload 方向是否四方一致；不一致行标红 |
| 表2 风扇数量与索引 | 硬件 v1.2=8 路（整改清单 D2） | firmware FAN_PWM_COUNT/FAN_TACH_COUNT、web（FanCard/Fans/types）、ha fans.yaml、protocol.md 示例、README | 每处写具体数值与 file:line；0/1-based 一并标注 |
| 表3 命令名与 payload | usb_console 命令表 | protocol.md §4、web backend 命令构造、ha command 模板、agent 命令处理 | 每命令一行：字段名/类型/单位/校验范围 |
| 表4 传感器类型与单位 | protocol.md §2（bme280/ds18b20/voltage/internal_temp） | firmware 各组件上报代码、web types/VoltageBar/TemperatureGauge、ha sensors.yaml | 字段名与单位逐项 |
| 表5 告警级别 | firmware alert_manager | protocol.md §5、web Alerts 页、ha alerts.yaml | 级别数、语义、颜色/文案映射 |
| 表6 硬件引脚 | 整改清单 §1 v1.2 表（31 行） | firmware 全部 GPIO define | 每行一致/不一致 |

---

## 9. 输出报告格式（固定模板）

### 9.1 覆盖矩阵
`模块 | 文件 | 行数 | 状态(全文已读/全文已读+已验证) | 备注` —— 行数用 `wc -l` 实测填入。

### 9.2 发现清单
`编号(MA-01 格式) | 严重度 | 模块 | 文件:行 | 证据摘录(≤3行) | 影响 | 建议修法`

### 9.3 一致性矩阵
§8 的 6 张表，逐行给出比对结果。

### 9.4 执行证据
§1 每条命令的实际输出摘录（或 BLOCKED 说明）。

### 9.5 统计与结论
发现总数按严重度分桶；覆盖矩阵 100% 完成声明；BLOCKED 项清单及原因。

---

**版本：** v1.0（2026-08-23）
**上游文档：** `hardware/docs/remediation-plan-v1.2.md`（硬件整改，含 v1.2 引脚表）
**审查顺序建议：** A(firmware) → B(agent) → C(web) → D(ha) → E(test) → F(docs)，最后统一填 §8 矩阵（矩阵是全项目视角，必须最后做）。
