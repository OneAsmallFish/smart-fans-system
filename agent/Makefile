BINARY  = smart-fan-agent
BUILD   = build
CMD     = ./cmd/agent

.PHONY: all build test vet install clean

all: build

build:
	@mkdir -p $(BUILD)
	go build -o $(BUILD)/$(BINARY) $(CMD)
	@echo "Built: $(BUILD)/$(BINARY)"

test:
	go test ./... -v -count=1

vet:
	go vet ./...

install: build
	install -Dm755 $(BUILD)/$(BINARY) /usr/local/bin/$(BINARY)
	install -Dm644 config.yaml         /etc/smart-fan-agent/config.yaml
	install -Dm644 $(BINARY).service   /etc/systemd/system/$(BINARY).service
	systemctl daemon-reload
	@echo "Installed. Run: systemctl enable --now $(BINARY)"

clean:
	rm -rf $(BUILD)
