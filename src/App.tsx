import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  beginDiscussion,
  beginNight,
  beginVoting,
  createGame,
  getActiveClaims,
  getChatAccess,
  getPlayerTimeline,
  getPrivatePlayerView,
  getVisibleChatMessages,
  getVoteHistory,
  groupRoleClaims,
  recordAccusationClaim,
  recordActionClaim,
  recordDefenseClaim,
  recordInformationClaim,
  recordRoleClaim,
  sendChatMessage,
  submitNightAction,
  submitVote,
  validNightTargets,
  withdrawClaim,
} from './game/engine'
import { completeNightWithBots, completeVoteWithBots } from './game/demo'
import { ROLE_DEFINITIONS, buildRolePack, countRoles } from './game/roles'
import { PHASE_DURATIONS_SECONDS, formatPhaseTime, isPhaseTimeUrgent } from './game/timing'
import {
  addPrivatePlayerNote,
  createPrivateDeductionState,
  getDeductionMark,
  getPrivatePlayerNotes,
  removePrivatePlayerNote,
  setDeductionMark,
} from './game/deduction'
import type { DeductionMark, PrivateDeductionState } from './game/deduction'
import type { ActionClaim, ChatChannel, ClaimKind, GameState, RoleId, StructuredClaim } from './game/types'

type Screen =
  | 'home'
  | 'lobby'
  | 'role'
  | 'night'
  | 'dawn'
  | 'ghost'
  | 'day'
  | 'vote'
  | 'vote-result'
  | 'end'

type Player = {
  id: number
  name: string
  initial: string
  accent: string
  status?: 'ready' | 'not-ready' | 'joining'
  mic?: boolean
}

const HUMAN_ID = 1

const players: Player[] = [
  { id: 1, name: 'Ali', initial: 'A', accent: '#b67a47', status: 'ready', mic: true },
  { id: 2, name: 'Ayşe', initial: 'A', accent: '#8d83bd', status: 'ready' },
  { id: 3, name: 'Mert', initial: 'M', accent: '#8a6d57', status: 'ready' },
  { id: 4, name: 'Esra', initial: 'E', accent: '#a24139', status: 'not-ready', mic: true },
  { id: 5, name: 'Burak', initial: 'B', accent: '#a98b55', status: 'ready' },
  { id: 6, name: 'Zeynep', initial: 'Z', accent: '#587991', status: 'ready' },
  { id: 7, name: 'Kerem', initial: 'K', accent: '#79634e', status: 'not-ready' },
  { id: 8, name: 'Elif', initial: 'E', accent: '#6e5a75', status: 'ready' },
  { id: 9, name: 'Can', initial: 'C', accent: '#716550', status: 'joining' },
]

const roleCounts = countRoles(buildRolePack(players.length))

const roleVisuals: Record<RoleId, { icon: string; title: string; text: string; action: string }> = {
  vampire: {
    icon: '🦇',
    title: 'Vampir',
    text: 'Gece diğer vampirlerle bir kurban seç. Gündüz kimliğini sakla.',
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

function Brand() {
  return (
    <div className="brand">
      <div className="brand-title"><span>Vampir</span><strong>Köylü</strong></div>
      <div className="brand-ribbon">Sözler, Maskeler, Hayatta Kalanlar...</div>
    </div>
  )
}

function VillageBackdrop() {
  return (
    <div className="scene" aria-hidden>
      <div className="sky" /><div className="moon" /><div className="mountains" />
      <div className="castle" /><div className="houses left" /><div className="houses right" />
      <div className="mist one" /><div className="mist two" />
      <div className="fire"><i /><b /></div><div className="vignette" />
    </div>
  )
}

function Topbar() {
  return (
    <header className="topbar">
      <button>⚙ <span>Ayarlar</span></button>
      <div className="top-spacer" />
      <div className="profile">
        <span className="avatar small">A</span>
        <div><b>Ali</b><small>Köyün Sesi</small></div><em>12</em>
      </div>
      <div className="coin">☀ 2.450</div><button>♟</button><button>✉</button>
    </header>
  )
}

function Lore() {
  return <div className="lore"><span>Gözlemle</span><span>Sorgula</span><span>Çelişkileri Bul</span><span>Doğruyu Keşfet</span></div>
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

function usePhaseCountdown(
  durationSeconds: number,
  resetKey: string,
  onExpire: () => void,
) {
  const [remaining, setRemaining] = useState(durationSeconds)
  const expireRef = useRef(onExpire)
  const expiredRef = useRef(false)
  expireRef.current = onExpire

  useEffect(() => {
    expiredRef.current = false
    const deadline = Date.now() + durationSeconds * 1000

    const tick = () => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setRemaining(next)

      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true
        expireRef.current()
      }
    }

    tick()
    const interval = window.setInterval(tick, 250)
    return () => window.clearInterval(interval)
  }, [durationSeconds, resetKey])

  return remaining
}

function PhaseTimer({
  seconds,
  label,
}: {
  seconds: number
  label: string
}) {
  const urgent = isPhaseTimeUrgent(seconds)

  return (
    <small
      className={'phase-timer ' + (urgent ? 'urgent' : '')}
      aria-live={urgent ? 'polite' : 'off'}
    >
      <span>⌛</span>
      <b>{label}</b>
      <em>{formatPhaseTime(seconds)}</em>
    </small>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [game, setGame] = useState<GameState | null>(null)
  const [deduction, setDeduction] = useState<PrivateDeductionState>(() =>
    createPrivateDeductionState(HUMAN_ID, players.map((player) => player.id)),
  )
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<'claims' | 'votes' | 'notes'>('claims')
  const [notes, setNotes] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [claimComposerOpen, setClaimComposerOpen] = useState(false)
  const [claimKind, setClaimKind] = useState<ClaimKind>('role')
  const [claimantId, setClaimantId] = useState(HUMAN_ID)
  const [claimTargetId, setClaimTargetId] = useState(2)
  const [claimRole, setClaimRole] = useState<RoleId>('seer')
  const [claimStatement, setClaimStatement] = useState('')
  const [claimAction, setClaimAction] = useState<ActionClaim['action']>('investigated')
  const [claimSuspectedRole, setClaimSuspectedRole] = useState<RoleId | ''>('vampire')
  const [claimQuote, setClaimQuote] = useState('')
  const [claimSourceMessageId, setClaimSourceMessageId] = useState<number | null>(null)
  const [ghostReturnScreen, setGhostReturnScreen] = useState<'dawn' | 'vote-result'>('dawn')
  const [chatLastRead, setChatLastRead] = useState<Record<ChatChannel, number>>({
    village: 0,
    vampire: 0,
    ghost: 0,
  })

  const markChatRead = (channel: ChatChannel, messageId: number) => {
    setChatLastRead((current) =>
      messageId <= current[channel]
        ? current
        : { ...current, [channel]: messageId },
    )
  }

  const addNote = () => {
    const text = note.trim()
    if (!text) return
    setNotes((current) => [...current, text])
    setNote('')
  }

  const removeNote = (index: number) => {
    setNotes((current) => current.filter((_, noteIndex) => noteIndex !== index))
  }

  const openClaimComposer = () => {
    if (!game) return
    const self = game.players.find((player) => player.id === HUMAN_ID)
    if (!self?.alive) return
    setClaimSourceMessageId(null)
    setClaimQuote('')
    setClaimStatement('')
    const living = game.players.filter((player) => player.alive)
    if (!living.some((player) => player.id === claimantId) && living[0]) {
      setClaimantId(living[0].id)
    }
    if (!game.players.some((player) => player.id === claimTargetId) && game.players[0]) {
      setClaimTargetId(game.players[0].id)
    }
    setClaimComposerOpen(true)
  }

  const openClaimFromMessage = (messageId: number) => {
    if (!game) return
    const self = game.players.find((player) => player.id === HUMAN_ID)
    if (!self?.alive) return
    const message = game.chatMessages.find((candidate) => candidate.id === messageId)
    if (!message || message.channel !== 'village') return

    setClaimSourceMessageId(message.id)
    setClaimantId(message.authorId)
    setClaimQuote(message.text)
    setClaimStatement(message.text)
    setClaimComposerOpen(true)
  }

  const addStructuredClaim = () => {
    if (!game) return
    const self = game.players.find((player) => player.id === HUMAN_ID)
    if (!self?.alive) return

    try {
      let next = game
      if (claimKind === 'role') {
        next = recordRoleClaim(
          game,
          claimantId,
          claimRole,
          claimQuote,
          claimSourceMessageId ?? undefined,
        )
      } else if (claimKind === 'information') {
        next = recordInformationClaim(
          game,
          claimantId,
          claimTargetId,
          claimStatement,
          claimQuote,
          claimSourceMessageId ?? undefined,
        )
      } else if (claimKind === 'action') {
        next = recordActionClaim(
          game,
          claimantId,
          claimTargetId,
          claimAction,
          claimQuote,
          claimSourceMessageId ?? undefined,
        )
      } else if (claimKind === 'accusation') {
        next = recordAccusationClaim(
          game,
          claimantId,
          claimTargetId,
          claimSuspectedRole || undefined,
          claimQuote,
          claimSourceMessageId ?? undefined,
        )
      } else {
        next = recordDefenseClaim(
          game,
          claimantId,
          claimTargetId,
          claimQuote,
          claimSourceMessageId ?? undefined,
        )
      }

      setGame(next)
      setClaimStatement('')
      setClaimQuote('')
      setClaimSourceMessageId(null)
      setClaimComposerOpen(false)
    } catch {
      // Motor geçersiz veya eksik yapılandırılmış kayıtları reddeder.
    }
  }

  const removeClaim = (claimId: number) => {
    if (!game) return
    const self = game.players.find((player) => player.id === HUMAN_ID)
    if (!self?.alive) return
    setGame(withdrawClaim(game, claimId))
  }

  const closeClaimComposer = () => {
    setClaimComposerOpen(false)
    setClaimSourceMessageId(null)
    setClaimQuote('')
    setClaimStatement('')
  }

  const sendHumanChat = (channel: ChatChannel, text: string) => {
    if (!game) return
    try {
      setGame(sendChatMessage(game, HUMAN_ID, channel, text))
    } catch {
      // Görünürlük ve yazma yetkisi motor tarafından tekrar doğrulanır.
    }
  }

  const launchGame = () => {
    const next = createGame(players.map(({ id, name }) => ({ id, name })))
    setGame(next)
    setDeduction(
      createPrivateDeductionState(HUMAN_ID, players.map((player) => player.id)),
    )
    setSelected(null)
    setGhostReturnScreen('dawn')
    setChatLastRead({ village: 0, vampire: 0, ghost: 0 })
    setScreen('role')
  }

  const updateDeductionMark = (playerId: number, mark: DeductionMark) => {
    setDeduction((current) => setDeductionMark(current, playerId, mark))
  }

  const addPrivateNote = (playerId: number, round: number, text: string) => {
    setDeduction((current) =>
      addPrivatePlayerNote(current, playerId, round, text),
    )
  }

  const removePrivateNote = (playerId: number, noteId: number) => {
    setDeduction((current) =>
      removePrivatePlayerNote(current, playerId, noteId),
    )
  }

  const toFirstNight = () => {
    if (!game) return
    setGame(beginNight(game))
    setSelected(null)
    setScreen('night')
  }

  const resolveNightPhase = (includeHumanAction: boolean) => {
    if (!game) return
    const view = getPrivatePlayerView(game, HUMAN_ID)
    const self = view.publicPlayers.find((player) => player.id === HUMAN_ID)
    const action = ROLE_DEFINITIONS[view.selfRole].nightAction
    let next = game

    if (includeHumanAction && self?.alive && action) {
      if (selected === null) return
      next = submitNightAction(next, HUMAN_ID, selected)
    }

    next = completeNightWithBots(next, HUMAN_ID)
    const wasAlive = Boolean(self?.alive)
    const isAlive = Boolean(next.players.find((player) => player.id === HUMAN_ID)?.alive)

    setGame(next)
    setSelected(null)

    if (next.winner) {
      setScreen('end')
    } else if (wasAlive && !isAlive) {
      setGhostReturnScreen('dawn')
      setScreen('ghost')
    } else {
      setScreen('dawn')
    }
  }

  const finishNight = () => resolveNightPhase(true)
  const finishNightFromTimer = () => resolveNightPhase(false)

  const toDiscussion = () => {
    if (!game) return
    setGame(beginDiscussion(game))
    setSelected(null)
    setScreen('day')
  }

  const toVoting = () => {
    if (!game) return
    closeClaimComposer()
    setGame(beginVoting(game))
    setSelected(null)
    setScreen('vote')
  }

  const resolveVotePhase = (includeHumanVote: boolean) => {
    if (!game) return
    const self = game.players.find((player) => player.id === HUMAN_ID)
    let next = game

    if (includeHumanVote && self?.alive) {
      if (selected === null) return
      next = submitVote(next, HUMAN_ID, selected)
    }

    next = completeVoteWithBots(next, HUMAN_ID)
    const wasAlive = Boolean(self?.alive)
    const isAlive = Boolean(next.players.find((player) => player.id === HUMAN_ID)?.alive)

    setGame(next)
    setSelected(null)

    if (next.winner) {
      setScreen('end')
    } else if (wasAlive && !isAlive) {
      setGhostReturnScreen('vote-result')
      setScreen('ghost')
    } else {
      setScreen('vote-result')
    }
  }

  const finishVote = () => resolveVotePhase(true)
  const finishVoteFromTimer = () => resolveVotePhase(false)

  const toNextNight = () => {
    if (!game) return
    setGame(beginNight(game))
    setSelected(null)
    setScreen('night')
  }

  return (
    <div className={'app phase-' + screen}>
      <VillageBackdrop /><Topbar />
      {screen === 'home' && <Home onLobby={() => setScreen('lobby')} onQuick={launchGame} />}
      {screen === 'lobby' && <Lobby onBack={() => setScreen('home')} onStart={launchGame} />}
      {screen === 'role' && game && <RoleReveal game={game} onContinue={toFirstNight} />}
      {screen === 'night' && game && (
        <Night
          game={game}
          selected={selected}
          setSelected={setSelected}
          onResolve={finishNight}
          onTimeout={finishNightFromTimer}
          onSendChat={sendHumanChat}
          onMarkChatRead={markChatRead}
        />
      )}
      {screen === 'dawn' && game && <Dawn game={game} onContinue={toDiscussion} />}
      {screen === 'ghost' && game && (
        <GhostTransition
          game={game}
          cause={ghostReturnScreen === 'dawn' ? 'night' : 'vote'}
          onSendChat={sendHumanChat}
          onMarkChatRead={markChatRead}
          onContinue={() => setScreen(ghostReturnScreen)}
        />
      )}
      {screen === 'day' && game && (
        <Day
          game={game}
          selected={selected}
          setSelected={setSelected}
          tab={tab}
          setTab={setTab}
          notes={notes}
          note={note}
          setNote={setNote}
          addNote={addNote}
          removeNote={removeNote}
          onVote={toVoting}
          onTimeout={toVoting}
          onOpenClaimComposer={openClaimComposer}
          onWithdrawClaim={removeClaim}
          deduction={deduction}
          onDeductionChange={updateDeductionMark}
          onAddPrivateNote={addPrivateNote}
          onRemovePrivateNote={removePrivateNote}
          onSendChat={sendHumanChat}
          onClaimFromMessage={openClaimFromMessage}
          chatLastRead={chatLastRead}
          onMarkChatRead={markChatRead}
        />
      )}
      {claimComposerOpen && game && (
        <ClaimComposer
          game={game}
          kind={claimKind}
          claimantId={claimantId}
          targetId={claimTargetId}
          role={claimRole}
          statement={claimStatement}
          action={claimAction}
          suspectedRole={claimSuspectedRole}
          quote={claimQuote}
          sourceMessageId={claimSourceMessageId}
          setKind={setClaimKind}
          setClaimantId={setClaimantId}
          setTargetId={setClaimTargetId}
          setRole={setClaimRole}
          setStatement={setClaimStatement}
          setAction={setClaimAction}
          setSuspectedRole={setClaimSuspectedRole}
          setQuote={setClaimQuote}
          onClose={closeClaimComposer}
          onSave={addStructuredClaim}
        />
      )}
      {screen === 'vote' && game && (
        <Voting
          game={game}
          selected={selected}
          setSelected={setSelected}
          onResolve={finishVote}
          onTimeout={finishVoteFromTimer}
        />
      )}
      {screen === 'vote-result' && game && <VoteResult game={game} onContinue={toNextNight} />}
      {screen === 'end' && game && <EndScreen game={game} onAgain={launchGame} onHome={() => setScreen('home')} />}
    </div>
  )
}

function Home({ onLobby, onQuick }: { onLobby: () => void; onQuick: () => void }) {
  return (
    <main className="home">
      <section>
        <Brand />
        <div className="menu">
          <Menu primary icon="⚔" title="Hızlı Oyun" sub="Hemen oyna, yeni insanlarla tanış." onClick={onQuick} />
          <Menu icon="⌂" title="Oda Kur" sub="Kendi kurallarınla oyna." onClick={onLobby} />
          <Menu icon="♟" title="Odaya Katıl" sub="Arkadaşlarının odasına katıl." onClick={onLobby} />
          <Menu icon="▤" title="Nasıl Oynanır?" sub="Kuralları öğren, ustalaş." />
        </div>
      </section>
      <aside className="home-side">
        <div className="promo">
          <div className="portrait-big">V</div>
          <div><small>YENİ SEZON</small><h2>Karanlık geri dönüyor.</h2><p>Daha fazla strateji, daha keskin blöfler, daha zor kararlar.</p><button>Detayları Gör ›</button></div>
        </div>
        <div className="invite"><div className="face-row"><i>A</i><i>Y</i><i>Z</i><i>K</i></div><h3>Arkadaşlarını Davet Et</h3><p>Aynı masada, farklı gerçekler.</p><button>♟ Davet Et</button></div>
        <blockquote>“Kim dost, kim düşman?<br />Doğru soruları sor...”</blockquote>
      </aside>
      <Lore />
    </main>
  )
}

function Menu({ icon, title, sub, onClick, primary }: { icon: string; title: string; sub: string; onClick?: () => void; primary?: boolean }) {
  return <button className={'menu-btn ' + (primary ? 'primary' : '')} onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{sub}</small></div><em>›</em></button>
}

function Lobby({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  return (
    <main className="lobby">
      <aside className="lobby-left"><Brand /><button className="back" onClick={onBack}>← Ana menü</button><Lore /></aside>
      <section className="panel lobby-panel">
        <div className="panel-head"><h1>Oda Lobisi</h1><div className="code"><small>ODA KODU</small><b>VK7M3</b></div><button>⌯ Paylaş</button></div>
        <div className="lobby-grid">
          <div>
            <h3>Oyuncular <small>({players.length}/10)</small></h3>
            <div className="player-list">
              {players.map((player, index) => (
                <div className="player-line" key={player.id}>
                  <span className="avatar" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
                  <div><b>{player.name} {index === 0 && <em>♛</em>}</b><small className={player.status}>{player.status === 'ready' ? '● Hazır' : player.status === 'joining' ? '○ Katılıyor...' : '● Hazır Değil'}</small></div>
                  <span className="mic">{player.mic ? '♬' : '♩'}</span><button>•••</button>
                </div>
              ))}
              <div className="empty">＋ <b>Boş Oyuncu</b><button>♟ Davet Et</button></div>
            </div>
            <div className="chat lobby-chat-placeholder"><b>Lobi Sohbeti</b><p>Gerçek zamanlı lobi mesajlaşması çok oyunculu ağ katmanıyla birlikte bağlanacak.</p><small>Oyun içi Köy, Vampir ve Hayalet sohbetleri aktif oyun motoruna bağlıdır.</small></div>
          </div>
          <div className="settings">
            <div className="tabs"><button className="active">Oyun Ayarları</button><button>Rol Dağılımı</button></div>
            <div className="mode"><span>🌒</span><div><small>OYUN MODU</small><h2>Klasik Paket</h2><p>Oyuncu sayısına göre otomatik ve dengeli.</p></div></div>
            <Setting icon="◆" label="Harita" value="Köy Meydanı" />
            <Setting icon="☀" label="Gündüz Süresi" value="90 saniye" />
            <Setting icon="☾" label="Gece Süresi" value="60 saniye" />
            <Setting icon="☵" label="Tartışma" value="Var" />
            <div className="roles">
              <h3>Rol Dağılımı ({players.length} Oyuncu)</h3>
              <div>
                <Role icon="🦇" name="Vampir" n={String(roleCounts.vampire)} />
                <Role icon="♙" name="Köylü" n={String(roleCounts.villager)} />
                <Role icon="◉" name="Kâhin" n={String(roleCounts.seer)} />
                <Role icon="⬟" name="Koruyucu" n={String(roleCounts.protector)} />
              </div>
              <label>Rolleri güvenli rastgele dağıt <input type="checkbox" checked readOnly /></label>
            </div>
            <button className="start" onClick={onStart}>Oyunu Başlat <b>›</b></button>
          </div>
        </div>
      </section>
    </main>
  )
}

function Setting({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className="setting"><span>{icon}</span><b>{label}</b><button>‹</button><strong>{value}</strong><button>›</button></div>
}

function Role({ icon, name, n }: { icon: string; name: string; n: string }) {
  return <div className="role"><span>{icon}</span><b>{name}</b><em>{n}</em></div>
}

function RoleReveal({ game, onContinue }: { game: GameState; onContinue: () => void }) {
  const nightSeconds = usePhaseCountdown(
    PHASE_DURATIONS_SECONDS.night,
    `night-${game.round}`,
    onTimeout,
  )
  const view = getPrivatePlayerView(game, HUMAN_ID)
  const visual = roleVisuals[view.selfRole]
  const allies = view.knownVampireIds
    .map((id) => view.publicPlayers.find((player) => player.id === id)?.name)
    .filter(Boolean)

  return (
    <main className="result-shell">
      <Brand />
      <section className={'flow-card role-reveal-card role-' + view.selfRole}>
        <small>ROLÜN</small>
        <div className="role-emblem">{visual.icon}</div>
        <h1>{visual.title}</h1>
        <p>{visual.text}</p>
        {allies.length > 0 && <div className="secret-line"><b>Diğer Vampir:</b> {allies.join(', ')}</div>}
        <div className="privacy-note">Bu bilgi yalnızca sana gösterilir.</div>
        <button className="start" onClick={onContinue}>Hazırım · Geceye Geç <b>›</b></button>
      </section>
      <Lore />
    </main>
  )
}

function Day({
  game,
  selected,
  setSelected,
  tab,
  setTab,
  notes,
  note,
  setNote,
  addNote,
  removeNote,
  onVote,
  onTimeout,
  onOpenClaimComposer,
  onWithdrawClaim,
  deduction,
  onDeductionChange,
  onAddPrivateNote,
  onRemovePrivateNote,
  onSendChat,
  onClaimFromMessage,
  chatLastRead,
  onMarkChatRead,
}: {
  game: GameState
  selected: number | null
  setSelected: (id: number | null) => void
  tab: 'claims' | 'votes' | 'notes'
  setTab: (tab: 'claims' | 'votes' | 'notes') => void
  notes: string[]
  note: string
  setNote: (value: string) => void
  addNote: () => void
  removeNote: (index: number) => void
  onVote: () => void
  onTimeout: () => void
  onOpenClaimComposer: () => void
  onWithdrawClaim: (claimId: number) => void
  deduction: PrivateDeductionState
  onDeductionChange: (playerId: number, mark: DeductionMark) => void
  onAddPrivateNote: (playerId: number, round: number, text: string) => void
  onRemovePrivateNote: (playerId: number, noteId: number) => void
  onSendChat: (channel: ChatChannel, text: string) => void
  onClaimFromMessage: (messageId: number) => void
  chatLastRead: Record<ChatChannel, number>
  onMarkChatRead: (channel: ChatChannel, messageId: number) => void
}) {
  const [panelMode, setPanelMode] = useState<'chat' | 'deduction'>('chat')
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const mobileLayout = useMediaQuery('(max-width: 900px)')
  const discussionSeconds = usePhaseCountdown(
    PHASE_DURATIONS_SECONDS.discussion,
    `discussion-${game.round}`,
    onTimeout,
  )
  const [chatChannel, setChatChannel] = useState<ChatChannel>(() =>
    getChatAccess(game, HUMAN_ID).writable.includes('ghost') ? 'ghost' : 'village',
  )
  const [chatFocusMessageId, setChatFocusMessageId] = useState<number | null>(null)
  const publicPlayers = getPrivatePlayerView(game, HUMAN_ID).publicPlayers
  const aliveById = new Map(publicPlayers.map((player) => [player.id, player.alive]))
  const viewerAlive = aliveById.get(HUMAN_ID) ?? false

  const activeClaimCount = getActiveClaims(game).length
  const voteRoundCount = new Set(getVoteHistory(game).map((vote) => vote.round)).size
  const playerPrivateNoteCount = Object.values(deduction.notes).reduce(
    (total, playerNotes) => total + playerNotes.length,
    0,
  )
  const privateNoteCount = notes.length + playerPrivateNoteCount

  const visibleChatMessages = getVisibleChatMessages(game, HUMAN_ID)
  const unreadByChannel: Record<ChatChannel, number> = {
    village: 0,
    vampire: 0,
    ghost: 0,
  }
  for (const message of visibleChatMessages) {
    if (
      message.authorId !== HUMAN_ID &&
      message.id > chatLastRead[message.channel]
    ) {
      unreadByChannel[message.channel] += 1
    }
  }
  const totalUnread = Object.values(unreadByChannel).reduce(
    (total, count) => total + count,
    0,
  )

  const openSourceMessage = (messageId: number) => {
    const source = game.chatMessages.find((message) => message.id === messageId)
    if (!source || source.channel !== 'village') return
    setSelected(null)
    setPanelMode('chat')
    setMobilePanelOpen(true)
    setChatChannel('village')
    setChatFocusMessageId(messageId)
  }

  return (
    <main className="game">
      <section className="council">
        <Brand />
        <div className="phase-badge">
          <b>☀ {game.round}. Gün</b>
          <span>Köy Meclisi</span>
          <PhaseTimer seconds={discussionSeconds} label="Tartışma" />
        </div>
        <div className="ring">
          {players.map((player, index) => {
            const angle = index / players.length * Math.PI * 2 - Math.PI / 2
            const x = 50 + Math.cos(angle) * 40
            const y = 50 + Math.sin(angle) * 37
            const alive = aliveById.get(player.id) ?? true
            const privateMark = getDeductionMark(deduction, player.id)
            return (
              <button
                key={player.id}
                className={'seat ' + (selected === player.id ? 'selected ' : '') + (!alive ? 'dead-seat' : '')}
                style={{ left: x + '%', top: y + '%' }}
                onClick={() => {
                  setMobilePanelOpen(false)
                  setSelected(selected === player.id ? null : player.id)
                }}
              >
                <i>{index + 1}</i>
                <span className="avatar player-avatar" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
                <b>{player.name}</b><em>{alive ? '•••' : '☠'}</em>
                {privateMark !== 'uncertain' && (
                  <small
                    className={'private-deduction-mark ' + privateMark}
                    title={privateMark === 'suspicious' ? 'Özel değerlendirme: Şüpheli' : 'Özel değerlendirme: Güveniyorum'}
                  >
                    {privateMark === 'suspicious' ? '!' : '✓'}
                  </small>
                )}
              </button>
            )
          })}
          <div className="bonfire"><i /><b /></div>
        </div>
        <Lore />
        <button className="vote" onClick={onVote}>Oylamaya Geç <b>›</b></button>
        <nav className="mobile-game-dock" aria-label="Köy meclisi araçları">
          <button
            className={panelMode === 'chat' && mobilePanelOpen ? 'active' : ''}
            onClick={() => {
              setSelected(null)
              setPanelMode('chat')
              setMobilePanelOpen(true)
            }}
          >
            <span>✉</span>
            <b>Sohbet</b>
            {totalUnread > 0 && <em>{totalUnread}</em>}
          </button>
          <button
            className={panelMode === 'deduction' && mobilePanelOpen ? 'active' : ''}
            onClick={() => {
              setSelected(null)
              setPanelMode('deduction')
              setMobilePanelOpen(true)
            }}
          >
            <span>⌘</span>
            <b>Dedüksiyon</b>
            <em>{activeClaimCount + privateNoteCount}</em>
          </button>
        </nav>
      </section>
      <div
        className={'mobile-sheet-backdrop ' + (mobilePanelOpen ? 'open' : '')}
        onClick={() => setMobilePanelOpen(false)}
        aria-hidden
      />
      <aside className={'panel day-side-panel ' + (panelMode === 'deduction' ? 'deduction ' : 'chat-side ') + (mobilePanelOpen ? 'mobile-open' : '')}>
        <div className="mobile-sheet-head">
          <span className="mobile-sheet-grabber" />
          <b>{panelMode === 'chat' ? 'Sohbet' : 'Dedüksiyon'}</b>
          <button aria-label="Paneli kapat" onClick={() => setMobilePanelOpen(false)}>×</button>
        </div>
        <nav className="panel-mode-switch" aria-label="Köy meclisi yan paneli">
          <button className={panelMode === 'chat' ? 'active' : ''} onClick={() => { setPanelMode('chat'); setMobilePanelOpen(true) }}>
            <span>✉</span><b>Sohbet</b>
            {totalUnread > 0 && <em className="mode-unread">{totalUnread}</em>}
          </button>
          <button className={panelMode === 'deduction' ? 'active' : ''} onClick={() => { setPanelMode('deduction'); setMobilePanelOpen(true) }}>
            <span>⌘</span><b>Dedüksiyon</b>
          </button>
        </nav>

        {panelMode === 'chat' ? (
          <ChatPanel
            game={game}
            viewerId={HUMAN_ID}
            onSend={onSendChat}
            onClaimFromMessage={viewerAlive ? onClaimFromMessage : undefined}
            activeChannel={chatChannel}
            onActiveChannelChange={setChatChannel}
            unreadByChannel={unreadByChannel}
            onMarkRead={onMarkChatRead}
            focusMessageId={chatFocusMessageId}
            onFocusHandled={() => setChatFocusMessageId(null)}
            visible={!mobileLayout || mobilePanelOpen}
          />
        ) : (
          <>
        <header className="deduction-head">
          <div>
            <small>ÖZEL DEDÜKSİYON DEFTERİ</small>
            <b>Köy Kayıtları</b>
          </div>
          <span>{game.round}. Gün</span>
        </header>
        <blockquote>“Sistem kayıt tutar. Kararı sen verirsin.”</blockquote>
        <nav className="deduction-tabs" aria-label="Dedüksiyon bölümleri">
          <button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}>
            <span>◇</span><b>İddialar</b><em>{activeClaimCount}</em>
          </button>
          <button className={tab === 'votes' ? 'active' : ''} onClick={() => setTab('votes')}>
            <span>🗳</span><b>Oylar</b><em>{voteRoundCount}</em>
          </button>
          <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>
            <span>▤</span><b>Notlar</b><em>{privateNoteCount}</em>
          </button>
        </nav>
        <div className="deduction-body">
          {tab === 'claims' && (
            <Claims
              game={game}
              onOpenComposer={onOpenClaimComposer}
              onWithdrawClaim={onWithdrawClaim}
              onOpenSourceMessage={openSourceMessage}
              canMutate={viewerAlive}
            />
          )}
          {tab === 'votes' && <Votes game={game} />}
          {tab === 'notes' && (
            <NotesPane
              notes={notes}
              note={note}
              setNote={setNote}
              addNote={addNote}
              removeNote={removeNote}
              deduction={deduction}
            />
          )}
        </div>
          </>
        )}
      </aside>
      {selected && (
        <Inspector
          game={game}
          player={players.find((player) => player.id === selected)!}
          alive={aliveById.get(selected) ?? true}
          deductionMark={getDeductionMark(deduction, selected)}
          privateNotes={getPrivatePlayerNotes(deduction, selected)}
          isSelf={selected === HUMAN_ID}
          onDeductionChange={(mark) => onDeductionChange(selected, mark)}
          onAddPrivateNote={(text) => onAddPrivateNote(selected, game.round, text)}
          onRemovePrivateNote={(noteId) => onRemovePrivateNote(selected, noteId)}
          onOpenSourceMessage={openSourceMessage}
          close={() => setSelected(null)}
        />
      )}
    </main>
  )
}

const chatChannelMeta: Record<ChatChannel, { label: string; icon: string; description: string }> = {
  village: {
    label: 'Köy',
    icon: '⌂',
    description: 'Yaşayan oyuncuların gündüz sohbeti',
  },
  vampire: {
    label: 'Vampir',
    icon: '🦇',
    description: 'Yalnızca Vampirler görür',
  },
  ghost: {
    label: 'Hayalet',
    icon: '☠',
    description: 'Yalnızca ölü oyuncular konuşur',
  },
}

function ChatPanel({
  game,
  viewerId,
  onSend,
  onClaimFromMessage,
  activeChannel: controlledChannel,
  onActiveChannelChange,
  unreadByChannel = { village: 0, vampire: 0, ghost: 0 },
  onMarkRead,
  focusMessageId = null,
  onFocusHandled,
  visible = true,
  compact = false,
}: {
  game: GameState
  viewerId: number
  onSend: (channel: ChatChannel, text: string) => void
  onClaimFromMessage?: (messageId: number) => void
  activeChannel?: ChatChannel
  onActiveChannelChange?: (channel: ChatChannel) => void
  unreadByChannel?: Record<ChatChannel, number>
  onMarkRead?: (channel: ChatChannel, messageId: number) => void
  focusMessageId?: number | null
  onFocusHandled?: () => void
  visible?: boolean
  compact?: boolean
}) {
  const access = getChatAccess(game, viewerId)
  const initialChannel = access.writable[0] ?? access.readable[0] ?? 'village'
  const [internalChannel, setInternalChannel] = useState<ChatChannel>(initialChannel)
  const [draft, setDraft] = useState('')
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const activeChannel = controlledChannel ?? internalChannel
  const setActiveChannel = (channel: ChatChannel) => {
    stickToBottomRef.current = true
    if (onActiveChannelChange) onActiveChannelChange(channel)
    else setInternalChannel(channel)
  }

  const preferredChannel =
    game.phase === 'night' && access.writable.length > 0
      ? access.writable[0]
      : activeChannel
  const selectedChannel = access.readable.includes(preferredChannel)
    ? preferredChannel
    : access.readable[0] ?? 'village'
  const messages = getVisibleChatMessages(game, viewerId).filter(
    (message) => message.channel === selectedChannel,
  )
  const writable = access.writable.includes(selectedChannel)
  const meta = chatChannelMeta[selectedChannel]
  const lastMessageId = messages.at(-1)?.id ?? 0

  useEffect(() => {
    if (!visible || !feedRef.current || focusMessageId !== null) return
    if (stickToBottomRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
      if (lastMessageId > 0) onMarkRead?.(selectedChannel, lastMessageId)
    }
  }, [lastMessageId, selectedChannel, focusMessageId, onMarkRead, visible])

  useEffect(() => {
    if (!visible || focusMessageId === null || !feedRef.current) return
    const target = feedRef.current.querySelector<HTMLElement>(
      `[data-message-id="${focusMessageId}"]`,
    )
    if (!target) return
    stickToBottomRef.current = false
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightedMessageId(focusMessageId)
    onMarkRead?.(selectedChannel, focusMessageId)
    onFocusHandled?.()
  }, [focusMessageId, selectedChannel, onFocusHandled, onMarkRead, visible])

  useEffect(() => {
    if (highlightedMessageId === null) return
    const timeout = window.setTimeout(() => setHighlightedMessageId(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [highlightedMessageId])

  const handleFeedScroll = () => {
    const feed = feedRef.current
    if (!feed) return
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    const nearBottom = distanceFromBottom < 72
    stickToBottomRef.current = nearBottom
    if (nearBottom && lastMessageId > 0) {
      onMarkRead?.(selectedChannel, lastMessageId)
    }
  }

  const send = () => {
    const text = draft.trim()
    if (!text || !writable) return
    onSend(selectedChannel, text)
    setDraft('')
  }

  return (
    <section className={'chat-panel ' + (compact ? 'compact' : '')}>
      <header className="chat-panel-head">
        <div>
          <small>{meta.icon} {meta.label.toLocaleUpperCase('tr-TR')} SOHBETİ</small>
          <b>{meta.description}</b>
        </div>
        <span>{game.round}. {game.phase === 'night' ? 'Gece' : 'Gün'}</span>
      </header>

      {access.readable.length > 1 && (
        <nav className="chat-channel-tabs" aria-label="Sohbet kanalları">
          {access.readable.map((channel) => {
            const channelMeta = chatChannelMeta[channel]
            const canWrite = access.writable.includes(channel)
            return (
              <button
                key={channel}
                className={selectedChannel === channel ? 'active' : ''}
                onClick={() => setActiveChannel(channel)}
              >
                <span>{channelMeta.icon}</span>
                <b>{channelMeta.label}</b>
                {unreadByChannel[channel] > 0
                  ? <em className="channel-unread">{unreadByChannel[channel]}</em>
                  : <em>{canWrite ? 'yaz' : 'oku'}</em>}
              </button>
            )
          })}
        </nav>
      )}

      <div
        ref={feedRef}
        className={'chat-feed chat-feed-' + selectedChannel}
        onScroll={handleFeedScroll}
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <span>{meta.icon}</span>
            <b>Henüz mesaj yok.</b>
            <small>{writable ? 'İlk mesajı sen yazabilirsin.' : 'Bu kanal şu anda yalnızca okunabilir.'}</small>
          </div>
        ) : (
          messages.map((message, index) => {
            const author = players.find((player) => player.id === message.authorId)
            const mine = message.authorId === viewerId
            const previous = messages[index - 1]
            const phaseKey = `${message.round}-${message.phase}`
            const previousPhaseKey = previous
              ? `${previous.round}-${previous.phase}`
              : null
            const showPhaseDivider = phaseKey !== previousPhaseKey
            return (
              <div className="chat-message-block" key={message.id}>
                {showPhaseDivider && (
                  <div className="chat-phase-divider">
                    <span />
                    <b>{message.round}. {message.phase === 'night' ? 'Gece' : 'Gün'}</b>
                    <span />
                  </div>
                )}
                <article
                  data-message-id={message.id}
                  className={[
                    mine ? 'mine' : '',
                    highlightedMessageId === message.id ? 'source-highlight' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="avatar" style={{ '--accent': author?.accent ?? '#685849' } as CSSProperties}>
                    {author?.initial ?? '?'}
                  </span>
                  <div>
                    <header>
                      <b>{author?.name ?? 'Oyuncu'}</b>
                      <small>{message.round}. {message.phase === 'night' ? 'Gece' : 'Gün'}</small>
                    </header>
                    <p>{message.text}</p>
                    {selectedChannel === 'village' && onClaimFromMessage && (
                      <button
                        className="chat-to-claim"
                        onClick={() => onClaimFromMessage(message.id)}
                      >
                        ◇ İddia olarak kaydet
                      </button>
                    )}
                  </div>
                </article>
              </div>
            )
          })
        )}
      </div>

      {writable ? (
        <div className="chat-compose">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            placeholder={selectedChannel === 'vampire' ? 'Vampir takımına yaz...' : selectedChannel === 'ghost' ? 'Hayaletlere yaz...' : 'Köye yaz...'}
            maxLength={280}
          />
          <button disabled={!draft.trim()} onClick={send}>Gönder</button>
        </div>
      ) : (
        <div className="chat-readonly">
          <span>◌</span>
          <p>{selectedChannel === 'vampire' ? 'Vampir sohbetine yalnızca gece yazılabilir.' : 'Bu kanala şu anda mesaj gönderemezsin.'}</p>
        </div>
      )}

      <footer>
        <span>Enter: gönder · Shift+Enter: satır atla</span>
        <b>{selectedChannel === 'vampire' ? 'GİZLİ KANAL' : selectedChannel === 'ghost' ? 'ÖLÜLER KANALI' : 'KÖY MEYDANI'}</b>
      </footer>
    </section>
  )
}

function claimTypeMeta(claim: StructuredClaim): { icon: string; label: string; detail: string } {
  if (claim.kind === 'information') {
    return { icon: '◉', label: 'Bilgi İddiası', detail: claim.statement }
  }
  if (claim.kind === 'action') {
    const labels: Record<ActionClaim['action'], string> = {
      protected: 'koruduğunu söylüyor',
      investigated: 'araştırdığını söylüyor',
      visited: 'ziyaret ettiğini söylüyor',
    }
    return { icon: '◇', label: 'Aksiyon İddiası', detail: labels[claim.action] }
  }
  if (claim.kind === 'accusation') {
    return {
      icon: '⚑',
      label: 'Suçlama',
      detail: claim.suspectedRole
        ? `${ROLE_DEFINITIONS[claim.suspectedRole].name} olduğunu düşünüyor`
        : 'şüpheli olduğunu söylüyor',
    }
  }
  if (claim.kind === 'defense') {
    return { icon: '♢', label: 'Savunma', detail: 'güvendiğini / savunduğunu söylüyor' }
  }
  return { icon: roleVisuals[claim.role].icon, label: 'Rol İddiası', detail: ROLE_DEFINITIONS[claim.role].name }
}

function Claims({
  game,
  onOpenComposer,
  onWithdrawClaim,
  onOpenSourceMessage,
  canMutate,
}: {
  game: GameState
  onOpenComposer: () => void
  onWithdrawClaim: (claimId: number) => void
  onOpenSourceMessage: (messageId: number) => void
  canMutate: boolean
}) {
  const groups = groupRoleClaims(game)
  const socialClaims = getActiveClaims(game)
    .filter((claim) => claim.kind !== 'role')
    .sort((a, b) => b.id - a.id)

  return (
    <div className="claim-board">
      <div className="claim-board-head">
        <div>
          <b>İddia Defteri</b>
          <small>Sözleri düzenler; doğruyu seçmez.</small>
        </div>
        {canMutate && <button onClick={onOpenComposer}>＋ Kayıt Ekle</button>}
      </div>
      {!canMutate && (
        <div className="claim-readonly">
          ☠ Hayalet modunda kamuya açık iddia kayıtları değiştirilemez.
        </div>
      )}

      <div className="claim-section-title">
        <b>Rol İddiaları</b>
        <small>Aynı rolü sahiplenen oyuncular birlikte görünür.</small>
      </div>

      {groups.length === 0 ? (
        <div className="claim-empty compact">
          <span>◇</span>
          <b>Henüz rol iddiası yok.</b>
        </div>
      ) : (
        <div className="claim-groups">
          {groups.map((group) => {
            const definition = ROLE_DEFINITIONS[group.role]
            return (
              <section className={'claim-group claim-group-' + group.role} key={group.role}>
                <header>
                  <div>
                    <span>{roleVisuals[group.role].icon}</span>
                    <div>
                      <b>{definition.name} İddiaları</b>
                      <small>{group.claims.length > 1 ? '◇ Birden fazla iddia' : 'Tek aktif iddia'}</small>
                    </div>
                  </div>
                </header>
                <div className="claim-group-list">
                  {group.claims.map((claim) => {
                    const claimant = players.find((player) => player.id === claim.claimantId)
                    return (
                      <article className="claim-card" key={claim.id}>
                        <span className="avatar" style={{ '--accent': claimant?.accent ?? '#755b48' } as CSSProperties}>{claimant?.initial ?? '?'}</span>
                        <div>
                          <b>{claimant?.name ?? 'Oyuncu'}</b>
                          <small>{claim.round}. Gün · Rol iddiası</small>
                          {claim.sourceMessageId && (
                            <button
                              className="claim-source-badge"
                              onClick={() => onOpenSourceMessage(claim.sourceMessageId!)}
                            >
                              ⌁ Mesaja git
                            </button>
                          )}
                          {claim.quote && <p>“{claim.quote}”</p>}
                        </div>
                        {canMutate && <button title="İddiayı geri çek" onClick={() => onWithdrawClaim(claim.id)}>↶</button>}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <div className="claim-section-title claim-stream-title">
        <b>Söz Akışı</b>
        <small>Bilgi, aksiyon, suçlama ve savunmalar.</small>
      </div>

      {socialClaims.length === 0 ? (
        <div className="claim-empty compact">
          <span>⌁</span>
          <b>Henüz başka yapılandırılmış kayıt yok.</b>
        </div>
      ) : (
        <div className="claim-stream">
          {socialClaims.map((claim) => {
            const claimant = players.find((player) => player.id === claim.claimantId)
            const targetId = 'targetId' in claim ? claim.targetId : null
            const target = targetId ? players.find((player) => player.id === targetId) : null
            const meta = claimTypeMeta(claim)

            return (
              <article className={'social-claim social-claim-' + claim.kind} key={claim.id}>
                <div className="social-claim-icon">{meta.icon}</div>
                <div className="social-claim-body">
                  <div className="social-claim-top">
                    <b>{claimant?.name ?? 'Oyuncu'}</b>
                    <small>{claim.round}. Gün · {meta.label}</small>
                  </div>
                  {claim.sourceMessageId && (
                    <button
                      className="claim-source-badge"
                      onClick={() => onOpenSourceMessage(claim.sourceMessageId!)}
                    >
                      ⌁ Mesaja git
                    </button>
                  )}
                  {target && (
                    <div className="social-claim-target">
                      <span>→</span>
                      <strong>{target.name}</strong>
                      <em>{meta.detail}</em>
                    </div>
                  )}
                  {claim.kind === 'information' && !target && <p>{claim.statement}</p>}
                  {claim.quote && <blockquote>“{claim.quote}”</blockquote>}
                </div>
                {canMutate && <button title="Kaydı geri çek" onClick={() => onWithdrawClaim(claim.id)}>↶</button>}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ClaimComposer({
  game,
  kind,
  claimantId,
  targetId,
  role,
  statement,
  action,
  suspectedRole,
  quote,
  sourceMessageId,
  setKind,
  setClaimantId,
  setTargetId,
  setRole,
  setStatement,
  setAction,
  setSuspectedRole,
  setQuote,
  onClose,
  onSave,
}: {
  game: GameState
  kind: ClaimKind
  claimantId: number
  targetId: number
  role: RoleId
  statement: string
  action: ActionClaim['action']
  suspectedRole: RoleId | ''
  quote: string
  sourceMessageId: number | null
  setKind: (kind: ClaimKind) => void
  setClaimantId: (id: number) => void
  setTargetId: (id: number) => void
  setRole: (role: RoleId) => void
  setStatement: (statement: string) => void
  setAction: (action: ActionClaim['action']) => void
  setSuspectedRole: (role: RoleId | '') => void
  setQuote: (quote: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const living = game.players.filter((player) => player.alive)
  const sourceMessage = sourceMessageId === null
    ? null
    : game.chatMessages.find((message) => message.id === sourceMessageId) ?? null
  const claimantOptions = sourceMessage
    ? game.players.filter((player) => player.id === sourceMessage.authorId)
    : living
  const roles = Object.keys(ROLE_DEFINITIONS) as RoleId[]
  const kindOptions: Array<{ id: ClaimKind; icon: string; label: string }> = [
    { id: 'role', icon: '♙', label: 'Rol' },
    { id: 'information', icon: '◉', label: 'Bilgi' },
    { id: 'action', icon: '◇', label: 'Aksiyon' },
    { id: 'accusation', icon: '⚑', label: 'Suçlama' },
    { id: 'defense', icon: '♢', label: 'Savunma' },
  ]
  const needsTarget = kind !== 'role'
  const canSave = kind !== 'information' || statement.trim().length > 0

  return (
    <div className="claim-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="claim-modal panel" role="dialog" aria-modal="true" aria-label="Yapılandırılmış kayıt ekle" onMouseDown={(event) => event.stopPropagation()}>
        <button className="claim-modal-close" onClick={onClose}>×</button>
        <small>İDDİA DEFTERİ</small>
        <h2>{sourceMessage ? 'Mesajı İddia Olarak Kaydet' : 'Kayıt Ekle'}</h2>
        <p>{sourceMessage
          ? 'Mesajın kaynağı ve yazarı korunur. Sen yalnızca bu beyanın hangi tür kayıt olduğunu düzenlersin.'
          : 'Söyleneni kaydet. Uygulama bu kaydın doğru veya yanlış olduğuna karar vermez.'}</p>

        {sourceMessage && (
          <div className="claim-source-preview">
            <span>⌁ KÖY SOHBETİNDEN</span>
            <b>{game.players.find((player) => player.id === sourceMessage.authorId)?.name ?? 'Oyuncu'}</b>
            <blockquote>“{sourceMessage.text}”</blockquote>
          </div>
        )}

        <div className="claim-kind-picker">
          {kindOptions.map((option) => (
            <button key={option.id} className={kind === option.id ? 'active' : ''} onClick={() => setKind(option.id)}>
              <span>{option.icon}</span><b>{option.label}</b>
            </button>
          ))}
        </div>

        <label>
          <span>Söyleyen oyuncu</span>
          <select
            value={claimantId}
            disabled={Boolean(sourceMessage)}
            onChange={(event) => setClaimantId(Number(event.target.value))}
          >
            {claimantOptions.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>

        {needsTarget && (
          <label>
            <span>Hedef / hakkında konuşulan oyuncu</span>
            <select value={targetId} onChange={(event) => setTargetId(Number(event.target.value))}>
              {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}{player.alive ? '' : ' · ölü'}</option>)}
            </select>
          </label>
        )}

        {kind === 'role' && (
          <label>
            <span>İddia edilen rol</span>
            <select value={role} onChange={(event) => setRole(event.target.value as RoleId)}>
              {roles.map((roleId) => <option key={roleId} value={roleId}>{ROLE_DEFINITIONS[roleId].name}</option>)}
            </select>
          </label>
        )}

        {kind === 'information' && (
          <label>
            <span>Söylediği bilgi</span>
            <textarea value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Örn. “Masum olduğunu gördüm.” veya “Vampir çıktı.”" maxLength={140} />
          </label>
        )}

        {kind === 'action' && (
          <label>
            <span>Yaptığını söylediği aksiyon</span>
            <select value={action} onChange={(event) => setAction(event.target.value as ActionClaim['action'])}>
              <option value="investigated">Araştırdım</option>
              <option value="protected">Korudum</option>
              <option value="visited">Ziyaret ettim</option>
            </select>
          </label>
        )}

        {kind === 'accusation' && (
          <label>
            <span>Şüphelendiği rol <em>isteğe bağlı</em></span>
            <select value={suspectedRole} onChange={(event) => setSuspectedRole(event.target.value as RoleId | '')}>
              <option value="">Rol belirtmedi</option>
              {roles.map((roleId) => <option key={roleId} value={roleId}>{ROLE_DEFINITIONS[roleId].name}</option>)}
            </select>
          </label>
        )}

        <label>
          <span>Söylediği cümle / not <em>isteğe bağlı</em></span>
          <textarea
            value={quote}
            readOnly={Boolean(sourceMessage)}
            onChange={(event) => setQuote(event.target.value)}
            placeholder="Örn. “Dün gece Can'ı araştırdım, masum çıktı.”"
            maxLength={280}
          />
        </label>

        <div className="claim-modal-actions">
          <button className="back" onClick={onClose}>Vazgeç</button>
          <button className="start" disabled={!canSave} onClick={onSave}>Kaydı Ekle <b>›</b></button>
        </div>
      </section>
    </div>
  )
}

function Votes({ game }: { game: GameState }) {
  const history = getVoteHistory(game)
  const rounds = [...new Set(history.map((vote) => vote.round))].sort((a, b) => b - a)

  if (rounds.length === 0) {
    return (
      <div className="vote-history-empty">
        <span>🗳</span>
        <b>Henüz tamamlanmış oylama yok.</b>
        <small>Bir oylama sonuçlandığında tüm nihai oylar burada görünür.</small>
      </div>
    )
  }

  return (
    <div className="vote-history">
      {rounds.map((round) => (
        <section key={round}>
          <header><b>{round}. Gün Oylaması</b><small>{history.filter((vote) => vote.round === round).length} oy</small></header>
          <div>
            {history
              .filter((vote) => vote.round === round)
              .map((vote) => {
                const voter = players.find((player) => player.id === vote.voterId)
                const target = players.find((player) => player.id === vote.targetId)
                return (
                  <article key={round + '-' + vote.voterId}>
                    <span className="avatar" style={{ '--accent': voter?.accent ?? '#66584b' } as CSSProperties}>{voter?.initial ?? '?'}</span>
                    <b>{voter?.name ?? 'Oyuncu'}</b>
                    <span>→</span>
                    <strong>{target?.name ?? 'Oyuncu'}</strong>
                  </article>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}

function NotesPane({
  notes,
  note,
  setNote,
  addNote,
  removeNote,
  deduction,
}: {
  notes: string[]
  note: string
  setNote: (value: string) => void
  addNote: () => void
  removeNote: (index: number) => void
  deduction: PrivateDeductionState
}) {
  const suspicious = players.filter(
    (player) => player.id !== HUMAN_ID && getDeductionMark(deduction, player.id) === 'suspicious',
  )
  const trusted = players.filter(
    (player) => player.id !== HUMAN_ID && getDeductionMark(deduction, player.id) === 'trusted',
  )
  const uncertainCount = players.filter(
    (player) => player.id !== HUMAN_ID && getDeductionMark(deduction, player.id) === 'uncertain',
  ).length

  return (
    <div className="notes-pane">
      <section className="private-map">
        <header>
          <div><b>Özel Haritam</b><small>Senin değerlendirmelerin · diğer oyuncular göremez</small></div>
          <span>{uncertainCount} kararsız</span>
        </header>
        <div className="private-map-groups">
          <div className="private-map-group suspicious">
            <small>ŞÜPHELİ</small>
            {suspicious.length > 0 ? (
              <div>{suspicious.map((player) => <span key={player.id}>{player.name}</span>)}</div>
            ) : <em>İşaretlenmiş oyuncu yok</em>}
          </div>
          <div className="private-map-group trusted">
            <small>GÜVENİYORUM</small>
            {trusted.length > 0 ? (
              <div>{trusted.map((player) => <span key={player.id}>{player.name}</span>)}</div>
            ) : <em>İşaretlenmiş oyuncu yok</em>}
          </div>
        </div>
        <p>Değerlendirmeyi değiştirmek veya oyuncuya özel not eklemek için portresine dokun.</p>
      </section>

      <section className="general-notes">
        <header>
          <div><b>Genel Notlarım</b><small>Belirli bir oyuncuya bağlı olmayan özel notlar</small></div>
          <span>{notes.length}</span>
        </header>
        <div className="general-note-compose">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                addNote()
              }
            }}
            placeholder="Köy hakkında özel not..."
            maxLength={240}
          />
          <button disabled={!note.trim()} onClick={addNote}>＋</button>
        </div>
        {notes.length === 0 ? (
          <div className="general-notes-empty">
            <span>⌁</span>
            <b>Henüz genel not yok.</b>
            <small>Oyuncuya özel notlar ilgili oyuncunun profilinde tutulur.</small>
          </div>
        ) : (
          <div className="general-note-list">
            {[...notes].reverse().map((item, reverseIndex) => {
              const originalIndex = notes.length - 1 - reverseIndex
              return (
                <article key={originalIndex + '-' + item}>
                  <p>{item}</p>
                  <button title="Notu sil" onClick={() => removeNote(originalIndex)}>×</button>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function Inspector({
  game,
  player,
  alive,
  deductionMark,
  privateNotes,
  isSelf,
  onDeductionChange,
  onAddPrivateNote,
  onRemovePrivateNote,
  onOpenSourceMessage,
  close,
}: {
  game: GameState
  player: Player
  alive: boolean
  deductionMark: DeductionMark
  privateNotes: ReturnType<typeof getPrivatePlayerNotes>
  isSelf: boolean
  onDeductionChange: (mark: DeductionMark) => void
  onAddPrivateNote: (text: string) => void
  onRemovePrivateNote: (noteId: number) => void
  onOpenSourceMessage: (messageId: number) => void
  close: () => void
}) {
  const [privateNoteDraft, setPrivateNoteDraft] = useState('')
  const timeline = [...getPlayerTimeline(game, player.id)].reverse()

  const savePrivateNote = () => {
    const text = privateNoteDraft.trim()
    if (!text || isSelf) return
    onAddPrivateNote(text)
    setPrivateNoteDraft('')
  }

  const describeClaim = (claim: StructuredClaim) => {
    if (claim.kind === 'role') {
      return {
        icon: roleVisuals[claim.role].icon,
        title: `${ROLE_DEFINITIONS[claim.role].name} olduğunu iddia etti`,
        target: null as Player | null,
        detail: null as string | null,
      }
    }

    const target = players.find((candidate) => candidate.id === claim.targetId) ?? null
    const meta = claimTypeMeta(claim)
    return {
      icon: meta.icon,
      title: meta.label,
      target,
      detail: meta.detail,
    }
  }

  return (
    <div className="inspector inspector-timeline">
      <button className="inspector-close" onClick={close}>×</button>

      <div className="inspector-profile">
        <span className="avatar big" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
        <div>
          <h2>{player.name}</h2>
          <em className={alive ? 'alive-label' : 'dead-label'}>{alive ? '● Hayatta' : '☠ Öldü'}</em>
        </div>
      </div>

      <div className="private-deduction-head">
        <div>
          <b>Özel Değerlendirmen</b>
          <small>{isSelf ? 'Kendi oyuncun için değerlendirme yapılmaz' : 'Yalnızca sana görünür · oyun gerçeği değildir'}</small>
        </div>
      </div>
      <div className="inspector-trust" role="group" aria-label="Özel oyuncu değerlendirmesi">
        <button
          className={'bad ' + (deductionMark === 'suspicious' ? 'active' : '')}
          aria-pressed={deductionMark === 'suspicious'}
          disabled={isSelf}
          onClick={() => onDeductionChange('suspicious')}
        >
          ✕ Şüpheli
        </button>
        <button
          className={deductionMark === 'uncertain' ? 'active neutral' : ''}
          aria-pressed={deductionMark === 'uncertain'}
          disabled={isSelf}
          onClick={() => onDeductionChange('uncertain')}
        >
          ? Kararsızım
        </button>
        <button
          className={'good ' + (deductionMark === 'trusted' ? 'active' : '')}
          aria-pressed={deductionMark === 'trusted'}
          disabled={isSelf}
          onClick={() => onDeductionChange('trusted')}
        >
          ✓ Güveniyorum
        </button>
      </div>

      <section className="private-player-notes">
        <header>
          <div>
            <b>Özel Notların</b>
            <small>{isSelf ? 'Kendi oyuncun için özel not tutulmaz' : 'Sadece sana görünür · kamuya açık geçmişe eklenmez'}</small>
          </div>
          <span>{privateNotes.length}</span>
        </header>

        {!isSelf && (
          <div className="private-note-compose">
            <textarea
              value={privateNoteDraft}
              onChange={(event) => setPrivateNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  savePrivateNote()
                }
              }}
              placeholder="Bu oyuncu hakkında özel not..."
              maxLength={220}
            />
            <button disabled={!privateNoteDraft.trim()} onClick={savePrivateNote}>＋</button>
          </div>
        )}

        {privateNotes.length > 0 && (
          <div className="private-note-list">
            {[...privateNotes].reverse().map((note) => (
              <article key={note.id}>
                <div>
                  <small>{note.round}. Gün</small>
                  <p>{note.text}</p>
                </div>
                <button title="Özel notu sil" onClick={() => onRemovePrivateNote(note.id)}>×</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="timeline-head">
        <div><b>Davranış Geçmişi</b><small>İddialar, beyanlar ve nihai oylar</small></div>
        <span>{timeline.length}</span>
      </div>

      {timeline.length === 0 ? (
        <div className="timeline-empty">
          <span>⌁</span>
          <b>Henüz kayıt yok.</b>
          <small>Bu oyuncunun yapılandırılmış bir sözü veya tamamlanmış oyu bulunmuyor.</small>
        </div>
      ) : (
        <div className="player-timeline">
          {timeline.map((entry) => {
            if (entry.kind === 'vote') {
              const target = players.find((candidate) => candidate.id === entry.vote.targetId)
              return (
                <article className="timeline-entry timeline-vote" key={entry.key}>
                  <div className="timeline-marker">🗳</div>
                  <div className="timeline-content">
                    <small>{entry.round}. Gün · Oy</small>
                    <b>{target?.name ?? 'Oyuncu'} için oy kullandı</b>
                  </div>
                </article>
              )
            }

            const described = describeClaim(entry.claim)
            return (
              <article className={'timeline-entry timeline-' + entry.claim.kind + (entry.claim.status === 'withdrawn' ? ' withdrawn' : '')} key={entry.key}>
                <div className="timeline-marker">{described.icon}</div>
                <div className="timeline-content">
                  <small>
                    {entry.round}. Gün · {claimTypeMeta(entry.claim).label}
                    {entry.claim.status === 'withdrawn' && <em> · geri çekildi</em>}
                  </small>
                  <b>{described.title}</b>
                  {entry.claim.sourceMessageId && (
                    <button
                      className="timeline-source"
                      onClick={() => onOpenSourceMessage(entry.claim.sourceMessageId!)}
                    >
                      ⌁ Kaynak mesaja git
                    </button>
                  )}
                  {described.target && (
                    <p><span>→ {described.target.name}</span>{described.detail && <> · {described.detail}</>}</p>
                  )}
                  {entry.claim.kind === 'information' && <p>{entry.claim.statement}</p>}
                  {entry.claim.quote && <blockquote>“{entry.claim.quote}”</blockquote>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Night({
  game,
  selected,
  setSelected,
  onResolve,
  onTimeout,
  onSendChat,
  onMarkChatRead,
}: {
  game: GameState
  selected: number | null
  setSelected: (id: number | null) => void
  onResolve: () => void
  onTimeout: () => void
  onSendChat: (channel: ChatChannel, text: string) => void
  onMarkChatRead: (channel: ChatChannel, messageId: number) => void
}) {
  const view = getPrivatePlayerView(game, HUMAN_ID)
  const visual = roleVisuals[view.selfRole]
  const self = view.publicPlayers.find((player) => player.id === HUMAN_ID)
  const action = ROLE_DEFINITIONS[view.selfRole].nightAction
  const targets = self?.alive && action ? validNightTargets(game, HUMAN_ID) : []
  const targetIds = new Set(targets.map((target) => target.id))
  const aliveById = new Map(view.publicPlayers.map((player) => [player.id, player.alive]))
  const picked = targets.find((target) => target.id === selected)
  const canAct = !self?.alive || action === null || selected !== null
  const nightChatAccess = getChatAccess(game, HUMAN_ID)
  const nightChatAvailable = nightChatAccess.writable.some(
    (channel) => channel === 'vampire' || channel === 'ghost',
  )
  const mobileNightActionLabel = !self?.alive
    ? 'Hayalet Olarak İzle'
    : action
      ? picked
        ? `${picked.name} · Onayla`
        : 'Bir hedef seç'
      : 'Geceyi Bitir'

  return (
    <main className="game night-game">
      <section className="council">
        <Brand />
        <div className="phase-badge night">
          <b>☾ Gece {game.round}</b>
          <span>Köy Uyuyor</span>
          <PhaseTimer seconds={nightSeconds} label="Rol Aşaması" />
        </div>
        <div className="ring sleeping">
          {players.map((player, index) => {
            const angle = index / players.length * Math.PI * 2 - Math.PI / 2
            const x = 50 + Math.cos(angle) * 40
            const y = 50 + Math.sin(angle) * 37
            const enabled = targetIds.has(player.id)
            const alive = aliveById.get(player.id) ?? true
            return (
              <button
                key={player.id}
                disabled={!enabled}
                className={'seat ' + (selected === player.id ? 'selected ' : '') + (!alive ? 'dead-seat ' : '') + (!enabled ? 'night-disabled' : '')}
                style={{ left: x + '%', top: y + '%' }}
                onClick={() => enabled && setSelected(player.id)}
              >
                <span className="avatar player-avatar" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
                <b>{player.name}</b><em>{!alive ? '☠' : enabled ? '◌' : 'zZ'}</em>
              </button>
            )
          })}
          <div className="bonfire low"><i /><b /></div>
        </div>
        <div className="vote blue night-guidance">
          {self?.alive
            ? action
              ? 'Karanlıkta hedefini seç.'
              : 'Bu gece özel bir aksiyonun yok.'
            : 'Hayalet olarak geceyi izliyorsun.'}
        </div>
        <button
          className="night-mobile-confirm"
          disabled={!canAct}
          onClick={onResolve}
        >
          <span>{visual.icon}</span>
          <b>{mobileNightActionLabel}</b>
        </button>
      </section>
      <aside className="panel role-panel">
        <blockquote>“Herkes uyur... Ama gerçekler asla.”</blockquote>
        <h1>Rolün</h1>
        <div className={'seer-card role-card-' + view.selfRole}><div>{visual.icon}</div><b>{visual.title.toLocaleUpperCase('tr-TR')}</b></div>
        <section>
          <h2>{visual.icon} {visual.title}</h2><p>{visual.text}</p>
          {view.selfRole === 'vampire' && view.knownVampireIds.length > 0 && (
            <em>Diğer Vampir: {view.knownVampireIds.map((id) => view.publicPlayers.find((player) => player.id === id)?.name).filter(Boolean).join(', ')}</em>
          )}
          <h3>{action ? 'Hedef Seçimi' : 'Gece Bekleyişi'}</h3>
          <p>{action ? 'Yalnızca geçerli hedefler seçilebilir.' : 'Özel bir gece aksiyonun yok.'}</p>
          <div className={'target ' + (picked ? 'active' : '')}><span>{picked?.name[0] ?? '•'}</span><b>{picked?.name ?? (action ? 'Oyuncu seçilmedi' : 'Gece devam ediyor')}</b><em>{visual.icon}</em></div>
        </section>
        <button className="seer-btn" disabled={!canAct} onClick={onResolve}>{visual.icon} {self?.alive ? visual.action : 'Hayalet Olarak İzle'}</button>
        <small className="hint">
          Gerçek roller diğer oyunculara açıklanmaz. Onaylanmamış hedef süre biterse pas sayılır.
        </small>
        {nightChatAvailable && (
          <div className="night-chat">
            <ChatPanel
              game={game}
              viewerId={HUMAN_ID}
              onSend={onSendChat}
              onMarkRead={onMarkChatRead}
              compact
            />
          </div>
        )}
      </aside>
    </main>
  )
}

function GhostTransition({
  game,
  cause,
  onSendChat,
  onMarkChatRead,
  onContinue,
}: {
  game: GameState
  cause: 'night' | 'vote'
  onSendChat: (channel: ChatChannel, text: string) => void
  onMarkChatRead: (channel: ChatChannel, messageId: number) => void
  onContinue: () => void
}) {
  const self = game.players.find((player) => player.id === HUMAN_ID)
  const portrait = players.find((player) => player.id === HUMAN_ID)!
  const access = getChatAccess(game, HUMAN_ID)
  const [activeChannel, setActiveChannel] = useState<ChatChannel>('ghost')

  return (
    <main className="ghost-transition">
      <section className="ghost-transition-main">
        <Brand />
        <div className="ghost-orb" aria-hidden>☠</div>
        <small className="ghost-kicker">HAYALET MODU</small>
        <h1>Artık Hayaletsin.</h1>
        <div className="ghost-self">
          <span className="avatar big" style={{ '--accent': portrait.accent } as CSSProperties}>
            {portrait.initial}
          </span>
          <div>
            <b>{self?.name ?? portrait.name}</b>
            <small>{cause === 'night' ? 'Gece öldürüldün.' : 'Köy oylamasıyla elendin.'}</small>
          </div>
        </div>
        <p>
          Oyunu izlemeye devam edebilirsin. Yaşayanların kararlarını etkileyemezsin;
          Hayalet sohbetinde diğer ölü oyuncularla konuşabilirsin.
        </p>
        <div className="ghost-rules">
          <div><span>⌂</span><b>Köy Sohbeti</b><small>Okuyabilirsin · yazamazsın</small></div>
          <div><span>☠</span><b>Hayalet Sohbeti</b><small>Okuyabilir ve yazabilirsin</small></div>
          <div><span>🦇</span><b>Vampir Sohbeti</b><small>Artık erişilemez</small></div>
        </div>
        <button className="start ghost-continue" onClick={onContinue}>
          {cause === 'night' ? 'Sabahı İzle' : 'Oylama Sonucunu İzle'} <b>›</b>
        </button>
      </section>

      <aside className="panel ghost-chat-panel">
        <header>
          <small>ÖLÜLER KANALI</small>
          <b>Hayalet Sohbeti</b>
          <em>{access.writable.includes('ghost') ? '● Aktif' : '○ Salt okunur'}</em>
        </header>
        <ChatPanel
          game={game}
          viewerId={HUMAN_ID}
          onSend={onSendChat}
          activeChannel={activeChannel}
          onActiveChannelChange={setActiveChannel}
          onMarkRead={onMarkChatRead}
          compact
        />
      </aside>
    </main>
  )
}

function Dawn({ game, onContinue }: { game: GameState; onContinue: () => void }) {
  const victim = game.lastNight?.victimId
    ? players.find((player) => player.id === game.lastNight?.victimId)
    : null

  return (
    <main className="result-shell dawn-shell">
      <Brand />
      <section className="flow-card dawn-card">
        <small>🌅 {game.round}. GÜN</small>
        <h1>{victim ? 'Köy bir eksik uyandı.' : 'Bu gece kimse ölmedi.'}</h1>
        {victim ? <div className="dawn-victim"><span className="avatar big" style={{ '--accent': victim.accent } as CSSProperties}>{victim.initial}</span><b>{victim.name}</b><em>gece öldürüldü</em></div> : <div className="quiet-night">Köy meydanı alışılmadık derecede sessiz.</div>}
        <p>Gece aksiyonlarının ayrıntıları gizli kalır. Köylüler yalnızca sabah gördükleri sonucu bilir.</p>
        <button className="start" onClick={onContinue}>Köy Meclisine Git <b>›</b></button>
      </section>
      <Lore />
    </main>
  )
}

function Voting({
  game,
  selected,
  setSelected,
  onResolve,
  onTimeout,
}: {
  game: GameState
  selected: number | null
  setSelected: (id: number | null) => void
  onResolve: () => void
  onTimeout: () => void
}) {
  const votingSeconds = usePhaseCountdown(
    PHASE_DURATIONS_SECONDS.voting,
    `voting-${game.round}`,
    onTimeout,
  )
  const self = game.players.find((player) => player.id === HUMAN_ID)
  const targets = game.players.filter((player) => player.alive && player.id !== HUMAN_ID)

  return (
    <main className="result-shell voting-shell">
      <Brand />
      <section className="flow-card voting-card">
        <small>🗳 {game.round}. GÜN OYLAMASI</small>
        <div className="voting-timer">
          <PhaseTimer seconds={votingSeconds} label="Oylama" />
        </div>
        <h1>{self?.alive ? 'Köyden kimi göndermek istiyorsun?' : 'Oylamayı hayalet olarak izliyorsun.'}</h1>
        <div className="vote-grid">
          {targets.map((target) => {
            const visual = players.find((player) => player.id === target.id)!
            return <button key={target.id} disabled={!self?.alive} className={selected === target.id ? 'picked' : ''} onClick={() => self?.alive && setSelected(target.id)}><span className="avatar" style={{ '--accent': visual.accent } as CSSProperties}>{visual.initial}</span><b>{target.name}</b><em>{selected === target.id ? '✓' : '○'}</em></button>
          })}
        </div>
        <p className="phase-timeout-note">
          {self?.alive
            ? 'Süre dolduğunda kilitlenmemiş oy kullanılmamış sayılır.'
            : 'Süre dolduğunda oylama otomatik sonuçlanır.'}
        </p>
        <button className="start" disabled={Boolean(self?.alive) && selected === null} onClick={onResolve}>{self?.alive ? 'Oyumu Kilitle' : 'Oylama Sonucunu Gör'} <b>›</b></button>
      </section>
    </main>
  )
}

function VoteResult({ game, onContinue }: { game: GameState; onContinue: () => void }) {
  const eliminated = game.lastVote?.eliminatedId
    ? players.find((player) => player.id === game.lastVote?.eliminatedId)
    : null

  return (
    <main className="result-shell">
      <Brand />
      <section className="flow-card vote-result-card">
        <small>KÖY KARARINI VERDİ</small>
        <h1>{eliminated ? eliminated.name : 'Kimse gönderilmedi'}</h1>
        <div className="result-symbol">{game.lastVote?.tied ? '⚖' : '🗳'}</div>
        <p>{game.lastVote?.tied ? 'Oylar eşit kaldı. Bu gün eleme olmadı.' : 'Rolü şimdilik açıklanmadı. Gerçek, maç sonunda ortaya çıkacak.'}</p>
        <button className="start" onClick={onContinue}>Yeni Geceye Geç <b>›</b></button>
      </section>
    </main>
  )
}

function EndScreen({ game, onAgain, onHome }: { game: GameState; onAgain: () => void; onHome: () => void }) {
  return (
    <main className="end-screen">
      <Brand />
      <section className="panel end-panel">
        <small>KAZANAN</small>
        <h1>{game.winner === 'vampire' ? 'VAMPİRLER' : 'KÖYLÜLER'}</h1>
        <p>Perde kalktı. Artık tüm gerçek roller görülebilir.</p>
        <div className="end-roles">
          {game.players.map((player) => {
            const visual = roleVisuals[player.secretRole]
            const portrait = players.find((item) => item.id === player.id)!
            return <div key={player.id} className={'end-role ' + (player.alive ? 'alive' : 'dead')}><span className="avatar" style={{ '--accent': portrait.accent } as CSSProperties}>{portrait.initial}</span><b>{player.name}</b><em>{visual.icon} {visual.title}</em><small>{player.alive ? 'HAYATTA' : 'ÖLDÜ'}</small></div>
          })}
        </div>
        <div className="end-actions"><button className="start" onClick={onAgain}>↻ Tekrar Oyna</button><button className="back" onClick={onHome}>⌂ Ana Menü</button></div>
      </section>
    </main>
  )
}
