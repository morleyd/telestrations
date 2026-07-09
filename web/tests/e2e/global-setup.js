import { cpSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const src = path.join(repoRoot, 'pb_data')
const dst = path.join(repoRoot, '.e2e-pb-data')

// Seed the tests with a throwaway copy of the real schema + rules, so create/
// join flows run against a genuine backend without ever mutating pb_data.
export default function globalSetup() {
  if (!existsSync(src)) {
    throw new Error(`[e2e] pb_data not found at ${src} — run from the repo with a seeded backend.`)
  }
  rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true })
  console.log(`[e2e] seeded isolated backend data at ${dst}`)
}
