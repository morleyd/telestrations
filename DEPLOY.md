# Deploying Doodle Drift

The game runs on [Fly.io](https://fly.io) as one small machine. It stops when
nobody is playing and starts on the next visit, with the games on a 1 GB
volume and the free `https://<app>.fly.dev` address. Everything here costs
little, but it does cost: Fly.io needs a payment card.

What's in the repo:

- `Dockerfile`: builds the web app and the server into one small image,
  which starts in public mode unless `PUBLIC_MODE` says otherwise. Fly
  builds it on its own machines, so you don't need Docker locally.
- `docker-entrypoint.sh`: starts the server in the image as its own user,
  not root.
- `fly.toml`: the machine, the volume, the health check, and the
  non-secret settings (public mode, Fly's client-address header).
- `web/tests/e2e/hosted.spec.js`: checks a deployed server from a browser.

## First deploy

1. **Install flyctl and sign in.** `brew install flyctl`, then
   `fly auth signup` (or `fly auth login`). Add a card in the dashboard when
   it asks.

2. **Create the app.** The name is the address: `doodle-drift.fly.dev`. If
   it's taken, pick another and change `app` in `fly.toml` to match.

   ```sh
   fly apps create doodle-drift
   ```

3. **Create the volume**, in the region `fly.toml` names (Denver):

   ```sh
   fly volumes create pb_data --region den --size 1
   ```

4. **Set the admin secrets.** Public mode won't start without them
   (README: Public mode). Make a long random password and keep it in your
   password manager:

   ```sh
   openssl rand -base64 24
   fly secrets set ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<that password>'
   ```

5. **Deploy:**

   ```sh
   fly deploy
   ```

   The first build takes a few minutes. `fly logs` shows PocketBase's
   `Server started` line, and no setup link. The game's own messages (the
   `public mode` line with the limits it's using, and what expiry deletes)
   aren't there: PocketBase prints those to the console only with `--dev`,
   so they're in the dashboard's logs (Day to day).

## Check it

- Open `https://doodle-drift.fly.dev`. The first visit after a quiet spell
  waits a few seconds while the machine starts.
- From the repo, in a browser, against the real server: its headers, a game
  against the bots (with a phone photo), and a two-device game, with no
  Content-Security-Policy violations:

  ```sh
  make -C web hosted URL=https://doodle-drift.fly.dev
  ```

  The checks play two games from your address, well inside the rate limits.
- Play a real game with two devices: your phone and a laptop, or a friend.

## Day to day

- **Redeploy** after merging: `fly deploy`.
- **Logs:** `fly logs` has the server starting, and an error that stops
  it. The game's own messages (public mode, expiry) are only in the
  dashboard's logs (below).
- **The PocketBase dashboard** is off (404) in public mode. To look at the
  logs or the data, turn it on, use it, and turn it off again (each change
  restarts the machine):

  ```sh
  fly secrets set ADMIN_DASHBOARD=1
  # https://doodle-drift.fly.dev/_/ , sign in with ADMIN_EMAIL / ADMIN_PASSWORD
  fly secrets unset ADMIN_DASHBOARD
  ```

- **Change the admin password:** `fly secrets set ADMIN_PASSWORD=...`. The
  server updates the superuser on its next start.
- **Limits:** `MAX_PLAYERS` (default 30) and `MAX_GAMES` (default 1000) can
  be set with `fly secrets set` or under `[env]` in `fly.toml`.
- **Backups:** Fly snapshots the volume daily and keeps the snapshots for 5
  days (`fly volumes snapshots list`). Games only live for 48 hours after
  they end anyway (README: Public mode), so there's little to lose.
- **A custom domain**, if you buy one: `fly certs add play.example.com`,
  then the DNS records it prints.

## What it costs

At Fly.io's prices when this was written: a `shared-cpu-1x` machine with
256 MB is about $2 a month if it ran all month, but it's stopped whenever
nobody is playing, and a stopped machine costs only a few cents for its disk. The 1 GB volume is about
$0.15 a month. The address is shared, which is free; don't allocate a
dedicated IPv4 (that's $2 a month). Check
[fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/) for today's
numbers, and set a spending alert in the dashboard.

## Taking it down

```sh
fly apps destroy doodle-drift
```

That deletes the machine, the volume and every game on it.
