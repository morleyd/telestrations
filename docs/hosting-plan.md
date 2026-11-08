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

| Phase | Issue | What | Status |
|---|---|---|---|
| 2 | [#39](https://github.com/morleyd/telestrations/issues/39) | Update PocketBase and dependencies, scan them in CI | PR open |
| 2 | [#40](https://github.com/morleyd/telestrations/issues/40) | Public mode: admin from secrets, dashboard off | |
| 2 | [#41](https://github.com/morleyd/telestrations/issues/41) | A game's data is reachable only with its code | |
| 2 | [#42](https://github.com/morleyd/telestrations/issues/42) | Rate limits, size caps, the real client IP | |
| 2 | [#43](https://github.com/morleyd/telestrations/issues/43) | Delete games 48 h after they finish, or after 7 days idle | |
| 2 | [#44](https://github.com/morleyd/telestrations/issues/44) | Security headers, same-origin CORS | |
| 1 | [#38](https://github.com/morleyd/telestrations/issues/38) | Rename to Doodle Drift | |
| 3 | [#45](https://github.com/morleyd/telestrations/issues/45) | Play with bots | |
| 3 | [#46](https://github.com/morleyd/telestrations/issues/46) | A scripted GIF for the README | |
| 4 | [#47](https://github.com/morleyd/telestrations/issues/47) | Host on Fly.io (David deploys) | |
| 5 | [#48](https://github.com/morleyd/telestrations/issues/48) | README for visitors | |

Phase 2 goes first and in order: each PR builds on the one before. The rename
comes after it, so it renames the new code too.

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
- **Rate limits:** proposed in the limits PR.

## Out of scope

- Accounts, public galleries, or anything that keeps drawings past the game.
- Ads or payments.
- Hosting on David's own machines.
