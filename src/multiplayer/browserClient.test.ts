import { describe, expect, it } from 'vitest'
import { BrowserMultiplayerClient } from './browserClient'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('browser multiplayer session lifecycle', () => {
  it('treats a session rejection as terminal and forgets the expired token', () => {
    const storage = new MemoryStorage()
    const client = new BrowserMultiplayerClient({
      httpBaseUrl: 'http://localhost:8787',
      storage,
    })
    const internal = client as unknown as {
      identity: {
        roomId: string
        playerId: number
        sessionToken: string
        revision: number
      } | null
      revision: number
      handleServerMessage(message: {
        type: 'session.rejected'
        code: 'room_not_found'
        message: string
      }): void
    }

    internal.identity = {
      roomId: 'EXPIRED',
      playerId: 1,
      sessionToken: 'dead-token',
      revision: 4,
    }
    internal.revision = 4
    storage.setItem(
      'vampirky:session:EXPIRED',
      JSON.stringify(internal.identity),
    )

    internal.handleServerMessage({
      type: 'session.rejected',
      code: 'room_not_found',
      message: 'Room expired due to inactivity.',
    })

    expect(client.getState()).toBe('closed')
    expect(client.getIdentity()).toBeNull()
    expect(client.getRevision()).toBe(0)
    expect(storage.getItem('vampirky:session:EXPIRED')).toBeNull()
  })
})
