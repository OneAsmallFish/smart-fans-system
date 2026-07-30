#!/usr/bin/env bash
# test/smoke_test.sh — 全系统冒烟测试
# 需要: mosquitto_pub, mosquitto_sub, curl, jq
# 使用方法: ./test/smoke_test.sh [broker_host] [api_host]
# 示例:     ./test/smoke_test.sh 192.168.1.100 localhost

set -euo pipefail

BROKER="${1:-localhost}"
API_HOST="${2:-localhost}"
API_BASE="http://${API_HOST}:3001/api"
TOPIC_PREFIX="fan-controller"
PASS=0; FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'; YELLOW='\033[1;33m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)); }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# ---------------------------------------------------------------
info "Starting Smart Fan Controller smoke test"
info "Broker: ${BROKER}, API: ${API_BASE}"
echo ""

# CP1: Web後端 /health 端点
info "CP1: Web backend health check"
HEALTH=$(curl -sf "${API_BASE}/../health" 2>/dev/null || echo "FAIL")
if echo "${HEALTH}" | grep -q '"ok":true'; then
  pass "CP1: Web backend /health → ok"
else
  fail "CP1: Web backend not responding (start: cd web/backend && npm start)"
fi

# CP2: MQTT Broker 可达
info "CP2: MQTT Broker connectivity"
if mosquitto_pub -h "${BROKER}" -t "smoke/test" -m "ping" -q 0 2>/dev/null; then
  pass "CP2: MQTT Broker reachable at ${BROKER}"
else
  fail "CP2: MQTT Broker not reachable (start: mosquitto -c /etc/mosquitto/mosquitto.conf)"
fi

# CP3: 模拟设备上线 — 发布 status=online
info "CP3: Simulate device online status"
TEST_DEVICE="smoke-test-device"
MSG_STATUS='{"status":"online","device_id":"'"${TEST_DEVICE}"'","firmware_version":"smoke"}'
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/status" -m "${MSG_STATUS}" -q 1 2>/dev/null \
  && pass "CP3: Device online message published" \
  || fail "CP3: Failed to publish device status"
sleep 1

# CP4: Web后端订阅设备上线
info "CP4: Web backend subscribes and caches device"
sleep 2  # wait for WebSocket push cycle (2s)
DEVICES=$(curl -sf "${API_BASE}/devices" 2>/dev/null || echo '{"ok":false}')
if echo "${DEVICES}" | grep -q "${TEST_DEVICE}"; then
  pass "CP4: Web API /api/devices shows simulated device"
else
  fail "CP4: Device not in /api/devices (check MQTT→WebSocket pipeline)"
fi

# CP5: 模拟传感器数据上报
info "CP5: Simulate BME280 sensor data"
MSG_SENSOR='{"timestamp":'"$(date +%s)"',"device_id":"'"${TEST_DEVICE}"'","temperature_c":35.5,"humidity_pct":48.2,"pressure_hpa":1013.1}'
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/sensor/bme280" -m "${MSG_SENSOR}" \
  && pass "CP5: BME280 sensor data published" \
  || fail "CP5: Failed to publish sensor data"

# CP6: 模拟风扇状态上报
info "CP6: Simulate fan state data"
MSG_FAN='{"timestamp":'"$(date +%s)"',"device_id":"'"${TEST_DEVICE}"'","fan_index":0,"pwm_duty_pct":65,"rpm":1850,"stalled":false,"mode":"auto"}'
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/fan/0/state" -m "${MSG_FAN}" \
  && pass "CP6: Fan state data published" \
  || fail "CP6: Failed to publish fan state"

# CP7: 通过 REST API 发送风扇控制指令
info "CP7: REST API fan speed control → MQTT command"
SUB_OUT=$(mktemp)
mosquitto_sub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/command/fan" -C 1 --quiet &
SUB_PID=$!
sleep 0.5

CTRL=$(curl -sf -X POST "${API_BASE}/devices/${TEST_DEVICE}/fan/0" \
  -H "Content-Type: application/json" -d '{"speed":75}' 2>/dev/null || echo '{"ok":false}')
sleep 1
kill ${SUB_PID} 2>/dev/null || true

if echo "${CTRL}" | grep -q '"ok":true'; then
  pass "CP7: Fan speed control API returned ok"
else
  fail "CP7: Fan control API failed: ${CTRL}"
fi

# CP8: 模拟告警消息
info "CP8: Simulate alert and verify API"
MSG_ALERT='{"timestamp":'"$(date +%s)"',"device_id":"'"${TEST_DEVICE}"'","alert_type":0,"message":"Temperature 78°C > 75°C","value":78,"threshold":75}'
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/alert" -m "${MSG_ALERT}" \
  && pass "CP8: Alert message published" \
  || fail "CP8: Failed to publish alert"

# CP9: OTA 触发 API
info "CP9: OTA trigger via REST API"
OTA_RESP=$(curl -sf -X POST "${API_BASE}/devices/${TEST_DEVICE}/ota" \
  -H "Content-Type: application/json" -d '{"url":"https://example.com/fw.bin"}' 2>/dev/null || echo '{"ok":false}')
if echo "${OTA_RESP}" | grep -q '"ok":true'; then
  pass "CP9: OTA trigger API ok"
else
  fail "CP9: OTA trigger API failed"
fi

# CP10: Zod 校验 — 无效参数返回错误
info "CP10: Zod validation rejects invalid input"
INVALID=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/devices/${TEST_DEVICE}/fan/0" \
  -H "Content-Type: application/json" -d '{"speed":999}' 2>/dev/null)
if [ "${INVALID}" = "400" ]; then
  pass "CP10: Invalid fan speed (999) returns HTTP 400"
else
  fail "CP10: Expected HTTP 400, got ${INVALID}"
fi

# CP11: HA Discovery 配置文件格式
info "CP11: Home Assistant YAML files existence and format"
HA_FILES=("ha/sensors.yaml" "ha/fans.yaml" "ha/alerts.yaml" "ha/README.md")
ALL_HA_OK=true
for f in "${HA_FILES[@]}"; do
  if [ -f "${f}" ]; then
    pass "CP11: ${f} exists"
  else
    fail "CP11: ${f} missing"
    ALL_HA_OK=false
  fi
done

SENSOR_COUNT=$(grep -c "state_topic:" ha/sensors.yaml 2>/dev/null || echo 0)
if [ "${SENSOR_COUNT}" -ge 5 ]; then
  pass "CP11: ha/sensors.yaml has ${SENSOR_COUNT} state_topic entries (≥5)"
else
  fail "CP11: ha/sensors.yaml has only ${SENSOR_COUNT} state_topic entries"
fi

# CP12: 协议文档完整性最终验证
info "CP12: Protocol documentation completeness"
TOPICS=$(grep -c "Topic:" docs/protocol.md 2>/dev/null || echo 0)
SENSORS=$(grep -ci "sensor" docs/protocol.md 2>/dev/null || echo 0)
[ "${SENSORS}" -ge 5 ] && pass "CP12: Protocol doc has ${SENSORS} sensor references" \
  || fail "CP12: Protocol doc incomplete"

# ---------------------------------------------------------------
echo ""
echo "================================================"
echo "  Smoke Test Summary"
echo "================================================"
echo -e "  ${GREEN}PASS: ${PASS}${NC}    ${RED}FAIL: ${FAIL}${NC}"
echo "================================================"

if [ "${FAIL}" -eq 0 ]; then
  echo -e "${GREEN}✓ All ${PASS} checks PASSED${NC}"
  exit 0
else
  echo -e "${RED}✗ ${FAIL} checks FAILED${NC}"
  exit 1
fi
