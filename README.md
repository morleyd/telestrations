# Telestrations

A PocketBase (Go) backend with an embedded Vue/Vuetify frontend.

Admin account (PocketBase dashboard at `/_/`): `asdf@asdf.asdf` / `asdfasdfasdf`.

## Play on your local network

This builds everything into a single binary. It serves the API and the web app
from the same origin, so every device only needs one URL.

```sh
# 1. Build the frontend so it talks to whatever host served it
cd web && npm install && VITE_POCKETBASE_URL=/ npm run build && cd ..

# 2. Build the server (embeds web/dist) and listen on all interfaces
go build -o telestrations-server .
./telestrations-server serve --http 0.0.0.0:8090
```

Find your machine's LAN IP (macOS: `ipconfig getifaddr en0`). Then everyone opens
`http://<that-ip>:8090` on their own device, all on the same Wi-Fi. If macOS asks
whether to allow incoming connections, allow them.

Rebuild the frontend (step 1) and the binary (step 2) after any frontend change,
because the web app is embedded at build time.

## Tracing a game

Every browser sends its game events to the server (`/api/client-log`), and the
server records each turn as it's saved. All of it lands in the PocketBase
dashboard under **Logs** (`http://<ip>:8090/_/#/logs`). Useful filters:

- `data.game = "abcde"`: everything from every device in one game, by game code
- `data.user = "firefox"` or `data.browser = "safari"`: one player or one browser
- `level >= 4`: warnings and errors only

Most client entries (`client: ...`) carry a per-tab `session`, a `seq` number and
the device's own clock, so you can put each device's timeline back in order.
Look for these first:

- `turn: wrong type for position`: a drawing slot got text, or a guess slot got
  a drawing.
- `turn: out of rotation`: a turn was written to the wrong story. (A second
  write to the same place in a story is refused outright by a unique index.)
- `client: turn.submit.typeMismatch`, `client: progress.staleStory`: the client
  caught itself in an inconsistent state.
- `host: action` / `host: turn skipped`: the host skipped or dropped a player
  from the Manage players dialog, and which turns the server wrote for them.

## Host controls

During a game, the host has a **Manage players** button (the person-and-gear
icon in the top bar) on the turn and review screens. It lists every player and
how many stories are waiting on them.

- **Skip** writes the turns that player owes right now, passing the previous
  word or drawing on unchanged, so the next player isn't held up. The player
  keeps playing after that. If they hadn't written their opening word yet, a
  random one is picked.
- **Drop** does the same for the rest of the game. If they never wrote an
  opening word, their story is removed. If a story is somehow still waiting on
  a dropped player, the dialog offers **Skip** for them again.
- **End Game** ends it for everyone. Anyone in the middle of a turn gets 10
  seconds to finish it; when time's up, whatever they have is submitted (marked
  "⏱ Ran out of time" in the review), and everyone goes to the review.

Turns the host skipped are hidden on the review page. A skipped opening word is
the exception: it's shown with a "Skipped by the host" banner.

There are no accounts, so these controls (like the rest of the game) trust the
people on your network: they stop mistakes, not a determined cheat.

## Rounds

The **New Game** dialog sets how many rounds to play: how many times each story
goes around the group (one by default). **Infinite** keeps the stories going
around until the host uses **End Game**. (Timed rounds, below, are about how
long each turn lasts.)

## Timed rounds

When a player's timer runs out:

- **They'd started:** whatever they typed or drew is submitted as their turn.
- **They hadn't:** the turn is skipped like a host skip. The previous word or
  drawing passes on unchanged; an empty opening word gets a random one.

During the game these look like any other turn to the next player. The review
marks them: partial work gets a "⏱ Ran out of time" banner, and an empty turn
gets a "⏱ *name* ran out of time" slide.

## Development

Run each of these in its own terminal:

```sh
go run . serve                 # backend on http://127.0.0.1:8090
make -C web setup dev          # Vite dev server on http://localhost:3000
```

In dev, the frontend points at `http://127.0.0.1:8090/` unless you set
`VITE_POCKETBASE_URL`.

## Tests

- Browser E2E (Playwright): `cd web && npm run test:e2e`. See `web/tests/e2e/README.md`.
  `run-e2e.sh` is NixOS-specific; on other systems, run `npx playwright test`.
- Go: `go test ./...` tests the server against a throwaway PocketBase built
  from the migrations, through the real routes and guards: write races (two
  requests landing together), the refusal codes the client acts on, the
  rotation views, random whole games, migrations, skips and timeouts, the
  client log and static serving. `-short` skips the concurrent soaks and
  plays fewer random games; `MODEL_SEED=<n>` replays one random game; `-race`
  works too.
- Rotation soak test: see `sim/README.md`.

CI (`.github/workflows/ci.yml`) runs gofmt, `go vet`, ESLint, the Go tests and
the E2E suite on every PR and every push to master. The checks are advisory:
none is required, so a red check flags a problem without blocking the merge.
