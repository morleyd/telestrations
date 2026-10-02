# Telestrations: a Go (PocketBase) server with the Vue web app embedded in it.
# `make` builds the server binary, web app included; `make help` lists the rest.

BINARY := bin/telestrations
# Where the games are kept. A built PocketBase defaults to pb_data next to the
# binary (bin/pb_data); this keeps them at the repo root, as `go run` does.
DATA := pb_data
# Where `make run` listens: every interface, so phones on the Wi-Fi can join.
HTTP ?= 0.0.0.0:8090

# The web app's npm tasks live in web/Makefile.
WEB := $(MAKE) --no-print-directory -C web

.DEFAULT_GOAL := build
.PHONY: help deps frontend build run dev-server dev-web test test-race e2e lint fmt clean

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

run: build ## Build everything and serve it on your network (HTTP=host:port)
	./$(BINARY) serve --dir $(DATA) --http $(HTTP)

dev-server: ## Development backend on http://127.0.0.1:8090
	go run ./cmd/telestrations serve

dev-web: deps ## Development web app (Vite, live reload) against dev-server
	$(WEB) dev

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
