# 模块一致性复验报告（module-recheck）

> 依据：`docs/module-remediation-plan-v1.2.md` §6.3；矩阵格式按 `docs/module-review-plan.md` §8。
> 复验日期：2026-08-25（整改完成后）。全部结论基于整改后代码 grep/构建实测。

---

## 表1 — MQTT topic 一致性（19 行）

左=protocol.md v1.0.1 topic 清单；右=四方实际使用。

| # | Topic（protocol.md） | 固件 | web backend | agent | ha | 结果 |
|---|---------------------|------|-------------|-------|-----|------|
| 1 | `{id}/status`（online, retain） | mqtt_wrapper CONNECTED 发布（retain=1）✓ | mqtt.ts 订阅 ✓ | — | alerts.yaml online 实体 + 全实体 availability ✓ | ✓ |
| 2 | `{id}/status`（LWT offline, retain） | connect() LWT 配置 ✓ | online=false 解析 ✓ | — | availability_template 判 offline ✓ | ✓ |
| 3 | `{id}/sensor/bme280` | sensor_task 1s ✓ | mqtt.ts sensor/# ✓ | agent.go 订阅 sensor/# ✓ | sensors.yaml ✓ | ✓ |
| 4 | `{id}/sensor/ds18b20` | address/valid schema（FW-18）✓ | types.ts address/valid ✓ | 订阅 ✓ | selectattr address ✓ | ✓ |
| 5 | `{id}/sensor/voltage` | 5s（FW-19）✓ | voltage 解析 ✓ | 订阅 ✓ | 3 实体（12V/5V/3.3V）✓ | ✓ |
| 6 | `{id}/sensor/internal_temp` | 5s ✓ | internal_temp ✓ | 订阅 ✓ | MCU 温度实体 ✓ | ✓ |
| 7 | `{id}/sensor/{type}/buffered` | flush_one 后缀 ✓（FW-07④） | sensor/# 吃到 ✓（CP17） | 订阅 sensor/# ✓ | 同 schema ✓ | ✓ |
| 8 | `{id}/fan/{0-7}/state` | tach_monitor 1s×8 ✓ | fan/+/state 解析 idx<FAN_COUNT ✓ | — | 8 RPM 实体 ✓ | ✓ |
| 9 | `{id}/command/fan` | handler ✓（越界丢弃） | devices.ts 发布 ✓ | —（AG-04 删除订阅） | fans.yaml command_topic ✓ | ✓ |
| 10 | `{id}/command/curve` | handler（FW-20①）✓ | curve 端点发布 ✓ | — | — | ✓ |
| 11 | `{id}/command/reboot` | handler ✓ | reboot 端点 ✓ | — | — | ✓ |
| 12 | `{id}/command/reset` | handler confirm 门 ✓（FW-20③） | —（无端点，协议直发） | — | — | ✓ |
| 13 | `{id}/command/ota` | handler（ADJ-3）✓ | ota 端点 ✓ | — | — | ✓ |
| 14 | `{id}/ota/status` | ota_publish_status（FW-10）✓ | 订阅+WS 转发（WEB-04）✓ | — | — | ✓ |
| 15 | `{id}/alert`（事件） | on_alert（§5.1 全字段）✓ | 订阅+alerts 缓存 ✓ | agent 订阅 `+/alert` 转发日志 ✓ | —（HA 改用状态 topic） | ✓ |
| 16 | `{id}/alert/{type}/state` | publish_alert_state（FW-17）✓ | — | — | alerts.yaml 4 实体 ✓ | ✓ |
| 17 | `{id}/config/alert` | 订阅 config/# + set/get（FW-20④）✓ | publishConfig（WEB-05）✓ | — | — | ✓ |
| 18 | `{id}/config/{wifi,mqtt}` | 协议标注"规划中，经 USB console"；固件未订阅 ✓（口径一致） | — | — | — | ✓（DESCOPE(ADJ-9) 一致降级） |
| 19 | `homeassistant/.../config`（Discovery） | 未实现，协议标注规划中 ✓ | — | — | ha/ 手动 packages ✓ | ✓（DESCOPE(ADJ-10) 一致裁剪） |

**结论：19/19 ✓**（其中 2 行为按裁决一致降级/裁剪，非分叉）。

---

## 表2 — 风扇数量与索引（15 处口径）

唯一基准 = 硬件决策 D2 = **8 路**，0 基索引。

| 位置 | 数值 | 结果 |
|------|------|------|
| firmware fan_pwm.h FAN_PWM_COUNT | 8 | ✓ |
| firmware fan_pwm.c FAN_GPIO[] | {5..12} 8 元素 | ✓ |
| firmware fan_tach.h FAN_TACH_COUNT | 8 | ✓ |
| firmware fan_tach.c TACH_GPIO[] | 8 元素（4 unit×2 ch） | ✓ |
| firmware fan_curve.h FAN_CURVE_FANS | 8 | ✓ |
| firmware alert_manager ALERT_FAN_COUNT | 8 | ✓ |
| firmware flash_storage.h fan_rpm[] | [8] | ✓ |
| firmware main.c 三处循环 | FAN_TACH_COUNT 引用 | ✓ |
| web backend types.ts FAN_COUNT | 8（导出常量） | ✓ |
| web backend mqtt.ts fans 数组/idx 边界 | FAN_COUNT | ✓ |
| web frontend Fans/History/FanCard | 遍历 device.fans（8）+ FAN_COUNT=8 | ✓ |
| ha fans.yaml fan 实体 | 8（Fan 0-7） | ✓ |
| ha sensors.yaml RPM 实体 | 8 | ✓ |
| protocol.md {index} 定义 | 0-7 | ✓ |
| README 架构图/特性/硬件表/Web 节 | 8 路 | ✓ |

**结论：15/15 ✓**。grep 门 `FAN_PWM_COUNT 4|FAN_CURVE_FANS 4|fan_rpm[4]|length: 4|idx < 4` 全空。

---

## 表3 — 命令名与 payload（9 条命令口径）

| 命令 | 固件实现 | 协议 §4/§6 | web 构造 | ha 模板 | 结果 |
|------|----------|-----------|----------|---------|------|
| console `help` | 动态列出 7 命令 | —（console 不在协议） | — | — | ✓ 与 deploy/assembly 示例一致 |
| console `status` | cmd_status（JSON） | — | — | — | ✓ |
| console `fan <0-7> <0-100>` | cmd_fan（越界拒绝） | — | — | — | ✓（DOC-02 对齐） |
| console `wifi status\|reset` | cmd_wifi | —（ADJ-9 降级承接） | — | — | ✓ |
| console `mqtt status\|set <url>` | cmd_mqtt（scheme 校验） | —（ADJ-9） | — | — | ✓ |
| console `ota <url>` / `reboot` | 既有 ✓ | — | — | — | ✓ |
| `command/fan` | fan_index+mode+duty_pct，越界丢弃 | §4.1 一致 | `{fan_index, mode:'manual', duty_pct, timestamp}` | fans.yaml 模板一致 | ✓ |
| `command/curve` | §4.2：points/LUT、PID 平铺、source 枚举映射、严格递增校验 | §4.2 一致（ADJ-4/5） | CurveSchema 平铺+枚举 zod | — | ✓ |
| `command/reset` / `config/alert` | confirm 门 / rules set-get+NVS | §4.4/§6.2 一致（ADJ-14 双阈值） | alert 端点→config/alert | — | ✓ |
| `command/ota` | firmware_url 触发 + ota/status 反馈 | §7 一致（ADJ-3） | ota 端点 | — | ✓ |

**结论：全部 ✓**（9 行命令口径 + console 命令集）。

---

## 表4 — 传感器字段与单位（17 项）

| 字段 | 协议 §2 | 固件上报 | web | ha | 结果 |
|------|---------|----------|-----|-----|------|
| bme280.temperature_c（°C） | ✓ | ✓ | ✓ | ✓ | ✓ |
| bme280.humidity_pct（%） | ✓ | ✓ | ✓ | ✓ | ✓ |
| bme280.pressure_hpa（hPa） | ✓ | ✓ | ✓ | ✓ | ✓ |
| bme280.timestamp（Unix 秒） | ✓ | time(NULL) ✓ | <1e9 显示未同步 ✓ | — | ✓ |
| ds18b20.sensors[].address（ROM 串） | ✓ | ds18b20_address_str ✓ | types ✓ | selectattr 匹配 ✓ | ✓ |
| ds18b20.sensors[].valid（bool） | ✓ | 无效也上报 ✓ | types ✓ | 未匹配→unavailable ✓ | ✓ |
| ds18b20.sensors[].temperature_c | ✓ | ✓ | ✓ | ✓ | ✓ |
| voltage.voltage_12v/5v/3v3（V） | ✓ | ÷6.0/÷5.7/÷5.7 换算 ✓ | VoltageBar nominal 12/5/3.3 ✓ | 3 实体 round(2) ✓ | ✓ |
| internal_temp.temperature_c | ✓ | 5s ✓ | ✓ | ✓ | ✓ |
| fan.pwm_duty_pct（0-100） | ✓ | ✓ | ✓ | percentage_value_template ✓ | ✓ |
| fan.rpm | ✓ | ✓ | ✓ | ✓ | ✓ |
| fan.stalled | ✓ | duty>5&&rpm<200 ✓ | ✓ | — | ✓ |
| fan.mode（auto/manual） | ✓ | fan_curve_is_manual ✓ | ✓ | — | ✓ |
| 上报频率 bme/ds=1s | ✓ | 1s ✓ | — | — | ✓ |
| 上报频率 voltage/internal=5s | ✓ | 5s（FW-19）✓ | — | — | ✓ |
| status 六字段（§1.1） | ✓ | FW-14 ✓ | firmware/ip 解析 ✓ | — | ✓ |
| 离线队列 50 条+30s 降频+buffered | §10 | 环形队列 ✓ | sensor/# 摄取 ✓ | — | ✓ |

**结论：17/17 ✓**。

---

## 表5 — 告警口径（8 维度）

| 维度 | 固件 alert_manager | 协议 §5 | web | ha | 结果 |
|------|--------------------|---------|-----|-----|------|
| 类型数 | 4 | 4 | 4 | 4 实体 | ✓ |
| 类型字符串 | temperature_high/fan_stall/voltage_abnormal/wifi_disconnected | 同左 | 同左 | topic 路径同左 | ✓ |
| severity 三级 | NORMAL/WARNING/CRITICAL → "normal/warning/critical" | warning/critical | SEV_COLORS 字符串键 | state topic severity 字段 | ✓ |
| 温度阈值 | 75 警告 / 80 critical（可配置） | 双阈值表 ✓ | AlertRuleEditor warn_c/crit_c | — | ✓ |
| 电压阈值 | 12V 10.8-13.2、5V ±0.25、3.3V ±0.165 | 同左 | VoltageBar 容差同左 | — | ✓ |
| 停转判定 | duty>5% 且 RPM<200 | 同左 | stalled 同左 | — | ✓ |
| WiFi 断连 | >60s（s_wifi 初值 false） | 60s | — | connectivity 实体 | ✓ |
| 恢复语义 | clear_rule→per-type state topic active:false | §5.2 | alerts 列表保留事件 | binary_sensor OFF | ✓ |
| 去重 | 2 分钟 | — | — | — | ✓（固件行为） |

**结论：8/8 ✓**。

---

## 表6 — 硬件引脚（固件 GPIO define vs 权威表 §1）

| GPIO | 权威表用途 | 固件实现 | 结果 |
|------|-----------|----------|------|
| GPIO1 | ADC_12V（÷6） | CH_12V=ADC_CHANNEL_0 ×6.0f | ✓ |
| GPIO2 | ADC_5V（÷5.7） | CH_5V=ADC_CHANNEL_1 ×5.7f | ✓ |
| GPIO4 | ADC_3V3（÷5.7） | CH_3V3=ADC_CHANNEL_3 ×5.7f | ✓ |
| GPIO5-12 | FAN1-8 PWM（LEDC0-7） | FAN_GPIO={5,6,7,8,9,10,11,12} | ✓ |
| GPIO13/14 | FAN1/2 TACH（PCNT U0） | TACH_GPIO[0..1]，unit0 | ✓ |
| GPIO15/21 | FAN3/4 TACH（PCNT U1） | TACH_GPIO[2..3]，unit1 | ✓ |
| GPIO16 | DS18B20 DQ | OW_GPIO=16 | ✓ |
| GPIO17/18 | I2C SDA/SCL | I2C_SDA=17 / SCL=18 | ✓ |
| GPIO19/20 | USB D-/D+（console） | TinyUSB CDC + CONSOLE_USB_SERIAL_JTAG | ✓ |
| GPIO38/39 | FAN5/6 TACH（PCNT U2） | TACH_GPIO[4..5]，unit2 | ✓ |
| GPIO40/41 | FAN7/8 TACH（PCNT U3） | TACH_GPIO[6..7]，unit3 | ✓ |
| GPIO42/43/44/48 | 屏幕 SPI 预留 | 固件不占用（未定义） | ✓（一致：不使用） |
| GPIO45 | WS2812B DI | LED_GPIO=45 | ✓ |
| GPIO46/3 | NC（strapping） | 固件不占用 | ✓ |
| GPIO47 | BTN_WIFI_CFG | BTN_GPIO=47 | ✓ |

**结论：全部 ✓**（H-03 8 条 grep 门全过，见 changelog §1）。

---

## 冒烟复验

- 固件 `idf.py build` **✅ 实测通过**（ESP-IDF v5.3.5，bin 0x11EA90 / 分区余 25%）；构建期修复 6 项见 changelog §4.5。
- `bash -n` 两脚本通过；完整运行 **BLOCKED**（本机无 mosquitto/broker/设备）。
- 用例数：smoke 25 项断言（含 TST-04 新增 CP13-CP17）；integration 5 组。

## 总结

- 表1-表6 全部 ✓（表1 含 2 行按裁决 ADJ-9/ADJ-10 一致降级，非不一致）。
- BLOCKED：真机冒烟、agent Linux 实机（环境缺失，见 changelog §5）；固件构建已实测通过。
- DESCOPE：DOC-06 Unity 测试未接入构建（changelog §6）。

---

**版本：** v1.0（2026-08-25）
**配套：** `docs/changelog-modules-v1.2.md`
