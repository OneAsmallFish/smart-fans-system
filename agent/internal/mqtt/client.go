// internal/mqtt/client.go — MQTT 发布/订阅客户端
// 基于 paho.mqtt.golang，指数退避重连。
// AG-04: 订阅范围按协议 §11 —— fan-controller/+/sensor/# 与 +/alert
// （告警转发系统日志）；不再订阅 command/#（命令不经过 agent）。
package mqtt

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/user/smart-fan-agent/internal/config"
	"github.com/user/smart-fan-agent/internal/monitor"
)

// Client wraps the paho MQTT connection.
type Client struct {
	cfg         *config.Config
	hostname    string
	paho        pahomqtt.Client
	mu          sync.Mutex
	connected   bool
	onAlertLog  func(alertJSON string) // 告警转发（默认写系统日志）
}

// NewClient creates and connects a new MQTT client.
// hostname 用于发布 topic：system-monitor/{hostname}/sensor/{collector}（协议 §11）。
func NewClient(cfg *config.Config, hostname string) (*Client, error) {
	c := &Client{cfg: cfg, hostname: hostname}

	opts := pahomqtt.NewClientOptions()
	opts.AddBroker(cfg.MQTT.Broker)
	opts.SetClientID(cfg.MQTT.ClientID)
	opts.SetUsername(cfg.MQTT.Username)
	opts.SetPassword(cfg.MQTT.Password)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetCleanSession(true)
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(60 * time.Second)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(5 * time.Second)

	opts.SetOnConnectHandler(func(client pahomqtt.Client) {
		c.mu.Lock()
		c.connected = true
		c.mu.Unlock()
		log.Printf("[mqtt] connected to %s", cfg.MQTT.Broker)

		// AG-04: 订阅按协议 §11（sensor 全量 + 告警），无 command 订阅
		client.Subscribe(fmt.Sprintf("%s/+/sensor/#", cfg.MQTT.TopicPrefix), 0,
			func(_ pahomqtt.Client, msg pahomqtt.Message) {
				log.Printf("[sensor] %s", msg.Topic()) // 诊断用途（journal 可查）
			})
		client.Subscribe(fmt.Sprintf("%s/+/alert", cfg.MQTT.TopicPrefix), 1,
			func(_ pahomqtt.Client, msg pahomqtt.Message) {
				// 告警转发系统日志（协议 §11 对 agent 的定位）
				if c.onAlertLog != nil {
					c.onAlertLog(string(msg.Payload()))
				} else {
					log.Printf("[alert] %s %s", msg.Topic(), string(msg.Payload()))
				}
			})
	})

	opts.SetConnectionLostHandler(func(_ pahomqtt.Client, err error) {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		log.Printf("[mqtt] connection lost: %v", err)
	})

	c.paho = pahomqtt.NewClient(opts)
	token := c.paho.Connect()
	// AG-07: WaitTimeout 返回 false 表示超时；true 且 Error!=nil 才是失败
	if !token.WaitTimeout(30*time.Second) || token.Error() != nil {
		return nil, fmt.Errorf("mqtt connect: %w", token.Error())
	}
	return c, nil
}

// PublishMetrics publishes a MetricBatch from a collector.
// Topic: system-monitor/{hostname}/sensor/{collector}（AG-02/AG-04: 用 hostname，非 ClientID）
func (c *Client) PublishMetrics(batch *monitor.MetricBatch) error {
	if batch == nil {
		return nil
	}
	topic := fmt.Sprintf("system-monitor/%s/sensor/%s", c.hostname, batch.CollectorName)
	payload, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	token := c.paho.Publish(topic, 0, false, payload)
	token.Wait()
	return token.Error()
}

// SetAlertHandler registers a callback for alert payloads (system-log relay).
func (c *Client) SetAlertHandler(fn func(alertJSON string)) {
	c.onAlertLog = fn
}

// Disconnect cleanly closes the MQTT connection.
func (c *Client) Disconnect() {
	c.paho.Disconnect(500)
}

// IsConnected reports whether the MQTT connection is active.
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}
