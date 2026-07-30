#!/usr/bin/env bash
# agent/install.sh — Smart Fan Agent 安装脚本
# Usage: sudo ./install.sh

set -euo pipefail

BINARY="smart-fan-agent"
BUILD_DIR="build"
INSTALL_BIN="/usr/local/bin/${BINARY}"
INSTALL_CFG="/etc/smart-fan-agent"
SERVICE_FILE="/etc/systemd/system/${BINARY}.service"

echo "=== Smart Fan Agent Installer ==="

# Build if binary not present
if [ ! -f "${BUILD_DIR}/${BINARY}" ]; then
  echo "[1/4] Building binary..."
  make build
else
  echo "[1/4] Using existing binary: ${BUILD_DIR}/${BINARY}"
fi

# Install binary
echo "[2/4] Installing binary to ${INSTALL_BIN}..."
install -Dm755 "${BUILD_DIR}/${BINARY}" "${INSTALL_BIN}"

# Install config (only if not already present to avoid overwriting)
echo "[3/4] Installing config to ${INSTALL_CFG}/config.yaml..."
mkdir -p "${INSTALL_CFG}"
if [ ! -f "${INSTALL_CFG}/config.yaml" ]; then
  install -Dm644 config.yaml "${INSTALL_CFG}/config.yaml"
  echo "      → Default config installed. Edit ${INSTALL_CFG}/config.yaml before starting."
else
  echo "      → Existing config preserved."
fi

# Install and enable systemd service
echo "[4/4] Installing systemd service..."
install -Dm644 "${BINARY}.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable "${BINARY}"

echo ""
echo "✓ Installation complete!"
echo "  Config:  ${INSTALL_CFG}/config.yaml"
echo "  Service: systemctl start ${BINARY}"
echo "  Logs:    journalctl -u ${BINARY} -f"
echo ""
echo "⚠  Edit ${INSTALL_CFG}/config.yaml to set your MQTT broker and serial port before starting!"
