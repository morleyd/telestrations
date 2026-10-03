import { createRouter, createWebHistory, START_LOCATION } from "vue-router";
import { log } from "@/services/log";

const routes = [
  {
    path: "/",
    component: () => import("@/pages/HomeScreen"),
    name: "Home",
  },
  {
    path: "/:gameCode([A-Z]{5})/draw",
    component: () => import("@/pages/TakeTurn"),
    name: "TakeTurn",
  },
  // Game code (5 case insensitive letters) sends users to waiting room
  {
    path: "/:gameCode([A-Z]{5})/review",
    component: () => import("@/pages/Review"),
    name: "Review",
  },
  // Game code (5 case insensitive letters) sends users to waiting room
  {
    path: "/:gameCode([A-Z]{5})",
    component: () => import("@/pages/WaitingRoom"),
    name: "WaitingRoom",
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import("@/pages/PageNotFound"),
    name: "PageNotFound",
  },
];

const router = createRouter({
  history: createWebHistory('/'), // base path also needs to be changed in /vite.config.mjs
  routes
});

// A tab keeps running whatever build it first loaded, since the app is a single
// page. After the server is rebuilt, that goes wrong in two ways:
//  - a page it hasn't loaded yet fails to load, because the chunk names are
//    content hashes and the old ones are gone. The player gets stuck, e.g. in
//    the waiting room after the host has started (onError below).
//  - a page it already loaded keeps running old code, bugs and all. The server
//    has no way to tell (beforeEach below).
// Either way, load the page fresh at the next page change: that picks up the
// new build. At most once per 10s, so a broken build can't reload in a loop.
const STALE_CHUNK_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i
const RELOAD_KEY = "reloadedForNewBuild"

function reloadInto(path, reason, details) {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // storage unavailable: still reload once
  }
  if (Date.now() - last < 10_000) {
    log.error("router.reload.giveUp", { to: path, reason, ...details })
    return false
  }
  log.warn("router.reload", { to: path, reason, ...details })
  log.flush({ beacon: true })
  window.location.assign(path)
  return true
}

// The server's build id, or "" if unknown (dev server, network trouble).
async function serverBuildId() {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 1500)
  try {
    const resp = await fetch("/version.json", { cache: "no-store", signal: abort.signal })
    return resp.ok ? String((await resp.json()).build || "") : ""
  } catch {
    return ""
  } finally {
    clearTimeout(timer)
  }
}

// Game codes are lowercase (see newGameCode in host.go), and the database
// compares them exactly. The routes take any case and the waiting room shows
// the code in capitals, so a code typed into the address bar as it's shown
// found no game: send it to the lowercase address.
router.beforeEach((to) => {
  const code = to.params.gameCode
  if (typeof code !== "string" || code === code.toLowerCase()) return true
  return { name: to.name, params: { ...to.params, gameCode: code.toLowerCase() }, query: to.query, hash: to.hash, replace: true }
})

router.beforeEach(async (to, from) => {
  if (from === START_LOCATION) return true // just loaded: already the newest build
  const build = await serverBuildId()
  const mine = import.meta.env.VITE_BUILD_ID
  if (build && build !== mine && reloadInto(to.fullPath, "newBuild", { build, mine })) {
    return false
  }
  return true
})

router.onError((err, to) => {
  const message = String(err?.message || err)
  if (STALE_CHUNK_RE.test(message)) reloadInto(to.fullPath, "staleChunk", { err: message })
});

export default router;
