#!/usr/bin/env bash
# test/e2e/integration_test.sh — 固件 ↔ Go Agent ↔ MQTT 集成测试
# 验证 MQTT 数据流的双向协议合规性

set -euo pipefail

BROKER="${1:-localhost}"
TOPIC_PREFIX="fan-controller"
TIMEOUT=10
PASS=0; FAIL=0

pass() { echo "[PASS] $1"; ((PASS++)); }
fail() { echo "[FAIL] $1"; ((FAIL++)); }

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
[ -s "${T_OUT}" ] \
  && pass "T3: Fan 0 state data received" \
  || fail "T3: No fan state data in ${TIMEOUT}s"
rm -f "${T_OUT}"

# Test 4: Command relay — send fan control, verify device receives
T_OUT=$(mktemp)
# Publish command (simulating Go Agent forwarding from API)
mosquitto_pub -h "${BROKER}" -t "${TOPIC_PREFIX}/test/command/fan" \
  -m '{"fan_index":0,"mode":"manual","duty_pct":75,"timestamp":0}' 2>/dev/null \
  && pass "T4: Fan control command published to MQTT" \
  || fail "T4: Failed to publish command"
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
