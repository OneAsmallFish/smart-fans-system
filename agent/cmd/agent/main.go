// cmd/agent/main.go — Smart Fan Agent 入口
// 启动顺序: config → MQTT 连接(含重连) → monitor collectors 周期发布 →
//           (可选 --relay) USB-CDC 串口桥 → 信号处理优雅退出
// AG-02: 完成全部接线；AG-08: USB relay 为可选功能（--relay 显式开启）。
package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/user/smart-fan-agent/internal/config"
	"github.com/user/smart-fan-agent/internal/monitor"
	mqttclient "github.com/user/smart-fan-agent/internal/mqtt"
	"github.com/user/smart-fan-agent/internal/usb"
)

func main() {
	relayEnabled := flag.Bool("relay", false,
		"enable optional USB-CDC serial bridge to the device console (debug)")
	configPath := flag.String("config", "", "path to config.yaml (overrides SMART_FAN_CONFIG env)")
	flag.Parse()

	// Load configuration from config.yaml (flag > env > default)
	cfgPath := *configPath
	if cfgPath == "" {
		cfgPath = os.Getenv("SMART_FAN_CONFIG")
	}
	if cfgPath == "" {
		cfgPath = "/etc/smart-fan-agent/config.yaml"
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	hostname, err := os.Hostname()
	if err != nil {
		log.Fatalf("failed to get hostname: %v", err)
	}

	log.Printf("Smart Fan Agent starting — broker=%s hostname=%s serial=%s relay=%v",
		cfg.MQTT.Broker, hostname, cfg.Serial.Port, *relayEnabled)

	// MQTT client (auto-reconnect via paho options)
	mqttClient, err := mqttclient.NewClient(cfg, hostname)
	if err != nil {
		log.Fatalf("failed to connect MQTT: %v", err)
	}

	// Monitor collectors: system (always) + GPU (if available & enabled)
	collectors := []monitor.Collector{monitor.NewSystemCollector()}
	if cfg.Monitor.GPUEnabled {
		collectors = append(collectors, monitor.NewGPUCollector())
	}

	// Optional USB relay bridge (AG-08: off by default)
	var relay *usb.Relay
	if *relayEnabled {
		relay = usb.NewRelay(cfg.Serial.Port, cfg.Serial.BaudRate)
		go relay.ReadLoop() // Open() 内部有限次重试后报错退出
		log.Printf("[usb] relay bridge started on %s", cfg.Serial.Port)
	}

	// Periodic publish loop
	interval := time.Duration(cfg.Monitor.IntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				for _, col := range collectors {
					batch, err := col.Collect()
					if err != nil {
						log.Printf("[monitor] %s: %v", col.Name(), err)
						continue
					}
					if batch == nil {
						continue // collector disabled (e.g. no GPU)
					}
					if err := mqttClient.PublishMetrics(batch); err != nil {
						log.Printf("[mqtt] publish %s: %v", col.Name(), err)
					}
				}
			case <-stop:
				return
			}
		}
	}()

	// Block until SIGTERM / SIGINT — graceful shutdown
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	log.Println("Smart Fan Agent stopping...")
	close(stop)
	mqttClient.Disconnect()
	log.Println("Smart Fan Agent stopped")
}
