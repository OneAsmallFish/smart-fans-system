# ha/README.md — Home Assistant 集成步骤

# Smart Fan Controller — Home Assistant 集成指南

## 前提条件

- Home Assistant 2024.1+
- Mosquitto broker 插件已安装并运行
- Smart Fan Controller 固件已烧录并已连接 WiFi

---

## 集成方法：MQTT Discovery（自动发现）

固件启动后会自动向 MQTT Broker 发布 Discovery 消息，HA 会自动创建所有传感器和控制实体。**无需手动配置**。

### 步骤

1. **安装 Mosquitto broker 插件**（HA → 设置 → 插件 → Mosquitto broker）

2. **在 MQTT 配置中启用 Discovery**（默认已启用）：
   ```yaml
   # configuration.yaml
   mqtt:
     discovery: true
     discovery_prefix: homeassistant
   ```

3. **重启 Home Assistant**

4. **等待设备上线**：设备上电后约30秒内，HA 集成 → MQTT 会自动显示以下实体：
   - 温度/湿度/气压（BME280）
   - DS18B20 远程温度探头
   - 12V/5V 电压监控
   - 风扇 0-3 转速（RPM）
   - 风扇 0-3 转速控制（0-100%）
   - 告警二进制传感器（温度/停转/电压/在线状态）

---

## 手动配置（备选方案）

如果自动发现未生效，可手动将 `ha/` 目录下的 YAML 文件放置到 HA 配置目录：

```bash
# 在 HA 宿主机上
cp ha/*.yaml /config/packages/fan-controller/
```

然后在 `configuration.yaml` 中添加：
```yaml
homeassistant:
  packages:
    fan_controller: !include_dir_named packages/fan-controller
```

重启 HA 后实体生效。

---

## 小爱同学语音控制（V2 增强项）

通过巴法云 MQTT 桥接实现（不包含在当前版本）：

```
HA 自动化 → 巴法云 MQTT → 小爱同学技能
```

---

## 告警自动化示例

```yaml
# 温度过高时发送通知 + 设置所有风扇100%
automation:
  - alias: "Fan Controller High Temperature"
    trigger:
      - platform: state
        entity_id: binary_sensor.fan_controller_temperature_alert
        to: "on"
    action:
      - service: notify.mobile_app
        data:
          message: "服务器温度过高！检查风扇控制器。"
```
