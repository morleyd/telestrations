# The web app's npm tasks. The root Makefile calls these (make -C web ...).

.PHONY: setup
setup:
	npm install

.PHONY: dev
dev:
	npm run dev

# Serves the last build (web/dist) on its own, without the Go server.
.PHONY: serve
serve:
	npm run preview

.PHONY: build
build: setup
	npm run build

# Fixes what it can.
.PHONY: lint
lint:
	npm run lint

# Changes nothing; fails on any error, as CI does.
.PHONY: check
check:
	npx eslint . --quiet

# Not `npm run test:e2e`, which wraps the NixOS-only run-e2e.sh.
.PHONY: e2e
e2e: setup
	npx playwright test
