import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createHandler } from './handler.mjs'

const env = {
  INSTANCE_ID: 'i-0123456789abcdef0',
  SITE_ORIGIN: 'https://www.projectrs.me',
  WAKE_CODE_SHA256: createHash('sha256').update('test-code').digest('hex')
}

const event = (method, path, body) => ({
  headers: { origin: env.SITE_ORIGIN },
  requestContext: { http: { method } },
  rawPath: path,
  body: body && JSON.stringify(body)
})

test('invalid access code never calls EC2', async () => {
  const ec2 = { send: () => { throw new Error('should not be called') } }
  const response = await createHandler(ec2, env)(event('POST', '/start', { code: 'wrong' }))
  assert.equal(response.statusCode, 401)
})

test('valid access code starts only a stopped instance', async () => {
  const calls = []
  const ec2 = {
    send: async command => {
      calls.push(command.constructor.name)
      return calls.length === 1
        ? { Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }] }
        : {}
    }
  }
  const response = await createHandler(ec2, env)(event('POST', '/start', { code: 'test-code' }))
  assert.equal(response.statusCode, 202)
  assert.deepEqual(calls, ['DescribeInstancesCommand', 'StartInstancesCommand'])
})

test('status reads instance state without starting it', async () => {
  const calls = []
  const ec2 = {
    send: async command => {
      calls.push(command.constructor.name)
      return { Reservations: [{ Instances: [{ State: { Name: 'running' } }] }] }
    }
  }
  const response = await createHandler(ec2, env)(event('GET', '/status'))
  assert.deepEqual(JSON.parse(response.body), { state: 'running' })
  assert.deepEqual(calls, ['DescribeInstancesCommand'])
})
