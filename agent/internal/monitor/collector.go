// internal/monitor/collector.go — 统一采集器接口
package monitor

import "time"

// MetricBatch holds all metrics from one collector at one point in time.
type MetricBatch struct {
	CollectorName string            `json:"collector"`
	Timestamp     int64             `json:"timestamp"`
	Metrics       map[string]float64 `json:"metrics"`
}

// Collector is the common interface for all monitor backends.
type Collector interface {
	Name() string
	Collect() (*MetricBatch, error)
}

func newBatch(name string) *MetricBatch {
	return &MetricBatch{
		CollectorName: name,
		Timestamp:     time.Now().Unix(),
		Metrics:       make(map[string]float64),
	}
}
