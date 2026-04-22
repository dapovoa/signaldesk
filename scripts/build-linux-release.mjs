import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const rawVersion = process.argv[2]

if (!rawVersion) {
  console.error('Usage: npm run build:linux:release -- <version|tag>')
  process.exit(1)
}

const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid version: ${rawVersion}`)
  process.exit(1)
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

// Check current version to avoid unnecessary bump
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))
const currentVersion = packageJson.version

if (currentVersion !== version) {
  run('npm', ['version', version, '--no-git-tag-version'])
} else {
  console.log(`Version ${version} unchanged, skipping version bump`)
}

run('npm', ['run', 'build:clean-dist'])
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--linux', '--config', 'electron-builder.release.yml'])
