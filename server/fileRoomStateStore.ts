import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  ROOM_PERSISTENCE_VERSION,
  type PersistedRoomSessionService,
} from '../src/multiplayer/persistence'

export class JsonRoomStateStore {
  private pending: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  async load(): Promise<PersistedRoomSessionService | null> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedRoomSessionService>
      if (
        parsed.version !== ROOM_PERSISTENCE_VERSION ||
        !Array.isArray(parsed.rooms) ||
        typeof parsed.savedAt !== 'string'
      ) {
        throw new Error('Unsupported or malformed persisted room state.')
      }
      return parsed as PersistedRoomSessionService
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null
      }

      const message =
        error instanceof Error ? error.message : 'Unknown persistence error.'
      throw new Error(
        `Unable to load multiplayer state from ${this.path}: ${message}`,
      )
    }
  }

  scheduleSave(state: PersistedRoomSessionService): void {
    const payload = JSON.stringify(state)
    this.pending = this.pending.then(
      () => this.writeAtomically(payload),
      () => this.writeAtomically(payload),
    )
  }

  async flush(): Promise<void> {
    await this.pending
  }

  private async writeAtomically(payload: string): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })

    const temporaryPath = `${this.path}.${process.pid}.tmp`
    await writeFile(temporaryPath, payload, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryPath, this.path)
  }
}
