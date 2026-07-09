import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dst = path.resolve(__dirname, '../../..', '.e2e-pb-data')

export default function globalTeardown() {
  rmSync(dst, { recursive: true, force: true })
}
