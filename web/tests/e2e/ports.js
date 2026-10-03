import process from 'node:process'

// The ports the suite's backend and frontend run on (see playwright.config.js).
// E2E_PB_PORT and E2E_WEB_PORT move them, so two checkouts can run the suite at
// once. A setting that isn't a port stops the run, rather than leave the
// servers and the tests on different ports.
function port(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number, not "${value}"`)
  return n
}

export const PB_PORT = port('E2E_PB_PORT', 8091)
export const WEB_PORT = port('E2E_WEB_PORT', 5199)
