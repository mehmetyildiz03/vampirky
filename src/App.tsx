import { useMemo, useState, type CSSProperties } from 'react'
import { beginDay, beginNight, beginVote, createGame, getRoleForPlayer, validNightTargets, validVoteTargets } from './game/engine'
import { resolveDemoNight, resolveDemoVote } from './game/demo'
import { ROLE_DEFINITIONS } from './game/roles'
import type { GameState, RoleId } from './game/types'

type Screen = 'home' | 'lobby' | 'role' | 'day' | 'night' | 'vote' | 'verdict' | 'end'
type Player = { id:number; name:string; initial:string; accent:string; status?:'ready'|'not-ready'|'joining'; mic?:boolean }
type Claim = { id:number; player:string; role:string; quote:string; tone:'violet'|'cyan'|'gold'|'red' }

const LOCAL_PLAYER_ID = 1
const players:Player[] = [
  {id:1,name:'Ali',initial:'A',accent:'#b67a47',status:'ready',mic:true},
  {id:2,name:'Ayşe',initial:'A',accent:'#8d83bd',status:'ready'},
  {id:3,name:'Mert',initial:'M',accent:'#8a6d57',status:'ready'},
  {id:4,name:'Esra',initial:'E',accent:'#a24139',status:'ready',mic:true},
  {id:5,name:'Burak',initial:'B',accent:'#a98b55',status:'ready'},
  {id:6,name:'Zeynep',initial:'Z',accent:'#587991',status:'ready'},
  {id:7,name:'Kerem',initial:'K',accent:'#79634e',status:'ready'},
  {id:8,name:'Elif',initial:'E',accent:'#6e5a75',status:'ready'},
  {id:9,name:'Can',initial:'C',accent:'#716550',status:'ready'},
  {id:10,name:'Deniz',initial:'D',accent:'#7d523f',status:'ready'}
]
const claims:Claim[] = [
  {id:1,player:'Ayşe',role:'Kâhin',quote:'Dün gece Deniz masum çıktı.',tone:'violet'},
  {id:2,player:'Mert',role:'Kâhin',quote:'Ben de Deniz’i gördüm; masum.',tone:'cyan'},
  {id:3,player:'Burak',role:'Koruyucu',quote:'Dün gece Elif’i korudum.',tone:'gold'},
  {id:4,player:'Esra',role:'Köylü',quote:'Ben sıradan köylüyüm.',tone:'red'}
]

function Brand(){
  return <div className="brand"><div className="brand-title"><span>Vampir</span><strong>Köylü</strong></div><div className="brand-ribbon">Sözler, Maskeler, Hayatta Kalanlar...</div></div>
}
function VillageBackdrop(){
  return <div className="scene" aria-hidden><div className="sky"/><div className="moon"/><div className="mountains"/><div className="castle"/><div className="houses left"/><div className="houses right"/><div className="mist one"/><div className="mist two"/><div className="fire"><i/><b/></div><div className="vignette"/></div>
}
function Topbar(){
  return <header className="topbar"><button>⚙ <span>Ayarlar</span></button><div className="top-spacer"/><div className="profile"><span className="avatar small">A</span><div><b>Ali</b><small>Köyün Sesi</small></div><em>12</em></div><div className="coin">☀ 2.450</div><button>♟</button><button>✉</button></header>
}
function Lore(){
  return <div className="lore"><span>Gözlemle</span><span>Sorgula</span><span>Çelişkileri Bul</span><span>Doğruyu Keşfet</span></div>
}

export default function App(){
  const [screen,setScreen]=useState<Screen>('home')
  const [game,setGame]=useState<GameState|null>(null)
  const [selected,setSelected]=useState<number|null>(null)
  const [tab,setTab]=useState<'claims'|'votes'|'clues'>('claims')
  const [notes,setNotes]=useState(['Ayşe ve Mert aynı rolü iddia ediyor.','Burak’ın tavırları gergin.'])
  const [note,setNote]=useState('')
  const [error,setError]=useState<string|null>(null)
  const conflict=useMemo(()=>claims.filter(c=>c.role==='Kâhin'),[])
  const addNote=()=>{const t=note.trim();if(!t)return;setNotes(n=>[...n,t]);setNote('')}
  const visualPlayers=useMemo(()=>players.map(p=>({...p,alive:game?.public.players.find(x=>x.id===p.id)?.alive??true})),[game])

  const startMatch=()=>{try{const next=createGame(players.map(({id,name})=>({id,name})));setGame(next);setSelected(null);setError(null);setScreen('role')}catch(e){setError(e instanceof Error?e.message:'Oyun başlatılamadı.')}}
  const revealDone=()=>{if(!game)return;setGame(beginNight(game));setSelected(null);setScreen('night')}
  const finishNight=()=>{if(!game)return;try{const role=getRoleForPlayer(game,LOCAL_PLAYER_ID);if(ROLE_DEFINITIONS[role].nightAction&&selected===null)return;const resolved=resolveDemoNight(game,LOCAL_PLAYER_ID,selected);setGame(resolved.public.winner?resolved:beginDay(resolved));setSelected(null);setScreen(resolved.public.winner?'end':'day');setError(null)}catch(e){setError(e instanceof Error?e.message:'Gece çözümlenemedi.')}}
  const openVote=()=>{if(!game)return;setGame(beginVote(game));setSelected(null);setScreen('vote')}
  const finishVote=()=>{if(!game)return;const alive=game.public.players.find(p=>p.id===LOCAL_PLAYER_ID)?.alive??false;if(alive&&selected===null)return;try{const target=selected??validVoteTargets(game,LOCAL_PLAYER_ID)[0]?.id;if(target==null)return;const resolved=resolveDemoVote(game,LOCAL_PLAYER_ID,target);setGame(resolved);setSelected(null);setScreen(resolved.public.winner?'end':'verdict');setError(null)}catch(e){setError(e instanceof Error?e.message:'Oylama çözümlenemedi.')}}
  const nextNight=()=>{if(!game)return;setGame(beginNight(game));setSelected(null);setScreen('night')}
  const home=()=>{setGame(null);setSelected(null);setError(null);setScreen('home')}
  const phase=(screen==='day'||screen==='vote'||screen==='verdict')?'day':screen

  return <div className={'app phase-'+phase}><VillageBackdrop/><Topbar/>
    {error&&<div className="system-error">⚠ {error}<button onClick={()=>setError(null)}>×</button></div>}
    {screen==='home'&&<Home onLobby={()=>setScreen('lobby')} onQuick={startMatch}/>}
    {screen==='lobby'&&<Lobby onBack={()=>setScreen('home')} onStart={startMatch}/>}
    {screen==='role'&&game&&<EngineRoleReveal game={game} onContinue={revealDone}/>}
    {screen==='day'&&game&&<EngineDay game={game} viewPlayers={visualPlayers} selected={selected} setSelected={setSelected} tab={tab} setTab={setTab} notes={notes} note={note} setNote={setNote} addNote={addNote} conflict={conflict} onVote={openVote}/>}
    {screen==='night'&&game&&<EngineNight game={game} viewPlayers={visualPlayers} selected={selected} setSelected={setSelected} onResolve={finishNight}/>}
    {screen==='vote'&&game&&<EngineVote game={game} viewPlayers={visualPlayers} selected={selected} setSelected={setSelected} onConfirm={finishVote}/>}
    {screen==='verdict'&&game&&<EngineVerdict game={game} onContinue={nextNight}/>}
    {screen==='end'&&game&&<EngineEnd game={game} onAgain={startMatch} onHome={home}/>}
  </div>
}

function Home({onLobby,onQuick}:{onLobby:()=>void;onQuick:()=>void}){
  return <main className="home"><section><Brand/><div className="menu">
    <Menu primary icon="⚔" title="Hızlı Oyun" sub="Hemen oyna, yeni insanlarla tanış." onClick={onQuick}/>
    <Menu icon="⌂" title="Oda Kur" sub="Kendi kurallarınla oyna." onClick={onLobby}/>
    <Menu icon="♟" title="Odaya Katıl" sub="Arkadaşlarının odasına katıl." onClick={onLobby}/>
    <Menu icon="▤" title="Nasıl Oynanır?" sub="Kuralları öğren, ustalaş."/>
  </div></section><aside className="home-side"><div className="promo"><div className="portrait-big">V</div><div><small>YENİ SEZON</small><h2>Karanlık geri dönüyor.</h2><p>Daha fazla strateji, daha keskin blöfler, daha zor kararlar.</p><button>Detayları Gör ›</button></div></div><div className="invite"><div className="face-row"><i>A</i><i>Y</i><i>Z</i><i>K</i></div><h3>Arkadaşlarını Davet Et</h3><p>Aynı masada, farklı gerçekler.</p><button>♟ Davet Et</button></div><blockquote>“Kim dost, kim düşman?<br/>Doğru soruları sor...”</blockquote></aside><Lore/></main>
}
function Menu({icon,title,sub,onClick,primary}:{icon:string;title:string;sub:string;onClick?:()=>void;primary?:boolean}){
  return <button className={'menu-btn '+(primary?'primary':'')} onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{sub}</small></div><em>›</em></button>
}

function Lobby({onBack,onStart}:{onBack:()=>void;onStart:()=>void}){
  return <main className="lobby"><aside className="lobby-left"><Brand/><button className="back" onClick={onBack}>← Ana menü</button><Lore/></aside><section className="panel lobby-panel"><div className="panel-head"><h1>Oda Lobisi</h1><div className="code"><small>ODA KODU</small><b>VK7M3</b></div><button>⌯ Paylaş</button></div><div className="lobby-grid"><div><h3>Oyuncular <small>(10/10)</small></h3><div className="player-list">{players.map((p,i)=><div className="player-line" key={p.id}><span className="avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><div><b>{p.name} {i===0&&<em>♛</em>}</b><small className={p.status}>{p.status==='ready'?'● Hazır':p.status==='joining'?'○ Katılıyor...':'● Hazır Değil'}</small></div><span className="mic">{p.mic?'♬':'♩'}</span><button>•••</button></div>)}</div><div className="chat"><b>Sohbet</b><p><strong>Mert:</strong> Herkese merhaba!</p><p><strong>Ayşe:</strong> Hazırım 🙂</p><p><strong>Burak:</strong> Bu sefer köylüler kazanacak.</p><input placeholder="Mesajını yaz..."/></div></div><div className="settings"><div className="tabs"><button className="active">Oyun Ayarları</button><button>Rol Dağılımı</button></div><div className="mode"><span>🌒</span><div><small>OYUN MODU</small><h2>Klasik Paket</h2><p>Dengeli, sürükleyici, zamansız.</p></div></div><Setting icon="◆" label="Harita" value="Köy Meydanı"/><Setting icon="☀" label="Gündüz Süresi" value="90 saniye"/><Setting icon="☾" label="Gece Süresi" value="60 saniye"/><Setting icon="☵" label="Tartışma" value="Var"/><div className="roles"><h3>Rol Dağılımı</h3><div><Role icon="🦇" name="Vampir" n="2"/><Role icon="♙" name="Köylü" n="6"/><Role icon="◉" name="Kâhin" n="1"/><Role icon="⬟" name="Koruyucu" n="1"/></div><label>Rolleri Rastgele Dağıt <input type="checkbox" defaultChecked/></label></div><button className="start" onClick={onStart}>Oyunu Başlat <b>›</b></button></div></div></section></main>
}
function Setting({icon,label,value}:{icon:string;label:string;value:string}){return <div className="setting"><span>{icon}</span><b>{label}</b><button>‹</button><strong>{value}</strong><button>›</button></div>}
function Role({icon,name,n}:{icon:string;name:string;n:string}){return <div className="role"><span>{icon}</span><b>{name}</b><em>{n}</em></div>}

function Day({selected,setSelected,tab,setTab,notes,note,setNote,addNote,conflict,onNight}:{selected:number|null;setSelected:(n:number|null)=>void;tab:'claims'|'votes'|'clues';setTab:(t:'claims'|'votes'|'clues')=>void;notes:string[];note:string;setNote:(s:string)=>void;addNote:()=>void;conflict:Claim[];onNight:()=>void}){
  return <main className="game"><section className="council"><Brand/><div className="phase-badge"><b>☀ 3. Gün</b><span>Köy Meclisi</span><small>⌛ Tartışma · 01:18</small></div><div className="ring">{players.slice(0,8).map((p,i)=>{const a=i/8*Math.PI*2-Math.PI/2,x=50+Math.cos(a)*40,y=50+Math.sin(a)*37;return <button key={p.id} className={'seat '+(selected===p.id?'selected':'')} style={{left:x+'%',top:y+'%'}} onClick={()=>setSelected(selected===p.id?null:p.id)}><i>{i+1}</i><span className="avatar player-avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><b>{p.name}</b><em>•••</em></button>})}<div className="bonfire"><i/><b/></div></div><Lore/><button className="vote">Bugün kimi oylayacaksın? <b>›</b></button><button className="night-link" onClick={onNight}>Gece demosu →</button></section><aside className="panel deduction"><blockquote>“Aynı köyde, farklı gerçekler...”</blockquote><div className="tabs"><button className={tab==='claims'?'active':''} onClick={()=>setTab('claims')}>İddialar</button><button className={tab==='votes'?'active':''} onClick={()=>setTab('votes')}>Oylama Geçmişi</button><button className={tab==='clues'?'active':''} onClick={()=>setTab('clues')}>Rol İpuçları</button></div>{tab==='claims'&&<Claims conflict={conflict}/>} {tab==='votes'&&<Votes/>} {tab==='clues'&&<Clues/>}<div className="notes"><div><b>▤ Benim Notlarım</b><small>Sadece sana görünür</small></div>{notes.map((n,i)=><label key={i}><input type="checkbox" defaultChecked={i<2}/>{n}</label>)}<div className="note-input"><input value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNote()} placeholder="Not ekle..."/><button onClick={addNote}>＋</button></div></div></aside>{selected&&<Inspector player={players.find(p=>p.id===selected)!} close={()=>setSelected(null)}/>}</main>
}
function Claims({conflict}:{conflict:Claim[]}){return <div className="claim-wrap"><div className="claim-list">{claims.map(c=><div className={'claim '+c.tone} key={c.id}><span>{c.player[0]}</span><div><b>{c.player} <em>→ {c.role}</em></b><p>“{c.quote}”</p></div><small>3. Gün</small></div>)}</div><div className="conflict"><h3>⚔ Çelişen İddia</h3><div>{conflict.slice(0,2).map((c,i)=><section key={c.id}><span>{c.player[0]}</span><b>{c.player}<small>{c.role}</small></b>{i===0&&<em>×</em>}</section>)}</div></div></div>}
function Votes(){return <div className="history">{[['1. Gün','Burak','4 oy'],['2. Gün','Can','5 oy'],['3. Gün','Elif','4 oy']].map(r=><div key={r[0]}><b>{r[0]}</b><span>● ● ● →</span><strong>{r[1]}</strong><small>{r[2]}</small></div>)}</div>}
function Clues(){return <div className="clues"><p><b>◉ Kâhin iddiası</b><br/>Aynı rol için iki farklı iddia var.</p><p><b>⬟ Koruma iddiası</b><br/>Mert, Elif’i koruduğunu söylüyor.</p><p><b>⚑ Temel kural</b><br/>Sistem doğruyu seçmez; yalnızca açıklanan bilgiyi düzenler.</p></div>}
function Inspector({player,close}:{player:Player;close:()=>void}){return <div className="inspector"><button onClick={close}>×</button><span className="avatar big" style={{'--accent':player.accent} as CSSProperties}>{player.initial}</span><h2>{player.name}</h2><em>● Hayatta</em><hr/><b>Oylama geçmişi</b><p>1. Gün → Bora</p><p>2. Gün → Ayşe</p><p>3. Gün → Can</p><div><button className="bad">✕ Şüpheli</button><button>? Emin Değilim</button><button className="good">✓ Güveniyorum</button></div></div>}

function Night({selected,setSelected,onDawn}:{selected:number|null;setSelected:(n:number|null)=>void;onDawn:()=>void}){
 const picked=players.find(p=>p.id===selected)
 return <main className="game night-game"><section className="council"><Brand/><div className="phase-badge night"><b>☾ Gece 2</b><span>Köy Uyuyor</span><small>⌛ Rol Aşaması · 00:38</small></div><div className="ring sleeping">{players.slice(0,8).map((p,i)=>{const a=i/8*Math.PI*2-Math.PI/2,x=50+Math.cos(a)*40,y=50+Math.sin(a)*37;return <button key={p.id} className={'seat '+(selected===p.id?'selected':'')} style={{left:x+'%',top:y+'%'}} onClick={()=>setSelected(p.id)}><span className="avatar player-avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><b>{p.name}</b><em>zZ</em></button>})}<div className="bonfire low"><i/><b/></div></div><button className="vote blue">Karanlıkta kimin gerçeğini göreceksin? <b>›</b></button></section><aside className="panel role-panel"><blockquote>“Herkes uyur... Ama gerçekler asla.”</blockquote><h1>Rolün</h1><div className="seer-card"><div>◉</div><b>KÂHİN</b></div><section><h2>◉ Kâhin</h2><p>Her gece bir oyuncunun tarafını araştırırsın.</p><em>“Gözlerim karanlıkta da görür.”</em><h3>Hedef Seçimi</h3><p>Bu gece araştırmak istediğin bir oyuncuyu seç.</p><div className={'target '+(picked?'active':'')}><span>{picked?.initial??'?'}</span><b>{picked?.name??'Oyuncu seçilmedi'}</b><em>◉</em></div></section><button className="seer-btn" disabled={!picked} onClick={onDawn}>◉ Bu Oyuncuyu Sorgula</button><small className="hint">Sonuç diğer oyunculara açıklanmaz.</small></aside></main>
}

type VisualPlayer = Player & { alive:boolean }

function EngineRoleReveal({game,onContinue}:{game:GameState;onContinue:()=>void}){
  const roleId=getRoleForPlayer(game,LOCAL_PLAYER_ID)
  const role=ROLE_DEFINITIONS[roleId]
  const mates=roleId==='vampire'?game.public.players.filter(p=>p.id!==LOCAL_PLAYER_ID&&getRoleForPlayer(game,p.id)==='vampire').map(p=>p.name):[]
  return <main className="engine-center"><section className={'engine-role-card role-'+roleId}><small>ROLÜN</small><div className="engine-role-icon">{role.icon}</div><h1>{role.name}</h1><p>{role.short}</p><hr/><p>{role.description}</p>{mates.length>0&&<div className="engine-mate"><b>Diğer Vampir</b><span>{mates.join(', ')}</span></div>}<button onClick={onContinue}>Hazırım · Geceye Geç ›</button><em>Bu bilgi yalnızca sana gösterilir.</em></section></main>
}

function EngineRing({viewPlayers,selected,setSelected,night=false,valid}:{viewPlayers:VisualPlayer[];selected:number|null;setSelected:(n:number|null)=>void;night?:boolean;valid?:Set<number>}){
  const n=viewPlayers.length
  return <div className={night?'ring sleeping':'ring'}>{viewPlayers.map((p,i)=>{const a=i/n*Math.PI*2-Math.PI/2,x=50+Math.cos(a)*40,y=50+Math.sin(a)*37;const selectable=p.alive&&(!night||valid?.has(p.id));return <button key={p.id} disabled={!selectable} className={'seat '+(selected===p.id?'selected ':'')+(p.alive?'':'dead')} style={{left:x+'%',top:y+'%'}} onClick={()=>setSelected(selected===p.id?null:p.id)}>{!night&&<i>{i+1}</i>}<span className="avatar player-avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><b>{p.name}</b><em>{p.alive?(night?'zZ':'•••'):'☠'}</em></button>})}<div className={'bonfire '+(night?'low':'')}><i/><b/></div></div>
}

function EngineDay({game,viewPlayers,selected,setSelected,tab,setTab,notes,note,setNote,addNote,conflict,onVote}:{game:GameState;viewPlayers:VisualPlayer[];selected:number|null;setSelected:(n:number|null)=>void;tab:'claims'|'votes'|'clues';setTab:(t:'claims'|'votes'|'clues')=>void;notes:string[];note:string;setNote:(s:string)=>void;addNote:()=>void;conflict:Claim[];onVote:()=>void}){
  const killed=game.public.lastNight?.killedPlayerId?viewPlayers.find(p=>p.id===game.public.lastNight?.killedPlayerId):null
  const localAlive=game.public.players.find(p=>p.id===LOCAL_PLAYER_ID)?.alive??false
  const inv=game.secret.investigations[LOCAL_PLAYER_ID]?.at(-1)
  const invPlayer=inv?viewPlayers.find(p=>p.id===inv.targetId):null
  return <main className="game"><section className="council"><Brand/><div className="phase-badge"><b>☀ {game.public.day}. Gün</b><span>Köy Meclisi</span><small>⌛ Tartışma · 01:18</small></div><div className="dawn-summary">{killed?<>☠ <b>{killed.name}</b> gece öldürüldü.</>:<>☀ Bu gece <b>kimse ölmedi.</b></>}{inv&&getRoleForPlayer(game,LOCAL_PLAYER_ID)==='seer'&&<span className={'seer-result '+inv.team}>◉ {invPlayer?.name}: {inv.team==='vampire'?'Vampir tarafı':'Köy tarafı'}</span>}</div><EngineRing viewPlayers={viewPlayers} selected={selected} setSelected={setSelected}/><Lore/><button className="vote" onClick={onVote}>{localAlive?'Bugün kimi oylayacaksın?':'Hayalet olarak oylamayı izle'} <b>›</b></button></section><aside className="panel deduction"><blockquote>“Aynı köyde, farklı gerçekler...”</blockquote><div className="tabs"><button className={tab==='claims'?'active':''} onClick={()=>setTab('claims')}>İddialar</button><button className={tab==='votes'?'active':''} onClick={()=>setTab('votes')}>Oylama Geçmişi</button><button className={tab==='clues'?'active':''} onClick={()=>setTab('clues')}>Rol İpuçları</button></div>{tab==='claims'&&<Claims conflict={conflict}/>} {tab==='votes'&&<EngineVotes game={game} viewPlayers={viewPlayers}/>} {tab==='clues'&&<Clues/>}<div className="notes"><div><b>▤ Benim Notlarım</b><small>Sadece sana görünür</small></div>{notes.map((x,i)=><label key={i}><input type="checkbox" defaultChecked={i<2}/>{x}</label>)}<div className="note-input"><input value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNote()} placeholder="Not ekle..."/><button onClick={addNote}>＋</button></div></div></aside>{selected&&<EngineInspector player={viewPlayers.find(p=>p.id===selected)!} close={()=>setSelected(null)}/>}</main>
}

function EngineVotes({game,viewPlayers}:{game:GameState;viewPlayers:VisualPlayer[]}){
  if(!game.public.voteHistory.length)return <div className="empty-history">Henüz tamamlanmış oylama yok.</div>
  return <div className="history">{game.public.voteHistory.map(v=><div key={v.day}><b>{v.day}. Gün</b><span>{Object.keys(v.votes).length} oy →</span><strong>{v.eliminatedPlayerId?viewPlayers.find(p=>p.id===v.eliminatedPlayerId)?.name:'Berabere'}</strong><small>{v.tied?'eleme yok':'elendi'}</small></div>)}</div>
}

function EngineInspector({player,close}:{player:VisualPlayer;close:()=>void}){
  return <div className="inspector"><button onClick={close}>×</button><span className="avatar big" style={{'--accent':player.accent} as CSSProperties}>{player.initial}</span><h2>{player.name}</h2><em className={player.alive?'':'dead-label'}>● {player.alive?'Hayatta':'Ölü'}</em><hr/><b>Dedüksiyon kaydı</b><p>İddiaları ve oy geçmişini karşılaştır.</p><div><button className="bad">✕ Şüpheli</button><button>? Emin Değilim</button><button className="good">✓ Güveniyorum</button></div></div>
}

function EngineNight({game,viewPlayers,selected,setSelected,onResolve}:{game:GameState;viewPlayers:VisualPlayer[];selected:number|null;setSelected:(n:number|null)=>void;onResolve:()=>void}){
  const roleId=getRoleForPlayer(game,LOCAL_PLAYER_ID),role=ROLE_DEFINITIONS[roleId]
  const alive=game.public.players.find(p=>p.id===LOCAL_PLAYER_ID)?.alive??false
  const valid=new Set(alive?validNightTargets(game,LOCAL_PLAYER_ID).map(p=>p.id):[])
  const target=viewPlayers.find(p=>p.id===selected),needs=alive&&role.nightAction!==null
  const mate=roleId==='vampire'?viewPlayers.find(p=>p.id!==LOCAL_PLAYER_ID&&p.alive&&getRoleForPlayer(game,p.id)==='vampire'):null
  const copy:Record<RoleId,{prompt:string;button:string}>={vampire:{prompt:'Bu gece avlamak istediğin oyuncuyu seç.',button:'🦇 Bu Oyuncuyu Hedefle'},seer:{prompt:'Bu gece tarafını öğrenmek istediğin oyuncuyu seç.',button:'◉ Bu Oyuncuyu Sorgula'},guardian:{prompt:'Bu gece korumak istediğin oyuncuyu seç.',button:'⬟ Bu Oyuncuyu Koru'},villager:{prompt:'Gece yeteneğin yok. Köyün uyanmasını bekle.',button:'☾ Geceyi Bekle'}}
  return <main className="game night-game"><section className="council"><Brand/><div className="phase-badge night"><b>☾ Gece {game.public.day}</b><span>Köy Uyuyor</span><small>⌛ Rol Aşaması · 00:38</small></div><EngineRing viewPlayers={viewPlayers} selected={selected} setSelected={setSelected} night valid={valid}/><button className="vote blue">{needs?'Karanlıkta kimi seçeceksin?':'Köy karanlığa gömüldü...'} <b>›</b></button></section><aside className={'panel role-panel role-'+roleId}><blockquote>“Herkes uyur... Ama gerçekler asla.”</blockquote><h1>Rolün</h1><div className="seer-card"><div>{role.icon}</div><b>{role.name.toUpperCase()}</b></div><section><h2>{role.icon} {role.name}</h2><p>{role.description}</p><em>{role.short}</em>{mate&&<p className="teammate-inline">Diğer Vampir: <b>{mate.name}</b></p>}<h3>{needs?'Hedef Seçimi':'Gece Bekleyişi'}</h3><p>{alive?copy[roleId].prompt:'Bu gece ölüsün; yaşayanların kararlarını izliyorsun.'}</p>{needs&&<div className={'target '+(target?'active':'')}><span>{target?.initial??'?'}</span><b>{target?.name??'Oyuncu seçilmedi'}</b><em>{role.icon}</em></div>}</section><button className="seer-btn" disabled={needs&&selected===null} onClick={onResolve}>{alive?copy[roleId].button:'☾ Geceyi İzle'}</button><small className="hint">Seçimin diğer oyunculara gösterilmez.</small></aside></main>
}

function EngineVote({game,viewPlayers,selected,setSelected,onConfirm}:{game:GameState;viewPlayers:VisualPlayer[];selected:number|null;setSelected:(n:number|null)=>void;onConfirm:()=>void}){
  const alive=game.public.players.find(p=>p.id===LOCAL_PLAYER_ID)?.alive??false
  const valid=new Set(alive?validVoteTargets(game,LOCAL_PLAYER_ID).map(p=>p.id):[])
  return <main className="engine-center"><section className="panel engine-vote"><div className="phase-badge vote-badge"><b>🗳 {game.public.day}. Gün</b><span>Oylama</span><small>Köy kararını veriyor.</small></div><h1>{alive?'Köyden kimi göndermek istiyorsun?':'Hayalet olarak oylamayı izliyorsun'}</h1><div className="engine-vote-grid">{viewPlayers.map(p=><button key={p.id} disabled={!alive||!p.alive||!valid.has(p.id)} className={(selected===p.id?'selected ':'')+(p.alive?'':'dead')} onClick={()=>setSelected(p.id)}><span className="avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><b>{p.name}</b><small>{p.alive?(p.id===LOCAL_PLAYER_ID?'Sen':'Hayatta'):'Ölü'}</small></button>)}</div><button className="engine-confirm" disabled={alive&&selected===null} onClick={onConfirm}>{alive?'Oyumu Kilitle':'Oylamayı İzle'} ›</button><p>Oylar tamamlanana kadar sonuç gizli tutulur.</p></section></main>
}

function EngineVerdict({game,onContinue}:{game:GameState;onContinue:()=>void}){
  const id=game.public.lastEliminatedPlayerId,p=id?players.find(x=>x.id===id):null,role=id?ROLE_DEFINITIONS[getRoleForPlayer(game,id)]:null,last=game.public.voteHistory.at(-1)
  return <main className="engine-center"><section className="panel engine-verdict">{last?.tied?<><span className="verdict-icon">⚖</span><h1>Köy Karar Veremedi</h1><p>Oylar eşit kaldı. Kimse gönderilmedi.</p></>:<><span className="verdict-icon">⚔</span><h1>Köy Kararını Verdi</h1><span className="avatar big">{p?.initial}</span><h2>{p?.name}</h2><p>{p?.name} köyden gönderildi.</p><div className="revealed-role">{role?.icon} {role?.name}</div></>}<button className="start" onClick={onContinue}>Yeni Geceye Geç ›</button></section></main>
}

function EngineEnd({game,onAgain,onHome}:{game:GameState;onAgain:()=>void;onHome:()=>void}){
  const village=game.public.winner==='village'
  return <main className="engine-center engine-end-wrap"><section className="panel engine-end"><header><small>KAZANAN</small><h1>{village?'KÖYLÜLER':'VAMPİRLER'}</h1><p>{village?'Köy karanlığı dağıttı.':'Köy sustu, karanlık hüküm sürdü.'}</p></header><h2>Gerçek Roller</h2><div className="truth-grid">{players.map(p=>{const r=ROLE_DEFINITIONS[getRoleForPlayer(game,p.id)],alive=game.public.players.find(x=>x.id===p.id)?.alive;return <div key={p.id} className={'truth-card team-'+r.team}><span className="avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><b>{p.name}</b><strong>{r.icon} {r.name}</strong><small>{alive?'Hayatta':'Öldü'}</small></div>})}</div><div className="end-actions"><button className="start" onClick={onAgain}>Tekrar Oyna ›</button><button onClick={onHome}>Ana Menü</button></div></section></main>
}
