# End-to-end tests (Playwright)

Smoke tests that drive a real browser against the real frontend **and** a real
PocketBase backend, covering the flows that break a game night: creating a game
(timed and untimed), round-duration validation, and a second player joining.

## Running

From `web/`:

```bash
./run-e2e.sh            # whole suite
./run-e2e.sh home.spec  # a single file
npm run test:e2e        # same as ./run-e2e.sh (if you're already in a node shell)
```

`run-e2e.sh` is the entry point because of two NixOS specifics it handles for you:

- **Browsers come from nixpkgs.** Playwright's own downloaded browsers are
  dynamically linked and won't launch on NixOS, so the script points
  `PLAYWRIGHT_BROWSERS_PATH` at `playwright-driver.browsers`. That Nix package's
  version must match the `@playwright/test` version in `package.json`
  (currently **1.60.0** — bump them together).
- **node/go come from the environment.** The script runs Playwright inside
  `nix-shell -p nodejs`; `go` (for the backend) is picked up from your Nix
  profile on `PATH`.

## What it spins up

`playwright.config.js` starts two servers automatically (test ports, torn down
after):

- **Backend** — `go run . serve` against `.e2e-pb-data`, a throwaway copy of
  `pb_data` created by `global-setup.js`. Tests run against genuine collections
  and API rules but **never touch your real `pb_data`**.
- **Frontend** — Vite, pointed at the test backend via `VITE_POCKETBASE_URL`.

No dev servers need to be running first; if you already have something on the
default ports it won't collide (tests use 8091 / 5199).
