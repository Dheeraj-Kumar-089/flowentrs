import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const require = createRequire(resolve(repo, 'sandbox/server/package.json'))
const yaml = require('js-yaml')

const required = new Map([
  ['database', ['AUTH', 'SANDBOX', 'REDIS_URL', 'RABBITMQ_URL']],
  ['jwt', ['JWT_SECRET']],
  ['google', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']],
  ['ai-secret', ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY']],
  ['aws', ['AWS_REGION', 'S3_BUCKET_NAME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']],
])

const [mode, ...args] = process.argv.slice(2)
const [target, keyPath] = args
if (!['--check', '--create'].includes(mode) ||
    (mode === '--check' && args.length !== 0) ||
    (mode === '--create' && args.length !== 2)) {
  console.error('Usage: node portfolio/provision-secrets.mjs --check | --create user@host ssh-key-path')
  process.exit(2)
}

let documents
try {
  documents = yaml.loadAll(readFileSync(resolve(repo, 'k8s/secrets.yml'), 'utf8'))
} catch {
  console.error('Unable to read or parse the local secret file.')
  process.exit(1)
}

const found = new Map()
const issues = []
for (const document of documents) {
  const name = document?.metadata?.name
  if (document?.kind !== 'Secret' || !required.has(name) || found.has(name)) {
    console.error('The local secret file has an unexpected or duplicate Secret document.')
    process.exit(1)
  }
  const values = document.stringData
  if (!values || typeof values !== 'object') {
    console.error(`Secret ${name} has no stringData.`)
    process.exit(1)
  }
  const selected = {}
  for (const key of required.get(name)) {
    const value = values[key]
    const missing = typeof value !== 'string' || !value.trim()
    const placeholder = !missing && /^(?:YOUR_|.*_VALUE$|CHANGE_ME|PLACEHOLDER)/i.test(value)
    if (missing || placeholder) {
      issues.push(`${name}.${key}: ${missing ? 'missing or empty' : 'placeholder'}`)
    } else selected[key] = value
  }
  found.set(name, {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace: 'default' },
    type: 'Opaque',
    stringData: selected,
  })
}

if (found.size !== required.size) {
  console.error('The local secret file is missing a required Secret document.')
  process.exit(1)
}

if (issues.length) {
  console.error(`Unusable local Secret values: ${issues.join(', ')}`)
  process.exit(1)
}

if (mode === '--check') {
  console.log(`Validated ${found.size} local Secret documents; no values displayed or sent.`)
  process.exit(0)
}

const payload = JSON.stringify({ apiVersion: 'v1', kind: 'List', items: [...found.values()] })
const child = spawn('ssh', ['-i', keyPath, '-o', 'BatchMode=yes', target, 'sudo', 'k3s', 'kubectl', 'create', '-f', '-'], {
  stdio: ['pipe', 'ignore', 'ignore'],
})
child.stdin.end(payload)
child.stdin.on('error', () => {
  // SSH may exit before consuming stdin (for example, a rejected key).
  // The close handler below reports the failure without exposing Secret data.
})
child.on('error', () => {
  console.error('Could not start the SSH secret transfer.')
  process.exitCode = 1
})
child.on('close', code => {
  if (code === 0) {
    console.log(`Created ${found.size} Kubernetes Secrets over SSH; the local YAML file was not transferred or applied.`)
  }
  else {
    console.error('Kubernetes Secret creation failed. Check for existing names and SSH access; no values were printed.')
    process.exitCode = 1
  }
})
