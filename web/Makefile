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

# Records the README GIF's frames (tests/e2e/readme-gif.spec.js), into
# test-results/readme-gif.
.PHONY: readme-gif
readme-gif: setup
	RECORD_GIF=1 npx playwright test readme-gif.spec.js --retries=0

# Checks a deployed server (DEPLOY.md): make -C web hosted URL=https://...
# Without URL the spec would skip every test and pass, so that's an error.
.PHONY: hosted
hosted: setup
	@test -n "$(URL)" || { echo 'usage: make -C web hosted URL=https://...'; exit 1; }
	HOSTED_URL=$(URL) npx playwright test hosted.spec.js --retries=0
