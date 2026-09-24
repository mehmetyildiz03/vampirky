import { useEffect, useMemo, useState } from 'react'
import type { DeductionMark } from '../game/deduction'
import type { ChatChannel, RoleId } from '../game/types'
import type {
  BrowserMultiplayerClient,
  ClientConnectionState,
  GameCommandInput,
} from './browserClient'
import type { ClaimCommandPayload } from './protocol'
import type { ViewerGameSnapshot } from './snapshot'

const roleVisuals: Record<RoleId, { icon: string; title: string; text: string; action: string }> = {
  vampire: {
    icon: '🦇',
    title: 'Vampir',
    text: 'Gece diğer vampirlerle kurban seç. Gündüz kimliğini sakla.',
    action: 'Kurbanı Seç',
  },
  villager: {
    icon: '♙',
    title: 'Köylü',
    text: 'Özel gece gücün yok. Sözleri, oyları ve çelişkileri takip et.',
    action: 'Geceyi İzle',
  },
  seer: {
    icon: '◉',
    title: 'Kâhin',
    text: 'Her gece bir oyuncunun Vampir olup olmadığını gizlice öğren.',
    action: 'Bu Oyuncuyu Sorgula',
  },
  protector: {
    icon: '⬟',
    title: 'Koruyucu',
    text: 'Her gece yaşayan bir oyuncuyu Vampir saldırısından koru.',
    action: 'Bu Oyuncuyu Koru',
  },
}

export function NetworkGame({
  snapshot,
  client,
  connectionState,
  error,
  onExit,
}: {
  snapshot: ViewerGameSnapshot
  client: BrowserMultiplayerClient
  connectionState: ClientConnectionState
  error: string
  onExit: () => void
}) {
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null)
  const [sideTab, setSideTab] = useState<'chat' | 'claims' | 'deduction'>('chat')
  const [claimSource, setClaimSource] = useState<{ id: number; text: string } | null>(null)

  useEffect(() => {
    setSelectedTarget(null)
    if (
      sideTab === 'claims' &&
      !['discussion', 'voting'].includes(snapshot.phase)
    ) {
      setSideTab('chat')
    }
  }, [snapshot.phase, snapshot.round, sideTab])

  const send = (command: GameCommandInput) => {
    try {
      client.sendCommand(command)
    } catch {
      // Transport errors are surfaced by BrowserMultiplayerClient.
    }
  }

  if (snapshot.phase === 'role_reveal') {
    return (
      <RoleRevealPhase
        snapshot={snapshot}
        connectionState={connectionState}
        error={error}
        onReady={() => client.markPhaseReady()}
        onExit={onExit}
      />
    )
  }

  if (snapshot.phase === 'dawn') {
    return (
      <IntermissionPhase
        snapshot={snapshot}
        mode="dawn"
        error={error}
        onReady={() => client.markPhaseReady()}
        onExit={onExit}
      />
    )
  }

  if (snapshot.phase === 'resolution') {
    return (
      <IntermissionPhase
        snapshot={snapshot}
        mode="resolution"
        error={error}
        onReady={() => client.markPhaseReady()}
        onExit={onExit}
      />
    )
  }

  if (snapshot.phase === 'ended') {
    return <NetworkEnd snapshot={snapshot} onExit={onExit} />
  }

  const timer = (
    <ServerPhaseTimer
      serverNow={snapshot.serverNow}
      deadlineAt={snapshot.phaseDeadlineAt}
      durationSeconds={snapshot.phaseDurationSeconds}
    />
  )

  return (
    <main className={'network-game network-game-' + snapshot.phase}>
      <header className="network-game-top">
        <div>
          <small>SERVER AUTHORITATIVE · {snapshot.round}. TUR</small>
          <b>{phaseTitle(snapshot.phase)}</b>
        </div>
        {timer}
        <div className={'network-live ' + connectionState}>
          <span>●</span>{connectionState}
        </div>
        <button onClick={onExit}>Oturumdan Çık</button>
      </header>

      <section className="network-game-layout">
        <div className="network-stage">
          <div className="network-stage-head">
            <div>
              <small>{phaseKicker(snapshot.phase)}</small>
              <h1>{phaseHeadline(snapshot)}</h1>
            </div>
            {snapshot.phase === 'discussion' && snapshot.capabilities.canAdvancePhase && (
              <button className="network-host-action" onClick={() => client.advancePhase()}>
                🗳 Oylamaya Geç
              </button>
            )}
          </div>

          <PlayerGrid
            snapshot={snapshot}
            selectedTarget={selectedTarget}
            onSelect={setSelectedTarget}
          />

          {snapshot.phase === 'night' && (
            <NightActionBar
              snapshot={snapshot}
              selectedTarget={selectedTarget}
              onSubmit={(targetId) => send({ type: 'night.submit', targetId })}
            />
          )}

          {snapshot.phase === 'voting' && (
            <VoteActionBar
              snapshot={snapshot}
              selectedTarget={selectedTarget}
              onSubmit={(targetId) => send({ type: 'vote.submit', targetId })}
            />
          )}
        </div>

        <aside className="network-game-side">
          <div className="network-self-card">
            <span>{roleVisuals[snapshot.self.role].icon}</span>
            <div>
              <small>GİZLİ ROLÜN</small>
              <b>{roleVisuals[snapshot.self.role].title}</b>
              <p>{roleVisuals[snapshot.self.role].text}</p>
            </div>
          </div>

          {snapshot.self.intel.length > 0 && (
            <div className="network-intel">
              <small>KÂHİN KAYITLARI</small>
              {snapshot.self.intel.slice().reverse().map((intel) => (
                <div key={intel.round + '-' + intel.targetId}>
                  <b>{playerName(snapshot, intel.targetId)}</b>
                  <span>{intel.isVampire ? 'Vampir' : 'Vampir değil'}</span>
                  <em>{intel.round}. gece</em>
                </div>
              ))}
            </div>
          )}

          <div className="network-side-tabs">
            <button
              className={sideTab === 'chat' ? 'active' : ''}
              onClick={() => setSideTab('chat')}
            >
              ✉ Sohbet
            </button>
            {(snapshot.phase === 'discussion' || snapshot.phase === 'voting') && (
              <button
                className={sideTab === 'claims' ? 'active' : ''}
                onClick={() => setSideTab('claims')}
              >
                ◇ İddialar
              </button>
            )}
            <button
              className={sideTab === 'deduction' ? 'active' : ''}
              onClick={() => setSideTab('deduction')}
            >
              ⌘ Dedüksiyon
            </button>
          </div>

          {sideTab === 'deduction' ? (
            <NetworkDeduction snapshot={snapshot} client={client} />
          ) : sideTab === 'claims' && (snapshot.phase === 'discussion' || snapshot.phase === 'voting') ? (
            <NetworkClaims
              snapshot={snapshot}
              send={send}
              source={claimSource}
              onClearSource={() => setClaimSource(null)}
            />
          ) : (
            <NetworkChat
              snapshot={snapshot}
              send={send}
              onClaimFromMessage={(id, text) => {
                setClaimSource({ id, text })
                setSideTab('claims')
              }}
            />
          )}
        </aside>
      </section>

      {error && <div className="network-game-error">⚠ {error}</div>}
    </main>
  )
}

function RoleRevealPhase({
  snapshot,
  connectionState,
  error,
  onReady,
  onExit,
}: {
  snapshot: ViewerGameSnapshot
  connectionState: ClientConnectionState
  error: string
  onReady: () => void
  onExit: () => void
}) {
  const visual = roleVisuals[snapshot.self.role]
  const allies = snapshot.self.knownVampireIds
    .map((id) => playerName(snapshot, id))
    .filter(Boolean)

  return (
    <main className="network-role-screen">
      <section className={'network-role-card role-' + snapshot.self.role}>
        <small>SERVER TARAFINDAN YALNIZCA SANA GÖNDERİLDİ</small>
        <div className="network-role-emblem">{visual.icon}</div>
        <h1>{visual.title}</h1>
        <p>{visual.text}</p>
        {allies.length > 0 && (
          <div className="network-secret-allies">
            <b>Diğer Vampirler</b>
            <span>{allies.join(', ')}</span>
          </div>
        )}
        <ServerPhaseTimer
          serverNow={snapshot.serverNow}
          deadlineAt={snapshot.phaseDeadlineAt}
          durationSeconds={snapshot.phaseDurationSeconds}
        />
        <div className="network-ready-progress">
          <span style={{ width: snapshot.phaseReadyRequired
            ? (snapshot.phaseReadyCount / snapshot.phaseReadyRequired * 100) + '%'
            : '0%' }} />
        </div>
        <small>{snapshot.phaseReadyCount}/{snapshot.phaseReadyRequired} oyuncu rolünü gördü</small>
        <button
          className="start"
          disabled={!snapshot.capabilities.canMarkPhaseReady}
          onClick={onReady}
        >
          {snapshot.capabilities.hasMarkedPhaseReady ? '✓ Hazırsın' : 'Rolümü Gördüm · Hazırım'} <b>›</b>
        </button>
        {error && <div className="network-error">⚠ {error}</div>}
        <footer>
          <span className={connectionState === 'ready' ? 'online' : ''}>● {connectionState}</span>
          <button onClick={onExit}>Oturumdan çık</button>
        </footer>
      </section>
    </main>
  )
}

function IntermissionPhase({
  snapshot,
  mode,
  error,
  onReady,
  onExit,
}: {
  snapshot: ViewerGameSnapshot
  mode: 'dawn' | 'resolution'
  error: string
  onReady: () => void
  onExit: () => void
}) {
  const eliminated =
    mode === 'dawn'
      ? snapshot.lastNight?.victimId ?? null
      : snapshot.lastVote?.eliminatedId ?? null

  const title = mode === 'dawn'
    ? eliminated === null
      ? 'Gece Sessiz Geçti'
      : playerName(snapshot, eliminated) + ' artık aramızda değil'
    : snapshot.lastVote?.tied
      ? 'Oylar Eşitlendi'
      : eliminated === null
        ? 'Köy Kimseyi Göndermedi'
        : playerName(snapshot, eliminated) + ' köyden gönderildi'

  return (
    <main className={'network-intermission ' + mode}>
      <section className="network-intermission-card">
        <small>{mode === 'dawn' ? '☀ ŞAFAK' : '🗳 OYLAMA SONUCU'} · {snapshot.round}. TUR</small>
        <div className="network-intermission-icon">{mode === 'dawn' ? '🌅' : '⚖'}</div>
        <h1>{title}</h1>
        <p>
          {mode === 'dawn'
            ? 'Gece çözümü server tarafından tamamlandı. Gizli saldırı ve koruma ayrıntıları açıklanmaz.'
            : 'Yalnızca tamamlanmış oylar geçmişe kaydedildi. Sonuç server tarafından hesaplandı.'}
        </p>
        <ServerPhaseTimer
          serverNow={snapshot.serverNow}
          deadlineAt={snapshot.phaseDeadlineAt}
          durationSeconds={snapshot.phaseDurationSeconds}
        />
        <button
          className="start"
          disabled={!snapshot.capabilities.canMarkPhaseReady}
          onClick={onReady}
        >
          {snapshot.capabilities.hasMarkedPhaseReady
            ? '✓ Devam için hazırsın'
            : mode === 'dawn' ? 'Köy Meydanına Geç' : 'Sonraki Geceye Geç'} <b>›</b>
        </button>
        <small>{snapshot.phaseReadyCount}/{snapshot.phaseReadyRequired} hazır · süre dolunca otomatik ilerler</small>
        {error && <div className="network-error">⚠ {error}</div>}
        <button className="network-text-button" onClick={onExit}>Oturumdan çık</button>
      </section>
    </main>
  )
}

function PlayerGrid({
  snapshot,
  selectedTarget,
  onSelect,
}: {
  snapshot: ViewerGameSnapshot
  selectedTarget: number | null
  onSelect: (id: number) => void
}) {
  const selectable = new Set(
    snapshot.phase === 'night'
      ? snapshot.capabilities.nightTargetIds
      : snapshot.phase === 'voting'
        ? snapshot.capabilities.voteTargetIds
        : [],
  )

  return (
    <div className="network-council">
      <div className="network-fire">🔥</div>
      <div className="network-player-grid">
        {snapshot.players.map((player) => {
          const canSelect = selectable.has(player.id)
          const isSelf = player.id === snapshot.self.id
          return (
            <button
              key={player.id}
              className={[
                'network-player-card',
                !player.alive ? 'dead' : '',
                canSelect ? 'selectable' : '',
                selectedTarget === player.id ? 'selected' : '',
                isSelf ? 'self' : '',
              ].join(' ')}
              disabled={!canSelect}
              onClick={() => canSelect && onSelect(player.id)}
            >
              <span className="network-avatar" style={{ '--accent': accent(player.id) } as React.CSSProperties}>
                {player.name.charAt(0).toLocaleUpperCase('tr-TR')}
              </span>
              <b>{player.name}</b>
              <small>
                {!player.alive
                  ? '☠ Hayalet'
                  : isSelf
                    ? 'Sen'
                    : canSelect
                      ? 'Seçilebilir'
                      : 'Hayatta'}
              </small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NightActionBar({
  snapshot,
  selectedTarget,
  onSubmit,
}: {
  snapshot: ViewerGameSnapshot
  selectedTarget: number | null
  onSubmit: (targetId: number) => void
}) {
  const visual = roleVisuals[snapshot.self.role]

  if (!snapshot.self.alive) {
    return <div className="network-action-status ghost">☠ Geceyi Hayalet olarak izliyorsun.</div>
  }

  if (!snapshot.capabilities.canActAtNight) {
    return <div className="network-action-status">☾ Bu gece aktif rol aksiyonun yok.</div>
  }

  return (
    <div className="network-action-bar">
      <div>
        <small>{visual.action.toLocaleUpperCase('tr-TR')}</small>
        <b>
          {selectedTarget === null
            ? 'Bir oyuncu seç'
            : playerName(snapshot, selectedTarget)}
        </b>
        {snapshot.capabilities.hasSubmittedNightAction && (
          <span>✓ Önceki seçimin server'a ulaştı; faz çözülmediyse değiştirebilirsin.</span>
        )}
      </div>
      <button
        disabled={selectedTarget === null}
        onClick={() => selectedTarget !== null && onSubmit(selectedTarget)}
      >
        {snapshot.capabilities.hasSubmittedNightAction ? 'Seçimi Güncelle' : 'Aksiyonu Kilitle'} ›
      </button>
    </div>
  )
}

function VoteActionBar({
  snapshot,
  selectedTarget,
  onSubmit,
}: {
  snapshot: ViewerGameSnapshot
  selectedTarget: number | null
  onSubmit: (targetId: number) => void
}) {
  if (!snapshot.self.alive) {
    return <div className="network-action-status ghost">☠ Oylamayı Hayalet olarak izliyorsun.</div>
  }

  return (
    <div className="network-action-bar vote">
      <div>
        <small>OYUNU KİLİTLE</small>
        <b>{selectedTarget === null ? 'Köyden gönderilecek oyuncuyu seç' : playerName(snapshot, selectedTarget)}</b>
        {snapshot.capabilities.hasSubmittedVote && (
          <span>✓ Oyun server'a ulaştı; sonuçlanmadıysa değiştirebilirsin.</span>
        )}
      </div>
      <button
        disabled={selectedTarget === null}
        onClick={() => selectedTarget !== null && onSubmit(selectedTarget)}
      >
        {snapshot.capabilities.hasSubmittedVote ? 'Oyumu Değiştir' : 'Oyumu Kilitle'} ›
      </button>
    </div>
  )
}

function NetworkChat({
  snapshot,
  send,
  onClaimFromMessage,
}: {
  snapshot: ViewerGameSnapshot
  send: (command: GameCommandInput) => void
  onClaimFromMessage: (messageId: number, text: string) => void
}) {
  const channels = snapshot.capabilities.readableChatChannels
  const [channel, setChannel] = useState<ChatChannel>(
    snapshot.capabilities.writableChatChannels[0] ?? channels[0] ?? 'village',
  )
  const [text, setText] = useState('')

  useEffect(() => {
    if (!channels.includes(channel)) {
      setChannel(snapshot.capabilities.writableChatChannels[0] ?? channels[0] ?? 'village')
    }
  }, [channels.join('|'), snapshot.capabilities.writableChatChannels.join('|'), channel])

  const messages = snapshot.chatMessages.filter((message) => message.channel === channel)
  const writable = snapshot.capabilities.writableChatChannels.includes(channel)

  const submit = () => {
    const normalized = text.trim()
    if (!normalized || !writable) return
    send({ type: 'chat.send', channel, text: normalized })
    setText('')
  }

  return (
    <div className="network-chat">
      <div className="network-channel-tabs">
        {channels.map((item) => (
          <button
            key={item}
            className={channel === item ? 'active' : ''}
            onClick={() => setChannel(item)}
          >
            {channelIcon(item)} {channelName(item)}
            <small>{snapshot.capabilities.writableChatChannels.includes(item) ? 'yaz' : 'oku'}</small>
          </button>
        ))}
      </div>
      <div className="network-message-feed">
        {messages.length === 0 && <div className="network-empty">Bu kanalda henüz mesaj yok.</div>}
        {messages.map((message) => (
          <article key={message.id} className={message.authorId === snapshot.self.id ? 'mine' : ''}>
            <header>
              <b>{playerName(snapshot, message.authorId)}</b>
              <small>{message.round}. tur · {message.phase}</small>
            </header>
            <p>{message.text}</p>
            {message.channel === 'village' &&
              message.authorId === snapshot.self.id &&
              snapshot.capabilities.canRecordPublicClaim && (
                <button
                  className="network-chat-claim"
                  onClick={() => onClaimFromMessage(message.id, message.text)}
                >
                  ◇ İddia olarak kaydet
                </button>
              )}
          </article>
        ))}
      </div>
      {writable ? (
        <div className="network-chat-compose">
          <textarea
            value={text}
            maxLength={280}
            placeholder={channel === 'ghost' ? 'Hayaletlere yaz…' : channel === 'vampire' ? 'Vampirlere gizlice yaz…' : 'Köy meydanına yaz…'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <button disabled={!text.trim()} onClick={submit}>Gönder</button>
        </div>
      ) : (
        <div className="network-chat-readonly">Bu kanalı şu anda yalnızca okuyabilirsin.</div>
      )}
    </div>
  )
}

function NetworkDeduction({
  snapshot,
  client,
}: {
  snapshot: ViewerGameSnapshot
  client: BrowserMultiplayerClient
}) {
  const candidates = snapshot.players.filter((player) => player.id !== snapshot.self.id)
  const [selectedPlayerId, setSelectedPlayerId] = useState<number>(
    candidates[0]?.id ?? snapshot.self.id,
  )
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!candidates.some((player) => player.id === selectedPlayerId) && candidates[0]) {
      setSelectedPlayerId(candidates[0].id)
    }
  }, [snapshot.players.length, selectedPlayerId])

  const selectedPlayer = snapshot.players.find((player) => player.id === selectedPlayerId)
  const selectedMark = snapshot.privateDeduction.marks[selectedPlayerId] ?? 'uncertain'
  const notes = snapshot.privateDeduction.notes[selectedPlayerId] ?? []

  const setMark = (mark: DeductionMark) => {
    try {
      client.setDeductionMark(selectedPlayerId, mark)
    } catch {
      // BrowserMultiplayerClient surfaces transport failures.
    }
  }

  const addNote = () => {
    const normalized = note.trim()
    if (!normalized) return
    try {
      client.addPrivateNote(selectedPlayerId, normalized)
      setNote('')
    } catch {
      // BrowserMultiplayerClient surfaces transport failures.
    }
  }

  return (
    <div className="network-deduction">
      <header className="network-deduction-head">
        <small>ÖZEL DEDÜKSİYON DEFTERİ</small>
        <b>Yalnızca sen görürsün</b>
        <p>İşaretler ve notlar session’ına özeldir; diğer oyunculara yayınlanmaz.</p>
      </header>

      <div className="network-deduction-players">
        {candidates.map((player) => {
          const mark = snapshot.privateDeduction.marks[player.id] ?? 'uncertain'
          return (
            <button
              key={player.id}
              className={[
                player.id === selectedPlayerId ? 'active' : '',
                'mark-' + mark,
              ].join(' ')}
              onClick={() => setSelectedPlayerId(player.id)}
            >
              <span>{deductionMarkIcon(mark)}</span>
              <div>
                <b>{player.name}</b>
                <small>{deductionMarkLabel(mark)}</small>
              </div>
            </button>
          )
        })}
      </div>

      {selectedPlayer && (
        <section className="network-deduction-detail">
          <h3>{selectedPlayer.name}</h3>
          <div className="network-mark-buttons">
            {(['suspicious', 'uncertain', 'trusted'] as DeductionMark[]).map((mark) => (
              <button
                key={mark}
                className={selectedMark === mark ? 'active mark-' + mark : 'mark-' + mark}
                onClick={() => setMark(mark)}
              >
                {deductionMarkIcon(mark)} {deductionMarkLabel(mark)}
              </button>
            ))}
          </div>

          <div className="network-private-notes">
            <div className="network-note-compose">
              <textarea
                value={note}
                maxLength={220}
                placeholder="Bu oyuncu hakkında özel not…"
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    addNote()
                  }
                }}
              />
              <div>
                <small>{note.length}/220</small>
                <button disabled={!note.trim()} onClick={addNote}>Not Ekle</button>
              </div>
            </div>

            <div className="network-note-list">
              {notes.length === 0 && <div className="network-empty">Bu oyuncu için özel not yok.</div>}
              {notes.slice().reverse().map((privateNote) => (
                <article key={privateNote.id}>
                  <header>
                    <small>{privateNote.round}. tur</small>
                    <button
                      onClick={() => {
                        try {
                          client.removePrivateNote(selectedPlayerId, privateNote.id)
                        } catch {
                          // BrowserMultiplayerClient surfaces transport failures.
                        }
                      }}
                    >
                      Sil
                    </button>
                  </header>
                  <p>{privateNote.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function deductionMarkIcon(mark: DeductionMark): string {
  if (mark === 'suspicious') return '!'
  if (mark === 'trusted') return '✓'
  return '?'
}

function deductionMarkLabel(mark: DeductionMark): string {
  if (mark === 'suspicious') return 'Şüpheli'
  if (mark === 'trusted') return 'Güveniyorum'
  return 'Kararsızım'
}

function NetworkClaims({
  snapshot,
  send,
  source,
  onClearSource,
}: {
  snapshot: ViewerGameSnapshot
  send: (command: GameCommandInput) => void
  source: { id: number; text: string } | null
  onClearSource: () => void
}) {
  const [kind, setKind] = useState<ClaimCommandPayload['kind']>('role')
  const [targetId, setTargetId] = useState<number>(
    snapshot.players.find((player) => player.id !== snapshot.self.id)?.id ?? snapshot.self.id,
  )
  const [role, setRole] = useState<RoleId>('seer')
  const [statement, setStatement] = useState('')
  const [action, setAction] = useState<'protected' | 'investigated' | 'visited'>('investigated')
  const [quote, setQuote] = useState('')

  useEffect(() => {
    if (!source) return
    setQuote(source.text)
    setStatement(source.text)
  }, [source])

  const submit = () => {
    let payload: ClaimCommandPayload
    if (kind === 'role') {
      payload = { kind, role, quote: quote.trim() || undefined }
    } else if (kind === 'information') {
      if (!statement.trim()) return
      payload = { kind, targetId, statement: statement.trim(), quote: quote.trim() || undefined }
    } else if (kind === 'action') {
      payload = { kind, targetId, action, quote: quote.trim() || undefined }
    } else if (kind === 'accusation') {
      payload = { kind, targetId, suspectedRole: role, quote: quote.trim() || undefined }
    } else {
      payload = { kind, targetId, quote: quote.trim() || undefined }
    }

    if (source) {
      payload = { ...payload, sourceMessageId: source.id } as ClaimCommandPayload
    }
    send({ type: 'claim.record', payload })
    setStatement('')
    setQuote('')
    onClearSource()
  }

  return (
    <div className="network-claims">
      <div className="network-claim-list">
        {snapshot.claims.length === 0 && <div className="network-empty">Henüz yapılandırılmış iddia yok.</div>}
        {snapshot.claims.slice().reverse().map((claim) => (
          <article key={claim.id} className={claim.status === 'withdrawn' ? 'withdrawn' : ''}>
            <header>
              <b>{playerName(snapshot, claim.claimantId)}</b>
              <small>{claim.round}. tur · {claim.kind}</small>
            </header>
            <p>{claimText(snapshot, claim)}</p>
            {claim.quote && <blockquote>“{claim.quote}”</blockquote>}
            {claim.claimantId === snapshot.self.id && claim.status === 'active' && snapshot.capabilities.canWithdrawPublicClaim && (
              <button onClick={() => send({ type: 'claim.withdraw', claimId: claim.id })}>Geri çek</button>
            )}
          </article>
        ))}
      </div>

      {snapshot.capabilities.canRecordPublicClaim && (
        <>
          {source && (
            <div className="network-claim-source">
              <span>⌁ KÖY SOHBETİNDEN</span>
              <p>“{source.text}”</p>
              <button onClick={onClearSource}>Kaynağı kaldır</button>
            </div>
          )}
          <div className="network-claim-form">
          <select value={kind} onChange={(event) => setKind(event.target.value as ClaimCommandPayload['kind'])}>
            <option value="role">Rol iddiası</option>
            <option value="information">Bilgi</option>
            <option value="action">Aksiyon</option>
            <option value="accusation">Suçlama</option>
            <option value="defense">Savunma</option>
          </select>

          {kind === 'role' ? (
            <RoleSelect value={role} onChange={setRole} />
          ) : (
            <select value={targetId} onChange={(event) => setTargetId(Number(event.target.value))}>
              {snapshot.players.map((player) => (
                <option value={player.id} key={player.id}>{player.name}</option>
              ))}
            </select>
          )}

          {kind === 'information' && (
            <input value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Paylaştığın bilgi…" />
          )}
          {kind === 'action' && (
            <select value={action} onChange={(event) => setAction(event.target.value as typeof action)}>
              <option value="investigated">Araştırdım</option>
              <option value="protected">Korudum</option>
              <option value="visited">Ziyaret ettim</option>
            </select>
          )}
          {kind === 'accusation' && <RoleSelect value={role} onChange={setRole} />}
          <input value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="İsteğe bağlı doğrudan alıntı" />
          <button onClick={submit}>◇ İddiayı Kaydet</button>
          </div>
        </>
      )}
    </div>
  )
}

function RoleSelect({
  value,
  onChange,
}: {
  value: RoleId
  onChange: (role: RoleId) => void
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as RoleId)}>
      <option value="vampire">Vampir</option>
      <option value="villager">Köylü</option>
      <option value="seer">Kâhin</option>
      <option value="protector">Koruyucu</option>
    </select>
  )
}

function NetworkEnd({
  snapshot,
  onExit,
}: {
  snapshot: ViewerGameSnapshot
  onExit: () => void
}) {
  return (
    <main className="network-end">
      <section className="network-end-card">
        <small>OYUN SONA ERDİ</small>
        <div className="network-end-icon">{snapshot.winner === 'vampire' ? '🦇' : '☀'}</div>
        <h1>{snapshot.winner === 'vampire' ? 'Vampirler Kazandı' : 'Köy Kazandı'}</h1>
        <p>Roller artık güvenli şekilde açılabilir.</p>
        <div className="network-revealed-grid">
          {snapshot.revealedRoles.map((entry) => (
            <div key={entry.playerId}>
              <b>{playerName(snapshot, entry.playerId)}</b>
              <span>{roleVisuals[entry.role].icon} {roleVisuals[entry.role].title}</span>
            </div>
          ))}
        </div>
        <button className="start" onClick={onExit}>Ana Menüye Dön ›</button>
      </section>
    </main>
  )
}

function ServerPhaseTimer({
  serverNow,
  deadlineAt,
  durationSeconds,
}: {
  serverNow: number
  deadlineAt: number | null
  durationSeconds: number | null
}) {
  const initialMs = deadlineAt === null ? null : Math.max(0, deadlineAt - serverNow)
  const [remainingMs, setRemainingMs] = useState<number | null>(initialMs)

  useEffect(() => {
    if (deadlineAt === null) {
      setRemainingMs(null)
      return
    }

    const startedAt = performance.now()
    const base = Math.max(0, deadlineAt - serverNow)
    const tick = () => setRemainingMs(Math.max(0, base - (performance.now() - startedAt)))
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [deadlineAt, serverNow])

  if (remainingMs === null) return <div className="network-server-timer">Server bekliyor</div>
  const seconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return (
    <div className={'network-server-timer ' + (seconds <= 10 ? 'urgent' : '')}>
      <small>SERVER SÜRESİ</small>
      <b>{String(minutes).padStart(2, '0')}:{String(rest).padStart(2, '0')}</b>
      {durationSeconds !== null && <span>{durationSeconds} sn faz</span>}
    </div>
  )
}

function phaseTitle(phase: ViewerGameSnapshot['phase']): string {
  if (phase === 'night') return 'Gece'
  if (phase === 'discussion') return 'Köy Meclisi'
  if (phase === 'voting') return 'Oylama'
  return phase
}

function phaseKicker(phase: ViewerGameSnapshot['phase']): string {
  if (phase === 'night') return '☾ KÖY UYUYOR'
  if (phase === 'discussion') return '☀ TARTIŞMA'
  if (phase === 'voting') return '🗳 KARAR ANI'
  return ''
}

function phaseHeadline(snapshot: ViewerGameSnapshot): string {
  if (snapshot.phase === 'night') {
    if (!snapshot.self.alive) return 'Hayaletlerin gecesi'
    return snapshot.capabilities.canActAtNight
      ? roleVisuals[snapshot.self.role].action
      : 'Karanlığı izle'
  }
  if (snapshot.phase === 'discussion') return 'Kim doğru söylüyor?'
  if (snapshot.phase === 'voting') return snapshot.self.alive
    ? 'Köyden kimi göndermek istiyorsun?'
    : 'Oylamayı Hayalet olarak izliyorsun'
  return ''
}

function playerName(snapshot: ViewerGameSnapshot, id: number): string {
  return snapshot.players.find((player) => player.id === id)?.name ?? 'Bilinmeyen'
}

function claimText(snapshot: ViewerGameSnapshot, claim: ViewerGameSnapshot['claims'][number]): string {
  if (claim.kind === 'role') return `${roleVisuals[claim.role].title} rolünü iddia ediyor.`
  if (claim.kind === 'information') return `${playerName(snapshot, claim.targetId)} hakkında: ${claim.statement}`
  if (claim.kind === 'action') return `${playerName(snapshot, claim.targetId)} · ${claim.action}`
  if (claim.kind === 'accusation') {
    return `${playerName(snapshot, claim.targetId)} şüpheli${claim.suspectedRole ? ' · ' + roleVisuals[claim.suspectedRole].title : ''}`
  }
  return `${playerName(snapshot, claim.targetId)} için savunma`
}

function channelName(channel: ChatChannel): string {
  if (channel === 'vampire') return 'Vampir'
  if (channel === 'ghost') return 'Hayalet'
  return 'Köy'
}

function channelIcon(channel: ChatChannel): string {
  if (channel === 'vampire') return '🦇'
  if (channel === 'ghost') return '☠'
  return '⌂'
}

function accent(id: number): string {
  const accents = ['#b67a47','#8d83bd','#8a6d57','#a24139','#a98b55','#587991','#79634e','#6e5a75','#716550','#5e7f65','#87596d','#536f8f']
  return accents[(id - 1) % accents.length]
}
