// internal/mqtt/client.go — MQTT 发布/订阅客户端
// 基于 paho.mqtt.golang，指数退避重连，串口指令中继
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
	cfg        *config.Config
	paho       pahomqtt.Client
	mu         sync.Mutex
	connected  bool
	onCommand  func(topic, payload string)
}

// NewClient creates and connects a new MQTT client.
func NewClient(cfg *config.Config) (*Client, error) {
	c := &Client{cfg: cfg}

	opts := pahomqtt.NewClientOptions()
	opts.AddBroker(cfg.MQTT.Broker)
	opts.SetClientID(cfg.MQTT.ClientID)
	opts.SetUsername(cfg.MQTT.Username)
	opts.SetPassword(cfg.MQTT.Password)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetCleanSession(true)
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(60 * time.Second)

	opts.SetOnConnectHandler(func(client pahomqtt.Client) {
		c.mu.Lock()
		c.connected = true
		c.mu.Unlock()
		log.Printf("[mqtt] connected to %s", cfg.MQTT.Broker)

		// Subscribe to fan-controller commands
		topic := fmt.Sprintf("%s/+/command/#", cfg.MQTT.TopicPrefix)
		client.Subscribe(topic, 1, func(_ pahomqtt.Client, msg pahomqtt.Message) {
			if c.onCommand != nil {
				c.onCommand(msg.Topic(), string(msg.Payload()))
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
	if token.WaitTimeout(30*time.Second) && token.Error() != nil {
		return nil, fmt.Errorf("mqtt connect: %w", token.Error())
	}
	return c, nil
}

// PublishMetrics publishes a MetricBatch from a collector.
func (c *Client) PublishMetrics(batch *monitor.MetricBatch) error {
	if batch == nil {
		return nil
	}
	topic := fmt.Sprintf("system-monitor/%s/sensor/%s",
		c.cfg.MQTT.ClientID, batch.CollectorName)
	payload, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	token := c.paho.Publish(topic, 0, false, payload)
	token.Wait()
	return token.Error()
}

// SetCommandHandler registers a callback for received MQTT commands.
func (c *Client) SetCommandHandler(fn func(topic, payload string)) {
	c.onCommand = fn
}

// IsConnected reports whether the MQTT connection is active.
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}
