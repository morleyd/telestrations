#!/usr/bin/env bash
# Run the Playwright E2E suite on NixOS.
#
# Playwright's own downloaded browsers are dynamically linked against libs that
# don't exist at the expected paths on NixOS, so they won't launch. Instead we
# point Playwright at the nixpkgs-provided, patched browsers (whose version must
# match the @playwright/test version pinned in package.json — currently 1.60.0).
set -euo pipefail
cd "$(dirname "$0")"

# Realize (build/fetch) the nix browser bundle and use it.
export PLAYWRIGHT_BROWSERS_PATH="$(nix-build '<nixpkgs>' -A playwright-driver.browsers --no-out-link)"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# node (for playwright + vite) comes from the nix shell; `go` (for the backend
# web server) is already on PATH via the user's nix profile.
exec nix-shell -p nodejs --run "npx playwright test $*"
