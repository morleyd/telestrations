# Telestrations game simulator / soak test

`sim.mjs` drives complete games through the real backend and checks that the
turn rotation never misroutes, drops, duplicates, or strands a player. It was
written to exercise the rotation-fix work (5–10+ player games) but scales to
50+ players.

It talks to the server over plain HTTP (PocketBase REST + the custom
`/api/games/{id}/begin` endpoint), faithfully reproducing the client flow in
`web/src/pages/TakeTurn.vue` and `web/src/services/pocketbase/index.js`:

create game → join N users → host `/begin` → every player seeds a word, then
draws / guesses in rotation until the game completes → results are read back and
validated.

## Requirements

- Node 18+ (uses the built-in global `fetch`, `FormData`, `Blob` — no npm install)
- A running server (see below)

## Running

Start the server (from the repo root):

```sh
go run . serve --http=127.0.0.1:8090
```

Then run the simulator against it:

```sh
# defaults: player counts 50,75 across all scenarios
BASE=http://127.0.0.1:8090 node sim/sim.mjs

# custom player counts
node sim/sim.mjs 3,5,10,30

# specific scenarios only
node sim/sim.mjs 10 orderly,concurrent
```

`BASE` defaults to `http://127.0.0.1:8090`.

Exit code is `0` only if every strict game run passes.

## Scenarios

Strict PASS/FAIL over each player count:

| scenario     | what it exercises                                                            |
|--------------|------------------------------------------------------------------------------|
| `orderly`    | players act one at a time in a rotating order (baseline)                      |
| `concurrent` | every player's turn-cycle fires in parallel each round (race hunt)           |
| `shuffled`   | host drags players into a random seating order before `/begin`               |
| `straggler`  | one player is omitted from the host's `/begin` order (late joiner)           |
| `refresh`    | mid-game, players re-fetch their record and re-enter their turn cycle        |
|              | (simulates a page refresh / rejoin) — must not duplicate stories or turns    |
| `predelete`  | host removes players in the waiting room before `/begin` (the supported flow)|

Plus one exploratory probe (reports behavior; not a strict pass/fail):

- **mid-game deletion** — attempts to delete players at several rotation
  positions after play has started. The backend refuses every one (story
  starters are pinned by the required `starter_id` FK; all players are also
  referenced by the `progress`/`results` views), so in-progress games can't be
  corrupted by deletion.

## What every game run validates

Ground truth is read back from the DB (`users`, `stories`, `results` view):

- **positions** form a clean `0..N-1` permutation after `/begin`
- **one story per player**, N stories total
- **each story has exactly N turns**, one from every distinct player (no dup, no gap)
- **rotation is correct**: the player at turn *k* of a story started at position *s*
  is always at position `(s + k) % N` — this is the misroute check
- **word/drawing alternation**: even turns are words, odd turns are drawings
- **each player takes exactly N turns**; `N × N` turns total
- **no HTTP errors** during the run

## Notes

- Drawing turns upload a real 1×1 PNG through the multipart turn endpoint, so the
  file field and the `results` view URL resolution are exercised too.
- The harness is stateless per player step (it re-derives state from the server
  every cycle), which is why the `refresh`/rejoin scenario is a no-op to add.
- Runtime scales with N² (a 50-player game plays 2,500 turns). Concurrent stages
  at 75 players take a few minutes.
