// internal/monitor/system.go — 系统 CPU/内存/磁盘/温度采集器
// 纯 Go 实现（无 cgo），可交叉编译
package monitor

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const sysCollectorName = "system"

// SystemCollector collects host CPU, memory, disk, and temperature metrics.
type SystemCollector struct {
	prevTotal  uint64
	prevIdle   uint64
	lastSample time.Time
}

func NewSystemCollector() *SystemCollector {
	return &SystemCollector{}
}

func (s *SystemCollector) Name() string { return sysCollectorName }

func (s *SystemCollector) Collect() (*MetricBatch, error) {
	batch := newBatch(sysCollectorName)

	// CPU utilization (delta between two /proc/stat reads)
	if cpu, err := s.cpuUtilization(); err == nil {
		batch.Metrics["cpu_utilization_pct"] = cpu
	} else {
		log.Printf("[sys] cpu: %v", err)
	}

	// Memory (/proc/meminfo)
	if total, avail, err := readMeminfo(); err == nil {
		batch.Metrics["memory_total_kb"]  = float64(total)
		batch.Metrics["memory_avail_kb"]  = float64(avail)
		batch.Metrics["memory_used_pct"]  = float64(total-avail) / float64(total) * 100
	}

	// Disk usage (root partition)
	if used, total, err := diskUsage("/"); err == nil {
		batch.Metrics["disk_used_gb"]  = float64(used) / 1e9
		batch.Metrics["disk_total_gb"] = float64(total) / 1e9
	}

	// System load (/proc/loadavg)
	if load1, load5, load15, err := readLoadavg(); err == nil {
		batch.Metrics["load_1m"]  = load1
		batch.Metrics["load_5m"]  = load5
		batch.Metrics["load_15m"] = load15
	}

	// CPU temperature (/sys/class/thermal or /sys/class/hwmon)
	if temp, err := cpuTemperature(); err == nil {
		batch.Metrics["cpu_temp_c"] = temp
	}

	return batch, nil
}

// cpuUtilization computes CPU usage % since last call using /proc/stat.
func (s *SystemCollector) cpuUtilization() (float64, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			break
		}
		var vals [10]uint64
		for i := 1; i < len(fields) && i <= 10; i++ {
			vals[i-1], _ = strconv.ParseUint(fields[i], 10, 64)
		}
		idle := vals[3] + vals[4] // idle + iowait
		total := uint64(0)
		for _, v := range vals {
			total += v
		}
		if s.prevTotal == 0 {
			s.prevTotal = total
			s.prevIdle = idle
			return 0, nil
		}
		dTotal := total - s.prevTotal
		dIdle := idle - s.prevIdle
		s.prevTotal = total
		s.prevIdle = idle
		if dTotal == 0 {
			return 0, nil
		}
		return float64(dTotal-dIdle) / float64(dTotal) * 100, nil
	}
	return 0, fmt.Errorf("cpu line not found")
}

func readMeminfo() (total, avail uint64, err error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fmt.Sscanf(strings.Fields(line)[1], "%d", &total)
		} else if strings.HasPrefix(line, "MemAvailable:") {
			fmt.Sscanf(strings.Fields(line)[1], "%d", &avail)
		}
		if total > 0 && avail > 0 {
			break
		}
	}
	return total, avail, nil
}

func diskUsage(path string) (used, total uint64, err error) {
	var stat syscall.Statfs_t
	if err = syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}
	total = stat.Blocks * uint64(stat.Bsize)
	avail := stat.Bavail * uint64(stat.Bsize)
	return total - avail, total, nil
}

func readLoadavg() (load1, load5, load15 float64, err error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, err
	}
	_, err = fmt.Sscanf(string(data), "%f %f %f", &load1, &load5, &load15)
	return load1, load5, load15, err
}

func cpuTemperature() (float64, error) {
	// Try thermal_zone0 first (common Linux path)
	zones, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	for _, z := range zones {
		data, err := os.ReadFile(z)
		if err != nil {
			continue
		}
		raw := strings.TrimSpace(string(data))
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v > 0 {
			return v / 1000.0, nil // millidegrees → °C
		}
	}
	// Fallback: hwmon (some distros)
	hwmons, _ := filepath.Glob("/sys/class/hwmon/hwmon*/temp1_input")
	for _, h := range hwmons {
		data, err := os.ReadFile(h)
		if err != nil {
			continue
		}
		if v, err := strconv.ParseFloat(strings.TrimSpace(string(data)), 64); err == nil {
			return v / 1000.0, nil
		}
	}
	return 0, fmt.Errorf("cpu temperature not found")
}
