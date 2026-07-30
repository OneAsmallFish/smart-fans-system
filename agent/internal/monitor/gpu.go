// internal/monitor/gpu.go — nvidia-smi GPU 采集器
// 无GPU时优雅降级（不崩溃，日志警告后跳过）
package monitor

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const gpuCollectorName = "gpu"

// GPUCollector uses nvidia-smi to collect GPU metrics.
type GPUCollector struct {
	available bool // set to false if nvidia-smi not found or no GPU
}

// NewGPUCollector creates a GPU collector; disables itself gracefully if no GPU.
func NewGPUCollector() *GPUCollector {
	c := &GPUCollector{}
	if _, err := exec.LookPath("nvidia-smi"); err != nil {
		log.Printf("[gpu] nvidia-smi not found, GPU monitoring disabled")
		return c
	}
	// Quick probe: check exit code
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := exec.CommandContext(ctx, "nvidia-smi", "-L").Run(); err != nil {
		log.Printf("[gpu] nvidia-smi probe failed: %v — GPU monitoring disabled", err)
		return c
	}
	c.available = true
	log.Printf("[gpu] nvidia-smi available, GPU monitoring enabled")
	return c
}

func (g *GPUCollector) Name() string { return gpuCollectorName }

func (g *GPUCollector) Collect() (*MetricBatch, error) {
	if !g.available {
		return nil, nil // graceful: no GPU, return nil (caller skips)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Query: temperature, utilization, memory used/total, power draw, fan speed
	args := []string{
		"--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,fan.speed",
		"--format=csv,noheader,nounits",
	}
	out, err := exec.CommandContext(ctx, "nvidia-smi", args...).Output()
	if err != nil {
		// Don't disable permanently on transient errors
		return nil, fmt.Errorf("nvidia-smi: %w", err)
	}

	batch := newBatch(gpuCollectorName)
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, line := range lines {
		fields := strings.Split(line, ", ")
		if len(fields) < 6 {
			continue
		}
		prefix := fmt.Sprintf("gpu%d.", i)
		names := []string{"temperature_c", "utilization_pct", "memory_used_mb",
			"memory_total_mb", "power_w", "fan_speed_pct"}
		for j, name := range names {
			if j < len(fields) {
				if v, err := strconv.ParseFloat(strings.TrimSpace(fields[j]), 64); err == nil {
					batch.Metrics[prefix+name] = v
				}
			}
		}
	}
	return batch, nil
}
