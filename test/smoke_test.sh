#!/usr/bin/env bash
# test/smoke_test.sh — 全系统冒烟测试
# ⚠️ 必须从仓库根目录运行（相对路径依赖 ha/ 与 docs/）：./test/smoke_test.sh
# 需要: mosquitto_pub, mosquitto_sub, curl（TST-03: 已移除未用的 JSON CLI 依赖声明）
# 使用方法: ./test/smoke_test.sh [broker_host] [api_host]
# 示例:     ./test/smoke_test.sh 192.168.1.100 localhost

set -euo pipefail

BROKER="${1:-localhost}"
API_HOST="${2:-localhost}"
API_BASE="http://${API_HOST}:3001/api"
TOPIC_PREFIX="fan-controller"
PASS=0; FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'; YELLOW='\033[1;33m'

# TST-01: set -e 下 bash 双括号自增会在结果为 0 时触发 ERR_EXIT —— 改用算术展开
pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
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
mosquitto_sub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/command/fan" -C 1 --quiet > "${SUB_OUT}" 2>/dev/null &
SUB_PID=$!
sleep 0.5

CTRL=$(curl -sf -X POST "${API_BASE}/devices/${TEST_DEVICE}/fan/0" \
  -H "Content-Type: application/json" -d '{"speed":75}' 2>/dev/null || echo '{"ok":false}')
sleep 1
kill ${SUB_PID} 2>/dev/null || true
wait ${SUB_PID} 2>/dev/null || true

if echo "${CTRL}" | grep -q '"ok":true'; then
  pass "CP7: Fan speed control API returned ok"
else
  fail "CP7: Fan control API failed: ${CTRL}"
fi
# TST-03: CP7 补 SUB_OUT 内容断言（此前 mktemp 创建后从未读取）
if grep -q '"duty_pct":75' "${SUB_OUT}" 2>/dev/null; then
  pass "CP7: command/fan payload captured with duty_pct=75"
else
  fail "CP7: command/fan payload not captured/asserted"
fi
rm -f "${SUB_OUT}"

# CP8: 模拟告警消息（协议 §5: alert_type/severity 为字符串）
info "CP8: Simulate alert and verify API"
MSG_ALERT='{"timestamp":'"$(date +%s)"',"device_id":"'"${TEST_DEVICE}"'","alert_type":"temperature_high","severity":"critical","message":"Temperature 78°C > 75°C","value":78,"threshold":75,"sensor":"bme280"}'
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

# CP11: HA 配置文件格式
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
# TST-03: 修正 Topic 计数（协议文档的 topic 定义以 "**Topic**:" 标注，
# 原 "Topic:" 匹配 0；同时统计 topic 模板表格行作为补充）
TOPICS=$(grep -c '\*\*Topic\*\*:' docs/protocol.md 2>/dev/null || echo 0)
TOPIC_ROWS=$(grep -c 'fan-controller/{device_id}' docs/protocol.md 2>/dev/null || echo 0)
SENSORS=$(grep -ci "sensor" docs/protocol.md 2>/dev/null || echo 0)
if [ "${TOPICS}" -ge 5 ] || [ "${TOPIC_ROWS}" -ge 10 ]; then
  pass "CP12: Protocol doc topic definitions present (Topic sections=${TOPICS}, template refs=${TOPIC_ROWS})"
else
  fail "CP12: Protocol doc topic definitions missing"
fi
[ "${SENSORS}" -ge 5 ] && pass "CP12: Protocol doc has ${SENSORS} sensor references" \
  || fail "CP12: Protocol doc incomplete"

# ---------------------------------------------------------------
# TST-04: 协议命令清单补测（依赖 FW-20/FW-07/FW-10 落地后的行为）

# CP13: 曲线命令 — REST API → command/curve（协议 §4.2: points + 平铺 PID + 枚举源）
info "CP13: Curve command via REST API → command/curve"
SUB_OUT=$(mktemp)
mosquitto_sub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/command/curve" -C 1 --quiet > "${SUB_OUT}" 2>/dev/null &
SUB_PID=$!
sleep 0.5
curl -sf -X POST "${API_BASE}/devices/${TEST_DEVICE}/fan/0/curve" \
  -H "Content-Type: application/json" \
  -d '{"mode":"lut","temperature_source":"bme280","points":[{"temp_c":30,"duty_pct":20},{"temp_c":70,"duty_pct":100}]}' \
  > /dev/null 2>&1
sleep 1
kill ${SUB_PID} 2>/dev/null || true
wait ${SUB_PID} 2>/dev/null || true
CURVE_OK=true
for field in '"fan_index":0' '"temperature_source":"bme280"' '"temp_c":30' '"duty_pct":100'; do
  echo "$(cat ${SUB_OUT})" | grep -q "${field}" || CURVE_OK=false
done
[ "${CURVE_OK}" = true ] \
  && pass "CP13: command/curve payload has protocol §4.2 fields" \
  || fail "CP13: command/curve payload missing fields"
rm -f "${SUB_OUT}"

# CP13b: 非法 temperature_source 被 Zod 拒绝（ADJ-5 枚举）
INVALID_SRC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/devices/${TEST_DEVICE}/fan/0/curve" \
  -H "Content-Type: application/json" \
  -d '{"mode":"lut","temperature_source":"gpu"}' 2>/dev/null)
if [ "${INVALID_SRC}" = "400" ]; then
  pass "CP13: Invalid temperature_source rejected (HTTP 400)"
else
  fail "CP13: Expected HTTP 400 for invalid source, got ${INVALID_SRC}"
fi

# CP14: reset 命令 — confirm:false 应被固件忽略（协议 §4.4 语义检查）
info "CP14: reset command semantics (confirm flag)"
RESET_DOC=$(grep -c 'confirm' docs/protocol.md 2>/dev/null || echo 0)
if [ "${RESET_DOC}" -ge 1 ] && grep -q 'command/reset' docs/protocol.md; then
  pass "CP14: protocol §4.4 documents command/reset + confirm gate"
else
  fail "CP14: protocol missing reset semantics"
fi
# 发布一条 confirm:false（真机应忽略；模拟环境仅验证发布链路）
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/command/reset" \
  -m '{"timestamp":0,"device_id":"'"${TEST_DEVICE}"'","confirm":false}' 2>/dev/null \
  && pass "CP14: reset (confirm:false) published — device must ignore" \
  || fail "CP14: failed to publish reset command"

# CP15: config/alert — REST API 走 config/alert topic（协议 §6.2，WEB-05）
info "CP15: alert rules endpoint → config/alert"
SUB_OUT=$(mktemp)
mosquitto_sub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/config/alert" -C 1 --quiet > "${SUB_OUT}" 2>/dev/null &
SUB_PID=$!
sleep 0.5
curl -sf -X POST "${API_BASE}/devices/${TEST_DEVICE}/alert" \
  -H "Content-Type: application/json" \
  -d '{"rules":[{"type":"temperature_high","warn_c":75,"crit_c":80,"enabled":true}]}' \
  > /dev/null 2>&1
sleep 1
kill ${SUB_PID} 2>/dev/null || true
wait ${SUB_PID} 2>/dev/null || true
if grep -q '"temperature_high"' "${SUB_OUT}" 2>/dev/null && grep -q '"crit_c":80' "${SUB_OUT}" 2>/dev/null; then
  pass "CP15: config/alert payload with dual thresholds captured"
else
  fail "CP15: config/alert payload not captured"
fi
rm -f "${SUB_OUT}"

# CP16: ota/status 订阅链路 — 发布模拟进度，验证 web 后端缓存 ota 字段
info "CP16: ota/status progress → web backend cache"
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/ota/status" \
  -m '{"timestamp":'"$(date +%s)"',"device_id":"'"${TEST_DEVICE}"'","state":"downloading","progress_pct":45,"message":"test"}' 2>/dev/null
sleep 3  # wait for backend subscription + WS push cycle
DEVICES=$(curl -sf "${API_BASE}/devices/${TEST_DEVICE}" 2>/dev/null || echo '{}')
if echo "${DEVICES}" | grep -q '"progress_pct":45'; then
  pass "CP16: ota/status progress cached and exposed via REST"
else
  fail "CP16: ota/status not reflected in /api/devices"
fi

# CP17: buffered 补发链路 — /buffered 五级 topic 应被 sensor/# 订阅吃到（WEB-04/ADJ-12）
info "CP17: buffered topic ingestion (sensor/# subscription)"
BUF_TS=$(date +%s)
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/${TEST_DEVICE}/sensor/bme280/buffered" \
  -m '{"timestamp":'"${BUF_TS}"',"device_id":"'"${TEST_DEVICE}"'","buffered":true,"temperature_c":31.7,"humidity_pct":40.0,"pressure_hpa":1000.0}' 2>/dev/null
sleep 3
DEVICES=$(curl -sf "${API_BASE}/devices/${TEST_DEVICE}" 2>/dev/null || echo '{}')
if echo "${DEVICES}" | grep -q '"temperature_c":31.7'; then
  pass "CP17: buffered (5-level) sensor topic ingested via sensor/#"
else
  fail "CP17: buffered topic not ingested"
fi

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
