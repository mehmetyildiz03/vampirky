const backend = (process.argv[2] ?? process.env.VAMPIRKY_BACKEND_URL ?? '').replace(/\/$/, '')
const expectedSha = (process.argv[3] ?? process.env.VAMPIRKY_EXPECTED_SHA ?? '').trim()
const origin = process.env.VAMPIRKY_E2E_ORIGIN ?? process.env.VAMPIRKY_SMOKE_ORIGIN ?? 'https://mehmetyildiz03.github.io'
const timeoutMs = Number(process.env.VAMPIRKY_DEPLOY_WAIT_TIMEOUT_MS ?? 180_000)
const intervalMs = Number(process.env.VAMPIRKY_DEPLOY_WAIT_INTERVAL_MS ?? 3_000)

if (!backend) throw new Error('Production backend URL is required.')
if (!expectedSha) throw new Error('Expected Git commit SHA is required.')
if (!/^https:\/\//.test(backend) && process.env.ALLOW_INSECURE_SMOKE !== '1') {
  throw new Error('Production deploy guard requires an https:// backend URL.')
}

const short = (sha) => sha ? sha.slice(0, 12) : 'none'
const startedAt = Date.now()
let lastSeen = null
let lastError = null

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(backend + '/health', {
      headers: { Origin: origin },
      cache: 'no-store',
    })
    const body = await response.json()
    if (!response.ok || body.ok !== true) {
      throw new Error('health returned ' + response.status + ': ' + JSON.stringify(body))
    }

    lastSeen = body.commitSha ?? null
    if (lastSeen === expectedSha) {
      console.log(JSON.stringify({
        ok: true,
        backend,
        expectedSha,
        runningSha: lastSeen,
        branch: body.branch ?? null,
        deploymentId: body.deploymentId ?? null,
        waitedMs: Date.now() - startedAt,
      }, null, 2))
      process.exit(0)
    }

    console.log(
      'Production SHA not ready: expected ' + short(expectedSha) +
      ', running ' + short(lastSeen) + '.',
    )
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.log('Production health not ready: ' + lastError)
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs))
}

throw new Error(
  'Production did not reach expected commit ' + expectedSha +
  ' within ' + timeoutMs + 'ms. Last running SHA: ' + (lastSeen ?? 'unknown') +
  (lastError ? '. Last health error: ' + lastError : ''),
)
