function secureUint32(): number {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure randomness is unavailable in this environment.')
  }

  const value = new Uint32Array(1)
  globalThis.crypto.getRandomValues(value)
  return value[0]
}

export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('maxExclusive must be a positive integer.')
  }

  const range = 0x1_0000_0000
  const limit = range - (range % maxExclusive)

  let value = secureUint32()
  while (value >= limit) value = secureUint32()

  return value % maxExclusive
}

export function secureShuffle<T>(items: readonly T[]): T[] {
  const output = [...items]
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1)
    ;[output[i], output[j]] = [output[j], output[i]]
  }
  return output
}
