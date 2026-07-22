import { spawnSync } from 'node:child_process'

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(command, ['now-sdk', 'build', '--errorOnConflict', 'true'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env,
})

const output = `${result.stdout || ''}${result.stderr || ''}`
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')

if (result.error) {
  console.error(`verified build could not start the ServiceNow SDK: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0 || /\[now-sdk\]\s+ERROR:/i.test(output)) {
  console.error('verified build rejected ServiceNow SDK errors')
  process.exit(result.status || 1)
}
