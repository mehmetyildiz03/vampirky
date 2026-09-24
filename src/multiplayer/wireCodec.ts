import type {
  ClientGameCommand,
  ClientTransportMessage,
  ServerTransportMessage,
} from './protocol'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function hasCommandMeta(value: JsonRecord): boolean {
  return isString(value.requestId) && isNonNegativeInteger(value.baseRevision)
}

function isClientGameCommand(value: unknown): value is ClientGameCommand {
  if (!isRecord(value) || !isString(value.type) || !hasCommandMeta(value)) {
    return false
  }

  if (value.type === 'chat.send') {
    return (
      ['village', 'vampire', 'ghost'].includes(String(value.channel)) &&
      isString(value.text)
    )
  }

  if (value.type === 'night.submit' || value.type === 'vote.submit') {
    return isNonNegativeInteger(value.targetId)
  }

  if (value.type === 'claim.withdraw') {
    return isNonNegativeInteger(value.claimId)
  }

  if (value.type !== 'claim.record' || !isRecord(value.payload)) return false

  const payload = value.payload
  if (!isString(payload.kind)) return false

  if (payload.kind === 'role') {
    return ['vampire', 'villager', 'seer', 'protector'].includes(String(payload.role))
  }

  if (payload.kind === 'information') {
    return isNonNegativeInteger(payload.targetId) && isString(payload.statement)
  }

  if (payload.kind === 'action') {
    return (
      isNonNegativeInteger(payload.targetId) &&
      ['protected', 'investigated', 'visited'].includes(String(payload.action))
    )
  }

  if (payload.kind === 'accusation' || payload.kind === 'defense') {
    return isNonNegativeInteger(payload.targetId)
  }

  return false
}

export function decodeClientTransportMessage(
  raw: string,
): ClientTransportMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(value) || !isString(value.type)) return null

  if (value.type === 'session.resume') {
    return isString(value.roomId) &&
      isString(value.sessionToken) &&
      isNonNegativeInteger(value.lastSeenRevision)
      ? (value as unknown as ClientTransportMessage)
      : null
  }

  if (value.type === 'game.command') {
    return isClientGameCommand(value.command)
      ? (value as unknown as ClientTransportMessage)
      : null
  }

  return null
}

export function decodeServerTransportMessage(
  raw: string,
): ServerTransportMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(value) || !isString(value.type)) return null
  if (
    ![
      'game.snapshot',
      'command.accepted',
      'command.rejected',
      'session.ready',
      'session.rejected',
    ].includes(value.type)
  ) {
    return null
  }

  return value as unknown as ServerTransportMessage
}
