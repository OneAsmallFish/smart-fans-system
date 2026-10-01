# ha/README.md — Home Assistant 集成步骤（手动 packages 方案）

# Smart Fan Controller — Home Assistant 集成指南

## 前提条件

- Home Assistant 2024.1+
- Mosquitto broker 插件已安装并运行
- Smart Fan Controller 固件已烧录并已连接 WiFi

---

## 集成方法：手动 packages（ha/ 目录）

> **说明**：固件当前**不实现** MQTT Discovery 自动发现（规划中）。
> 集成方式为手动 packages —— 将 `ha/` 目录的 YAML 放入 HA 配置。

### 步骤

1. **获取 device_id**（二选一）：
   - 订阅设备状态 topic，等一条 retained 消息：
     ```bash
     mosquitto_sub -t 'fan-controller/+/status' -v   # 输出里的 esp32-XXXXXX 即 device_id
     ```
   - 或查看固件启动日志（USB-CDC 串口）：`Device ID: esp32-XXXXXX`

2. **获取 DS18B20 探头地址**（用于 sensors.yaml 的两个探头实体）：
   ```bash
   mosquitto_sub -t 'fan-controller/<device_id>/sensor/ds18b20' -v
   # payload 中 sensors[].address 形如 "28-a1b2c3d4e5f6"
   ```

3. **替换占位符并部署**（在仓库根执行）：
   ```bash
   mkdir -p /config/packages/fan-controller
   sed -e 's/__DEVICE_ID__/<你的device_id>/g' \
       -e 's/__DS_ADDR_0__/<探头0地址>/g' \
       -e 's/__DS_ADDR_1__/<探头1地址>/g' \
       ha/fans.yaml ha/alerts.yaml ha/sensors.yaml \
       > /dev/null   # 先 dry-run 确认，或直接逐文件输出：
   # cp 到 HA 配置目录：
   cp ha/fans.yaml ha/alerts.yaml ha/sensors.yaml /config/packages/fan-controller/
   # 然后在 HA 宿主机上执行 sed 批量替换：
   sed -i -e 's/__DEVICE_ID__/esp32-a1b2c3/g' \
          -e 's/__DS_ADDR_0__/28-xxxxxxxxxxxx/g' \
          -e 's/__DS_ADDR_1__/28-yyyyyyyyyyyy/g' \
          /config/packages/fan-controller/*.yaml
   ```

4. **在 configuration.yaml 中启用 packages**：
   ```yaml
   homeassistant:
     packages:
       fan_controller: !include_dir_named packages/fan-controller
   ```

5. **重启 Home Assistant**，实体生效：
   - 温度/湿度/气压（BME280）×3 + DS18B20 探头 ×2 + MCU 温度 ×1
   - 12V / 5V / 3.3V 电压监控 ×3
   - 风扇 0-7 转速（RPM）×8
   - 风扇 0-7 转速控制（0-100%）×8
   - 告警二进制传感器 ×4（温度/停转/电压/WiFi）+ 设备在线 ×1

> ⚠️ **必须替换 `__DEVICE_ID__`**：固件按具体 device_id 订阅命令（不做通配订阅），
> 不替换的 HA 配置将无法控制设备。旧的隐性占位 device_id 已废弃。

---

## 告警自动化示例

```yaml
# 温度过高时发送通知
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

---

## MQTT Discovery（规划中）

自动发现为规划功能（protocol.md §8）；当前方案为上述手动 packages。
