import type {
  ClientTransportMessage,
  ServerTransportMessage,
  SessionRejectedMessage,
} from './protocol'
import { RoomSessionService, type SessionBroadcast } from './sessionService'

export interface TransportPeer {
  id: string
  send(message: ServerTransportMessage): void
  close?(reason: string): void
}

export class RoomGateway {
  private sessionByPeerId = new Map<string, string>()
  private peerBySessionToken = new Map<string, TransportPeer>()

  constructor(private readonly sessions: RoomSessionService) {}

  receive(peer: TransportPeer, message: ClientTransportMessage): void {
    if (message.type === 'session.resume') {
      this.resume(peer, message.roomId, message.sessionToken, message.lastSeenRevision)
      return
    }

    const sessionToken = this.sessionByPeerId.get(peer.id)
    if (!sessionToken) {
      peer.send({
        type: 'session.rejected',
        code: 'invalid_session',
        message: 'Resume a valid session before sending room commands.',
      })
      return
    }

    try {
      const result = message.type === 'lobby.command'
        ? this.sessions.dispatchLobby(sessionToken, message.command)
        : message.type === 'private.command'
          ? this.sessions.dispatchPrivate(sessionToken, message.command)
          : this.sessions.dispatchGame(sessionToken, message.command)

      peer.send(result.response)
      if (result.mutated) this.sendBroadcasts(result.broadcasts)
    } catch {
      peer.send({
        type: 'session.rejected',
        code: 'invalid_session',
        message: 'The bound session is no longer valid.',
      })
      this.disconnect(peer)
    }
  }

  broadcastRoom(roomId: string): void {
    this.sendBroadcasts(this.sessions.broadcastsForRoomId(roomId))
  }

  tick(now = Date.now()): void {
    const result = this.sessions.tick(now)
    this.sendBroadcasts(result.broadcasts)

    for (const sessionToken of result.expiredSessionTokens) {
      const peer = this.peerBySessionToken.get(sessionToken)
      if (!peer) continue

      peer.send({
        type: 'session.rejected',
        code: 'room_not_found',
        message: 'Room expired due to inactivity.',
      })
      this.peerBySessionToken.delete(sessionToken)
      this.sessionByPeerId.delete(peer.id)
      peer.close?.('Room expired due to inactivity.')
    }
  }

  disconnect(peer: TransportPeer): void {
    const sessionToken = this.sessionByPeerId.get(peer.id)
    this.sessionByPeerId.delete(peer.id)
    if (
      sessionToken &&
      this.peerBySessionToken.get(sessionToken)?.id === peer.id
    ) {
      this.peerBySessionToken.delete(sessionToken)
      try {
        this.sendBroadcasts(this.sessions.setSessionConnected(sessionToken, false))
      } catch {
        // Session may already be invalidated.
      }
    }
  }

  private sendBroadcasts(broadcasts: SessionBroadcast[]): void {
    for (const broadcast of broadcasts) {
      this.peerBySessionToken.get(broadcast.sessionToken)?.send(broadcast.message)
    }
  }

  private resume(
    peer: TransportPeer,
    roomId: string,
    sessionToken: string,
    lastSeenRevision: number,
  ): void {
    try {
      const session = this.sessions.resumeSession(
        roomId,
        sessionToken,
        lastSeenRevision,
      )

      const previousPeer = this.peerBySessionToken.get(sessionToken)
      if (previousPeer && previousPeer.id !== peer.id) {
        previousPeer.send({
          type: 'session.rejected',
          code: 'session_mismatch',
          message: 'This session resumed from another connection.',
        })
        previousPeer.close?.('Session replaced by reconnect.')
        this.sessionByPeerId.delete(previousPeer.id)
      }

      this.sessionByPeerId.set(peer.id, sessionToken)
      this.peerBySessionToken.set(sessionToken, peer)
      const presenceBroadcasts = this.sessions.setSessionConnected(sessionToken, true)

      peer.send({
        type: 'session.ready',
        roomId: session.roomId,
        playerId: session.playerId,
        revision: session.revision,
        caughtUp: session.caughtUp,
      })
      if (presenceBroadcasts.length > 0) {
        this.sendBroadcasts(presenceBroadcasts)
      } else {
        peer.send(this.sessions.messageForSession(sessionToken))
      }
    } catch (error) {
      peer.send(sessionError(error))
    }
  }
}

function sessionError(error: unknown): SessionRejectedMessage {
  const message = error instanceof Error ? error.message : 'Session rejected.'
  const normalized = message.toLocaleLowerCase('en-US')
  return {
    type: 'session.rejected',
    code: normalized.includes('room') ? 'room_not_found' : 'invalid_session',
    message,
  }
}
