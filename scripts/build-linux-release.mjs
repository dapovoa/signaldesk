import { spawnSync } from 'node:child_process'

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

run('npm', ['version', version, '--no-git-tag-version'])
run('npm', ['run', 'build:clean-dist'])
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--linux', '--config', 'electron-builder.release.yml'])
