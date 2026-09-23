import { useMemo, useState, type CSSProperties } from 'react'

type Screen = 'home' | 'lobby' | 'day' | 'night'
type Player = { id:number; name:string; initial:string; accent:string; status?:'ready'|'not-ready'|'joining'; mic?:boolean }
type Claim = { id:number; player:string; role:string; quote:string; tone:'violet'|'cyan'|'gold'|'red' }

const players:Player[] = [
  {id:1,name:'Ali',initial:'A',accent:'#b67a47',status:'ready',mic:true},
  {id:2,name:'Ayşe',initial:'A',accent:'#8d83bd',status:'ready'},
  {id:3,name:'Mert',initial:'M',accent:'#8a6d57',status:'ready'},
  {id:4,name:'Esra',initial:'E',accent:'#a24139',status:'not-ready',mic:true},
  {id:5,name:'Burak',initial:'B',accent:'#a98b55',status:'ready'},
  {id:6,name:'Zeynep',initial:'Z',accent:'#587991',status:'ready'},
  {id:7,name:'Kerem',initial:'K',accent:'#79634e',status:'not-ready'},
  {id:8,name:'Elif',initial:'E',accent:'#6e5a75',status:'ready'},
  {id:9,name:'Can',initial:'C',accent:'#716550',status:'joining'}
]
const claims:Claim[] = [
  {id:1,player:'Ali',role:'Kâhin',quote:'Dün gece Deniz masum çıktı.',tone:'violet'},
  {id:2,player:'Ayşe',role:'Kâhin',quote:'Ben de Deniz’i gördüm; masum.',tone:'cyan'},
  {id:3,player:'Mert',role:'Koruyucu',quote:'Dün gece Elif’i korudum.',tone:'gold'},
  {id:4,player:'Burak',role:'Köylü',quote:'Ben sıradan köylüyüm.',tone:'red'}
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
  const [selected,setSelected]=useState<number|null>(null)
  const [tab,setTab]=useState<'claims'|'votes'|'clues'>('claims')
  const [notes,setNotes]=useState(['Ali ve Ayşe aynı rolü iddia ediyor.','Burak’ın tavırları gergin.'])
  const [note,setNote]=useState('')
  const conflict=useMemo(()=>claims.filter(c=>c.role==='Kâhin'),[])
  const addNote=()=>{const t=note.trim();if(!t)return;setNotes(n=>[...n,t]);setNote('')}
  return <div className={'app phase-'+screen}><VillageBackdrop/><Topbar/>
    {screen==='home'&&<Home onLobby={()=>setScreen('lobby')} onQuick={()=>setScreen('day')}/>}
    {screen==='lobby'&&<Lobby onBack={()=>setScreen('home')} onStart={()=>setScreen('day')}/>}
    {screen==='day'&&<Day selected={selected} setSelected={setSelected} tab={tab} setTab={setTab} notes={notes} note={note} setNote={setNote} addNote={addNote} conflict={conflict} onNight={()=>setScreen('night')}/>}
    {screen==='night'&&<Night selected={selected} setSelected={setSelected} onDawn={()=>setScreen('day')}/>}
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
  return <main className="lobby"><aside className="lobby-left"><Brand/><button className="back" onClick={onBack}>← Ana menü</button><Lore/></aside><section className="panel lobby-panel"><div className="panel-head"><h1>Oda Lobisi</h1><div className="code"><small>ODA KODU</small><b>VK7M3</b></div><button>⌯ Paylaş</button></div><div className="lobby-grid"><div><h3>Oyuncular <small>(9/10)</small></h3><div className="player-list">{players.map((p,i)=><div className="player-line" key={p.id}><span className="avatar" style={{'--accent':p.accent} as CSSProperties}>{p.initial}</span><div><b>{p.name} {i===0&&<em>♛</em>}</b><small className={p.status}>{p.status==='ready'?'● Hazır':p.status==='joining'?'○ Katılıyor...':'● Hazır Değil'}</small></div><span className="mic">{p.mic?'♬':'♩'}</span><button>•••</button></div>)}<div className="empty">＋ <b>Boş Oyuncu</b><button>♟ Davet Et</button></div></div><div className="chat"><b>Sohbet</b><p><strong>Mert:</strong> Herkese merhaba!</p><p><strong>Ayşe:</strong> Hazırım 🙂</p><p><strong>Burak:</strong> Bu sefer köylüler kazanacak.</p><input placeholder="Mesajını yaz..."/></div></div><div className="settings"><div className="tabs"><button className="active">Oyun Ayarları</button><button>Rol Dağılımı</button></div><div className="mode"><span>🌒</span><div><small>OYUN MODU</small><h2>Klasik Paket</h2><p>Dengeli, sürükleyici, zamansız.</p></div></div><Setting icon="◆" label="Harita" value="Köy Meydanı"/><Setting icon="☀" label="Gündüz Süresi" value="90 saniye"/><Setting icon="☾" label="Gece Süresi" value="60 saniye"/><Setting icon="☵" label="Tartışma" value="Var"/><div className="roles"><h3>Rol Dağılımı</h3><div><Role icon="🦇" name="Vampir" n="2"/><Role icon="♙" name="Köylü" n="5"/><Role icon="◉" name="Kâhin" n="1"/><Role icon="⬟" name="Koruyucu" n="1"/><Role icon="☠" name="Deli" n="1"/></div><label>Rolleri Rastgele Dağıt <input type="checkbox" defaultChecked/></label></div><button className="start" onClick={onStart}>Oyunu Başlat <b>›</b></button></div></div></section></main>
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