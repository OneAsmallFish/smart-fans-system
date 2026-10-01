#!/usr/bin/env bash
# test/e2e/integration_test.sh — 固件 ↔ Go Agent ↔ MQTT 集成测试
# 验证 MQTT 数据流的双向协议合规性
# ⚠️ 必须从仓库根目录运行；需要真机固件 + 本地 broker

set -euo pipefail

BROKER="${1:-localhost}"
TOPIC_PREFIX="fan-controller"
TIMEOUT=10
PASS=0; FAIL=0

# TST-01: set -e 下 bash 双括号自增会在结果为 0 时触发 ERR_EXIT —— 改用算术展开
pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "=== Firmware ↔ Go Agent ↔ MQTT Integration Test ==="
echo "Broker: ${BROKER}"
echo ""

# Test 1: Status message has required fields
T_OUT=$(mktemp)
timeout ${TIMEOUT} mosquitto_sub -h "${BROKER}" \
  -t "${TOPIC_PREFIX}/+/status" -C 1 --quiet > "${T_OUT}" 2>/dev/null || true

if [ -s "${T_OUT}" ]; then
  MSG=$(cat "${T_OUT}")
  for field in "device_id" "status" "timestamp"; do
    echo "${MSG}" | grep -q "\"${field}\"" \
      && pass "T1: status message has field '${field}'" \
      || fail "T1: status message missing '${field}'"
  done
else
  fail "T1: No status message received in ${TIMEOUT}s (is firmware running?)"
fi
rm -f "${T_OUT}"

# Test 2: Sensor data has required fields
T_OUT=$(mktemp)
timeout ${TIMEOUT} mosquitto_sub -h "${BROKER}" \
  -t "${TOPIC_PREFIX}/+/sensor/bme280" -C 1 --quiet > "${T_OUT}" 2>/dev/null || true

if [ -s "${T_OUT}" ]; then
  MSG=$(cat "${T_OUT}")
  for field in "temperature_c" "humidity_pct" "pressure_hpa" "device_id" "timestamp"; do
    echo "${MSG}" | grep -q "\"${field}\"" \
      && pass "T2: bme280 message has field '${field}'" \
      || fail "T2: bme280 message missing '${field}'"
  done
else
  fail "T2: No BME280 data received in ${TIMEOUT}s"
fi
rm -f "${T_OUT}"

# Test 3: Fan state data
T_OUT=$(mktemp)
timeout ${TIMEOUT} mosquitto_sub -h "${BROKER}" \
  -t "${TOPIC_PREFIX}/+/fan/0/state" -C 1 --quiet > "${T_OUT}" 2>/dev/null || true
if [ -s "${T_OUT}" ]; then
  MSG=$(cat "${T_OUT}")
  for field in "pwm_duty_pct" "rpm" "mode"; do
    echo "${MSG}" | grep -q "\"${field}\"" \
      && pass "T3: fan state has field '${field}'" \
      || fail "T3: fan state missing '${field}'"
  done
else
  fail "T3: No fan state data in ${TIMEOUT}s"
fi
rm -f "${T_OUT}"

# Test 4: Command relay — TST-02: 真正订阅捕获 payload 并断言字段
# （原实现只发布不校验，且 mktemp 的 T_OUT 创建后未读）
T_OUT=$(mktemp)
mosquitto_sub -h "${BROKER}" \
  -t "${TOPIC_PREFIX}/test/command/fan" -C 1 --quiet > "${T_OUT}" 2>/dev/null &
SUB_PID=$!
sleep 0.5
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/test/command/fan" \
  -m '{"fan_index":0,"mode":"manual","duty_pct":75,"timestamp":0}' 2>/dev/null
sleep 1
kill ${SUB_PID} 2>/dev/null || true
wait ${SUB_PID} 2>/dev/null || true

if [ -s "${T_OUT}" ]; then
  MSG=$(cat "${T_OUT}")
  T4_OK=true
  for field in '"fan_index":0' '"duty_pct":75' '"mode":"manual"'; do
    echo "${MSG}" | grep -q "${field}" || T4_OK=false
  done
  [ "${T4_OK}" = true ] \
    && pass "T4: fan control command published AND payload fields asserted" \
    || fail "T4: command payload field mismatch: ${MSG}"
else
  fail "T4: command payload not captured"
fi
rm -f "${T_OUT}"

# Test 5: Voltage data format
T_OUT=$(mktemp)
timeout ${TIMEOUT} mosquitto_sub -h "${BROKER}" \
  -t "${TOPIC_PREFIX}/+/sensor/voltage" -C 1 --quiet > "${T_OUT}" 2>/dev/null || true
if [ -s "${T_OUT}" ]; then
  MSG=$(cat "${T_OUT}")
  echo "${MSG}" | grep -q "voltage_12v" \
    && pass "T5: Voltage message has 12V field" \
    || fail "T5: Voltage message missing 12V field"
else
  fail "T5: No voltage data in ${TIMEOUT}s"
fi
rm -f "${T_OUT}"

echo ""
echo "=== Integration Test: PASS=${PASS} FAIL=${FAIL} ==="
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
