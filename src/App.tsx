import { useState, type CSSProperties } from 'react'
import {
  beginDiscussion,
  beginNight,
  beginVoting,
  createGame,
  getActiveClaims,
  getPrivatePlayerView,
  groupRoleClaims,
  recordAccusationClaim,
  recordActionClaim,
  recordDefenseClaim,
  recordInformationClaim,
  recordRoleClaim,
  submitNightAction,
  submitVote,
  validNightTargets,
  withdrawClaim,
} from './game/engine'
import { completeNightWithBots, completeVoteWithBots } from './game/demo'
import { ROLE_DEFINITIONS, buildRolePack, countRoles } from './game/roles'
import type { ActionClaim, ClaimKind, GameState, RoleId, StructuredClaim } from './game/types'

type Screen =
  | 'home'
  | 'lobby'
  | 'role'
  | 'night'
  | 'dawn'
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

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [game, setGame] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<'claims' | 'votes' | 'clues'>('claims')
  const [notes, setNotes] = useState(['Ali ve Ayşe aynı rolü iddia ediyor.', 'Burak’ın tavırları gergin.'])
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

  const addNote = () => {
    const text = note.trim()
    if (!text) return
    setNotes((current) => [...current, text])
    setNote('')
  }

  const openClaimComposer = () => {
    if (!game) return
    const living = game.players.filter((player) => player.alive)
    if (!living.some((player) => player.id === claimantId) && living[0]) {
      setClaimantId(living[0].id)
    }
    if (!game.players.some((player) => player.id === claimTargetId) && game.players[0]) {
      setClaimTargetId(game.players[0].id)
    }
    setClaimComposerOpen(true)
  }

  const addStructuredClaim = () => {
    if (!game) return

    try {
      let next = game
      if (claimKind === 'role') {
        next = recordRoleClaim(game, claimantId, claimRole, claimQuote)
      } else if (claimKind === 'information') {
        next = recordInformationClaim(
          game,
          claimantId,
          claimTargetId,
          claimStatement,
          claimQuote,
        )
      } else if (claimKind === 'action') {
        next = recordActionClaim(
          game,
          claimantId,
          claimTargetId,
          claimAction,
          claimQuote,
        )
      } else if (claimKind === 'accusation') {
        next = recordAccusationClaim(
          game,
          claimantId,
          claimTargetId,
          claimSuspectedRole || undefined,
          claimQuote,
        )
      } else {
        next = recordDefenseClaim(game, claimantId, claimTargetId, claimQuote)
      }

      setGame(next)
      setClaimStatement('')
      setClaimQuote('')
      setClaimComposerOpen(false)
    } catch {
      // Motor geçersiz veya eksik yapılandırılmış kayıtları reddeder.
    }
  }

  const removeClaim = (claimId: number) => {
    if (!game) return
    setGame(withdrawClaim(game, claimId))
  }

  const launchGame = () => {
    const next = createGame(players.map(({ id, name }) => ({ id, name })))
    setGame(next)
    setSelected(null)
    setScreen('role')
  }

  const toFirstNight = () => {
    if (!game) return
    setGame(beginNight(game))
    setSelected(null)
    setScreen('night')
  }

  const finishNight = () => {
    if (!game) return
    const view = getPrivatePlayerView(game, HUMAN_ID)
    const self = view.publicPlayers.find((player) => player.id === HUMAN_ID)
    const action = ROLE_DEFINITIONS[view.selfRole].nightAction
    let next = game

    if (self?.alive && action) {
      if (selected === null) return
      next = submitNightAction(next, HUMAN_ID, selected)
    }

    next = completeNightWithBots(next, HUMAN_ID)
    setGame(next)
    setSelected(null)
    setScreen(next.winner ? 'end' : 'dawn')
  }

  const toDiscussion = () => {
    if (!game) return
    setGame(beginDiscussion(game))
    setSelected(null)
    setScreen('day')
  }

  const toVoting = () => {
    if (!game) return
    setGame(beginVoting(game))
    setSelected(null)
    setScreen('vote')
  }

  const finishVote = () => {
    if (!game) return
    const self = game.players.find((player) => player.id === HUMAN_ID)
    let next = game

    if (self?.alive) {
      if (selected === null) return
      next = submitVote(next, HUMAN_ID, selected)
    }

    next = completeVoteWithBots(next, HUMAN_ID)
    setGame(next)
    setSelected(null)
    setScreen(next.winner ? 'end' : 'vote-result')
  }

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
        <Night game={game} selected={selected} setSelected={setSelected} onResolve={finishNight} />
      )}
      {screen === 'dawn' && game && <Dawn game={game} onContinue={toDiscussion} />}
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
          onVote={toVoting}
          onOpenClaimComposer={openClaimComposer}
          onWithdrawClaim={removeClaim}
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
          setKind={setClaimKind}
          setClaimantId={setClaimantId}
          setTargetId={setClaimTargetId}
          setRole={setClaimRole}
          setStatement={setClaimStatement}
          setAction={setClaimAction}
          setSuspectedRole={setClaimSuspectedRole}
          setQuote={setClaimQuote}
          onClose={() => setClaimComposerOpen(false)}
          onSave={addStructuredClaim}
        />
      )}
      {screen === 'vote' && game && (
        <Voting game={game} selected={selected} setSelected={setSelected} onResolve={finishVote} />
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
            <div className="chat"><b>Sohbet</b><p><strong>Mert:</strong> Herkese merhaba!</p><p><strong>Ayşe:</strong> Hazırım 🙂</p><p><strong>Burak:</strong> Bu sefer köylüler kazanacak.</p><input placeholder="Mesajını yaz..." /></div>
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
  onVote,
  onOpenClaimComposer,
  onWithdrawClaim,
}: {
  game: GameState
  selected: number | null
  setSelected: (id: number | null) => void
  tab: 'claims' | 'votes' | 'clues'
  setTab: (tab: 'claims' | 'votes' | 'clues') => void
  notes: string[]
  note: string
  setNote: (value: string) => void
  addNote: () => void
  onVote: () => void
  onOpenClaimComposer: () => void
  onWithdrawClaim: (claimId: number) => void
}) {
  const publicPlayers = getPrivatePlayerView(game, HUMAN_ID).publicPlayers
  const aliveById = new Map(publicPlayers.map((player) => [player.id, player.alive]))

  return (
    <main className="game">
      <section className="council">
        <Brand />
        <div className="phase-badge"><b>☀ {game.round}. Gün</b><span>Köy Meclisi</span><small>⌛ Tartışma · 01:18</small></div>
        <div className="ring">
          {players.slice(0, 8).map((player, index) => {
            const angle = index / 8 * Math.PI * 2 - Math.PI / 2
            const x = 50 + Math.cos(angle) * 40
            const y = 50 + Math.sin(angle) * 37
            const alive = aliveById.get(player.id) ?? true
            return (
              <button
                key={player.id}
                className={'seat ' + (selected === player.id ? 'selected ' : '') + (!alive ? 'dead-seat' : '')}
                style={{ left: x + '%', top: y + '%' }}
                onClick={() => setSelected(selected === player.id ? null : player.id)}
              >
                <i>{index + 1}</i>
                <span className="avatar player-avatar" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
                <b>{player.name}</b><em>{alive ? '•••' : '☠'}</em>
              </button>
            )
          })}
          <div className="bonfire"><i /><b /></div>
        </div>
        <Lore />
        <button className="vote" onClick={onVote}>Oylamaya Geç <b>›</b></button>
      </section>
      <aside className="panel deduction">
        <blockquote>“Aynı köyde, farklı gerçekler...”</blockquote>
        <div className="tabs">
          <button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}>İddialar</button>
          <button className={tab === 'votes' ? 'active' : ''} onClick={() => setTab('votes')}>Oylama Geçmişi</button>
          <button className={tab === 'clues' ? 'active' : ''} onClick={() => setTab('clues')}>Rol İpuçları</button>
        </div>
        {tab === 'claims' && (
          <Claims
            game={game}
            onOpenComposer={onOpenClaimComposer}
            onWithdrawClaim={onWithdrawClaim}
          />
        )}
        {tab === 'votes' && <Votes />}
        {tab === 'clues' && <Clues />}
        <div className="notes">
          <div><b>▤ Benim Notlarım</b><small>Sadece sana görünür</small></div>
          {notes.map((item, index) => <label key={index}><input type="checkbox" defaultChecked={index < 2} />{item}</label>)}
          <div className="note-input"><input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addNote()} placeholder="Not ekle..." /><button onClick={addNote}>＋</button></div>
        </div>
      </aside>
      {selected && <Inspector player={players.find((player) => player.id === selected)!} alive={aliveById.get(selected) ?? true} close={() => setSelected(null)} />}
    </main>
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
}: {
  game: GameState
  onOpenComposer: () => void
  onWithdrawClaim: (claimId: number) => void
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
        <button onClick={onOpenComposer}>＋ Kayıt Ekle</button>
      </div>

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
                          {claim.quote && <p>“{claim.quote}”</p>}
                        </div>
                        <button title="İddiayı geri çek" onClick={() => onWithdrawClaim(claim.id)}>↶</button>
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
                <button title="Kaydı geri çek" onClick={() => onWithdrawClaim(claim.id)}>↶</button>
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
        <h2>Kayıt Ekle</h2>
        <p>Söyleneni kaydet. Uygulama bu kaydın doğru veya yanlış olduğuna karar vermez.</p>

        <div className="claim-kind-picker">
          {kindOptions.map((option) => (
            <button key={option.id} className={kind === option.id ? 'active' : ''} onClick={() => setKind(option.id)}>
              <span>{option.icon}</span><b>{option.label}</b>
            </button>
          ))}
        </div>

        <label>
          <span>Söyleyen oyuncu</span>
          <select value={claimantId} onChange={(event) => setClaimantId(Number(event.target.value))}>
            {living.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
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
          <textarea value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Örn. “Dün gece Can'ı araştırdım, masum çıktı.”" maxLength={180} />
        </label>

        <div className="claim-modal-actions">
          <button className="back" onClick={onClose}>Vazgeç</button>
          <button className="start" disabled={!canSave} onClick={onSave}>Kaydı Ekle <b>›</b></button>
        </div>
      </section>
    </div>
  )
}

function Votes() {
  return <div className="history">{[['1. Gün', 'Burak', '4 oy'], ['2. Gün', 'Can', '5 oy'], ['3. Gün', 'Elif', '4 oy']].map((row) => <div key={row[0]}><b>{row[0]}</b><span>● ● ● →</span><strong>{row[1]}</strong><small>{row[2]}</small></div>)}</div>
}

function Clues() {
  return <div className="clues"><p><b>◉ Kâhin iddiası</b><br />Aynı rol için iki farklı iddia var.</p><p><b>⬟ Koruma iddiası</b><br />Mert, Elif’i koruduğunu söylüyor.</p><p><b>⚑ Temel kural</b><br />Sistem doğruyu seçmez; yalnızca açıklanan bilgiyi düzenler.</p></div>
}

function Inspector({ player, alive, close }: { player: Player; alive: boolean; close: () => void }) {
  return (
    <div className="inspector">
      <button onClick={close}>×</button>
      <span className="avatar big" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
      <h2>{player.name}</h2><em>{alive ? '● Hayatta' : '☠ Öldü'}</em><hr />
      <b>Oylama geçmişi</b><p>1. Gün → Bora</p><p>2. Gün → Ayşe</p><p>3. Gün → Can</p>
      <div><button className="bad">✕ Şüpheli</button><button>? Emin Değilim</button><button className="good">✓ Güveniyorum</button></div>
    </div>
  )
}

function Night({
  game,
  selected,
  setSelected,
  onResolve,
}: {
  game: GameState
  selected: number | null
  setSelected: (id: number | null) => void
  onResolve: () => void
}) {
  const view = getPrivatePlayerView(game, HUMAN_ID)
  const visual = roleVisuals[view.selfRole]
  const self = view.publicPlayers.find((player) => player.id === HUMAN_ID)
  const action = ROLE_DEFINITIONS[view.selfRole].nightAction
  const targets = self?.alive && action ? validNightTargets(game, HUMAN_ID) : []
  const targetIds = new Set(targets.map((target) => target.id))
  const picked = targets.find((target) => target.id === selected)
  const canAct = !self?.alive || action === null || selected !== null

  return (
    <main className="game night-game">
      <section className="council">
        <Brand />
        <div className="phase-badge night"><b>☾ Gece {game.round}</b><span>Köy Uyuyor</span><small>⌛ Rol Aşaması · 00:38</small></div>
        <div className="ring sleeping">
          {players.slice(0, 8).map((player, index) => {
            const angle = index / 8 * Math.PI * 2 - Math.PI / 2
            const x = 50 + Math.cos(angle) * 40
            const y = 50 + Math.sin(angle) * 37
            const enabled = targetIds.has(player.id)
            return (
              <button
                key={player.id}
                disabled={!enabled}
                className={'seat ' + (selected === player.id ? 'selected ' : '') + (!enabled ? 'night-disabled' : '')}
                style={{ left: x + '%', top: y + '%' }}
                onClick={() => enabled && setSelected(player.id)}
              >
                <span className="avatar player-avatar" style={{ '--accent': player.accent } as CSSProperties}>{player.initial}</span>
                <b>{player.name}</b><em>{enabled ? '◌' : 'zZ'}</em>
              </button>
            )
          })}
          <div className="bonfire low"><i /><b /></div>
        </div>
        <button className="vote blue">{action ? 'Karanlıkta hedefini seç.' : 'Bu gece yalnızca gözlemliyorsun.'} <b>›</b></button>
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
        <small className="hint">Gerçek roller diğer oyunculara açıklanmaz.</small>
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
}: {
  game: GameState
  selected: number | null
  setSelected: (id: number | null) => void
  onResolve: () => void
}) {
  const self = game.players.find((player) => player.id === HUMAN_ID)
  const targets = game.players.filter((player) => player.alive && player.id !== HUMAN_ID)

  return (
    <main className="result-shell voting-shell">
      <Brand />
      <section className="flow-card voting-card">
        <small>🗳 {game.round}. GÜN OYLAMASI</small>
        <h1>{self?.alive ? 'Köyden kimi göndermek istiyorsun?' : 'Oylamayı hayalet olarak izliyorsun.'}</h1>
        <div className="vote-grid">
          {targets.map((target) => {
            const visual = players.find((player) => player.id === target.id)!
            return <button key={target.id} className={selected === target.id ? 'picked' : ''} onClick={() => self?.alive && setSelected(target.id)}><span className="avatar" style={{ '--accent': visual.accent } as CSSProperties}>{visual.initial}</span><b>{target.name}</b><em>{selected === target.id ? '✓' : '○'}</em></button>
          })}
        </div>
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
