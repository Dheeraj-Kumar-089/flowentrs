// Creates and removes one disposable project. Google sign-in remains a browser check.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import https from 'node:https'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'

const [keyPath, ip = '43.205.61.128'] = process.argv.slice(2)
const publicRoutes = process.argv.includes('--public')
if (!keyPath) throw new Error('Pass the SSH private-key path as the first argument.')
if (publicRoutes) {
  const response = await fetch('https://www.projectrs.me/', { signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.equal(html, await readFile(new URL('../frontend/dist-portfolio/index.html', import.meta.url), 'utf8'), 'CloudFront must serve the portfolio frontend')
  for (const [, path] of html.matchAll(/["'](\/assets\/[^"']+)["']/g)) {
    const asset = await fetch(`https://www.projectrs.me${path}`, { signal: AbortSignal.timeout(15000) })
    assert.equal(asset.status, 200, `Asset unavailable: ${path}`)
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await readFile(new URL(`../frontend/dist-portfolio${path}`, import.meta.url)), `Wrong asset: ${path}`)
  }
  console.log('CloudFront serves the exact portfolio HTML, JavaScript, and CSS build.')
}
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { io } = require('socket.io-client')
const userId = randomBytes(12).toString('hex')
const ssh = source => execFileSync('ssh', [
  '-i', keyPath, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `ubuntu@${ip}`,
  'sudo k3s kubectl exec -i deploy/sandbox-deployment -- node --input-type=module -'
], { input: source, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] })
const credentials = JSON.parse(ssh(`
  import jwt from 'jsonwebtoken';
  console.log(JSON.stringify({ token: jwt.sign({ id: '${userId}' }, process.env.JWT_SECRET, { expiresIn: '10m' }), bucket: process.env.S3_BUCKET_NAME }));
`))

function request(host, path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    const requestHost = publicRoutes && host === 'api.projectrs.me' ? 'www.projectrs.me' : host
    const address = publicRoutes ? requestHost : ip
    const body = data === undefined ? undefined : JSON.stringify(data)
    const req = https.request(`https://${address}${path}`, {
      method, servername: requestHost, timeout: 20000,
      headers: {
        host: requestHost, authorization: `Bearer ${credentials.token}`,
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {})
      }
    }, response => {
      let text = ''
      response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        let json
        try { json = JSON.parse(text) } catch { /* Preview is HTML. */ }
        if (response.statusCode >= 400) return reject(new Error(`${method} ${path}: HTTP ${response.statusCode}`))
        resolve({ status: response.statusCode, json, text })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error(`${path} timed out`)))
    req.end(body)
  })
}

function terminalCheck(host) {
  return new Promise((resolve, reject) => {
    const socket = io(`https://${publicRoutes ? host : ip}`, {
      transports: ['websocket'], reconnection: false, timeout: 10000,
      extraHeaders: { Host: host }, servername: host
    })
    let output = ''
    const timer = setTimeout(() => finish(new Error('Terminal did not return the command output')), 15000)
    function finish(error) {
      clearTimeout(timer)
      socket.disconnect()
      error ? reject(error) : resolve()
    }
    socket.on('connect_error', error => finish(new Error(`Terminal connection: ${error.message}`)))
    socket.on('connect', () => socket.emit('terminal-input', "printf 'flowent-%s\\n' 'terminal-check'\r"))
    socket.on('terminal-output', chunk => {
      output += chunk
      if (output.includes('flowent-terminal-check')) finish()
    })
  })
}

let projectId
let sandboxId
try {
  const created = await request('api.projectrs.me', '/api/sandbox/project', 'POST', { title: 'Deployment verification' })
  projectId = created.json.project._id
  assert.match(projectId, /^[0-9a-f]{24}$/)
  const started = await request('api.projectrs.me', '/api/sandbox/start', 'POST', { projectId })
  sandboxId = started.json.sandboxId
  assert.match(sandboxId, /^[0-9a-f-]{36}$/)
  console.log(`Created disposable project ${projectId} and sandbox ${sandboxId}.`)
  const deadline = Date.now() + 180000
  let ready = false
  while (Date.now() < deadline) {
    const status = await request('api.projectrs.me', `/api/sandbox/status/${sandboxId}`)
    if (status.json.status === 'ready') { ready = true; break }
    if (status.json.status === 'failed') throw new Error('Sandbox pod failed')
    await sleep(2000)
  }
  assert.ok(ready, 'Sandbox did not become ready in three minutes')
  const previewHost = `preview-${sandboxId}.projectrs.me`
  const agentHost = `agent-${sandboxId}.projectrs.me`
  const preview = await request(previewHost, '/')
  assert.match(preview.text, /<html/i)
  const agent = await request(agentHost, '/')
  assert.equal(agent.json.status, 'success')
  console.log('Sandbox readiness, TLS, preview, and agent routing passed.')
  await terminalCheck(agentHost)
  console.log('WebSocket terminal executed a command and returned its output.')
  await request(agentHost, '/create-files', 'POST', {
    files: [{ file: 'deployment-check.txt', content: 'Flowent deployment verification\n' }]
  })
  let stored = false
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await sleep(2000)
    try {
      execFileSync('aws', ['s3api', 'head-object', '--bucket', credentials.bucket, '--key', `${projectId}/deployment-check.txt`, '--region', 'ap-south-1'], { stdio: 'pipe', timeout: 15000 })
      stored = true
      break
    } catch { /* The watcher may still be syncing. */ }
  }
  assert.ok(stored, 'Created file did not reach S3')
  console.log('A new workspace file synced successfully to S3.')
} finally {
  if (sandboxId && projectId) {
    const deleted = await request('api.projectrs.me', `/api/sandbox/${sandboxId}`, 'DELETE', { projectId })
    assert.equal(deleted.status, 200)
    console.log(`Removed the disposable project, sandbox, service, and ${deleted.json.deletedS3Objects} stored object versions.`)
  } else if (projectId) {
    // Only remove the known test document if no sandbox was created.
    ssh(`import mongoose from 'mongoose'; import Project from './src/models/project.model.js'; await mongoose.connect(process.env.MONGO_URI); await Project.deleteOne({ _id: '${projectId}', user: '${userId}' }); await mongoose.disconnect();`)
    console.log(`Removed the unused disposable project ${projectId}.`)
  }
}
