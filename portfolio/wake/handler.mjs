import { createHash, timingSafeEqual } from 'node:crypto'
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2'

const client = new EC2Client({ region: process.env.AWS_REGION })

export function createHandler(ec2 = client, env = process.env) {
  const reply = (statusCode, data, extraHeaders = {}) => ({
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(data)
  })

  const instanceState = async () => {
    const result = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [env.INSTANCE_ID] }))
    return result.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown'
  }

  return async (event) => {
    const origin = event.headers?.origin ?? event.headers?.Origin
    if (origin && origin !== env.SITE_ORIGIN) return reply(403, { message: 'Origin not allowed' })

    const method = event.requestContext?.http?.method
    const path = event.rawPath?.replace(/^\/v1/, '')

    try {
      if (method === 'GET' && path === '/status') {
        return reply(200, { state: await instanceState() })
      }

      if (method === 'POST' && path === '/start') {
        let body
        try { body = JSON.parse(event.body || '{}') } catch { return reply(400, { message: 'Invalid request' }) }
        if (typeof body.code !== 'string' || !/^[0-9a-f]{64}$/i.test(env.WAKE_CODE_SHA256 || '')) {
          return reply(401, { message: 'Invalid access code' })
        }

        const submitted = createHash('sha256').update(body.code).digest()
        const expected = Buffer.from(env.WAKE_CODE_SHA256, 'hex')
        if (!timingSafeEqual(submitted, expected)) return reply(401, { message: 'Invalid access code' })

        const state = await instanceState()
        if (state === 'running' || state === 'pending') return reply(200, { state })
        if (state === 'stopping') return reply(409, { message: 'Server is stopping. Try again shortly.' }, { 'retry-after': '15' })
        if (state !== 'stopped') return reply(503, { message: 'Server is unavailable' })

        await ec2.send(new StartInstancesCommand({ InstanceIds: [env.INSTANCE_ID] }))
        return reply(202, { state: 'pending' })
      }

      return reply(404, { message: 'Not found' })
    } catch (error) {
      console.error('Wake operation failed:', error?.name || 'UnknownError')
      return reply(503, { message: 'Server status is unavailable. Try again shortly.' })
    }
  }
}

export const handler = createHandler()
