import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const backend = (process.argv[2] ?? process.env.VAMPIRKY_BACKEND_URL ?? '')
  .replace(/\/$/, '')
const origin =
  process.env.VAMPIRKY_E2E_ORIGIN ?? 'https://mehmetyildiz03.github.io'
const timeoutMs = Number(process.env.VAMPIRKY_E2E_TIMEOUT_MS ?? 15_000)

if (!backend) {
  throw new Error('Pass the backend URL as argv[2] or VAMPIRKY_BACKEND_URL.')
}
if (!/^https:\/\//.test(backend) && process.env.ALLOW_INSECURE_SMOKE !== '1') {
  throw new Error('Production full-match E2E requires an https:// backend URL.')
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

function waitFor(check, label, timeout = timeoutMs) {
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
        timeoutMs,
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
      ).then(resolve, reject)
    })

    await waitFor(
      () => this.lobby || this.game,
      `${this.name} initial snapshot`,
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
      }, timeoutMs)

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

  waitLobby(check, label) {
    return waitFor(
      () => this.lobby && check(this.lobby) ? this.lobby : null,
      `${this.name} ${label}`,
    )
  }

  waitGame(check, label) {
    return waitFor(
      () => this.game && check(this.game) ? this.game : null,
      `${this.name} ${label}`,
    )
  }

  close() {
    this.socket?.close(1000, 'Production full-match E2E complete.')
  }
}

async function waitAllPhase(clients, phase, round) {
  await Promise.all(
    clients.map((client) =>
      client.waitGame(
        (snapshot) =>
          snapshot.phase === phase &&
          (round === undefined || snapshot.round === round),
        `${phase}${round ? ` round ${round}` : ''}`,
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

function clientByRole(clients, role) {
  const matches = clients.filter((client) => client.game?.self.role === role)
  assert(matches.length === 1, `Expected exactly one ${role}, found ${matches.length}.`)
  return matches[0]
}

function living(clients) {
  return clients.filter((client) => client.game?.self.alive)
}

async function protectedNight(clients, round, vampire, seer, protector) {
  await waitAllPhase(clients, 'night', round)

  const vampireMessage = `E2E vampir özel kanal · tur ${round}`
  await vampire.gameCommand({
    type: 'chat.send',
    channel: 'vampire',
    text: vampireMessage,
  })
  await vampire.waitGame(
    (snapshot) =>
      snapshot.chatMessages.some(
        (message) =>
          message.channel === 'vampire' && message.text === vampireMessage,
      ),
    'vampire private chat echo',
  )

  for (const client of clients.filter((item) => item !== vampire)) {
    await client.waitGame(
      (snapshot) =>
        !snapshot.chatMessages.some(
          (message) => message.text === vampireMessage,
        ),
      'vampire chat privacy',
    )
  }

  const ordinaryVillagers = clients.filter(
    (client) =>
      client.game?.self.role === 'villager' &&
      client.game.self.alive,
  )
  assert(ordinaryVillagers.length >= 1, 'No living villager available for night target.')
  const attackTarget = ordinaryVillagers[0]

  assert(
    vampire.game.capabilities.nightTargetIds.includes(attackTarget.session.playerId),
    'Vampire cannot target the chosen villager.',
  )
  assert(
    protector.game.capabilities.nightTargetIds.includes(attackTarget.session.playerId),
    'Protector cannot protect the chosen villager.',
  )
  assert(
    seer.game.capabilities.nightTargetIds.includes(vampire.session.playerId),
    'Seer cannot investigate the vampire.',
  )

  await vampire.gameCommand({
    type: 'night.submit',
    targetId: attackTarget.session.playerId,
  })
  await protector.gameCommand({
    type: 'night.submit',
    targetId: attackTarget.session.playerId,
  })
  await seer.gameCommand({
    type: 'night.submit',
    targetId: vampire.session.playerId,
  })

  await waitAllPhase(clients, 'dawn', round)
  assert(
    clients[0].game.lastNight?.victimId === null,
    `Round ${round} protection did not prevent the night death.`,
  )

  const seerSnapshot = seer.game
  assert(
    seerSnapshot.self.intel.some(
      (intel) =>
        intel.round === round &&
        intel.targetId === vampire.session.playerId &&
        intel.isVampire === true,
    ),
    `Seer did not receive vampire intel in round ${round}.`,
  )
}

const health = await jsonRequest('/health')
assert(health.body.ok === true, 'Health endpoint did not report ok=true.')
assert(health.body.persistence === true, 'Production persistence is not enabled.')
assert(
  health.response.headers.get('access-control-allow-origin') === origin,
  'Production CORS did not allow the GitHub Pages origin.',
)

const roomId = 'E2E' + Date.now().toString(36).toUpperCase()
const hostName = 'E2E-1'
const host = (await jsonRequest('/api/lobbies', {
  method: 'POST',
  body: JSON.stringify({ hostName, roomId }),
})).body

const sessions = [host]
for (let index = 2; index <= 6; index += 1) {
  const joined = (await jsonRequest(
    '/api/lobbies/' + encodeURIComponent(roomId) + '/join',
    {
      method: 'POST',
      body: JSON.stringify({ name: `E2E-${index}` }),
    },
  )).body
  sessions.push(joined)
}

const clients = sessions.map(
  (session, index) => new E2EClient(session, `E2E-${index + 1}`),
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
      ),
    ),
  )

  await clients[0].lobbyCommand({ type: 'lobby.start' })
  await waitAllPhase(clients, 'role_reveal', 1)

  const roleCounts = clients.reduce(
    (counts, client) => {
      counts[client.game.self.role] += 1
      return counts
    },
    { vampire: 0, villager: 0, seer: 0, protector: 0 },
  )
  assert(
    JSON.stringify(roleCounts) ===
      JSON.stringify({ vampire: 1, villager: 3, seer: 1, protector: 1 }),
    `Unexpected 6-player role pack: ${JSON.stringify(roleCounts)}`,
  )
  for (const client of clients) {
    assert(client.game.revealedRoles.length === 0, 'Roles leaked before game end.')
    assert(
      !JSON.stringify(client.game.players).includes('secretRole'),
      'Public player snapshot leaked secretRole.',
    )
  }

  const vampire = clientByRole(clients, 'vampire')
  const seer = clientByRole(clients, 'seer')
  const protector = clientByRole(clients, 'protector')
  const villagers = clients.filter((client) => client.game.self.role === 'villager')

  await readyAll(clients)
  await protectedNight(clients, 1, vampire, seer, protector)

  await readyAll(clients)
  await waitAllPhase(clients, 'discussion', 1)

  const publicMessage = 'E2E köy mesajı: yapılandırılmış iddia kaynağı.'
  await clients[0].gameCommand({
    type: 'chat.send',
    channel: 'village',
    text: publicMessage,
  })
  await Promise.all(
    clients.map((client) =>
      client.waitGame(
        (snapshot) =>
          snapshot.chatMessages.some(
            (message) =>
              message.channel === 'village' &&
              message.text === publicMessage,
          ),
        'village chat broadcast',
      ),
    ),
  )

  const sourceMessage = clients[0].game.chatMessages.find(
    (message) =>
      message.authorId === clients[0].session.playerId &&
      message.text === publicMessage,
  )
  assert(sourceMessage, 'Could not find village source message.')

  await clients[0].gameCommand({
    type: 'claim.record',
    payload: {
      kind: 'role',
      role: 'seer',
      quote: publicMessage,
      sourceMessageId: sourceMessage.id,
    },
  })
  await Promise.all(
    clients.map((client) =>
      client.waitGame(
        (snapshot) =>
          snapshot.claims.some(
            (claim) =>
              claim.claimantId === clients[0].session.playerId &&
              claim.sourceMessageId === sourceMessage.id,
          ),
        'public structured claim',
      ),
    ),
  )

  await clients[0].gameCommand({ type: 'phase.advance' })
  await waitAllPhase(clients, 'voting', 1)

  const roundOneVictim = villagers[0]
  for (const voter of living(clients)) {
    const targetId =
      voter === roundOneVictim
        ? vampire.session.playerId
        : roundOneVictim.session.playerId
    assert(
      voter.game.capabilities.voteTargetIds.includes(targetId),
      `${voter.name} cannot vote for planned round-one target ${targetId}.`,
    )
    await voter.gameCommand({ type: 'vote.submit', targetId })
  }

  await waitAllPhase(clients, 'resolution', 1)
  assert(
    clients[0].game.lastVote?.eliminatedId === roundOneVictim.session.playerId,
    'Round-one villager was not eliminated as planned.',
  )
  assert(roundOneVictim.game.self.alive === false, 'Eliminated player is still alive.')
  assert(
    roundOneVictim.game.capabilities.writableChatChannels.includes('ghost'),
    'Dead player cannot write to Ghost chat.',
  )

  const ghostMessage = 'E2E hayalet kanalı gizlilik kontrolü.'
  await roundOneVictim.gameCommand({
    type: 'chat.send',
    channel: 'ghost',
    text: ghostMessage,
  })
  await roundOneVictim.waitGame(
    (snapshot) =>
      snapshot.chatMessages.some(
        (message) =>
          message.channel === 'ghost' && message.text === ghostMessage,
      ),
    'ghost chat echo',
  )
  for (const client of living(clients)) {
    await client.waitGame(
      (snapshot) =>
        !snapshot.chatMessages.some((message) => message.text === ghostMessage),
      'ghost chat privacy',
    )
  }

  await readyAll(clients)
  await protectedNight(clients, 2, vampire, seer, protector)

  await readyAll(clients)
  await waitAllPhase(clients, 'discussion', 2)
  await clients[0].gameCommand({ type: 'phase.advance' })
  await waitAllPhase(clients, 'voting', 2)

  const survivingNonVampire = living(clients).find(
    (client) => client !== vampire,
  )
  assert(survivingNonVampire, 'No surviving non-vampire vote target.')

  for (const voter of living(clients)) {
    const targetId =
      voter === vampire
        ? survivingNonVampire.session.playerId
        : vampire.session.playerId
    assert(
      voter.game.capabilities.voteTargetIds.includes(targetId),
      `${voter.name} cannot cast the planned final vote.`,
    )
    await voter.gameCommand({ type: 'vote.submit', targetId })
  }

  await waitAllPhase(clients, 'ended', 2)
  for (const client of clients) {
    assert(client.game.winner === 'village', 'Village did not win after vampire elimination.')
    assert(client.game.revealedRoles.length === 6, 'End snapshot did not reveal all roles.')
  }

  const revealed = clients[0].game.revealedRoles
  for (const client of clients) {
    const finalRole = revealed.find(
      (entry) => entry.playerId === client.session.playerId,
    )?.role
    assert(
      finalRole === client.game.self.role,
      `End role reveal mismatch for ${client.name}.`,
    )
  }

  console.log(JSON.stringify({
    ok: true,
    backend,
    origin,
    roomId,
    players: clients.length,
    roleCounts,
    roundOne: {
      protectedNight: true,
      villageChat: true,
      sourcedClaim: true,
      eliminatedVillager: roundOneVictim.name,
      ghostChatPrivate: true,
    },
    roundTwo: {
      protectedNight: true,
      eliminatedVampire: vampire.name,
      winner: clients[0].game.winner,
    },
    privacy: {
      preEndRoleRevealHidden: true,
      vampireChatPrivate: true,
      ghostChatPrivate: true,
    },
    finalRolesRevealed: revealed.length,
  }, null, 2))
} finally {
  for (const client of clients) client.close()
}
