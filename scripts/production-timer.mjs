import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const backend = (process.argv[2] ?? process.env.VAMPIRKY_BACKEND_URL ?? '')
  .replace(/\/$/, '')
const origin =
  process.env.VAMPIRKY_E2E_ORIGIN ?? 'https://mehmetyildiz03.github.io'
const commandTimeoutMs = Number(
  process.env.VAMPIRKY_TIMER_COMMAND_TIMEOUT_MS ?? 20_000,
)
const phaseWaitTimeoutMs = Number(
  process.env.VAMPIRKY_TIMER_PHASE_TIMEOUT_MS ?? 45_000,
)
const toleranceMs = Number(
  process.env.VAMPIRKY_TIMER_TOLERANCE_MS ?? 3_000,
)

const configured = {
  night: 20,
  discussion: 30,
  voting: 15,
}

if (!backend) {
  throw new Error('Pass the backend URL as argv[2] or VAMPIRKY_BACKEND_URL.')
}
if (!/^https:\/\//.test(backend) && process.env.ALLOW_INSECURE_SMOKE !== '1') {
  throw new Error('Production timer E2E requires an https:// backend URL.')
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
    throw new Error(
      `${path} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return { response, body }
}

function waitFor(check, label, timeout = phaseWaitTimeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      try {
        const value = check()
        if (value) {
          clearInterval(timer)
          resolve(value)
        } else if (Date.now() - startedAt >= timeout) {
          clearInterval(timer)
          reject(new Error(`Timed out waiting for ${label}.`))
        }
      } catch (error) {
        clearInterval(timer)
        reject(error)
      }
    }, 25)
  })
}

class E2EClient {
  constructor(session, name) {
    this.session = session
    this.name = name
    this.socket = null
    this.revision = session.revision
    this.lobby = session.snapshot ?? null
    this.game = null
    this.messages = []
    this.pending = new Map()
  }

  async connect() {
    const wsUrl = backend.replace(/^http/, 'ws') + '/ws'
    const socket = new WebSocket(wsUrl, { origin })
    this.socket = socket

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      this.messages.push(message)

      if (typeof message.revision === 'number') {
        this.revision = Math.max(this.revision, message.revision)
      }

      if (message.type === 'lobby.snapshot') {
        this.lobby = message.snapshot
        this.revision = message.snapshot.revision
      } else if (message.type === 'game.snapshot') {
        this.game = message.snapshot
        this.revision = message.snapshot.revision
      } else if (
        message.type === 'command.accepted' ||
        message.type === 'command.rejected'
      ) {
        const pending = this.pending.get(message.requestId)
        if (pending) {
          this.pending.delete(message.requestId)
          if (message.type === 'command.rejected') {
            pending.reject(
              new Error(
                `${this.name} command rejected [${message.code}]: ${message.message}`,
              ),
            )
          } else {
            pending.resolve(message)
          }
        }
      } else if (message.type === 'session.rejected') {
        for (const pending of this.pending.values()) {
          pending.reject(
            new Error(
              `${this.name} session rejected [${message.code}]: ${message.message}`,
            ),
          )
        }
        this.pending.clear()
      }
    })

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.name} WebSocket open timed out.`)),
        commandTimeoutMs,
      )

      socket.once('open', () => {
        clearTimeout(timer)
        socket.send(JSON.stringify({
          type: 'session.resume',
          roomId: this.session.roomId,
          sessionToken: this.session.sessionToken,
          lastSeenRevision: this.revision,
        }))
      })

      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      waitFor(
        () => this.messages.some((message) => message.type === 'session.ready'),
        `${this.name} session.ready`,
        commandTimeoutMs,
      ).then(resolve, reject)
    })

    await waitFor(
      () => this.lobby || this.game,
      `${this.name} initial snapshot`,
      commandTimeoutMs,
    )
  }

  command(kind, command) {
    assert(
      this.socket?.readyState === WebSocket.OPEN,
      `${this.name} WebSocket is not open.`,
    )

    const requestId = randomUUID()
    const wire = {
      ...command,
      requestId,
      baseRevision: this.revision,
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`${this.name} command ${command.type} timed out.`))
      }, commandTimeoutMs)

      this.pending.set(requestId, {
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })

      this.socket.send(JSON.stringify({
        type: kind,
        command: wire,
      }))
    })
  }

  lobbyCommand(command) {
    return this.command('lobby.command', command)
  }

  gameCommand(command) {
    return this.command('game.command', command)
  }

  waitLobby(check, label, timeout) {
    return waitFor(
      () => this.lobby && check(this.lobby) ? this.lobby : null,
      `${this.name} ${label}`,
      timeout,
    )
  }

  waitGame(check, label, timeout) {
    return waitFor(
      () => this.game && check(this.game) ? this.game : null,
      `${this.name} ${label}`,
      timeout,
    )
  }

  close() {
    this.socket?.close(1000, 'Production timer E2E complete.')
  }
}

async function waitAllPhase(clients, phase, round, timeout = phaseWaitTimeoutMs) {
  return Promise.all(
    clients.map((client) =>
      client.waitGame(
        (snapshot) =>
          snapshot.phase === phase &&
          (round === undefined || snapshot.round === round),
        `${phase}${round ? ` round ${round}` : ''}`,
        timeout,
      ),
    ),
  )
}

async function readyAll(clients) {
  for (const client of clients) {
    assert(
      client.game?.capabilities.canMarkPhaseReady,
      `${client.name} cannot mark phase ready in ${client.game?.phase}.`,
    )
    await client.gameCommand({ type: 'phase.ready' })
  }
}

function validatePhaseWindow(snapshot, phase, expectedSeconds) {
  assert(snapshot.phase === phase, `Expected ${phase}, got ${snapshot.phase}.`)
  assert(
    snapshot.phaseDurationSeconds === expectedSeconds,
    `${phase} duration is ${snapshot.phaseDurationSeconds}s; expected ${expectedSeconds}s.`,
  )
  assert(
    typeof snapshot.phaseDeadlineAt === 'number',
    `${phase} has no server deadline.`,
  )
  const remainingAtSnapshot = snapshot.phaseDeadlineAt - snapshot.serverNow
  assert(
    remainingAtSnapshot >= expectedSeconds * 1000 - 1_500 &&
      remainingAtSnapshot <= expectedSeconds * 1000 + 500,
    `${phase} server deadline window was ${remainingAtSnapshot}ms; expected about ${expectedSeconds * 1000}ms.`,
  )
}

function assertElapsed(label, elapsedMs, expectedSeconds) {
  const expectedMs = expectedSeconds * 1000
  const deltaMs = elapsedMs - expectedMs
  assert(
    Math.abs(deltaMs) <= toleranceMs,
    `${label} elapsed ${elapsedMs}ms; expected ${expectedMs}ms ±${toleranceMs}ms.`,
  )
  return {
    elapsedMs,
    expectedMs,
    deltaMs,
  }
}

async function measureTimeoutPhase(
  clients,
  phase,
  nextPhase,
  expectedSeconds,
  round,
) {
  const observer = clients[0]
  const startSnapshot = await observer.waitGame(
    (snapshot) => snapshot.phase === phase && snapshot.round === round,
    `${phase} start`,
    commandTimeoutMs,
  )
  validatePhaseWindow(startSnapshot, phase, expectedSeconds)

  const observedAt = Date.now()
  await waitAllPhase(
    clients,
    nextPhase,
    round,
    expectedSeconds * 1000 + toleranceMs + 5_000,
  )
  const elapsedMs = Date.now() - observedAt
  return assertElapsed(`${phase} → ${nextPhase}`, elapsedMs, expectedSeconds)
}

const health = await jsonRequest('/health')
assert(health.body.ok === true, 'Health endpoint did not report ok=true.')
assert(health.body.persistence === true, 'Production persistence is not enabled.')
assert(
  health.response.headers.get('access-control-allow-origin') === origin,
  'Production CORS did not allow the GitHub Pages origin.',
)

const roomId = 'TMR' + Date.now().toString(36).toUpperCase()
const host = (await jsonRequest('/api/lobbies', {
  method: 'POST',
  body: JSON.stringify({ hostName: 'Timer-1', roomId }),
})).body

const sessions = [host]
for (let index = 2; index <= 6; index += 1) {
  const joined = (await jsonRequest(
    '/api/lobbies/' + encodeURIComponent(roomId) + '/join',
    {
      method: 'POST',
      body: JSON.stringify({ name: `Timer-${index}` }),
    },
  )).body
  sessions.push(joined)
}

const clients = sessions.map(
  (session, index) => new E2EClient(session, `Timer-${index + 1}`),
)

try {
  await Promise.all(clients.map((client) => client.connect()))
  await Promise.all(
    clients.map((client) =>
      client.waitLobby(
        (snapshot) =>
          snapshot.players.length === 6 &&
          snapshot.players.every((player) => player.connected),
        'six connected lobby players',
        commandTimeoutMs,
      ),
    ),
  )

  const hostClient = clients[0]
  for (const [key, seconds] of Object.entries(configured)) {
    await hostClient.lobbyCommand({
      type: 'lobby.duration',
      key,
      seconds,
    })
  }

  await Promise.all(
    clients.map((client) =>
      client.waitLobby(
        (snapshot) =>
          snapshot.phaseDurations.night === configured.night &&
          snapshot.phaseDurations.discussion === configured.discussion &&
          snapshot.phaseDurations.voting === configured.voting,
        'minimum phase durations',
        commandTimeoutMs,
      ),
    ),
  )

  for (const client of clients) {
    await client.lobbyCommand({ type: 'lobby.ready', ready: true })
  }

  await Promise.all(
    clients.map((client) =>
      client.waitLobby(
        (snapshot) =>
          snapshot.players.length === 6 &&
          snapshot.players.every((player) => player.ready),
        'all lobby players ready',
        commandTimeoutMs,
      ),
    ),
  )

  await hostClient.lobbyCommand({ type: 'lobby.start' })
  await waitAllPhase(clients, 'role_reveal', 1, commandTimeoutMs)

  await readyAll(clients)
  await waitAllPhase(clients, 'night', 1, commandTimeoutMs)

  const night = await measureTimeoutPhase(
    clients,
    'night',
    'dawn',
    configured.night,
    1,
  )

  await readyAll(clients)
  await waitAllPhase(clients, 'discussion', 1, commandTimeoutMs)

  const discussion = await measureTimeoutPhase(
    clients,
    'discussion',
    'voting',
    configured.discussion,
    1,
  )

  const voting = await measureTimeoutPhase(
    clients,
    'voting',
    'resolution',
    configured.voting,
    1,
  )

  assert(
    clients[0].game.lastVote?.eliminatedId === null,
    'No-vote timeout should resolve without eliminating a player.',
  )

  console.log(JSON.stringify({
    ok: true,
    backend,
    origin,
    roomId,
    players: clients.length,
    configuredSeconds: configured,
    toleranceMs,
    measured: {
      nightToDawn: night,
      discussionToVoting: discussion,
      votingToResolution: voting,
    },
    serverAuthoritativeTimeouts: true,
    noTestBackdoor: true,
  }, null, 2))
} finally {
  for (const client of clients) client.close()
}
