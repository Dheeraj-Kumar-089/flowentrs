import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import https from 'node:https'
import { setTimeout as sleep } from 'node:timers/promises'

const [apiUrl, originIp = '43.205.61.128'] = process.argv.slice(2)
if (!apiUrl?.startsWith('https://')) throw new Error('Pass the deployed HTTPS wake API URL.')
const api = apiUrl.replace(/\/$/, '')
const origin = 'https://www.projectrs.me'
const code = (await readFile(new URL('./wake-code.local', import.meta.url), 'utf8')).trim()

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: { origin, ...options.headers },
    signal: AbortSignal.timeout(15000)
  })
  return { response, data: await response.json().catch(() => ({})) }
}

let result = await request('/status')
assert.equal(result.response.status, 200, 'Status endpoint must be readable')
assert.equal(result.response.headers.get('access-control-allow-origin'), origin)
console.log(`Status and CORS passed; EC2 is ${result.data.state}.`)
await sleep(1000)
result = await request('/start', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'incorrect-code' })
})
assert.equal(result.response.status, 401, 'Incorrect code must be rejected')
await sleep(1000)
result = await request('/status', { headers: { origin: 'https://example.invalid' } })
assert.equal(result.response.status, 403, 'Unexpected origin must be rejected')
console.log('Incorrect access code and unexpected origin were rejected.')
await sleep(1000)

const startedAt = performance.now()
result = await request('/start', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code })
})
assert.ok([200, 202].includes(result.response.status), `Start failed with HTTP ${result.response.status}`)
console.log(`Valid code accepted; EC2 is ${result.data.state}.`)

function originReady() {
  return new Promise(resolve => {
    const req = https.get(`https://${originIp}/api/auth/me`, {
      servername: 'api.projectrs.me', headers: { host: 'api.projectrs.me' }, timeout: 5000
    }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        try { resolve(response.statusCode === 200 && typeof JSON.parse(body).loggedIn === 'boolean') }
        catch { resolve(false) }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
  })
}

const deadline = Date.now() + 240000
while (Date.now() < deadline) {
  if (await originReady()) {
    console.log(`HTTPS application ready after ${Math.round((performance.now() - startedAt) / 1000)} seconds from the start request.`)
    process.exit(0)
  }
  await sleep(3000)
}
throw new Error('EC2 did not serve the HTTPS application within four minutes.')
