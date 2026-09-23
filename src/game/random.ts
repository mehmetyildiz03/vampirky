import type { RandomSource } from './types'

export const secureRandom: RandomSource = () => {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Güvenli rol dağıtımı için Web Crypto API gerekiyor.')
  }

  const value = new Uint32Array(1)
  cryptoApi.getRandomValues(value)
  return value[0] / 0x1_0000_0000
}

export function fisherYates<T>(items: readonly T[], random: RandomSource = secureRandom): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const r = random()
    if (!Number.isFinite(r) || r < 0 || r >= 1) {
      throw new Error('RandomSource 0 dahil, 1 hariç bir sayı üretmelidir.')
    }
    const j = Math.floor(r * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
