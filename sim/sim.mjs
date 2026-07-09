// Telestrations full-game simulation harness.
//
// Faithfully mirrors the client flow in web/src/pages/TakeTurn.vue and the
// pbService calls in web/src/services/pocketbase/index.js, driving N players
// through a complete game against the real PocketBase backend, then validates
// rotation / routing correctness.
//
// Scenarios (strict PASS/FAIL over the size list):
//   orderly     players act one-at-a-time in a rotating order
//   concurrent  every player's turn-cycle fires in parallel each round (race hunt)
//   shuffled    host drags players into a random seating order before /begin
//   straggler   one player is omitted from the host's /begin order (late joiner)
//   refresh     mid-game each player re-fetches their record and re-enters their
//               turn cycle (simulates a page refresh / rejoin) — must not create
//               duplicate stories or turns, must resume at the right spot
//   predelete   host removes players in the waiting room before /begin (supported
//               "leave party" flow); the reduced roster must still play cleanly
//
// Separate exploratory probe (reports behavior, not a strict pass/fail):
//   midkill     a player is deleted MID-game — observe whether the game completes,
//               deadlocks, or corrupts (this path has no in-app UI; it stresses
//               the rotation math when total_players changes underneath it)

const BASE = process.env.BASE || "http://127.0.0.1:8090";

// 1x1 transparent PNG for "drawing" turns.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYE0k9kAAAAASUVORK5CYII=";
const PNG_BYTES = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));

const enc = encodeURIComponent;
let REQ = 0;
let ERRORS = [];

async function api(path, opts = {}) {
  REQ++;
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = `HTTP ${res.status} ${opts.method || "GET"} ${path} -> ${text.slice(0, 200)}`;
    ERRORS.push(msg);
    return { __err: true, status: res.status, body };
  }
  return body;
}

const jpost = (path, obj) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });

// getFirstListItem equivalent: returns first record or null.
async function first(collection, filter) {
  const r = await api(
    `/api/collections/${collection}/records?perPage=1&filter=${enc(filter)}`
  );
  if (r.__err) return null;
  return r.items && r.items.length ? r.items[0] : null;
}

async function fullList(collection, filter, sort = "") {
  let items = [];
  let page = 1;
  for (;;) {
    let q = `/api/collections/${collection}/records?perPage=200&page=${page}&filter=${enc(filter)}`;
    if (sort) q += `&sort=${enc(sort)}`;
    const r = await api(q);
    if (r.__err) break;
    items = items.concat(r.items);
    if (page >= r.totalPages) break;
    page++;
  }
  return items;
}

async function count(collection, filter) {
  const r = await api(
    `/api/collections/${collection}/records?perPage=1&filter=${enc(filter)}`
  );
  if (r.__err) return 0;
  return r.totalItems;
}

function shuffle(arr, seed) {
  // deterministic shuffle driven by a seed so runs are reproducible without
  // Math.random (which the harness environment forbids).
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- setup ---------------------------------------------------------------

let GAME_SEQ = 0;
async function createGame(n) {
  const code = "g" + Date.now().toString(36) + "x" + (GAME_SEQ++).toString(36);
  const game = await jpost("/api/collections/games/records", {
    game_code: code,
    roundDuration: -1,
  });
  const users = [];
  for (let i = 0; i < n; i++) {
    const u = await jpost("/api/collections/users/records", {
      username: `p${i}`,
      avatar: "a",
      color: "#123456",
      game_id: game.id,
      is_host: i === 0,
    });
    users.push(u);
  }
  return { code: game.game_code, game, users };
}

const begin = (gameId, order) => jpost(`/api/games/${gameId}/begin`, { order });
async function deleteUser(id) {
  REQ++;
  const res = await fetch(`${BASE}/api/collections/users/records/${id}`, { method: "DELETE" });
  return { ok: res.ok, status: res.status };
}

// --- turn submission (mirrors saveResponse) -----------------------------

async function createTurn(userId, storyId, gameId, isDraw, seed) {
  const fd = new FormData();
  fd.append("user_id", userId);
  fd.append("story_id", storyId);
  fd.append("game_id", gameId);
  if (isDraw) {
    fd.append("drawing", new Blob([PNG_BYTES], { type: "image/png" }), "d.png");
    fd.append("prompt", "");
  } else {
    fd.append("drawing", "");
    fd.append("prompt", seed);
  }
  fd.append("is_drawing", String(isDraw));
  return api("/api/collections/turns/records", { method: "POST", body: fd });
}

// One player's "getTurns" cycle (mirrors TakeTurn.getTurns / queryMorePrompts).
// Returns number of turns submitted this cycle.
async function playerStep(user, gameId, totalUsers, state) {
  if (state.finished.has(user.id)) return 0;

  // 1. Own story?
  let story = await first(
    "stories",
    `starter_id="${user.id}"&&game_id="${gameId}"`
  );
  if (!story) {
    story = await jpost("/api/collections/stories/records", {
      starter_id: user.id,
      game_id: gameId,
    });
    await createTurn(user.id, story.id, gameId, false, `seed-${user.username}`);
    return 1;
  }
  // 1.5 Did they take their first turn on their own story?
  const ownTurn = await first(
    "turns",
    `user_id="${user.id}"&&story_id="${story.id}"`
  );
  if (!ownTurn) {
    await createTurn(user.id, story.id, gameId, false, `seed-${user.username}`);
    return 1;
  }

  // 2/3. Finished all stories?
  const myTurns = await count("turns", `user_id="${user.id}"`);
  if (myTurns >= totalUsers) {
    state.finished.add(user.id);
    return 0;
  }

  // 4/5. Stories currently waiting on me.
  const nexts = await fullList("progress", `next_user_id="${user.id}"`);
  let did = 0;
  for (const row of nexts) {
    const isDraw = Boolean(row.prev_prompt); // prev was a word -> I draw
    await createTurn(user.id, row.story_id, gameId, isDraw, `guess-${user.username}`);
    did++;
  }
  return did;
}

// Simulate a page refresh / rejoin: the client reloads and restores the user
// from the server via getUser(username, gameId), then re-enters getTurns. This
// re-derives all state from scratch and must not create duplicate stories/turns.
async function refreshAndStep(user, gameId, totalUsers, state) {
  const fresh = await first(
    "users",
    `game_id="${gameId}"&&username="${user.username}"`
  );
  const u = fresh || user; // fresh should always exist
  return playerStep(u, gameId, totalUsers, state);
}

// --- validation ----------------------------------------------------------

async function validate(gameId) {
  const problems = [];
  const roster = await fullList("users", `game_id="${gameId}"`, "position");
  const n = roster.length;
  const posById = Object.fromEntries(roster.map((u) => [u.id, u.position]));

  // positions are a permutation 0..n-1
  const positions = roster.map((u) => u.position).sort((a, b) => a - b);
  const expected = Array.from({ length: n }, (_, i) => i);
  if (JSON.stringify(positions) !== JSON.stringify(expected)) {
    problems.push(`positions not a 0..${n - 1} permutation: ${JSON.stringify(positions)}`);
  }

  // one story per user
  const stories = await fullList("stories", `game_id="${gameId}"`);
  if (stories.length !== n) {
    problems.push(`expected ${n} stories, got ${stories.length} (duplicate/orphan?)`);
  }

  // per-story: exactly n turns, all users once, correct rotation + alternation
  let totalTurns = 0;
  for (const s of stories) {
    if (posById[s.starter_id] === undefined) {
      problems.push(`story has starter not in roster (orphaned by deletion)`);
      continue;
    }
    const results = await fullList("results", `starter_id="${s.starter_id}"`, "turn_number");
    totalTurns += results.length;
    const starterPos = posById[s.starter_id];
    if (results.length !== n) {
      problems.push(`story pos ${starterPos}: expected ${n} turns, got ${results.length}`);
      continue;
    }
    const seenUsers = new Set();
    for (let k = 0; k < n; k++) {
      const row = results.find((r) => Number(r.turn_number) === k);
      if (!row) {
        problems.push(`story pos ${starterPos}: missing turn_number ${k}`);
        continue;
      }
      seenUsers.add(row.turn_user_id);
      const actualPos = posById[row.turn_user_id];
      const wantPos = (starterPos + k) % n;
      if (actualPos !== wantPos) {
        problems.push(`story pos ${starterPos}, turn ${k}: player pos ${actualPos}, expected ${wantPos} (MISROUTE)`);
      }
      const isDraw = Boolean(row.drawing);
      const wantDraw = k % 2 === 1;
      if (isDraw !== wantDraw) {
        problems.push(`story pos ${starterPos}, turn ${k}: is_drawing=${isDraw}, expected ${wantDraw}`);
      }
    }
    if (seenUsers.size !== n) {
      problems.push(`story pos ${starterPos}: only ${seenUsers.size}/${n} distinct players (duplicate/misroute)`);
    }
  }

  // each user took exactly n turns
  for (const u of roster) {
    const c = await count("turns", `user_id="${u.id}"`);
    if (c !== n) problems.push(`user pos ${posById[u.id]} took ${c} turns, expected ${n}`);
  }
  if (totalTurns !== n * n) {
    problems.push(`total turns ${totalTurns}, expected ${n * n}`);
  }
  return { problems, n };
}

// --- driver --------------------------------------------------------------

async function drive(users, gameId, n, { concurrent = false, refresh = false } = {}) {
  const state = { finished: new Set() };
  let rounds = 0;
  const maxRounds = n * n * 4 + 100;
  for (;;) {
    rounds++;
    let progressed = 0;
    const actors = shuffle(users, rounds + n);
    const step = (u) =>
      refresh && (rounds + u.position) % 3 === 0
        ? refreshAndStep(u, gameId, n, state)
        : playerStep(u, gameId, n, state);
    if (concurrent) {
      const counts = await Promise.all(actors.map(step));
      progressed = counts.reduce((a, b) => a + b, 0);
    } else {
      for (const u of actors) progressed += await step(u);
    }
    if (state.finished.size === n) break;
    if (progressed === 0) break; // deadlock guard
    if (rounds > maxRounds) break;
  }
  return { finished: state.finished.size, rounds };
}

async function playGame(nCreate, scenario) {
  const t0 = Date.now();
  const errBefore = ERRORS.length;
  const { code, game, users } = await createGame(nCreate);

  // Pre-begin host actions.
  let roster = users;
  if (scenario === "predelete") {
    // Host removes two non-host players in the waiting room ("Leave Party").
    const toKill = users.filter((u) => !u.is_host).slice(0, Math.min(2, nCreate - 2));
    for (const u of toKill) await deleteUser(u.id);
    roster = await fullList("users", `game_id="${game.id}"`, "created");
  }

  let order = roster.map((u) => u.id);
  if (scenario === "shuffled") order = shuffle(order, nCreate * 7 + 1);
  else if (scenario === "straggler") order = shuffle(order, nCreate * 13 + 3).slice(0, roster.length - 1);

  const beginResp = await begin(game.id, order);

  const n = roster.length;
  const { finished, rounds } = await drive(roster, game.id, n, {
    concurrent: scenario === "concurrent" || scenario === "refresh",
    refresh: scenario === "refresh",
  });

  const { problems } = await validate(game.id);
  const httpErrors = ERRORS.slice(errBefore);
  return {
    label: `${nCreate}→${n}p | ${scenario}`,
    n,
    code,
    rounds,
    finished,
    ms: Date.now() - t0,
    reqs: REQ,
    beginErr: beginResp.__err ? beginResp.body : null,
    httpErrors,
    problems,
    ok: problems.length === 0 && httpErrors.length === 0 && finished === n,
  };
}

// Mid-game deletion probe. Once a game is underway, PocketBase refuses to
// delete players: story starters are pinned by the required starter_id FK, and
// EVERY player is also referenced by the progress/results views (as
// next_user_id / prev_user_id / turn_user_id), which the delete cascade scans.
// So we attempt to delete players at several rotation positions mid-game, expect
// each to be refused, and confirm the game still finishes perfectly intact.
async function probeMidGameDeletion(n) {
  const { game, users } = await createGame(n);
  await begin(game.id, users.map((u) => u.id));
  const state = { finished: new Set() };
  // Warm up so stories + turns + view rows all exist.
  for (let r = 0; r < 3; r++)
    for (const u of shuffle(users, r + 1)) await playerStep(u, game.id, n, state);

  const roster = await fullList("users", `game_id="${game.id}"`, "position");
  const targets = [0, Math.floor(n / 2), n - 1].map((p) => roster.find((u) => u.position === p));
  const attempts = [];
  for (const t of targets) {
    const del = await deleteUser(t.id);
    attempts.push({ pos: t.position, status: del.status, deleted: del.ok });
  }

  // Finish the (still-complete) game and confirm integrity.
  await drive(roster, game.id, n, {});
  const rosterAfter = await fullList("users", `game_id="${game.id}"`);
  const { problems } = await validate(game.id);
  return {
    n,
    attempts,
    anyDeleted: attempts.some((a) => a.deleted),
    rosterIntact: rosterAfter.length === n,
    brokenStories: problems.length,
  };
}

// --- runner --------------------------------------------------------------

async function main() {
  const sizes = (process.argv[2] || "50,75").split(",").map(Number);
  const scenarios = (process.argv[3] ||
    "orderly,concurrent,shuffled,straggler,refresh,predelete").split(",");
  console.log(`Player counts: ${sizes.join(", ")}`);
  console.log(`Scenarios: ${scenarios.join(", ")}\n`);
  const summary = [];
  for (const n of sizes) {
    for (const sc of scenarios) {
      REQ = 0;
      const r = await playGame(n, sc);
      summary.push(r);
      console.log(
        `[${r.label.padEnd(22)}] ${r.ok ? "PASS ✅" : "FAIL ❌"}  ` +
          `finished ${r.finished}/${r.n}  rounds=${r.rounds}  ${String(r.ms).padStart(6)}ms  ${r.reqs} reqs`
      );
      if (r.beginErr) console.log(`   begin error:`, JSON.stringify(r.beginErr));
      for (const p of r.problems.slice(0, 15)) console.log(`   ⚠️  ${p}`);
      if (r.problems.length > 15) console.log(`   ... +${r.problems.length - 15} more problems`);
      for (const e of r.httpErrors.slice(0, 8)) console.log(`   🌐 ${e}`);
      if (r.httpErrors.length > 8) console.log(`   ... +${r.httpErrors.length - 8} more http errors`);
    }
    console.log();
  }

  // Mid-game deletion probe (exploratory — reports behavior).
  console.log("----- mid-game player deletion probe (exploratory) -----");
  for (const n of sizes.filter((s) => s <= 50)) {
    REQ = 0;
    const p = await probeMidGameDeletion(n);
    const attemptStr = p.attempts
      .map((a) => `pos ${a.pos}→HTTP ${a.status}${a.deleted ? " DELETED" : ""}`)
      .join(", ");
    console.log(
      `[${n}p] delete attempts mid-game: ${attemptStr}\n` +
        `   → all refused=${!p.anyDeleted ? "yes ✅" : "NO ⚠️"}  roster intact=${p.rosterIntact}  ` +
        `game finished with ${p.brokenStories === 0 ? "0 broken stories ✅" : p.brokenStories + " BROKEN ⚠️"}`
    );
  }
  console.log(
    "   takeaway: once a game is underway the backend refuses every player delete —\n" +
    "   story starters are pinned by the required starter_id FK, and all players are\n" +
    "   referenced by the progress/results views (next/prev/turn_user). In-progress\n" +
    "   games therefore can't be corrupted by deletion, and the app offers no mid-game leave.\n"
  );

  const allOk = summary.every((r) => r.ok);
  const passed = summary.filter((r) => r.ok).length;
  console.log(`===== ${passed}/${summary.length} strict game runs passed — ${allOk ? "ALL PASS ✅" : "FAILURES PRESENT ❌"} =====`);
  process.exit(allOk ? 0 : 1);
}

main();
