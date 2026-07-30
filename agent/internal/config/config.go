// internal/config/config.go — 配置加载模块
package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the root configuration structure loaded from config.yaml.
type Config struct {
	MQTT    MQTTConfig    `yaml:"mqtt"`
	Serial  SerialConfig  `yaml:"serial"`
	Monitor MonitorConfig `yaml:"monitor"`
}

type MQTTConfig struct {
	Broker      string `yaml:"broker"`
	Port        int    `yaml:"port"`
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

// Load reads and parses the YAML config file at path.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("config: parse: %w", err)
	}
	return &cfg, nil
}
