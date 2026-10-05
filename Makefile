# Telestrations: a Go (PocketBase) server with the Vue web app embedded in it.
# `make` builds the server binary, web app included; `make help` lists the rest.

BINARY := bin/telestrations
# Where the games are kept. A built PocketBase defaults to pb_data next to the
# binary (bin/pb_data); this keeps them at the repo root, as `go run` does.
DATA := pb_data
# Where `make run` listens: every interface, so phones on the Wi-Fi can join.
HTTP ?= 0.0.0.0:8090
# This machine's address on the local network (192.168.x.x and the like), the
# one other devices join at. Found from the interfaces; set it if it guesses wrong.
LAN_IP ?= $(shell { ip -4 -o addr show 2>/dev/null || ifconfig 2>/dev/null; } \
	| awk '{for (i = 1; i < NF; i++) if ($$i == "inet") print $$(i+1)}' \
	| sed 's/^addr://; s|/.*||' \
	| grep -E '^(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.' | head -1)
# `make dev-server dev-web LAN=1` (or each in its own terminal) opens the
# development servers to the network too; without it they stay on this machine.
LAN ?=

# The web app's npm tasks live in web/Makefile.
WEB := $(MAKE) --no-print-directory -C web

.DEFAULT_GOAL := build
.PHONY: help deps frontend build run lan-url dev-server dev-web test test-race e2e lint fmt clean

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-11s %s\n", $$1, $$2}'

deps: ## Install the web app's npm packages
	$(WEB) setup

# VITE_POCKETBASE_URL=/ points the app at whatever host served it, so one
# binary works on any address.
frontend: ## Build the web app into web/dist
	VITE_POCKETBASE_URL=/ $(WEB) build

build: frontend ## Build the server binary, with the web app embedded
	go build -o $(BINARY) ./cmd/telestrations

run: build lan-url ## Build everything and serve it on your network (HTTP=host:port)
	./$(BINARY) serve --dir $(DATA) --http $(HTTP)

lan-url: ## Print the address other devices on your network join at
	@if [ -n "$(LAN_IP)" ]; then \
		echo "Other devices on your network join at http://$(LAN_IP):$(lastword $(subst :, ,$(HTTP)))"; \
	else \
		echo "Couldn't find this machine's network address; set LAN_IP=..."; \
	fi

dev-server: ## Development backend on http://127.0.0.1:8090 (LAN=1: on your network)
	go run ./cmd/telestrations serve $(if $(LAN),--http 0.0.0.0:8090)

# On the network, the app on a phone must reach the backend at this machine's
# address, not its own 127.0.0.1.
dev-web: deps ## Development web app (Vite, live reload) against dev-server (LAN=1: on your network)
	$(if $(LAN),@echo "Other devices on your network join at http://$(LAN_IP):3000")
	$(if $(LAN),VITE_POCKETBASE_URL=http://$(LAN_IP):8090/ npm --prefix web run dev -- --host,$(WEB) dev)

test: ## Go tests
	go test ./...

test-race: ## Go tests under the race detector, as CI runs them
	go test -race -short ./...

e2e: ## Browser tests (Playwright; on NixOS use web/run-e2e.sh)
	$(WEB) e2e

lint: ## gofmt, go vet and ESLint, as CI runs them
	@unformatted=$$(gofmt -l cmd internal web/embed.go); \
		if [ -n "$$unformatted" ]; then echo "gofmt needed:"; echo "$$unformatted"; exit 1; fi
	go vet ./...
	$(WEB) check

fmt: ## Format the Go code
	gofmt -w cmd internal web/embed.go

# web/dist/index.html is committed so the server builds without a web build
# (the Go tests check it's embedded); building overwrites it, so put it back.
clean: ## Remove the binary and the web build
	rm -rf bin
	rm -rf web/dist/assets web/dist/version.json
	git checkout -- web/dist
