// internal/config/config.go — 配置加载模块
// AG-06: 删除未用的 port 字段（合并进 broker URL）；校验 broker scheme。
package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config is the root configuration structure loaded from config.yaml.
type Config struct {
	MQTT    MQTTConfig    `yaml:"mqtt"`
	Serial  SerialConfig  `yaml:"serial"`
	Monitor MonitorConfig `yaml:"monitor"`
}

type MQTTConfig struct {
	Broker      string `yaml:"broker"`       // 完整 URL，含端口：mqtt://host:1883
	ClientID    string `yaml:"client_id"`
	TopicPrefix string `yaml:"topic_prefix"`
	Username    string `yaml:"username"`
	Password    string `yaml:"password"`
}

type SerialConfig struct {
	Port     string `yaml:"port"`
	BaudRate int    `yaml:"baud_rate"`
}

type MonitorConfig struct {
	IntervalSeconds int  `yaml:"interval"`
	GPUEnabled      bool `yaml:"gpu_enabled"`
}

// Load reads and parses the YAML config file at path and applies defaults.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("config: parse: %w", err)
	}

	applyDefaults(&cfg)
	if err := validate(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.MQTT.Broker == "" {
		cfg.MQTT.Broker = "mqtt://localhost:1883"
	}
	if cfg.MQTT.TopicPrefix == "" {
		cfg.MQTT.TopicPrefix = "fan-controller"
	}
	if cfg.MQTT.ClientID == "" {
		cfg.MQTT.ClientID = "smart-fan-agent"
	}
	if cfg.Serial.Port == "" {
		cfg.Serial.Port = "/dev/ttyACM0"
	}
	if cfg.Serial.BaudRate == 0 {
		cfg.Serial.BaudRate = 115200
	}
	if cfg.Monitor.IntervalSeconds <= 0 {
		cfg.Monitor.IntervalSeconds = 5
	}
}

func validate(cfg *Config) error {
	lower := strings.ToLower(cfg.MQTT.Broker)
	switch {
	case strings.HasPrefix(lower, "mqtt://"),
		strings.HasPrefix(lower, "mqtts://"),
		strings.HasPrefix(lower, "ws://"),
		strings.HasPrefix(lower, "wss://"):
		return nil
	default:
		return fmt.Errorf("config: broker URL must start with mqtt://, mqtts://, ws:// or wss:// (got %q)",
			cfg.MQTT.Broker)
	}
}
