// internal/usb/relay.go — USB-CDC 串口桥（可选功能，默认关闭）
// 定位：调试用途——向设备 USB-CDC console 发送命令、读取 JSON 响应行。
// 固件 console 不主动上报遥测数据；正常遥测走 MQTT（协议 §11）。
// AG-08: Open() 有限次重试后返回错误，不再无限阻塞。
package usb

import (
	"bufio"
	"fmt"
	"log"
	"time"

	"go.bug.st/serial"
)

const openMaxRetries = 5 // AG-08: 有限次重试

// Relay manages a serial port connection to the ESP32 USB-CDC console.
type Relay struct {
	portPath string
	baudRate int
	port     serial.Port
	onLine   func(line string) // callback for each line received
}

// NewRelay creates a relay; actual connection happens on Open().
func NewRelay(portPath string, baudRate int) *Relay {
	return &Relay{portPath: portPath, baudRate: baudRate}
}

// Open establishes the serial connection with bounded exponential backoff.
// 重试 openMaxRetries 次后返回最后一次错误。
func (r *Relay) Open() error {
	mode := &serial.Mode{BaudRate: r.baudRate}
	var lastErr error
	for attempt := 0; attempt < openMaxRetries; attempt++ {
		port, err := serial.Open(r.portPath, mode)
		if err == nil {
			r.port = port
			log.Printf("[usb] opened %s at %d baud", r.portPath, r.baudRate)
			return nil
		}
		lastErr = err
		delay := time.Duration(1<<uint(attempt)) * time.Second
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		log.Printf("[usb] open %s failed (%d/%d): %v — retry in %v",
			r.portPath, attempt+1, openMaxRetries, err, delay)
		time.Sleep(delay)
	}
	return fmt.Errorf("usb: open %s after %d attempts: %w",
		r.portPath, openMaxRetries, lastErr)
}

// SetLineHandler registers a callback that receives each newline-terminated line.
func (r *Relay) SetLineHandler(fn func(line string)) { r.onLine = fn }

// ReadLoop continuously reads lines from the serial port and calls onLine.
// Reconnects automatically on error（重连同样受 Open() 重试上限约束，
// 连续失败则记录错误并退出循环）。
func (r *Relay) ReadLoop() {
	for {
		if r.port == nil {
			if err := r.Open(); err != nil {
				log.Printf("[usb] giving up reconnect: %v", err)
				return
			}
		}
		scanner := bufio.NewScanner(r.port)
		for scanner.Scan() {
			line := scanner.Text()
			if line != "" && r.onLine != nil {
				r.onLine(line)
			}
		}
		log.Printf("[usb] read error: %v — reconnecting", scanner.Err())
		r.port.Close()
		r.port = nil
		time.Sleep(2 * time.Second)
	}
}

// SendCommand writes a JSON command followed by newline to the device console.
func (r *Relay) SendCommand(jsonCmd string) error {
	if r.port == nil {
		return fmt.Errorf("serial port not open")
	}
	_, err := fmt.Fprintf(r.port, "%s\n", jsonCmd)
	return err
}
