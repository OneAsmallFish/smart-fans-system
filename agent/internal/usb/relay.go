// internal/usb/relay.go — USB-CDC 双向串口中继
// 读取 ESP32 JSON 上报数据 → 转发至 MQTT；接收 MQTT 指令 → 写入串口
package usb

import (
	"bufio"
	"fmt"
	"log"
	"time"

	"go.bug.st/serial"
)

// Relay manages a serial port connection to the ESP32 USB-CDC interface.
type Relay struct {
	portPath string
	baudRate int
	port     serial.Port
	onLine   func(line string) // callback for each JSON line received
}

// NewRelay creates a relay; actual connection happens on Open().
func NewRelay(portPath string, baudRate int) *Relay {
	return &Relay{portPath: portPath, baudRate: baudRate}
}

// Open establishes the serial connection with exponential backoff retry.
func (r *Relay) Open() error {
	mode := &serial.Mode{BaudRate: r.baudRate}
	for attempt := 0; ; attempt++ {
		port, err := serial.Open(r.portPath, mode)
		if err == nil {
			r.port = port
			log.Printf("[usb] opened %s at %d baud", r.portPath, r.baudRate)
			return nil
		}
		delay := time.Duration(1<<uint(attempt)) * time.Second
		if delay > 60*time.Second {
			delay = 60 * time.Second
		}
		log.Printf("[usb] open %s failed: %v — retry in %v", r.portPath, err, delay)
		time.Sleep(delay)
	}
}

// SetLineHandler registers a callback that receives each newline-terminated JSON line.
func (r *Relay) SetLineHandler(fn func(line string)) { r.onLine = fn }

// ReadLoop continuously reads lines from the serial port and calls onLine.
// Reconnects automatically on error.
func (r *Relay) ReadLoop() {
	for {
		if r.port == nil {
			if err := r.Open(); err != nil {
				continue
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

// SendCommand writes a JSON command followed by newline to the ESP32.
func (r *Relay) SendCommand(jsonCmd string) error {
	if r.port == nil {
		return fmt.Errorf("serial port not open")
	}
	_, err := fmt.Fprintf(r.port, "%s\n", jsonCmd)
	return err
}
