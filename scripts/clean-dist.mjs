import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const distPath = path.resolve(process.cwd(), 'dist')

if (existsSync(distPath)) {
  rmSync(distPath, { recursive: true, force: true })
}

console.log(`Cleaned ${distPath}`)
