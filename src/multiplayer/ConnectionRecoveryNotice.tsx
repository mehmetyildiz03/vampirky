import { useEffect, useRef, useState } from 'react'
import type { ClientConnectionState } from './browserClient'

export function ConnectionRecoveryNotice({
  state,
  context,
  onExit,
}: {
  state: ClientConnectionState
  context: 'game' | 'lobby'
  onExit: () => void
}) {
  const interrupted = useRef(false)
  const [recovered, setRecovered] = useState(false)

  useEffect(() => {
    if (state === 'reconnecting') {
      interrupted.current = true
      setRecovered(false)
      return
    }

    if (state === 'ready' && interrupted.current) {
      interrupted.current = false
      setRecovered(true)
      const timer = window.setTimeout(() => setRecovered(false), 2600)
      return () => window.clearTimeout(timer)
    }

    if (state === 'closed') setRecovered(false)
  }, [state])

  if (state === 'reconnecting') {
    return (
      <div className="network-recovery-notice reconnecting" role="status" aria-live="polite">
        <span className="network-recovery-symbol" aria-hidden="true">⌁</span>
        <div>
          <small>BAĞLANTI KESİLDİ</small>
          <b>Yeniden bağlanılıyor…</b>
          <p>
            {context === 'game'
              ? 'Oyun sunucuda devam ediyor ve oyundaki yerin korunuyor. Bağlantı gelene kadar yeni seçim veya mesaj gönderilemez.'
              : 'Odadaki yerin yeniden bağlanma süresi boyunca korunuyor. Bağlantı gelene kadar hazır durumu ve ayarlar gönderilemez.'}
          </p>
        </div>
      </div>
    )
  }

  if (state === 'connected' && interrupted.current) {
    return (
      <div className="network-recovery-notice restoring" role="status" aria-live="polite">
        <span className="network-recovery-symbol" aria-hidden="true">↻</span>
        <div>
          <small>SUNUCUYA ULAŞILDI</small>
          <b>Oturum geri yükleniyor…</b>
          <p>Kimliğin ve son sunucu durumu yeniden doğrulanıyor.</p>
        </div>
      </div>
    )
  }

  if (state === 'closed') {
    return (
      <div className="network-recovery-notice closed" role="alert">
        <span className="network-recovery-symbol" aria-hidden="true">×</span>
        <div>
          <small>BAĞLANTI KAPANDI</small>
          <b>Oturum geri yüklenemedi</b>
          <p>Oda kapanmış veya bu oturum artık geçerli olmayabilir.</p>
        </div>
        <button onClick={onExit}>Oturumdan Çık</button>
      </div>
    )
  }

  if (recovered) {
    return (
      <div className="network-recovery-notice recovered" role="status" aria-live="polite">
        <span className="network-recovery-symbol" aria-hidden="true">✓</span>
        <div>
          <small>BAĞLANTI GERİ GELDİ</small>
          <b>Oturum yeniden doğrulandı</b>
          <p>Güncel oyun durumu sunucudan senkronize ediliyor.</p>
        </div>
      </div>
    )
  }

  return null
}
