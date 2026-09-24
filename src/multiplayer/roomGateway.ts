import type {
  ClientTransportMessage,
  ServerTransportMessage,
  SessionRejectedMessage,
} from './protocol'
import { RoomSessionService } from './sessionService'

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
        message: 'Resume a valid session before sending game commands.',
      })
      return
    }

    try {
      const result = this.sessions.dispatch(sessionToken, message.command)
      peer.send(result.response)

      if (result.mutated) {
        for (const broadcast of result.broadcasts) {
          this.peerBySessionToken.get(broadcast.sessionToken)?.send(broadcast.message)
        }
      }
    } catch {
      peer.send({
        type: 'session.rejected',
        code: 'invalid_session',
        message: 'The bound session is no longer valid.',
      })
      this.disconnect(peer)
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

      peer.send({
        type: 'session.ready',
        roomId: session.roomId,
        playerId: session.playerId,
        revision: session.revision,
        caughtUp: session.caughtUp,
      })
      peer.send({
        type: 'game.snapshot',
        revision: session.revision,
        snapshot: session.snapshot,
      })
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
