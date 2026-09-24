import WebSocket from 'ws'

const backend = (process.argv[2] ?? process.env.VAMPIRKY_BACKEND_URL ?? '')
  .replace(/\/$/, '')
const origin = process.env.VAMPIRKY_SMOKE_ORIGIN ?? 'https://mehmetyildiz03.github.io'

if (!backend) {
  throw new Error('Pass the backend URL as argv[2] or VAMPIRKY_BACKEND_URL.')
}
if (!/^https:\/\//.test(backend) && process.env.ALLOW_INSECURE_SMOKE !== '1') {
  throw new Error('Production smoke requires an https:// backend URL.')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(backend + path, {
    ...init,
    headers: {
      Origin: origin,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`)
  }
  return { response, body }
}

async function websocketResume(session) {
  const wsUrl = backend.replace(/^http/, 'ws') + '/ws'
  const socket = new WebSocket(wsUrl, { origin })

  const messages = []
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket smoke timed out.')), 10_000)
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'session.resume',
        roomId: session.roomId,
        sessionToken: session.sessionToken,
        lastSeenRevision: session.revision,
      }))
    })
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      messages.push(message)
      if (
        messages.some((item) => item.type === 'session.ready') &&
        messages.some((item) => item.type === 'lobby.snapshot')
      ) {
        clearTimeout(timer)
        resolve()
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  const ready = messages.find((item) => item.type === 'session.ready')
  const snapshot = messages.find((item) => item.type === 'lobby.snapshot')
  assert(ready?.roomId === session.roomId, 'WebSocket resumed the wrong room.')
  assert(snapshot?.snapshot?.roomId === session.roomId, 'Lobby snapshot room mismatch.')
  socket.close(1000, 'Production smoke complete.')
}

const health = await jsonRequest('/health')
assert(health.body.ok === true, 'Health endpoint did not report ok=true.')
assert(
  health.response.headers.get('access-control-allow-origin') === origin,
  'CORS did not echo the expected production origin.',
)

const roomId = 'SMK' + Date.now().toString(36).toUpperCase()
const host = (await jsonRequest('/api/lobbies', {
  method: 'POST',
  body: JSON.stringify({ hostName: 'SmokeHost', roomId }),
})).body
assert(host.roomId === roomId, 'Lobby create returned the wrong room id.')

const guest = (await jsonRequest(
  '/api/lobbies/' + encodeURIComponent(roomId) + '/join',
  {
    method: 'POST',
    body: JSON.stringify({ name: 'SmokeGuest' }),
  },
)).body
assert(guest.roomId === roomId, 'Lobby join returned the wrong room id.')

await websocketResume(host)

console.log(JSON.stringify({
  ok: true,
  backend,
  origin,
  roomId,
  health: health.body,
  websocket: 'ready',
  lobbyJoin: 'ready',
}, null, 2))
