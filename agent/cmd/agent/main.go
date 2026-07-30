// cmd/agent/main.go — Smart Fan Agent 入口
// 启动顺序: config → MQTT → monitor collectors → USB relay → heartbeat loop
package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/user/smart-fan-agent/internal/config"
)

func main() {
	// Load configuration from config.yaml (path from env or default)
	cfgPath := os.Getenv("SMART_FAN_CONFIG")
	if cfgPath == "" {
		cfgPath = "/etc/smart-fan-agent/config.yaml"
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	log.Printf("Smart Fan Agent starting — broker=%s serial=%s", cfg.MQTT.Broker, cfg.Serial.Port)

	// TODO (T24): initialise MQTT client
	// mqttClient, err := mqtt.NewClient(cfg)

	// TODO (T23): initialise GPU + system monitor collectors
	// collectors := monitor.NewCollectors(cfg)

	// TODO (T24): initialise USB-CDC relay
	// relay, err := usb.NewRelay(cfg.Serial.Port, cfg.Serial.BaudRate)

	// Block until SIGTERM / SIGINT
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	log.Println("Smart Fan Agent stopping...")
}
