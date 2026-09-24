import type {
  ClientGameCommand,
  ClientLobbyCommand,
  ClientPrivateCommand,
  ClientTransportMessage,
  LobbySnapshot,
  ServerTransportMessage,
} from './protocol'
import { decodeServerTransportMessage } from './wireCodec'
import type { ViewerGameSnapshot } from './snapshot'
import type { DeductionMark } from '../game/deduction'
import type { PhaseDurationKey } from '../game/timing'
import type { PlayerSeed } from '../game/types'

export interface SessionIdentity {
  roomId: string
  playerId: number
  sessionToken: string
  revision: number
}

export interface SessionBootstrapResponse extends SessionIdentity {
  snapshot: ViewerGameSnapshot
}

export interface LobbySessionBootstrapResponse extends SessionIdentity {
  snapshot: LobbySnapshot
}

export type ClientConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'reconnecting'
  | 'closed'

export interface BrowserMultiplayerClientOptions {
  httpBaseUrl: string
  websocketUrl?: string
  reconnectDelayMs?: number
  storage?: Storage | null
}

export type BrowserClientEvent =
  | { type: 'state'; state: ClientConnectionState }
  | { type: 'message'; message: ServerTransportMessage }
  | { type: 'snapshot'; snapshot: ViewerGameSnapshot }
  | { type: 'lobbySnapshot'; snapshot: LobbySnapshot }
  | { type: 'error'; message: string }

type Listener = (event: BrowserClientEvent) => void

type LobbyCommandInput =
  | { type: 'lobby.ready'; ready: boolean }
  | { type: 'lobby.duration'; key: PhaseDurationKey; seconds: number }
  | { type: 'lobby.start' }

type PrivateCommandInput =
  | { type: 'deduction.mark'; targetId: number; mark: DeductionMark }
  | { type: 'deduction.note.add'; targetId: number; text: string }
  | { type: 'deduction.note.remove'; targetId: number; noteId: number }
  | { type: 'deduction.general.add'; text: string }
  | { type: 'deduction.general.remove'; noteId: number }

type StripCommandMeta<T> = T extends { requestId: string; baseRevision: number }
  ? Omit<T, 'requestId' | 'baseRevision'>
  : never

export type GameCommandInput = StripCommandMeta<ClientGameCommand>

export class BrowserMultiplayerClient {
  private socket: WebSocket | null = null
  private identity: SessionIdentity | null = null
  private revision = 0
  private listeners = new Set<Listener>()
  private reconnectTimer: number | null = null
  private manuallyClosed = false
  private state: ClientConnectionState = 'idle'

  private readonly httpBaseUrl: string
  private readonly websocketUrl: string
  private readonly reconnectDelayMs: number
  private readonly storage: Storage | null

  constructor(options: BrowserMultiplayerClientOptions) {
    this.httpBaseUrl = options.httpBaseUrl.replace(/\/$/, '')
    this.websocketUrl =
      options.websocketUrl ??
      this.httpBaseUrl.replace(/^http/, 'ws') + '/ws'
    this.reconnectDelayMs = options.reconnectDelayMs ?? 800
    this.storage = options.storage ?? (
      typeof sessionStorage !== 'undefined' ? sessionStorage : null
    )
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): ClientConnectionState {
    return this.state
  }

  getRevision(): number {
    return this.revision
  }

  getIdentity(): SessionIdentity | null {
    return this.identity ? { ...this.identity, revision: this.revision } : null
  }

  async createLobby(
    hostName: string,
    roomId?: string,
  ): Promise<LobbySessionBootstrapResponse> {
    const response = await fetch(this.httpBaseUrl + '/api/lobbies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostName, roomId }),
    })
    return this.readBootstrapResponse<LobbySessionBootstrapResponse>(response)
  }

  async joinLobby(
    roomId: string,
    name: string,
  ): Promise<LobbySessionBootstrapResponse> {
    const response = await fetch(
      this.httpBaseUrl +
        '/api/lobbies/' +
        encodeURIComponent(roomId) +
        '/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    )
    return this.readBootstrapResponse<LobbySessionBootstrapResponse>(response)
  }

  // Legacy active-game bootstrap retained for integration tooling.
  async createRoom(
    players: PlayerSeed[],
    hostPlayerId: number,
    roomId?: string,
  ): Promise<SessionBootstrapResponse> {
    const response = await fetch(this.httpBaseUrl + '/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ players, hostPlayerId, roomId }),
    })
    return this.readBootstrapResponse<SessionBootstrapResponse>(response)
  }

  async claimSeat(
    roomId: string,
    playerId: number,
  ): Promise<SessionBootstrapResponse> {
    const response = await fetch(
      this.httpBaseUrl +
        '/api/rooms/' +
        encodeURIComponent(roomId) +
        '/seats/' +
        encodeURIComponent(String(playerId)),
      { method: 'POST' },
    )
    return this.readBootstrapResponse<SessionBootstrapResponse>(response)
  }

  connect(identity: SessionIdentity): void {
    this.clearReconnect()
    this.manuallyClosed = false
    this.identity = { ...identity }
    this.revision = identity.revision
    this.persistIdentity()
    this.openSocket(false)
  }

  reconnectStored(roomId: string): boolean {
    const stored = this.storage?.getItem(this.storageKey(roomId))
    if (!stored) return false

    try {
      const identity = JSON.parse(stored) as SessionIdentity
      if (
        identity.roomId !== roomId.toUpperCase() ||
        typeof identity.sessionToken !== 'string' ||
        typeof identity.playerId !== 'number' ||
        typeof identity.revision !== 'number'
      ) {
        return false
      }
      this.connect(identity)
      return true
    } catch {
      return false
    }
  }

  close(): void {
    this.manuallyClosed = true
    this.clearReconnect()
    this.socket?.close(1000, 'Client closed.')
    this.socket = null
    this.setState('closed')
  }

  setReady(ready: boolean): string {
    return this.sendLobbyCommand({ type: 'lobby.ready', ready })
  }

  startGame(): string {
    return this.sendLobbyCommand({ type: 'lobby.start' })
  }

  setPhaseDuration(key: PhaseDurationKey, seconds: number): string {
    return this.sendLobbyCommand({ type: 'lobby.duration', key, seconds })
  }

  setDeductionMark(targetId: number, mark: DeductionMark): string {
    return this.sendPrivateCommand({ type: 'deduction.mark', targetId, mark })
  }

  addPrivateNote(targetId: number, text: string): string {
    return this.sendPrivateCommand({ type: 'deduction.note.add', targetId, text })
  }

  removePrivateNote(targetId: number, noteId: number): string {
    return this.sendPrivateCommand({ type: 'deduction.note.remove', targetId, noteId })
  }

  addGeneralPrivateNote(text: string): string {
    return this.sendPrivateCommand({ type: 'deduction.general.add', text })
  }

  removeGeneralPrivateNote(noteId: number): string {
    return this.sendPrivateCommand({ type: 'deduction.general.remove', noteId })
  }

  markPhaseReady(): string {
    return this.sendCommand({ type: 'phase.ready' })
  }

  advancePhase(): string {
    return this.sendCommand({ type: 'phase.advance' })
  }

  sendCommand(
    command: GameCommandInput,
  ): string {
    const requestId = crypto.randomUUID()
    const wireCommand = {
      ...command,
      requestId,
      baseRevision: this.revision,
    } as ClientGameCommand
    this.sendReadyMessage({
      type: 'game.command',
      command: wireCommand,
    })
    return requestId
  }

  private sendPrivateCommand(
    command: PrivateCommandInput,
  ): string {
    const requestId = crypto.randomUUID()
    const wireCommand = {
      ...command,
      requestId,
      baseRevision: this.revision,
    } as ClientPrivateCommand
    this.sendReadyMessage({
      type: 'private.command',
      command: wireCommand,
    })
    return requestId
  }

  private sendLobbyCommand(
    command: LobbyCommandInput,
  ): string {
    const requestId = crypto.randomUUID()
    const wireCommand = {
      ...command,
      requestId,
      baseRevision: this.revision,
    } as ClientLobbyCommand
    this.sendReadyMessage({
      type: 'lobby.command',
      command: wireCommand,
    })
    return requestId
  }

  private sendReadyMessage(message: ClientTransportMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected.')
    }
    if (this.state !== 'ready') throw new Error('Session is not ready.')
    this.send(message)
  }

  private openSocket(reconnecting: boolean): void {
    if (!this.identity) throw new Error('Session identity is required.')

    this.socket?.close()
    this.setState(reconnecting ? 'reconnecting' : 'connecting')
    const socket = new WebSocket(this.websocketUrl)
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket || !this.identity) return
      this.setState('connected')
      this.send({
        type: 'session.resume',
        roomId: this.identity.roomId,
        sessionToken: this.identity.sessionToken,
        lastSeenRevision: this.revision,
      })
    })

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      const message = decodeServerTransportMessage(event.data)
      if (!message) {
        this.emit({ type: 'error', message: 'Invalid server message.' })
        return
      }
      this.handleServerMessage(message)
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.manuallyClosed) {
        this.setState('closed')
        return
      }
      this.scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      this.emit({ type: 'error', message: 'WebSocket transport error.' })
    })
  }

  private handleServerMessage(message: ServerTransportMessage): void {
    if ('revision' in message && typeof message.revision === 'number') {
      this.revision = Math.max(this.revision, message.revision)
      if (this.identity) {
        this.identity = { ...this.identity, revision: this.revision }
        this.persistIdentity()
      }
    }

    if (message.type === 'session.ready') {
      this.setState('ready')
    } else if (message.type === 'game.snapshot') {
      this.revision = message.snapshot.revision
      this.emit({ type: 'snapshot', snapshot: message.snapshot })
    } else if (message.type === 'lobby.snapshot') {
      this.revision = message.snapshot.revision
      this.emit({ type: 'lobbySnapshot', snapshot: message.snapshot })
    } else if (message.type === 'command.rejected') {
      this.emit({ type: 'error', message: message.message })
    } else if (message.type === 'session.rejected') {
      this.emit({ type: 'error', message: message.message })
    }

    if (this.identity) {
      this.identity = { ...this.identity, revision: this.revision }
      this.persistIdentity()
    }
    this.emit({ type: 'message', message })
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || !this.identity) return
    this.clearReconnect()
    this.setState('reconnecting')
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket(true)
    }, this.reconnectDelayMs)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private send(message: ClientTransportMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open.')
    }
    this.socket.send(JSON.stringify(message))
  }

  private async readBootstrapResponse<T extends SessionIdentity>(
    response: Response,
  ): Promise<T> {
    const body = await response.json() as T | { error: string }
    if (!response.ok || 'error' in body) {
      throw new Error('error' in body ? body.error : 'Bootstrap request failed.')
    }

    this.identity = {
      roomId: body.roomId,
      playerId: body.playerId,
      sessionToken: body.sessionToken,
      revision: body.revision,
    }
    this.revision = body.revision
    this.persistIdentity()
    return body
  }

  private persistIdentity(): void {
    if (!this.identity) return
    this.storage?.setItem(
      this.storageKey(this.identity.roomId),
      JSON.stringify({ ...this.identity, revision: this.revision }),
    )
  }

  private storageKey(roomId: string): string {
    return 'vampirky:session:' + roomId.toUpperCase()
  }

  private setState(state: ClientConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.emit({ type: 'state', state })
  }

  private emit(event: BrowserClientEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
