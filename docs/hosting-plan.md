# Hosting plan

Getting the game ready to host publicly, as a portfolio piece. Tracked in
[#50](https://github.com/morleyd/telestrations/issues/50), one issue per PR.
This file is the plan and its status; it changes as each PR lands.

## Ground rules

- Never rewrite history: no squashing, no force-pushing. Branches and PRs,
  conventional commits, small focused PRs.
- Anything that costs money, creates an account, publishes or deploys is
  David's to approve and to do. That includes renaming the GitHub repo,
  creating the hosting account, buying a domain, and the first deploy.
- Home-network play (`make run`) keeps working as it does today. Everything
  stricter switches on with public mode.

## Phases

| Phase | Issue | What | PR |
|---|---|---|---|
| 2 | [#39](https://github.com/morleyd/telestrations/issues/39) | Update PocketBase and dependencies, scan them in CI | [#51](https://github.com/morleyd/telestrations/pull/51) |
| 2 | [#40](https://github.com/morleyd/telestrations/issues/40) | Public mode: admin from secrets, dashboard off | [#52](https://github.com/morleyd/telestrations/pull/52) |
| 2 | [#41](https://github.com/morleyd/telestrations/issues/41) | A game's data is reachable only with its code | [#53](https://github.com/morleyd/telestrations/pull/53) |
| 2 | [#42](https://github.com/morleyd/telestrations/issues/42) | Rate limits, size caps, the real client IP | [#54](https://github.com/morleyd/telestrations/pull/54) |
| 2 | [#43](https://github.com/morleyd/telestrations/issues/43) | Delete games 48 h after they finish, or after 7 days idle | [#55](https://github.com/morleyd/telestrations/pull/55) |
| 2 | [#44](https://github.com/morleyd/telestrations/issues/44) | Security headers, same-origin CORS | [#56](https://github.com/morleyd/telestrations/pull/56) |
| 1 | [#38](https://github.com/morleyd/telestrations/issues/38) | Rename to Doodle Drift | [#57](https://github.com/morleyd/telestrations/pull/57) |
| 3 | [#45](https://github.com/morleyd/telestrations/issues/45) | Play with bots | [#58](https://github.com/morleyd/telestrations/pull/58) |
| 3 | [#46](https://github.com/morleyd/telestrations/issues/46) | A scripted GIF for the README | [#59](https://github.com/morleyd/telestrations/pull/59) |
| 4 | [#47](https://github.com/morleyd/telestrations/issues/47) | Host on Fly.io (David deploys) | [#60](https://github.com/morleyd/telestrations/pull/60) |
| 5 | [#48](https://github.com/morleyd/telestrations/issues/48) | README for visitors | [#61](https://github.com/morleyd/telestrations/pull/61) |

The PRs are stacked: each builds on the one before, in the order above, so
they merge in that order. Phase 2 went first, and the rename after it, so it
renamed the new code too.

## What's left for David

1. Merge the PRs in order, with merge commits.
2. Rename the GitHub repo to `doodle-drift` (see #57).
3. Deploy, following [DEPLOY.md](../DEPLOY.md), then
   `make -C web hosted URL=https://doodle-drift.fly.dev` and a two-device
   game.
4. Draw the logo; it goes where the old one was (see #57).
5. Set the repo's description and topics (see #61), and add the game to the
   portfolio site.

Not planned for now: [#49](https://github.com/morleyd/telestrations/issues/49),
turn alerts (browser notifications).

## Decisions

- **Name:** Doodle Drift. David draws the new logo; until then the header is
  text only.
- **Host:** Fly.io. One small machine that stops when idle, a small volume
  for `pb_data`, the free `*.fly.dev` address. No domain for now. No ads.
- **Game codes:** stay 5 letters, drawn from `crypto/rand`. With each game's
  data behind its code, lookups rate limited, and few games live at once,
  guessing a live code takes a very long time.
- **Dashboard:** off in public mode unless an env var turns it on.
- **Data lifetime:** a game is deleted 48 hours after it completes (every
  story has gone all the way round, or the host's End Game countdown has run
  out), or after 7 days without activity (an hour, for a game nobody
  started). Logs are kept for 2 days in public mode.
- **Text limits:** names up to 24 characters, prompts and guesses up to 200.
- **Players per game:** up to 30 by default, adjustable by env var.
- **Rate limits:** per address, generous enough for a party behind one home
  router (#54 lists them).
- **Bots:** server-side, drawing a dozen doodles in Go, guessing from word
  lists. No AI service, nothing that costs per game.
- **Expiry** is worked out from each game's own records rather than stored
  timestamps, and also runs when the server starts, since Fly.io stops it
  while idle.

## Out of scope

- Accounts, public galleries, or anything that keeps drawings past the game.
- Ads or payments.
- Hosting on David's own machines.
