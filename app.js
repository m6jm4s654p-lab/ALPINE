(()=>{
'use strict';
const root=document.getElementById('snow-cyber'),q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)];
const atlases=[...window.ALPINE_ATLASES,"./animal-avatars.png","./animal-mascots.png"].map(src=>{const im=new Image();im.src=src;return im});
let state={me:null,registered:false,avatar:null,background:50,rivals:[],url:'',profiles:{},history:[],rankIds:[],rewardSeen:[],missionFull:false,premium:null,uiTheme:'original'},roster=[],dataset=null;
let screen='title',gender=0,page=0,draft=0,selected=null,received=null,photoKey=null,photoBack='card',dirty=false;
let writeQueue=Promise.resolve(),refreshing=null,lastAttempt=0,notice='',ready=false;
let rankingAttempt=0,rankingNotice='公開リストを確認していません。';
const photos=new Map(),photoUrls=new Map();
const dbReady=new Promise(resolve=>{try{const r=indexedDB.open('alpine-cyber-local',1);r.onupgradeneeded=()=>{r.result.createObjectStore('settings');r.result.createObjectStore('photos')};r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>resolve(null)}catch{resolve(null)}});
function read(db,store,key){return new Promise(resolve=>{try{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null)}catch{resolve(null)}})}
function write(db,store,key,value){return new Promise(resolve=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>resolve(false)}catch{resolve(false)}})}
function save(){dirty=true;const snapshot=JSON.parse(JSON.stringify(state));writeQueue=writeQueue.then(async()=>{const db=await dbReady;if(!db||!await write(db,'settings','state',snapshot))q('#cy-storage').textContent='端末保存が使えないため、変更は表示中のみ有効です。'})}
function validAvatar(a){return Number.isInteger(a)&&a>=0&&a<140}
function validCardAvatar(a){return a===null||validAvatar(a)}
function validId(id){return /^\d{8}$/.test(id)}
function validUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
// Reserved local identity; serialized points use a string so JSON preserves infinity.
const FIXED_ID='00000000',FIXED_QUERY='iwatesan2038';
function fixedPlayer(){return {id:FIXED_ID,name:'岩崎 岳人',team:'',pref:'',sex:'男子',category:'未確認',points:{SL:'∞',GS:'∞',SG:'∞'}}}
function who(id){if(id===FIXED_ID)return fixedPlayer();return state.profiles[id]||roster.find(r=>r.id===id)||null}
function point(v){if(v==='∞')return '∞';return typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'—'}
function dateText(value){return new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function metadata(){return dataset?`${dataset.season-1}/${dataset.season} · SAJ No.${dataset.listNumber} · 取得 ${dateText(dataset.checkedAt)}`:'SAJデータ未取得'}
function validateDataset(d){
 if(d?.schema!==1||d.provider!=='SAJ'||!Number.isInteger(d.season)||!Number.isInteger(d.listNumber)||!Number.isFinite(Date.parse(d.checkedAt))||!Array.isArray(d.athletes)||!d.athletes.length)throw Error('SAJデータの形式を確認できません。');
 const ids=new Set();
 for(const a of d.athletes){if(!validId(a.id)||ids.has(a.id)||typeof a.name!=='string'||!a.name||typeof a.pref!=='string'||typeof a.team!=='string'||!['男子','女子'].includes(a.sex)||!['K2','一般','未確認'].includes(a.category)||!a.points||!['SL','GS','SG'].every(k=>a.points[k]===null||(typeof a.points[k]==='number'&&Number.isFinite(a.points[k])&&a.points[k]>=0)))throw Error('不完全なSAJデータのため更新しません。');ids.add(a.id)}
 return d;
}
function profileList(p){
 const match=/^(\d{4}) No\.(\d+)$/.exec(p?.listLabel||'');
 return {season:p?.pointSeasonCode??(match?+match[1]:0),number:p?.pointListNumber??(match?+match[2]:0)};
}
function syncPublishedProfiles(d){
 let changed=false;
 for(const id of new Set([state.me,...state.rivals.map(r=>r.id)].filter(Boolean))){
  if(id===FIXED_ID)continue;
  const person=d.athletes.find(a=>a.id===id);if(!person)continue;
  const old=state.profiles[id],list=profileList(old);
  if(list.season>d.season||(list.season===d.season&&list.number>d.listNumber))continue;
  if(list.season===d.season&&list.number===d.listNumber&&Date.parse(old?.checkedAt)>Date.parse(d.checkedAt))continue;
  const next={...old,...person,pendingProfile:false,pointSeasonCode:d.season,pointListNumber:d.listNumber,listLabel:`${d.season} No.${d.listNumber}`,checkedAt:d.checkedAt};
  if(JSON.stringify(old)!==JSON.stringify(next)){state.profiles[id]=next;changed=true;}
  if(id===state.me){const key=`${id}:${d.season}:${d.listNumber}`,entry={key,label:next.listLabel,points:person.points};
   if(JSON.stringify(state.history.find(h=>h.key===key))!==JSON.stringify(entry)){state.history=state.history.filter(h=>h.key!==key);state.history.push(entry);state.history=state.history.slice(-24);changed=true;}}
 }
 if(changed)save();
}
function applyDataset(d){
 dataset=d;roster=d.athletes;
 syncPublishedProfiles(d);
 const oldPref=q('#cy-pref').value;prefs();if([...q('#cy-pref').options].some(o=>o.value===oldPref))q('#cy-pref').value=oldPref;
 if(screen==='register')candidates();render();
}
// Refresh the complete published list independently of individual API points.
async function refreshRanking(force=false){
 if(!force&&rankingAttempt&&Date.now()-rankingAttempt<3600000)return;
 rankingAttempt=Date.now();const epoch=dataEpoch;
 try{
  const response=await fetch('./saj-data.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('公開リスト取得失敗');
  const next=validateDataset(await response.json());
  if(epoch!==dataEpoch)return;
  if(dataset&&(next.season<dataset.season||(next.season===dataset.season&&next.listNumber<dataset.listNumber)||
    (next.season===dataset.season&&next.listNumber===dataset.listNumber&&Date.parse(next.checkedAt)<Date.parse(dataset.checkedAt))))throw Error('旧リスト');
  applyDataset(next);
  rankingNotice=Date.now()-Date.parse(next.checkedAt)>86400000?'公開リストの取得から24時間以上経過しています。最新リストの反映が遅れている可能性があります。':'公開リストを確認しました。公式公開から反映まで時間差があります。';
  const db=await dbReady;if(epoch!==dataEpoch)return;
  if(db&&!await write(db,'settings','saj-dataset',next))rankingNotice+=' この端末には保存できませんでした。';
 }catch{
  if(epoch!==dataEpoch)return;
  rankingNotice=dataset?'公開リストを確認できません。前回取得したリストの参考順位です。':'公開リストを取得できないため順位を表示できません。';
 }
}
function rankingValue(list,id,event,prefOnly=false){
 const current=list?.athletes.find(a=>a.id===id);
 if(!current||current.category==='未確認'||current.points[event]===null)return null;
 return 1+list.athletes.filter(a=>a.sex===current.sex&&(current.category==='一般'||a.category==='K2')&&
  (!prefOnly||a.pref===current.pref)&&a.points[event]!==null&&a.points[event]<current.points[event]).length;
}
function rankingMeta(){
 if(!dataset)return '順位データ未取得';
 const person=dataset.athletes.find(a=>a.id===state.me);
 return `順位の基準：${metadata()}`+(person?` · ${person.sex} / ${person.category==='一般'?'一般（K2を含む全選手）':person.category} / ${person.pref}`:' · このリストに登録選手が見つかりません');
}

function prefs(){const names='北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄'.split(' ');q('#cy-pref').replaceChildren(new Option('都道府県名を選択してください',''));for(const n of names)q('#cy-pref').append(new Option(n==='北海道'?n:n+(['東京'].includes(n)?'都':['京都','大阪'].includes(n)?'府':'県'),n));const extra=[...new Set(roster.map(a=>a.pref))].filter(n=>n&&!names.includes(n));for(const n of extra)q('#cy-pref').append(new Option(n,n));q('#cy-pref').value=''}

const API='https://snowtech-saj-api.take6583.workers.dev';
function weekBoundary(now=Date.now()){const d=new Date(now+9*3600000);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+3)%7);return d.getTime()-9*3600000}
function profileMeta(p){if(p?.id===FIXED_ID)return '固定ポイント · 更新対象外';return p?.checkedAt?`${p.listLabel} · 取得 ${dateText(p.checkedAt)}`:`公開リスト · ${metadata()}`}
async function api(path){const r=await fetch(API+path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('SAJ通信エラー');const d=await r.json();if(!d.ok)throw Error('SAJ取得失敗');return d}
function normalized(a,meta={}){const id=String(a.saj),old=who(id)||{};if(!validId(id)||!a.name)throw Error('選手情報不正');return {id,name:a.name,team:a.team||old.team||'',pref:meta.pref||a.organization||old.pref||'',sex:meta.sex||(a.sex==='女'?'女子':'男子'),category:old.category||'未確認',points:old.points||{SL:null,GS:null,SG:null}}}
async function loadPerson(id){if(id===FIXED_ID){state.profiles[id]=fixedPlayer();return}const epoch=dataEpoch;const d=await api('/api/saj-athlete?saj='+encodeURIComponent(id));if(epoch===dataEpoch)state.profiles[id]=normalized(d.athlete);}
async function updatePoints(id){if(id===FIXED_ID)return;const d=await api('/api/saj-athlete-points?saj='+id),p=d.points,old=who(id);if(!old||p.saj!==id||!Number.isInteger(p.pointSeasonCode)||!Number.isInteger(p.pointListNumber))throw Error('形式不正');const points={};for(const k of ['SL','GS','SG']){const v=p[k.toLowerCase()];if(v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('ポイント不正');points[k]=v}if(old.pointSeasonCode&&(p.pointSeasonCode<old.pointSeasonCode||(p.pointSeasonCode===old.pointSeasonCode&&p.pointListNumber<old.pointListNumber)))throw Error('旧リスト');state.profiles[id]={...old,points,pointSeasonCode:p.pointSeasonCode,pointListNumber:p.pointListNumber,listLabel:`${p.pointSeasonCode} No.${p.pointListNumber}`,checkedAt:new Date().toISOString()};if(id===state.me){const key=`${id}:${p.pointSeasonCode}:${p.pointListNumber}`;state.history=state.history.filter(h=>h.key!==key);state.history.push({key,label:state.profiles[id].listLabel,points});state.history=state.history.slice(-24)}save()}
const attempts=new Map();
async function refresh(force=false){
 if(dataBusy)return;
 if(refreshing){await refreshing;return refresh(force)}
 const ids=[...new Set([state.me,...state.rivals.map(r=>r.id)].filter(Boolean))].filter(id=>id!==FIXED_ID).filter(id=>force||((Date.parse(who(id)?.checkedAt)||0)<weekBoundary()&&Date.now()-(attempts.get(id)||0)>600000));
 const rankingDue=force||!rankingAttempt||Date.now()-rankingAttempt>=3600000;
 if(!ids.length&&!rankingDue)return;
 notice='この端末のSAJポイントを更新しています…';
 refreshing=(async()=>{await refreshRanking(force);let failed=0;const queue=[...ids];await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(queue.length){const id=queue.shift();attempts.set(id,Date.now());try{if(!who(id)||who(id).pendingProfile)await loadPerson(id);await updatePoints(id)}catch{failed++}}}));notice=!ids.length?'':failed?`${failed}名の更新を確認できません。前回のデータを保持しています。`:'この端末のSAJポイントを確認しました。次回は木曜以降の起動・表示時に更新します。';})().finally(()=>{refreshing=null;render()});render();return refreshing;
}
let candidatesRequest=0;const candidateChecks=new Map();
async function loadCandidates(){const epoch=dataEpoch;const pref=q('#cy-pref').value,sex=q('#cy-sex').value,key=pref+sex,request=++candidatesRequest;if(!pref||candidateChecks.get(key)>=weekBoundary())return;q('#cy-register-status').textContent='SAJの選手一覧を取得しています…';try{const d=await api('/api/saj-athletes?sex='+encodeURIComponent(sex==='女子'?'女':'男')+'&organization='+encodeURIComponent(pref));if(epoch!==dataEpoch)return;if(!Array.isArray(d.athletes)||!d.athletes.length)throw Error();const people=d.athletes.map(a=>normalized(a,{pref,sex}));const fresh=new Map(people.map(a=>[a.id,a]));roster=roster.filter(a=>!fresh.has(a.id)).concat(people);candidateChecks.set(key,Date.now());if(request===candidatesRequest&&screen==='register'){candidates();q('#cy-register-status').textContent=`SAJ一覧取得済み · ${people.length}名（検索で絞り込み）`}}catch{if(request===candidatesRequest)q('#cy-register-status').textContent='最新一覧を取得できません。保存済みの選手から選択できます。'}}

const themePalettes=[
 ['さくら','#fff0f6','#ffc9df','#dabbff','#452442','#73516b'],
 ['ソーダ','#e8fbff','#b2e9ff','#d1ccff','#1e3955','#4b637d'],
 ['ミント','#e9fff3','#afe9d1','#c8eeff','#173f3d','#486b62'],
 ['ピーチ','#fff0dc','#ffd2b3','#ffbfd2','#55322b','#7e5a50'],
 ['ラベンダー','#f4edff','#d6c0ff','#fecfe8','#3e285a','#715786'],
 ['ミッドナイト','#061426','#143257','#166876','#f0f9ff','#b3cbdf'],
 ['ネオン','#110e29','#342263','#117785','#f9f1ff','#cbbce9'],
 ['グラファイト','#121820','#283341','#47637c','#f2f6fa','#b8c4d0'],
 ['オーロラ','#072b32','#1a3756','#64497b','#efffff','#b6d8e3'],
 ['サンセット','#25112a','#6c2852','#b45b36','#fff2f7','#ebc2d4']
];
const patternNames=['グラデーション','スノードット','ストライプ','チェック','オーブ','ダイヤ','ウェーブ','スター','マウンテン','プリズム'];
let premiumOwner=null,premiumBusy=false;
async function restorePurple(){premiumOwner=null;if(state.premium&&await window.YukiNakaPremium?.verifyProof(state.premium))premiumOwner=state.premium.playerId;if(state.background===108&&premiumOwner!==state.me)state.background=50}
async function claimPurple(code){if(premiumBusy)throw Error('プレミアムコードを確認中です。');if(!state.me)throw Error('先に自分の選手を登録してください。');const epoch=dataEpoch,playerId=state.me;premiumBusy=true;try{if(!window.YukiNakaPremium)throw Error('最新版を開き直してください。');const db=await dbReady;if(!db)throw Error('端末保存が必要です。保存可能なブラウザーで開いてください。');if(state.premium?.playerId!==playerId)state.premium={playerId,token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),receipt:''};const proof={...state.premium};save();await writeQueue;const persisted=await read(db,'settings','state');if(persisted?.premium?.token!==proof.token)throw Error('端末保存に失敗しました。コードはまだ使用していません。');if(epoch!==dataEpoch||state.me!==playerId)return;const next=await window.YukiNakaPremium.claim(code,proof);if(epoch!==dataEpoch||state.me!==playerId)return;state.premium=next;premiumOwner=playerId;state.background=108;save();q('#cy-ex-status').textContent='プレミアムSSR・紫を解放しました。背景選択の「専用SSR」から選べます。';render()}finally{premiumBusy=false}}
let themeGroup=0,themePage=0,themeDraft=0;
function themeStyle(id){
 if(id>=100&&id<110)return rareStyle(id);
 const [name,a,b,c,ink,muted]=themePalettes[Math.floor(id/10)],p=id%10;
 const base=`linear-gradient(145deg,${a},${b} 60%,${c})`;
 const patterns=[base,
 `radial-gradient(circle at 12px 12px,${c} 2px,transparent 3px) 0 0/24px 24px,${base}`,
 `repeating-linear-gradient(135deg,transparent 0 20px,${c}55 20px 28px),${base}`,
 `repeating-linear-gradient(0deg,transparent 0 28px,${c}44 28px 30px),repeating-linear-gradient(90deg,transparent 0 28px,${c}44 28px 30px),${base}`,
 `radial-gradient(circle at 90% 10%,${c} 0 12%,transparent 13%),radial-gradient(circle at 5% 80%,${b} 0 24%,transparent 25%),${base}`,
 `conic-gradient(from 45deg,${a} 0 25%,${b} 0 50%,${c} 0 75%,${b} 0) 0 0/70px 70px`,
 `repeating-radial-gradient(ellipse at 0% 0%,${a} 0 25px,${b} 26px 50px,${c} 51px 55px)`,
 `radial-gradient(ellipse 2px 8px at 20px 20px,${c} 90%,transparent),radial-gradient(ellipse 8px 2px at 20px 20px,${c} 90%,transparent),${base}`,
 `linear-gradient(145deg,transparent 55%,${c}88 55% 70%,transparent 70%),linear-gradient(215deg,${a} 45%,${b} 45% 70%,${c} 70%)`,
 `conic-gradient(from 200deg at 80% 25%,${a},${c},${b},${a},${c},${a})`];
 return {name:`${name}・${patternNames[p]}`,background:patterns[p],ink,muted};
}
function applyCardTheme(panel,id){const t=themeStyle(id);panel.style.background=t.background;panel.style.color=t.ink;panel.style.setProperty('--card-muted',t.muted);panel.style.borderColor=t.muted;panel.dataset.theme=id;panel.classList.toggle("rare-card",id>=100);panel.classList.toggle("ssr-card",id>=105);panel.dataset.rarity=id===109?"ULTRA":id>=105?"SSR":id>=100?"SR":""}
function updateThemeVisibility(){const owned=!!state.me&&premiumOwner===state.me;all('[data-theme-group]').forEach(b=>{b.hidden=+b.dataset.themeGroup===4&&!owned});if(themeGroup===4&&!owned){themeGroup=1;themePage=0}}
function renderThemes(){
 updateThemeVisibility();
 if(!themeAllowed(themeDraft))themeDraft=50;
 const preview=q('#cy-theme-preview');card(preview,state.me,state.avatar,false,true);applyCardTheme(preview.firstElementChild,themeDraft);if(themeDraft>=105){if(!preview.querySelector(".holo-texture"))attachHolo(preview.firstElementChild)}else{preview.querySelectorAll(".holo-texture,.holo-enable").forEach(e=>e.remove())}
 q('#cy-theme-name').textContent=themeStyle(themeDraft).name;all('[data-theme-group]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.themeGroup===themeGroup));q('#cy-theme-grid').replaceChildren();
 for(let n=0;n<(themeGroup===2?5:themeGroup===3?3:themeGroup>=4?1:25);n++){const id=themeGroup>=2?(themeGroup===5?109:themeGroup===4?108:themeGroup===2?100:105)+n:themeGroup*50+themePage*25+n,t=themeStyle(id),b=document.createElement('button');b.className='theme-choice';b.style.background=t.background;if(id>=105){b.style.backgroundImage=id===109?'url("./ultra-premium.png")':'url("./ssr-holo.webp")';b.style.backgroundSize='cover';b.style.filter=id===105?'grayscale(1) sepia(1) saturate(3)':id===109?'none':id===106?'grayscale(1)':id===108?'sepia(.35) saturate(2) hue-rotate(245deg)':'saturate(1.15)';b.style.textShadow='0 1px 3px #000'}b.style.color=t.ink;b.setAttribute('aria-label',`背景 ${id+1} ${t.name}`);b.setAttribute('aria-pressed',id===themeDraft);b.textContent=id===109?'超プレミア':id===108?'SSR 紫':id>=105?'SSR '+(id-104):id>=100?'SR '+(id-99):String(id+1).padStart(2,'0');b.disabled=!themeAllowed(id);b.onclick=()=>{themeDraft=id;renderThemes()};q('#cy-theme-grid').append(b)}
 q('#cy-theme-prev').parentElement.hidden=themeGroup>=2;all('[data-theme-group]').forEach(b=>b.disabled=(+b.dataset.themeGroup===2&&!missionUnlocked(10))||(+b.dataset.themeGroup===3&&!missionUnlocked(20))||(+b.dataset.themeGroup===4&&premiumOwner!==state.me)||(+b.dataset.themeGroup===5&&!missionUnlocked(30)));q('#cy-theme-page').textContent=`${themePage*25+1}–${themePage*25+25} / 50`;q('#cy-theme-prev').disabled=themePage===0;q('#cy-theme-next').disabled=themePage===1;
}

function appendCardPoints(panel,id){
 const person=who(id),grid=document.createElement('div');grid.className='point-grid';grid.setAttribute('aria-label','SAJ SL GS SGポイント');
 for(const k of ['SL','GS','SG']){const cell=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=k;value.textContent=point(person?.points?.[k]);cell.append(label,value);grid.append(cell)}panel.append(grid);
 const meta=document.createElement('p');meta.className='note';meta.textContent=profileMeta(person);panel.append(meta);
}
function avatar(canvas,id){if(!validAvatar(id)){canvas.dataset.avatar="none";canvas.setAttribute("aria-label","アバター未選択");const c=canvas.getContext("2d");c.clearRect(0,0,canvas.width,canvas.height);c.fillStyle="#10263d";c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle="#a5b6cc";c.textAlign="center";c.font="20px sans-serif";c.fillText("未選択",canvas.width/2,canvas.height/2);return}canvas.setAttribute("aria-label",`アバター ${id+1}`);canvas.dataset.avatar=id;const draw=()=>{if(Number(canvas.dataset.avatar)!==id)return;const im=atlases[id>=120?3:id>=100?2:Math.floor(id/50)];if(!im.complete||!im.naturalWidth)return;const n=id>=120?id-120:id>=100?id-100:id%50,cols=id>=100?5:10,rows=id>=100?4:5,w=im.naturalWidth/cols,h=im.naturalHeight/rows,c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(im,n%cols*w+1,Math.floor(n/cols)*h+1,w-2,h-2,0,0,canvas.width,canvas.height)};const im=atlases[id>=120?3:id>=100?2:Math.floor(id/50)];if(im.complete)draw();else im.addEventListener('load',draw,{once:true})}
function avatarCanvas(id,size=256){const c=document.createElement('canvas');c.width=c.height=size;c.className='avatar';c.setAttribute('role','img');c.setAttribute('aria-label',`アバター ${id+1}`);avatar(c,id);return c}
async function photoUrl(key){const epoch=dataEpoch;if(photoUrls.has(key))return photoUrls.get(key);let blob=photos.get(key);if(!blob){const db=await dbReady;if(db)blob=await read(db,'photos',key)}if(!blob||epoch!==dataEpoch)return null;if(photoUrls.has(key))return photoUrls.get(key);const url=URL.createObjectURL(blob);photoUrls.set(key,url);return url}
function card(target,id,a,photo=true,own=false,background=50){target.replaceChildren();const person=who(id);const panel=document.createElement('div');panel.className='player-card'+(own?' own-card':'');applyCardTheme(panel,own?(themeAllowed(state.background)?state.background:50):(validBackground(background)?background:50));const top=document.createElement('div');top.className='card-top';top.append(avatarCanvas(a));const info=document.createElement('div');info.className='card-info';const label=document.createElement('p');label.className='label';label.textContent='選手名';const name=document.createElement('p');name.className='card-name';name.textContent=person?.name||'情報取得待ち';const sid=document.createElement('p');sid.className='label';sid.textContent='SAJ競技者番号';const number=document.createElement('p');number.className='saj';number.textContent=id===FIXED_ID?'--------':id;info.append(label,name,sid,number);top.append(info);panel.append(top);const teamLabel=document.createElement('p');teamLabel.className='label';teamLabel.style.marginTop='16px';teamLabel.textContent='チーム名';const team=document.createElement('p');team.className='team';team.textContent=person?.team||(id===FIXED_ID?'—':'通信復帰後に取得');panel.append(teamLabel,team);appendCardPoints(panel,id);if(!own&&photo)appendRivalChoice(panel,id);if(photo){const key=own?'own:'+id:'rival:'+id;const button=document.createElement('button');button.className='memory';button.setAttribute('aria-label','記念写真を追加・変更');button.innerHTML='<b>＋</b><span>記念写真を1枚追加</span><span>この端末だけの思い出</span>';button.onclick=()=>openPhoto(key,id);panel.append(button);photoUrl(key).then(url=>{if(!url||!button.isConnected)return;button.replaceChildren();const img=document.createElement('img');img.src=url;img.alt='記念写真。タップして変更';button.append(img)})}if(own&&photo)appendMissions(panel);attachHolo(panel);target.append(panel)}
function appendRivalChoice(panel,id){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');label.className='rank-choice rival-registration';input.type='checkbox';input.checked=(state.rankIds||[]).includes(id);span.textContent='ライバル登録する';input.onchange=()=>{const chosen=new Set(state.rankIds||[]);if(input.checked)chosen.add(id);else chosen.delete(id);state.rankIds=[...chosen];save()};label.append(input,span);panel.append(label)}
function qr(target,text){target.replaceChildren();if(typeof qrcode!=='function'){target.textContent='QRライブラリを読み込めませんでした。';return}const code=qrcode(0,'M');code.addData(text,'Byte');code.make();const n=code.getModuleCount(),s=6,c=document.createElement('canvas');c.width=c.height=(n+8)*s;c.setAttribute('role','img');c.setAttribute('aria-label','QRコード');const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#000';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))ctx.fillRect((x+4)*s,(y+4)*s,s,s);target.append(c)}
const animalNames=['うさぎ','ねこ','柴犬','きつね','パンダ','くま','しろくま','ペンギン','アザラシ','カワウソ','リス','アライグマ','コアラ','ハリネズミ','ハムスター','しか','トラ','ユキヒョウ','レッサーパンダ','オオカミ'];
function picker(){const count=gender===2?40:50;page=Math.max(0,Math.min(page,Math.ceil(count/25)-1));q('#cy-avatar-save').disabled=!validAvatar(draft);avatar(q('#cy-avatar-preview'),draft);all('[data-gender]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.gender===gender));q('#cy-avatar-grid').replaceChildren();for(let n=page*25;n<Math.min(page*25+25,count);n++){const id=gender*50+n,b=document.createElement('button');b.className='avatar-choice';b.setAttribute('aria-label',gender===2?animalNames[n%20]+(n>=20?'（ゆるキャラ・スキー）':'（スキー）'):(gender?'女子':'男子')+'アバター '+(n+1));b.setAttribute('aria-pressed',draft===id);b.append(avatarCanvas(id,150));const label=document.createElement('span');label.textContent=gender===2?animalNames[n%20]+(n>=20?"・ゆる":""):String(n+1).padStart(2,'0');b.append(label);b.onclick=()=>{draft=id;picker()};q('#cy-avatar-grid').append(b)}q('#cy-page').textContent=(page*25+1)+'–'+Math.min(page*25+25,count)+' / '+count;q('#cy-prev').disabled=page===0;q('#cy-next').disabled=(page+1)*25>=count}
async function openPhoto(key,id){photoKey=key;photoBack=screen==='rivals'?'rivals':'card';q('#cy-photo-name').textContent=who(id)?.name||id;q('#cy-photo-status').textContent='';q('#cy-photo-preview').hidden=true;go('photo');const url=await photoUrl(key);if(url&&photoKey===key){q('#cy-photo-preview').src=url;q('#cy-photo-preview').hidden=false}}
async function choosePhoto(e){const file=e.target.files?.[0];e.target.value='';if(!file||!photoKey)return;const key=photoKey;q('#cy-photo-status').textContent='保存しています…';try{const image=await createImageBitmap(file);const c=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(image.width,image.height));c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close();const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error();photos.set(key,blob);if(photoUrls.has(key))URL.revokeObjectURL(photoUrls.get(key));photoUrls.set(key,URL.createObjectURL(blob));const db=await dbReady,ok=db&&await write(db,'photos',key,blob);if(photoKey===key){q('#cy-photo-preview').src=photoUrls.get(key);q('#cy-photo-preview').hidden=false;q('#cy-photo-status').textContent=ok?'この端末に保存しました。':'この環境では端末保存が使えません。表示中のみ反映します。'}}catch{q('#cy-photo-status').textContent='画像を開けません。JPEG・PNGなどをお試しください。'}}

function chart(){
 const svg=q('#cy-chart'),series=state.history.filter(h=>h.key.startsWith(state.me+':')).slice(-6);svg.replaceChildren();
 if(series.length<2){const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x','15');t.setAttribute('y','50');t.textContent='次のリスト取得後に推移を表示します';svg.setAttribute('viewBox','0 0 330 100');svg.append(t);return}
 const w=330,h=200,max=Math.max(50,...series.flatMap(s=>Object.values(s.points).filter(v=>typeof v==='number')))*1.1;
 const element=(name,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n};
 const x=i=>40+i*270/(series.length-1),y=v=>15+v/max*145;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 for(let i=0;i<=4;i++){const v=max*i/4;element('line',{x1:38,x2:315,y1:y(v),y2:y(v)});element('text',{x:32,y:y(v)+4,'text-anchor':'end'},Math.round(v))}
 series.forEach((s,i)=>element('text',{x:x(i),y:185,'text-anchor':'middle'},s.label.split(' ')[1]));
 ['SL','GS','SG'].forEach((k,j)=>{let prior=null;series.forEach((s,i)=>{const v=s.points[k];if(v===null){prior=null;return}const color=['#65e8ff','#bd9aff','#ffb07a'][j];if(prior)element('line',{x1:prior[0],y1:prior[1],x2:x(i),y2:y(v),style:`stroke:${color}`,'stroke-width':2,'stroke-dasharray':['none','7 4','2 4'][j]});element('circle',{cx:x(i),cy:y(v),r:3,fill:color});prior=[x(i),y(v)]})});
}
function stats(){
 const me=who(state.me);q('#cy-me').textContent=me?`${me.name} · ${me.category} · ${me.sex} · ${me.pref}`:'タイトル画面から自分の選手を登録してください。';
 q('#cy-data-meta').textContent=profileMeta(me);q('#cy-data-status').textContent=[notice,rankingNotice].filter(Boolean).join(' ');
 q('#cy-rank-meta').textContent=rankingMeta();q('#cy-refresh').disabled=!!refreshing;
 const body=q('#cy-stats');body.replaceChildren();
 const row=(name,values)=>{const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=name;tr.append(th);for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td)}body.append(tr)};
 row('所持pt',['SL','GS','SG'].map(k=>point(me?.points?.[k])));
 row('順位用pt',['SL','GS','SG'].map(k=>point(dataset?.athletes.find(a=>a.id===state.me)?.points[k])));
 for(const label of ['各都道府県内','全国'])row(label,['SL','GS','SG'].map(k=>{const rank=rankingValue(dataset,state.me,k,label==='各都道府県内');return rank===null?'—':rank+'位'}));
 chart();
}
function validUiTheme(value){return value==='fancy'||value==='original'}
function applyUiTheme(){const theme=validUiTheme(state.uiTheme)?state.uiTheme:'original';root.dataset.uiTheme=theme;const brand=q('#cy-brand');if(brand)brand.textContent=theme==='fancy'?'ゆき・なか':'Yuki-Naka';all('[data-ui-version]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.uiVersion===theme)));const status=q('#cy-ui-status');if(status)status.textContent=theme==='fancy'?'ゆき・なかver を使用中':'オリジナルver を使用中'}
function render(){applyUiTheme();
 all('[data-screen]').forEach(p=>p.hidden=p.dataset.screen!==screen);q('nav').hidden=['title','register'].includes(screen);all('nav [data-go]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.go===screen));
 q('#cy-title-register').disabled=!ready||dataBusy;
 all('[data-go=register]').forEach(b=>b.disabled=!ready);
 q('#cy-data-status').textContent=[notice,rankingNotice].filter(Boolean).join(' ');
 q('#cy-rank-meta').textContent=rankingMeta();
 const me=who(state.me);
 q('nav [data-go=rank]').hidden=!missionUnlocked(5);q('nav').style.gridTemplateColumns=missionUnlocked(5)?'repeat(6,minmax(0,1fr))':'repeat(5,minmax(0,1fr))';if(screen==='rank')renderRank();if(ready)checkUnlocks();if(screen==='stats')stats();
 if(screen==='card'){q('[data-go=avatar]').hidden=!me;q('[data-go=background]').hidden=!me;if(me)card(q('#cy-own-card'),state.me,state.avatar,true,true);else q('#cy-own-card').textContent='タイトル画面から自分の選手を登録してください。'}
 if(screen==='background')renderThemes();if(screen==='avatar')picker();
 if(screen==='exchange'){q('#cy-show-own').disabled=!me;q('#cy-received').hidden=!received;}
 q('#cy-rivals-refresh').disabled=!!refreshing;
 q('#cy-rivals-status').textContent=[notice,rankingNotice].filter(Boolean).join(' ');
 if(screen==='rivals'){q('#cy-rivals').replaceChildren();if(!state.rivals.length)q('#cy-rivals').textContent='「友達追加」から友達のカードを追加してください。';for(const r of state.rivals){const host=document.createElement('div');q('#cy-rivals').append(host);card(host,r.id,r.avatar,true,false,r.background)}}
 if(screen==='share'){const url=validUrl(state.url);q('#cy-share-ready').hidden=!url;q('#cy-share-pending').hidden=!!url;q('#cy-url').value=state.url;if(url){q('#cy-share-url').textContent=url;qr(q('#cy-share-qr'),url)}}
}
function go(next){if(!ready)return;if(next==='rank'&&!missionUnlocked(5))return;if(next==='register'&&screen!=='title')return;if(screen==='exchange'&&next!=='exchange'){stopScan();receiveGeneration++;}if(next==='exchange'&&screen!=='exchange')setExchangeMode('');screen=next;q('main').scrollTop=0;if(next==='avatar'){draft=state.avatar;gender=validAvatar(draft)?Math.floor(draft/50):0;page=validAvatar(draft)?Math.floor(draft%50/25):0}if(next==='background'){themeDraft=state.background;themeGroup=themeDraft===109?5:themeDraft===108?4:themeDraft>=105?3:themeDraft>=100?2:Math.floor(themeDraft/50);themePage=themeDraft>=100?0:Math.floor(themeDraft%50/25)}if(next==='register'){q('#cy-pref').value='';candidates()};render();if(next==='rare')window.YukiNakaRare?.open();if(next!=='title')refresh()}
function candidates(){
 selected=null;q('#cy-register').disabled=true;q('#cy-register').textContent='選手を選択してください';q('#cy-candidates').replaceChildren();
 if(q('#cy-search').value===FIXED_QUERY){selected=FIXED_ID;q('#cy-register').disabled=false;q('#cy-register').textContent='この選手で登録';q('#cy-register-status').textContent='岩崎 岳人 / -------- / SL ∞ · GS ∞ · SG ∞';return}
 if(!q('#cy-pref').value){q('#cy-register-status').textContent='都道府県名を選択してください。';return}const query=q('#cy-search').value.trim().replace(/\s/g,'');const matches=roster.filter(a=>a.pref===q('#cy-pref').value&&a.sex===q('#cy-sex').value&&(!query||a.name.replace(/\s/g,'').includes(query)||a.id.includes(query)));
 q('#cy-register-status').textContent=dataset?`${matches.length}名 · ${metadata()}`:'取得中です。通信できない場合はタイトルからDATAを開き、再取得してください。';
 for(const a of matches){const b=document.createElement('button');b.className='candidate';b.setAttribute('aria-pressed','false');const name=document.createElement('strong');name.textContent=a.name;const detail=document.createElement('p');detail.className='sub';detail.textContent=`${a.team} / ${a.category} / ${a.id}`;b.append(name,detail);b.onclick=()=>{selected=a.id;all('.candidate').forEach(c=>c.setAttribute('aria-pressed',c===b));q('#cy-register').disabled=false;q('#cy-register').textContent='この選手で登録'};q('#cy-candidates').append(b)}
}
let exchangeMode='',scanStream=null,scanTimer=null,scanGeneration=0,receiveGeneration=0,ownCodeKey='',ownCodePromise=null;
const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function pack(bytes){let bits=0,value=0,out='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31]}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out}
function unpack(s){let bits=0,value=0,out=[];for(const ch of s){const n=alphabet.indexOf(ch);if(n<0)throw Error();value=(value<<5)|n;bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255)}}const bytes=new Uint8Array(out);if(pack(bytes)!==s)throw Error();return bytes}
const exchangeKey=(version=4)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode('Yuki-Naka public exchange format '+version)).then(key=>crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt','decrypt']));
async function encodeCard(id,a,background=50){if(!validId(id)||!validCardAvatar(a)||!validBackground(background))throw Error();const raw=new Uint8Array(6);new DataView(raw.buffer).setUint32(0,Number(id));raw[4]=a===null?255:a;raw[5]=background;const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await exchangeKey(5),raw));return 'YN5'+pack(new Uint8Array([...iv,...cipher]))}
async function decodeCard(raw){const code=raw.trim();if(code.startsWith('AC3:')){const p=code.split(':');if(p.length===3&&validId(p[1])&&/^\d{1,2}$/.test(p[2])&&validAvatar(+p[2]))return{id:p[1],avatar:+p[2],background:50}}
 try{const s=code.replace(/\s/g,'').toUpperCase();if(!/^(?:YN4[0-9A-HJKMNP-TV-Z]{53}|YN5[0-9A-HJKMNP-TV-Z]{55})$/.test(s))throw Error();const version=Number(s[2]);const bytes=unpack(s.slice(3)),plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await exchangeKey(version),bytes.slice(12)));if(plain.length!==(version===5?6:5))throw Error();const id=String(new DataView(plain.buffer).getUint32(0)).padStart(8,'0'),avatar=plain[4]===255?null:plain[4];const background=version===5?plain[5]:50;if(!validId(id)||!validCardAvatar(avatar)||!validBackground(background))throw Error();return{id,avatar,background}}catch{throw Error('コードを確認してください。Yuki-Nakaの交換コードを入力してください。')}}
function stopScan(){scanGeneration++;clearTimeout(scanTimer);scanTimer=null;scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;const v=q('#cy-qr-video');v.pause();v.srcObject=null}
function setExchangeMode(mode){stopScan();receiveGeneration++;received=null;exchangeMode=mode;q('#cy-received').hidden=true;q('#cy-ex-status').textContent='';for(const m of ['own','scan','input'])q('#cy-ex-'+m).hidden=m!==mode;if(mode==='own')showOwnCode();if(mode==='scan')startScan();if(mode==='input')q('#cy-friend-code').focus()}
async function showOwnCode(){if(!state.me){q('#cy-ex-status').textContent='タイトル画面で自分を登録してください。';return}const background=themeAllowed(state.background)?state.background:50;const key=state.me+':'+state.avatar+':'+background;if(key!==ownCodeKey){ownCodeKey=key;ownCodePromise=encodeCard(state.me,state.avatar,background)}try{const code=await ownCodePromise;if(key!==ownCodeKey||exchangeMode!=='own'||screen!=='exchange')return;q('#cy-own-code').value=code;qr(q('#cy-ex-qr'),code)}catch{ownCodeKey='';q('#cy-ex-status').textContent='コードを作成できません。HTTPSで開き直してください。'}}
function showAccessReport(report){const target=q('#cy-ex-status');target.replaceChildren();const title=document.createElement('p');title.textContent='管理者モード：累計アクセス端末数 約'+report.total.toLocaleString('ja-JP')+'台';target.append(title);const note=document.createElement('p');note.textContent=report.historyAvailable?'週次アクセス端末数（日本時間）。各週で同じ端末は1台。終了した週の台数は固定です。第1週は1〜7日、第2週は8〜14日です。':'週別表示にはサーバーの更新が必要です。';target.append(note);if(!report.historyAvailable)return;const table=document.createElement('table');table.style.width='100%';const head=document.createElement('tr');for(const text of ['アクセスした週','端末数']){const th=document.createElement('th');th.textContent=text;head.append(th)}table.append(head);for(const r of report.weekly){const row=document.createElement('tr');for(const text of [r.year+'年'+r.month+'月 第'+r.week+'週',r.count.toLocaleString('ja-JP')+'台']){const td=document.createElement('td');td.textContent=text;row.append(td)}table.append(row)}target.append(table);if(report.unknown){const unknown=document.createElement('p');unknown.textContent='日時未記録：'+report.unknown.toLocaleString('ja-JP')+'台（更新後の再アクセスで記録されます）';target.append(unknown)}}
async function receiveCode(value){if(value.trim().toUpperCase()==='YN42038'){receiveGeneration++;received=null;state.missionFull=true;save();q('#cy-received').hidden=true;q('#cy-ex-status').textContent='裏コードを適用しました。ミッションをすべて解放しました！';render();return}const request=++receiveGeneration;received=null;q('#cy-received').hidden=true;q('#cy-ex-status').textContent='コードを確認しています…';try{if(!/^(YN|AC3)/i.test(value.trim())&&window.YukiNakaStats?.isAdminCandidate(value)){q('#cy-friend-code').value='';const report=await window.YukiNakaStats.getReport(value);if(request!==receiveGeneration||screen!=='exchange')return;showAccessReport(report);return}if(/^\d{3}$/.test(value.trim())){q('#cy-friend-code').value='';await claimPurple(value.trim().toUpperCase());return}const r=await decodeCard(value);if(r.id===state.me)throw Error('自分のカードは友達に追加できません。');if(request!==receiveGeneration||screen!=='exchange')return;received=r;card(q('#cy-received-card'),r.id,r.avatar,false,false,r.background);q('#cy-received').hidden=false;q('#cy-ex-status').textContent=state.rivals.some(friend=>friend.id===r.id)?'登録済みの友達です。追加すると最新のアバター・背景に更新します。':'この選手を友達一覧に追加します。';if(!who(r.id)||who(r.id).pendingProfile)void loadReceivedPerson(r,request)}catch(e){if(request===receiveGeneration)q('#cy-ex-status').textContent=e.message}}
async function loadReceivedPerson(r,request){const epoch=dataEpoch;try{await loadPerson(r.id);if(epoch!==dataEpoch)return;if(state.rivals.some(friend=>friend.id===r.id))save();if(request===receiveGeneration&&screen==='exchange'&&received===r)card(q('#cy-received-card'),r.id,r.avatar,false,false,r.background);else if(screen==='rivals')render()}catch{if(epoch===dataEpoch&&request===receiveGeneration&&screen==='exchange'&&received===r)q('#cy-ex-status').textContent='コードは正常に読み込みました。選手情報は通信復帰後に取得します。このまま友達に追加できます。'}}
function pendingPerson(id){return{id,name:'情報取得待ち',team:'',pref:'',sex:'男子',category:'未確認',points:{SL:null,GS:null,SG:null},pendingProfile:true}}
function cameraMessage(e){return e.name==='NotAllowedError'?'カメラの使用が許可されていません。端末のカメラ設定を確認するか、下の「カメラで撮影」「QR画像を選択」を使ってください。':e.name==='NotFoundError'?'カメラが見つかりません。QR画像を選択してください。':'カメラ映像を開始できません。再試行するか、下の「カメラで撮影」「QR画像を選択」を使ってください。'}
async function startScan(){
 const generation=scanGeneration,v=q('#cy-qr-video');
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('unsupported');
  v.muted=true;v.autoplay=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');
  q('#cy-ex-status').textContent='カメラの使用を許可してください。映像が出ない場合は下の撮影・画像選択を使えます。';
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}})}
  catch(e){if(generation!==scanGeneration)return;if(!['OverconstrainedError','NotFoundError'].includes(e.name))throw e;stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true})}
  if(generation!==scanGeneration){stream.getTracks().forEach(t=>t.stop());return}
  scanStream=stream;v.srcObject=stream;
  // Bound playback waiting; a stale permission result is stopped above.
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('playback timeout')),12000);Promise.resolve(v.play()).then(()=>{clearTimeout(timer);resolve()},e=>{clearTimeout(timer);reject(e)})});
  if(generation!==scanGeneration)return;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true}),started=Date.now();let hasFrame=false;
  q('#cy-ex-status').textContent='友達のQRを枠内に映してください。';
  const scan=()=>{
   if(generation!==scanGeneration)return;
   try{
    if(v.readyState>=2&&v.videoWidth&&v.videoHeight){hasFrame=true;const scale=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight));canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);ctx.drawImage(v,0,0,canvas.width,canvas.height);const im=ctx.getImageData(0,0,canvas.width,canvas.height),found=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});if(found){stopScan();q('#cy-ex-scan').hidden=true;receiveCode(found.data);return}}
    if(!hasFrame&&Date.now()-started>12000)throw Error('no camera frames');
   }catch(e){stopScan();q('#cy-ex-status').textContent=cameraMessage(e);return}
   scanTimer=setTimeout(scan,180);
  };scan();
 }catch(e){if(generation!==scanGeneration)return;stopScan();q('#cy-ex-status').textContent=cameraMessage(e)}
}
function pickQrImage(selector){stopScan();receiveGeneration++;received=null;q('#cy-received').hidden=true;q('#cy-ex-status').textContent='QRを撮影するか、QR画像を選択してください。';q(selector).value='';q(selector).click()}
async function readQrImage(e){
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 const generation=scanGeneration,request=receiveGeneration;
 q('#cy-ex-status').textContent='QR画像を読み取っています…';let image,url;
 try{
  url=URL.createObjectURL(file);image=new Image();image.src=url;await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject});
  if(generation!==scanGeneration||request!==receiveGeneration||screen!=='exchange')return;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});let found=null;
  for(const size of [1600,2400,800]){const scale=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));ctx.drawImage(image,0,0,canvas.width,canvas.height);const im=ctx.getImageData(0,0,canvas.width,canvas.height);found=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});if(found)break}
  if(!found)throw Error('QRを読み取れませんでした。QR全体が大きく、はっきり写った画像を選んでください。');
  q('#cy-ex-scan').hidden=true;await receiveCode(found.data);
 }catch(err){if(generation===scanGeneration&&request===receiveGeneration&&screen==='exchange')q('#cy-ex-status').textContent=err.message||'画像を開けませんでした。別の画像を選んでください。'}
 finally{if(url)URL.revokeObjectURL(url)}
}
q('#cy-qr-retry').onclick=()=>setExchangeMode('scan');
q('#cy-qr-capture').onclick=()=>pickQrImage('#cy-qr-capture-file');q('#cy-qr-image').onclick=()=>pickQrImage('#cy-qr-image-file');
q('#cy-qr-capture-file').onchange=q('#cy-qr-image-file').onchange=readQrImage;

q('#cy-show-own').onclick=()=>setExchangeMode('own');q('#cy-scan-friend').onclick=()=>setExchangeMode('scan');q('#cy-input-friend').onclick=()=>setExchangeMode('input');q('#cy-stop-scan').onclick=()=>{setExchangeMode('');q('#cy-ex-status').textContent='カメラを停止しました。'};q('#cy-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(q('#cy-own-code').value);q('#cy-ex-status').textContent='コードをコピーしました。'}catch{q('#cy-own-code').select();q('#cy-ex-status').textContent='コードを選択しました。コピーしてください。'}};
window.addEventListener('pagehide',stopScan);document.addEventListener('visibilitychange',()=>{if(document.hidden&&exchangeMode==='scan'&&scanStream){stopScan();q('#cy-ex-status').textContent='カメラを停止しました。再開するには読み込みボタンを押してください。'}});

let holoEnabled=false,holoFrame=0,holoX=50,holoY=50;
const reducedHolo=matchMedia('(prefers-reduced-motion: reduce)');
function moveHolo(x,y){if(document.hidden||reducedHolo.matches||!q('.ssr-card'))return;holoX=Math.max(0,Math.min(100,x));holoY=Math.max(0,Math.min(100,y));if(holoFrame)return;holoFrame=requestAnimationFrame(()=>{holoFrame=0;root.style.setProperty('--holo-x',holoX+'%');root.style.setProperty('--holo-y',holoY+'%');root.style.setProperty('--holo-angle',(90+holoX*1.8)+'deg')})}
function onHoloTilt(e){if(typeof e.gamma==='number'&&Number.isFinite(e.gamma)&&typeof e.beta==='number'&&Number.isFinite(e.beta))moveHolo(50+e.gamma*1.7,50+(e.beta-35)*1.2)}
async function enableHolo(button){if(reducedHolo.matches){button.textContent='動きを減らす設定が有効です';return}if(!window.DeviceOrientationEvent){button.textContent='この端末ではタッチできらめきます';return}try{if(typeof DeviceOrientationEvent.requestPermission==='function'){const result=await DeviceOrientationEvent.requestPermission();if(result!=='granted'){button.textContent='動きが未許可です・タッチで操作できます';return}}if(!holoEnabled){window.addEventListener('deviceorientation',onHoloTilt);holoEnabled=true}button.textContent='傾き検知ON・カードに触れてもきらめきます'}catch{button.textContent='傾きを利用できません・タッチで操作できます'}}
function attachHolo(panel){if(!panel.classList.contains('ssr-card'))return;const texture=document.createElement('div');texture.className='holo-texture';texture.setAttribute('aria-hidden','true');panel.prepend(texture);panel.addEventListener('pointermove',e=>{const r=panel.getBoundingClientRect();moveHolo((e.clientX-r.left)/r.width*100,(e.clientY-r.top)/r.height*100)});panel.addEventListener('pointerleave',()=>moveHolo(50,50));const button=document.createElement('button');button.type='button';button.className='secondary holo-enable';button.textContent=holoEnabled?'傾き検知ON・タッチでもきらめきます':'傾きできらめく';button.onclick=()=>enableHolo(button);panel.append(button)}
window.addEventListener('pagehide',()=>{window.removeEventListener('deviceorientation',onHoloTilt);holoEnabled=false;cancelAnimationFrame(holoFrame);holoFrame=0});

const rewardSteps=[{count:5,text:'ライバルモード / RANK！'},{count:10,text:'SR背景 5種類'},{count:20,text:'SSR背景 3種類'},{count:30,text:'超プレミア背景 1種類'}];
function missionUnlocked(count){return state.missionFull===true||friendCount()>=count}
function friendCount(){return new Set(state.rivals.map(r=>r.id).filter(id=>id!==state.me)).size}
function validBackground(id){return Number.isInteger(id)&&id>=0&&id<110}
function themeAllowed(id){return validBackground(id)&&(id===109?missionUnlocked(30):id===108?premiumOwner===state.me:id<100||(id<105?missionUnlocked(10):missionUnlocked(20)))}
const rareThemes=[
 ['SR アイスホロ','#052a46','#22d5ed','#a8f4ff'],['SR ローズクォーツ','#431940','#f98bce','#f8c9ff'],['SR サンライズ','#442914','#eeb342','#fff1b3'],['SR エメラルド','#073c37','#2ee9b2','#c8ffe9'],['SR アメジスト','#251948','#a486ff','#f0d3ff'],
 ['SSR ゴールド','#181e48','#edb9ff','#fff1ab'],['SSR シルバー','#281b10','#ffc84b','#fff6d1'],['SSR レインボー','#090f35','#8576ff','#b9ffff'],['SSR プレミアムパープル','#210a42','#a955ff','#e9baff'],['超プレミア アメジストオーロラ','#090510','#bd7aff','#f4d490']
];
function rareStyle(id){if(id>=105)return{name:rareThemes[id-100][0],ink:'#ffffff',muted:'#eef0ff',background:'#0b1428'};const [name,a,b,c]=rareThemes[id-100],ssr=id>=105;return{name,ink:'#ffffff',muted:'#e8e8f5',background:`radial-gradient(circle at 18% 20%,${c}bb 0 1px,transparent 2px) 0 0/27px 31px,linear-gradient(115deg,transparent 25%,${c}44 36%,transparent 46%,${b}66 60%,transparent 74%),${ssr?'repeating-conic-gradient(from 20deg at 50% 25%,transparent 0deg 14deg,'+b+'44 16deg 18deg,transparent 20deg 36deg),':''}linear-gradient(145deg,${a},${b}88 48%,${a})`}}
function checkUnlocks(){if(!ready||dataBusy)return;const newly=rewardSteps.filter(r=>missionUnlocked(r.count)&&!(state.rewardSeen||[]).includes(r.count));if(!newly.length||q('#cy-confirm').open||q('#cy-unlock').open)return;state.rewardSeen=[...new Set([...(state.rewardSeen||[]),...newly.map(r=>r.count)])];save();q('#cy-unlock-text').textContent=newly.map(r=>`${state.missionFull?"ミッションコンプリート！":"友達"+r.count+"人達成！"} ${r.text}を解放しました。`).join('\n');q('#cy-unlock').showModal()}
q('#cy-unlock-close').onclick=()=>q('#cy-unlock').close();q('#cy-unlock').onclose=()=>checkUnlocks();
function appendMissions(panel){const box=document.createElement('div');box.className='missions';const title=document.createElement('h2');title.textContent='MISSION';box.append(title);for(const r of rewardSteps){const p=document.createElement('p'),done=missionUnlocked(r.count);p.textContent=`${done?'✓':'🔒'} 友達追加${r.count}件以上で ${done?r.text:'？？？'}　${state.missionFull?"COMPLETE":Math.min(friendCount(),r.count)+"/"+r.count}`;box.append(p)}panel.append(box)}
let rankEvent='SL';
function renderRank(){const ids=new Set(state.rankIds||[]);all('[data-rank-event]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.rankEvent===rankEvent));q('#cy-rank-results').replaceChildren();const people=[state.me,...state.rivals.filter(r=>ids.has(r.id)).map(r=>r.id)].filter(Boolean).map(id=>({id,p:who(id)}));const rankValue=p=>typeof p?.points?.[rankEvent]==='number'?p.points[rankEvent]:Infinity;people.sort((a,b)=>rankValue(a.p)-rankValue(b.p));let previous=null,rank=0;people.forEach((item,index)=>{const value=item.p?.points?.[rankEvent],has=typeof value==='number'&&Number.isFinite(value);if(has&&value!==previous)rank=index+1;previous=value;const row=document.createElement('div');row.className='rank-row';const head=document.createElement('strong'),detail=document.createElement('p');head.textContent=`${has?rank+'位':'—'}　${item.p?.name||item.id}${item.id===state.me?'（自分）':''}　${point(value)} pt`;detail.className='sub';detail.textContent=`${item.p?.sex||''} / ${item.p?.category||''} · ${profileMeta(item.p)}`;row.append(head,detail);q('#cy-rank-results').append(row)});q('#cy-rank-hint').textContent=ids.size?'ポイントが小さい順。同ポイントは同順位、未取得は順位なし。性別・カテゴリを問わず選択メンバーを比較します。リストや取得日時が異なる場合があります。':'友達カードの「ライバル登録する」にチェックしてください。自分と指名した友達のポイントを比較できます。'}
all('[data-rank-event]').forEach(b=>b.onclick=()=>{rankEvent=b.dataset.rankEvent;renderRank()});

const emptyState=()=>({me:null,registered:false,avatar:null,background:50,rivals:[],url:'',profiles:{},history:[],rankIds:[],rewardSeen:[],missionFull:false,premium:null,uiTheme:'original'});
let dataEpoch=0,dataBusy=false,confirmResolve=null,photoTask=Promise.resolve();
function askData(message){q('#cy-confirm-message').textContent=message;q('#cy-confirm').showModal();return new Promise(resolve=>{confirmResolve=resolve})}
function answerData(value){q('#cy-confirm').close();const resolve=confirmResolve;confirmResolve=null;resolve?.(value)}
q('#cy-confirm-yes').onclick=()=>answerData(true);q('#cy-confirm-no').onclick=()=>answerData(false);q('#cy-confirm').oncancel=e=>{e.preventDefault();answerData(false)};
function releasePersonalMemory(){stopScan();receiveGeneration++;dataEpoch++;for(const url of photoUrls.values())URL.revokeObjectURL(url);photoUrls.clear();photos.clear();received=null;selected=null;photoKey=null;ownCodeKey='';ownCodePromise=null;attempts.clear();rankingAttempt=0;rankingNotice='公開リストを確認していません。';candidateChecks.clear();candidatesRequest++;state=emptyState();premiumOwner=null;notice='';q('#cy-storage').textContent='';q('#cy-search').value='';q('#cy-sex').value='男子';q('#cy-friend-code').value='';q('#cy-own-code').value='';q('#cy-ex-qr').replaceChildren();q('#cy-received-card').replaceChildren();q('#cy-own-card').replaceChildren();q('#cy-rivals').replaceChildren();q('#cy-photo-preview').removeAttribute('src');}
async function replaceStoredData(next,images,seed){const db=await dbReady;if(!db)throw Error('この環境では端末保存を利用できません。');await writeQueue;await new Promise((resolve,reject)=>{const tx=db.transaction(['settings','photos'],'readwrite');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(Error('保存できませんでした。現在のデータは変更していません。'));try{const settings=tx.objectStore('settings'),pics=tx.objectStore('photos');settings.clear();pics.clear();if(next)settings.put(next,'state');if(seed)settings.put(seed,'saj-dataset');for(const image of images)pics.put(image.blob,image.key)}catch{tx.abort()}});}
async function beginRegistration(){if(!ready||dataBusy)return;if(!state.registered){go('register');return}const yes=await askData('現在の登録内容をすべてクリアして新規登録しますか？');if(!yes){go('card');return}dataBusy=true;ready=false;q('#cy-storage').textContent='データをクリアしています…';try{if(refreshing)await refreshing;await photoTask;await replaceStoredData(null,[],null);releasePersonalMemory();roster=dataset?.athletes||[];prefs();ready=true;screen='title';go('register')}catch(e){q('#cy-storage').textContent=e.message}finally{dataBusy=false;ready=true;render()}}
function allPhotos(db){return new Promise((resolve,reject)=>{const tx=db.transaction('photos'),req=tx.objectStore('photos').openCursor(),result=[];req.onsuccess=()=>{const c=req.result;if(c){result.push({key:c.key,blob:c.value});c.continue()}};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('写真を読み込めませんでした。'))})}
function blobData(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('写真を読み込めませんでした。'));reader.readAsDataURL(blob)})}
async function exportTransfer(){if(dataBusy)return;dataBusy=true;ready=false;setSettingsBusy(true);q('#cy-settings-status').textContent='引継ぎデータを作成しています…';try{if(refreshing)await refreshing;await photoTask;await writeQueue;const db=await dbReady;if(!db)throw Error('端末保存を利用できません。');const entries=await allPhotos(db);const images=await Promise.all(entries.map(async p=>({key:p.key,data:await blobData(p.blob)})));const backup={app:'Yuki-Naka',version:1,createdAt:new Date().toISOString(),state:JSON.parse(JSON.stringify(state)),dataset,photos:images};const blob=new Blob([JSON.stringify(backup)],{type:'application/json'});if(blob.size>80*1024*1024)throw Error('引継ぎデータが80MBを超えています。');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Yuki-Naka-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);q('#cy-settings-status').textContent='引継ぎファイルを作成しました。保存先を確認し、新しい端末で読み込んでください。'}catch(e){q('#cy-settings-status').textContent=e.message}finally{dataBusy=false;ready=true;setSettingsBusy(false);render()}}
function setSettingsBusy(value){all('[data-ui-version]').forEach(button=>button.disabled=value);q('#cy-export').disabled=value;q('#cy-import').disabled=value;q('#cy-clear').disabled=value;}
function cleanPoints(p){if(!p||!['SL','GS','SG'].every(k=>p[k]===null||(typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0)))throw Error('ポイントの形式が正しくありません。');return{SL:p.SL,GS:p.GS,SG:p.SG}}
function cleanProfile(p,id){if(id===FIXED_ID&&p?.id===id)return fixedPlayer();if(!p||p.id!==id||!validId(id)||!['name','team','pref'].every(k=>typeof p[k]==='string'&&p[k].length<500)||!p.name||!['男子','女子'].includes(p.sex)||!['K2','一般','未確認'].includes(p.category))throw Error('選手情報の形式が正しくありません。');const result={id,name:p.name,team:p.team,pref:p.pref,sex:p.sex,category:p.category,points:cleanPoints(p.points)};if(p.listLabel!==undefined){if(typeof p.listLabel!=='string'||p.listLabel.length>80)throw Error('リスト情報が不正です。');result.listLabel=p.listLabel}if(p.checkedAt!==undefined){if(!Number.isFinite(Date.parse(p.checkedAt)))throw Error('取得日時が不正です。');result.checkedAt=p.checkedAt}for(const k of ['pointSeasonCode','pointListNumber'])if(p[k]!==undefined){if(!Number.isInteger(p[k])||p[k]<1)throw Error('リスト番号が不正です。');result[k]=p[k]}if(p.pendingProfile===true)result.pendingProfile=true;return result}
async function validateTransfer(raw){if(raw?.app!=='Yuki-Naka'||raw.version!==1||!raw.state||!Array.isArray(raw.photos)||raw.photos.length>2000)throw Error('Yuki-Nakaの引継ぎファイルではありません。');const src=raw.state,next=emptyState();if(!validCardAvatar(src.avatar)||!validBackground(src.background)||!Array.isArray(src.rivals)||src.rivals.length>1000||!Array.isArray(src.history)||src.history.length>24||!src.profiles||typeof src.profiles!=='object')throw Error('登録内容の形式が正しくありません。');if(src.me!==null&&!validId(src.me))throw Error('登録番号が不正です。');if(src.uiTheme!==undefined&&!validUiTheme(src.uiTheme))throw Error('UIの設定が正しくありません。');next.uiTheme=src.uiTheme||'original';next.missionFull=src.missionFull===true;next.me=src.me;next.registered=!!src.me;next.avatar=src.avatar;next.background=src.background;if(src.premium){if(!await window.YukiNakaPremium?.verifyProof(src.premium))throw Error('プレミアム背景の所有証明が不正です。');next.premium={playerId:src.premium.playerId,token:src.premium.token,receipt:src.premium.receipt}}if(src.url){if(!validUrl(src.url))throw Error('紹介URLが不正です。');next.url=validUrl(src.url)}const ids=new Set();next.rivals=src.rivals.map(r=>{if(!validId(r?.id)||!validCardAvatar(r.avatar)||(r.background!==undefined&&!validBackground(r.background))||r.id===next.me||ids.has(r.id))throw Error('友達一覧が不正です。');ids.add(r.id);return{id:r.id,avatar:r.avatar,background:r.background===undefined?50:r.background}});next.rankIds=Array.isArray(src.rankIds)?[...new Set(src.rankIds.filter(id=>ids.has(id)))]:[];next.rewardSeen=Array.isArray(src.rewardSeen)?src.rewardSeen.filter(n=>[5,10,20,30].includes(n)&&(next.missionFull||next.rivals.length>=n)):[];if(!(next.background===108&&next.premium?.playerId===next.me)&&!next.missionFull&&!((next.background<100)||(next.background===109?next.rivals.length>=30:next.background<105?next.rivals.length>=10:next.rivals.length>=20)))next.background=50;if(Object.keys(src.profiles).length>10000)throw Error('選手数が多すぎます。');for(const [id,p]of Object.entries(src.profiles))next.profiles[id]=cleanProfile(p,id);next.history=src.history.map(h=>{if(typeof h?.key!=='string'||!/^\d{8}:\d{4}:\d+$/.test(h.key)||typeof h.label!=='string'||h.label.length>80)throw Error('履歴が不正です。');return{key:h.key,label:h.label,points:cleanPoints(h.points)}});let seed=null;if(raw.dataset){validateDataset(raw.dataset);seed={schema:1,provider:'SAJ',season:raw.dataset.season,listNumber:raw.dataset.listNumber,checkedAt:raw.dataset.checkedAt,athletes:raw.dataset.athletes.map(p=>cleanProfile(p,p.id))}}for(const id of [next.me,...ids].filter(Boolean))if(!next.profiles[id]){const p=id===FIXED_ID?fixedPlayer():seed?.athletes.find(a=>a.id===id);if(!p)throw Error('登録選手の情報が不足しています。');next.profiles[id]=p}const imageKeys=new Set(),images=[];for(const p of raw.photos){if(typeof p?.key!=='string'||! /^(own|rival):\d{8}$/.test(p.key)||imageKeys.has(p.key)||typeof p.data!=='string'||p.data.length>12*1024*1024)throw Error('写真データが不正です。');const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(p.data);if(!match)throw Error('写真の形式が不正です。');let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))}catch{throw Error('写真を読み込めません。')}const blob=new Blob([bytes],{type:match[1]});try{const bitmap=await createImageBitmap(blob);bitmap.close()}catch{throw Error('写真を読み込めません。')}imageKeys.add(p.key);images.push({key:p.key,blob})}return{next,images,seed}}
async function importTransfer(e){const file=e.target.files?.[0];e.target.value='';if(!file||dataBusy)return;dataBusy=true;ready=false;setSettingsBusy(true);q('#cy-settings-status').textContent='引継ぎデータを確認しています…';try{if(file.size>80*1024*1024)throw Error('80MB以下の引継ぎファイルを選択してください。');const {next,images,seed}=await validateTransfer(JSON.parse(await file.text()));const yes=await askData('この引継ぎデータを読み込みますか？現在の登録・友達・写真などは置き換わります。');if(!yes){q('#cy-settings-status').textContent='読込をキャンセルしました。';return}ready=false;if(refreshing)await refreshing;await photoTask;await replaceStoredData(next,images,seed);releasePersonalMemory();state=next;await restorePurple();dataset=seed||dataset;roster=dataset?.athletes||[];prefs();for(const p of images)photos.set(p.key,p.blob);screen=state.registered?'card':'title';q('#cy-storage').textContent='引継ぎデータを読み込みました。';render()}catch(e){q('#cy-settings-status').textContent=e instanceof SyntaxError?'ファイルを読み込めません。現在のデータは変更していません。':e.message}finally{dataBusy=false;ready=true;setSettingsBusy(false);render()}}
all('[data-ui-version]').forEach(button=>button.onclick=()=>{if(dataBusy||!ready)return;const theme=button.dataset.uiVersion;if(!validUiTheme(theme))return;state.uiTheme=theme;applyUiTheme();save()});
q('#cy-title-register').onclick=beginRegistration;q('#cy-export').onclick=exportTransfer;q('#cy-import').onclick=()=>q('#cy-transfer-file').click();q('#cy-transfer-file').onchange=importTransfer;q('#cy-clear').onclick=()=>{if(!dataBusy)go('title')};

all('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
all('[data-gender]').forEach(b=>b.onclick=()=>{gender=+b.dataset.gender;page=0;picker()});q('#cy-prev').onclick=()=>{page=0;picker()};q('#cy-next').onclick=()=>{page=1;picker()};q('#cy-avatar-save').onclick=()=>{if(!validAvatar(draft))return;state.avatar=draft;save();go('card')};
q('#cy-pref').onchange=q('#cy-sex').onchange=()=>{candidates();loadCandidates()};q('#cy-search').oninput=candidates;
q('#cy-register').onclick=()=>{const me=selected===FIXED_ID&&q('#cy-search').value===FIXED_QUERY?fixedPlayer():roster.find(a=>a.id===selected);if(!me)return;state.me=me.id;state.registered=true;state.rivals=state.rivals.filter(r=>r.id!==me.id);received=null;q('#cy-ex-status').textContent='';state.profiles[me.id]=me.id===FIXED_ID?fixedPlayer():{...me,...state.profiles[me.id]};save();go('card')};
q('#cy-refresh').onclick=()=>refresh(true);q('#cy-rivals-refresh').onclick=()=>refresh(true);all('[data-theme-group]').forEach(b=>b.onclick=()=>{themeGroup=+b.dataset.themeGroup;themePage=0;renderThemes()});q('#cy-theme-prev').onclick=()=>{themePage=0;renderThemes()};q('#cy-theme-next').onclick=()=>{themePage=1;renderThemes()};q('#cy-theme-save').onclick=()=>{if(!themeAllowed(themeDraft))return;state.background=themeDraft;save();go('card')};
q('#cy-receive').onclick=()=>receiveCode(q('#cy-friend-code').value);
q('#cy-add').onclick=()=>{if(!received)return;const idx=state.rivals.findIndex(r=>r.id===received.id);if(idx<0)state.rivals.push({...received});else state.rivals[idx]={...received};const person=who(received.id)||pendingPerson(received.id);state.profiles[received.id]={...person,listLabel:person.listLabel||(dataset?`${dataset.season} No.${dataset.listNumber}`:'選手情報取得待ち')};received=null;save();go('rivals')};
q('#cy-camera').onclick=()=>q('#cy-camera-file').click();q('#cy-gallery').onclick=()=>q('#cy-gallery-file').click();q('#cy-camera-file').onchange=q('#cy-gallery-file').onchange=e=>{photoTask=choosePhoto(e)};q('#cy-photo-back').onclick=()=>go(photoBack);
q('#cy-url-save').onclick=()=>{const url=validUrl(q('#cy-url').value.trim());if(!url){q('#cy-share-status').textContent='https:// で始まる公開URLを入力してください。';return}state.url=url;save();render();q('#cy-share-status').textContent='紹介QRを生成しました。'};
q('#cy-copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.url);q('#cy-share-status').textContent='URLをコピーしました。'}catch{q('#cy-share-status').textContent='表示URLを長押ししてコピーしてください。'}};
window.addEventListener('online',()=>{lastAttempt=0;if(screen!=='title')refresh()});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&screen!=='title')refresh()});setInterval(()=>{if(!document.hidden&&screen!=='title')refresh()},60*60*1000);
document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault()},{passive:false});document.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault()},{passive:false});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['+','-','=','0'].includes(e.key))e.preventDefault()});
new ResizeObserver(()=>{if(screen==='stats')chart()}).observe(q('#cy-chart'));
(async()=>{const db=await dbReady;if(db){const saved=await read(db,'settings','state');if(saved){state.premium=saved.premium||null;state.uiTheme=validUiTheme(saved.uiTheme)?saved.uiTheme:'original';state.missionFull=saved.missionFull===true;if(validCardAvatar(saved.avatar))state.avatar=saved.avatar;if(validBackground(saved.background))state.background=saved.background;state.rankIds=Array.isArray(saved.rankIds)?saved.rankIds.filter(validId):[];state.rewardSeen=Array.isArray(saved.rewardSeen)?saved.rewardSeen.filter(n=>[5,10,20,30].includes(n)):[];if(validUrl(saved.url))state.url=saved.url;state.profiles=saved.profiles&&typeof saved.profiles==='object'?saved.profiles:{};state.history=Array.isArray(saved.history)?saved.history:[];if(validId(saved.me)&&(saved.me===FIXED_ID||!saved.me.startsWith('000000'))){state.me=saved.me;state.registered=true}state.rivals=Array.isArray(saved.rivals)?saved.rivals.filter(r=>r&&validId(r.id)&&(r.id===FIXED_ID||!r.id.startsWith('000000'))&&validCardAvatar(r.avatar)).map(r=>({...r,background:validBackground(r.background)?r.background:50})):[];if(saved.me&&!state.me)q('#cy-storage').textContent='サンプル登録を終了しました。タイトルから実際の選手を登録してください。'}const cached=await read(db,'settings','saj-dataset');if(cached){try{applyDataset(validateDataset(cached));notice='端末の保存データを表示しています。'}catch{}}}else q('#cy-storage').textContent='端末保存が利用できません。';if(location.hostname.endsWith('.github.io'))state.url=new URL('./',location.href).href;if(!dataset){try{const response=await fetch('./saj-data.json');applyDataset(validateDataset(await response.json()));if(db)await write(db,'settings','saj-dataset',dataset)}catch{notice='初期データを取得できません。通信を確認してください。'}}await restorePurple();ready=true;if(state.registered&&who(state.me))screen='card';render();window.YukiNakaRare?.launch();await refresh()})();
})();




