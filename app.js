(()=>{
'use strict';
const root=document.getElementById('snow-cyber'),q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)];
const atlases=window.ALPINE_ATLASES.map(src=>{const im=new Image();im.src=src;return im});
let state={me:null,registered:false,avatar:0,background:50,rivals:[],url:'',profiles:{},history:[]},roster=[],dataset=null;
let screen='title',gender=0,page=0,draft=0,selected=null,received=null,photoKey=null,photoBack='card',dirty=false;
let writeQueue=Promise.resolve(),refreshing=null,lastAttempt=0,notice='',ready=false;
const photos=new Map(),photoUrls=new Map();
const dbReady=new Promise(resolve=>{try{const r=indexedDB.open('alpine-cyber-local',1);r.onupgradeneeded=()=>{r.result.createObjectStore('settings');r.result.createObjectStore('photos')};r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>resolve(null)}catch{resolve(null)}});
function read(db,store,key){return new Promise(resolve=>{try{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null)}catch{resolve(null)}})}
function write(db,store,key,value){return new Promise(resolve=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>resolve(false)}catch{resolve(false)}})}
function save(){dirty=true;const snapshot=JSON.parse(JSON.stringify(state));writeQueue=writeQueue.then(async()=>{const db=await dbReady;if(!db||!await write(db,'settings','state',snapshot))q('#cy-storage').textContent='端末保存が使えないため、変更は表示中のみ有効です。'})}
function validAvatar(a){return Number.isInteger(a)&&a>=0&&a<100}
function validId(id){return /^\d{8}$/.test(id)}
function validUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
function who(id){return roster.find(r=>r.id===id)||state.profiles[id]||null}
function encodeCard(id,a){if(!validId(id)||!validAvatar(a))throw Error('カード情報が不正です');return `AC3:${id}:${a}`}
function decodeCard(raw){const p=raw.trim().split(':');if(p.length!==3||p[0]!=='AC3'||!validId(p[1])||!/^\d{1,2}$/.test(p[2])||!validAvatar(+p[2]))throw Error('QRの文字列（AC3:競技者番号:アバター番号）を入力してください。');return {id:p[1],avatar:+p[2]}}
function point(v){return typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'—'}
function dateText(value){return new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function metadata(){return dataset?`${dataset.season-1}/${dataset.season} · SAJ No.${dataset.listNumber} · 取得 ${dateText(dataset.checkedAt)}`:'SAJデータ未取得'}
function validateDataset(d){
 if(d?.schema!==1||d.provider!=='SAJ'||!Number.isInteger(d.season)||!Number.isInteger(d.listNumber)||!Number.isFinite(Date.parse(d.checkedAt))||!Array.isArray(d.athletes)||!d.athletes.length)throw Error('SAJデータの形式を確認できません。');
 const ids=new Set();
 for(const a of d.athletes){if(!validId(a.id)||ids.has(a.id)||typeof a.name!=='string'||!a.name||typeof a.pref!=='string'||typeof a.team!=='string'||!['男子','女子'].includes(a.sex)||!['K2','一般','未確認'].includes(a.category)||!a.points||!['SL','GS','SG'].every(k=>a.points[k]===null||(typeof a.points[k]==='number'&&Number.isFinite(a.points[k])&&a.points[k]>=0)))throw Error('不完全なSAJデータのため更新しません。');ids.add(a.id)}
 return d;
}
function applyDataset(d){
 dataset=d;roster=d.athletes;
 for(const id of [state.me,...state.rivals.map(r=>r.id)].filter(Boolean)){const person=roster.find(a=>a.id===id);if(person)state.profiles[id]={...person,listLabel:`${d.season} No.${d.listNumber}`}}
 const me=roster.find(a=>a.id===state.me);
 if(me){const key=`${me.id}:${d.season}:${d.listNumber}`,entry={key,label:`${d.season} No.${d.listNumber}`,points:me.points};state.history=state.history.filter(x=>x.key!==key);state.history.push(entry);state.history=state.history.slice(-24)}
 const oldPref=q('#cy-pref').value;prefs();if([...q('#cy-pref').options].some(o=>o.value===oldPref))q('#cy-pref').value=oldPref;
 if(screen==='register')candidates();render();
}
function prefs(){const values=[...new Set(roster.map(a=>a.pref).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));q('#cy-pref').replaceChildren();for(const pref of values){const o=document.createElement('option');o.value=o.textContent=pref;q('#cy-pref').append(o)}if(values.includes('岩手'))q('#cy-pref').value='岩手'}
async function refresh(force=false){
 if(refreshing)return refreshing;
 if(!force&&Date.now()-lastAttempt<60*60*1000)return;
 lastAttempt=Date.now();notice='SAJデータを確認しています…';render();
 refreshing=(async()=>{try{
  const response=await fetch('./saj-data.json',{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('通信エラー');const d=validateDataset(await response.json());
  if(dataset&&(d.season<dataset.season||(d.season===dataset.season&&d.listNumber<dataset.listNumber)||Date.parse(d.checkedAt)<Date.parse(dataset.checkedAt)))throw Error('新しいデータを確認できません');
  notice='取得済みの最新SAJリストを表示中。公式データは毎週木曜に自動確認します。';applyDataset(d);save();const db=await dbReady;if(db&&!await write(db,'settings','saj-dataset',d))q('#cy-storage').textContent='データを端末に保存できませんでした。';
 }catch(e){notice=dataset?'更新を確認できません。前回取得したデータを表示しています。':'SAJデータを取得できません。通信を確認し、再度「最新データを確認」を押してください。';}finally{refreshing=null;render()}})();return refreshing;
}
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
let themeGroup=0,themePage=0,themeDraft=0;
function themeStyle(id){
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
function applyCardTheme(panel,id){const t=themeStyle(id);panel.style.background=t.background;panel.style.color=t.ink;panel.style.setProperty('--card-muted',t.muted);panel.style.borderColor=t.muted;panel.dataset.theme=id}
function renderThemes(){
 const preview=q('#cy-theme-preview');card(preview,state.me,state.avatar,false,true);applyCardTheme(preview.firstElementChild,themeDraft);
 q('#cy-theme-name').textContent=themeStyle(themeDraft).name;all('[data-theme-group]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.themeGroup===themeGroup));q('#cy-theme-grid').replaceChildren();
 for(let n=0;n<25;n++){const id=themeGroup*50+themePage*25+n,t=themeStyle(id),b=document.createElement('button');b.className='theme-choice';b.style.background=t.background;b.style.color=t.ink;b.setAttribute('aria-label',`背景 ${id+1} ${t.name}`);b.setAttribute('aria-pressed',id===themeDraft);b.textContent=String(id+1).padStart(2,'0');b.onclick=()=>{themeDraft=id;renderThemes()};q('#cy-theme-grid').append(b)}
 q('#cy-theme-page').textContent=`${themePage*25+1}–${themePage*25+25} / 50`;q('#cy-theme-prev').disabled=themePage===0;q('#cy-theme-next').disabled=themePage===1;
}

function appendCardPoints(panel,id){
 const person=who(id),grid=document.createElement('div');grid.className='point-grid';grid.setAttribute('aria-label','SAJ SL GS SGポイント');
 for(const k of ['SL','GS','SG']){const cell=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=k;value.textContent=point(person?.points?.[k]);cell.append(label,value);grid.append(cell)}panel.append(grid);
 const meta=document.createElement('p');meta.className='note';meta.textContent=roster.some(a=>a.id===id)?metadata():`今回のリストに未掲載。前回の情報 ${person?.listLabel||'なし'}`;panel.append(meta);
}
function avatar(canvas,id){if(!validAvatar(id))id=0;canvas.dataset.avatar=id;const draw=()=>{if(Number(canvas.dataset.avatar)!==id)return;const im=atlases[Math.floor(id/50)];if(!im.complete||!im.naturalWidth)return;const n=id%50,w=im.naturalWidth/10,h=im.naturalHeight/5,c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(im,n%10*w+1,Math.floor(n/10)*h+1,w-2,h-2,0,0,canvas.width,canvas.height)};const im=atlases[Math.floor(id/50)];if(im.complete)draw();else im.addEventListener('load',draw,{once:true})}
function avatarCanvas(id,size=256){const c=document.createElement('canvas');c.width=c.height=size;c.className='avatar';c.setAttribute('role','img');c.setAttribute('aria-label',`アバター ${id+1}`);avatar(c,id);return c}
async function photoUrl(key){if(photoUrls.has(key))return photoUrls.get(key);let blob=photos.get(key);if(!blob){const db=await dbReady;if(db)blob=await read(db,'photos',key)}if(!blob)return null;if(photoUrls.has(key))return photoUrls.get(key);const url=URL.createObjectURL(blob);photoUrls.set(key,url);return url}
function card(target,id,a,photo=true,own=false){target.replaceChildren();const person=who(id);const panel=document.createElement('div');panel.className='player-card'+(own?' own-card':'');applyCardTheme(panel,own?state.background:50);const top=document.createElement('div');top.className='card-top';top.append(avatarCanvas(a));const info=document.createElement('div');info.className='card-info';const label=document.createElement('p');label.className='label';label.textContent='選手名';const name=document.createElement('p');name.className='card-name';name.textContent=person?.name||'情報取得待ち';const sid=document.createElement('p');sid.className='label';sid.textContent='SAJ競技者番号';const number=document.createElement('p');number.className='saj';number.textContent=id;info.append(label,name,sid,number);top.append(info);panel.append(top);const teamLabel=document.createElement('p');teamLabel.className='label';teamLabel.style.marginTop='16px';teamLabel.textContent='チーム名';const team=document.createElement('p');team.className='team';team.textContent=person?.team||'通信復帰後に取得';panel.append(teamLabel,team);appendCardPoints(panel,id);if(photo){const key=own?'own:'+id:'rival:'+id;const button=document.createElement('button');button.className='memory';button.setAttribute('aria-label','記念写真を追加・変更');button.innerHTML='<b>＋</b><span>記念写真を1枚追加</span><span>この端末だけの思い出</span>';button.onclick=()=>openPhoto(key,id);panel.append(button);photoUrl(key).then(url=>{if(!url||!button.isConnected)return;button.replaceChildren();const img=document.createElement('img');img.src=url;img.alt='記念写真。タップして変更';button.append(img)})}target.append(panel)}
function qr(target,text){target.replaceChildren();if(typeof qrcode!=='function'){target.textContent='QRライブラリを読み込めませんでした。';return}const code=qrcode(0,'M');code.addData(text,'Byte');code.make();const n=code.getModuleCount(),s=6,c=document.createElement('canvas');c.width=c.height=(n+8)*s;c.setAttribute('role','img');c.setAttribute('aria-label','QRコード');const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#000';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(code.isDark(y,x))ctx.fillRect((x+4)*s,(y+4)*s,s,s);target.append(c)}
function picker(){avatar(q('#cy-avatar-preview'),draft);all('[data-gender]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.gender===gender));q('#cy-avatar-grid').replaceChildren();for(let n=page*25;n<page*25+25;n++){const id=gender*50+n,b=document.createElement('button');b.className='avatar-choice';b.setAttribute('aria-label',`${gender?'女子':'男子'}アバター ${n+1}`);b.setAttribute('aria-pressed',draft===id);b.append(avatarCanvas(id,150));const label=document.createElement('span');label.textContent=String(n+1).padStart(2,'0');b.append(label);b.onclick=()=>{draft=id;picker()};q('#cy-avatar-grid').append(b)}q('#cy-page').textContent=`${page*25+1}–${page*25+25} / 50`;q('#cy-prev').disabled=page===0;q('#cy-next').disabled=page===1}
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
 q('#cy-data-meta').textContent=metadata();q('#cy-data-status').textContent=notice;q('#cy-refresh').disabled=!!refreshing;
 const body=q('#cy-stats');body.replaceChildren();
 const row=(name,values)=>{const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=name;tr.append(th);for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td)}body.append(tr)};
 row('所持pt',['SL','GS','SG'].map(k=>point(me?.points?.[k])));
 const current=roster.find(a=>a.id===state.me);
 for(const label of ['県内','全国']){row(label,['SL','GS','SG'].map(k=>{if(!current||current.category==='未確認'||current.points[k]===null)return '—';const peers=roster.filter(a=>a.sex===current.sex&&a.category===current.category&&(label==='全国'||a.pref===current.pref));return (1+peers.filter(a=>a.points[k]!==null&&a.points[k]<current.points[k]).length)+'位'}))}
 chart();
}
function render(){
 all('[data-screen]').forEach(p=>p.hidden=p.dataset.screen!==screen);q('nav').hidden=['title','register'].includes(screen);q('.top-actions').hidden=['title','register'].includes(screen);all('nav [data-go]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.go===screen));
 q('#cy-start').textContent=state.registered?'はじめる':'DATAを開く';q('#cy-start').disabled=!ready;
 all('[data-go=register]').forEach(b=>b.disabled=!ready);
 q('#cy-data-status').textContent=notice;
 const me=who(state.me);
 if(screen==='stats')stats();
 if(screen==='card'){q('[data-go=avatar]').hidden=!me;q('[data-go=background]').hidden=!me;if(me)card(q('#cy-own-card'),state.me,state.avatar,true,true);else q('#cy-own-card').textContent='タイトル画面から自分の選手を登録してください。'}
 if(screen==='background')renderThemes();if(screen==='avatar')picker();
 if(screen==='exchange'){q('#cy-ex-name').textContent=me?.name||'選手未登録';avatar(q('#cy-ex-avatar'),state.avatar);if(me)qr(q('#cy-ex-qr'),encodeCard(state.me,state.avatar));else q('#cy-ex-qr').textContent='タイトル画面で登録してください。';q('#cy-receive').disabled=!me;q('#cy-received').hidden=!received}
 if(screen==='rivals'){q('#cy-rivals').replaceChildren();if(!state.rivals.length)q('#cy-rivals').textContent='「友達追加」から友達のカードを追加してください。';for(const r of state.rivals){const host=document.createElement('div');q('#cy-rivals').append(host);card(host,r.id,r.avatar)}}
 if(screen==='share'){const url=validUrl(state.url);q('#cy-share-ready').hidden=!url;q('#cy-share-pending').hidden=!!url;q('#cy-url').value=state.url;if(url){q('#cy-share-url').textContent=url;qr(q('#cy-share-qr'),url)}}
}
function go(next){if(!ready)return;if(next==='register'&&screen!=='title')return;screen=next;if(next==='avatar'){draft=state.avatar;gender=Math.floor(draft/50);page=Math.floor(draft%50/25)}if(next==='background'){themeDraft=state.background;themeGroup=Math.floor(themeDraft/50);themePage=Math.floor(themeDraft%50/25)}if(next==='register')candidates();render();if(next!=='title')refresh()}
function candidates(){
 selected=null;q('#cy-register').disabled=true;q('#cy-register').textContent='選手を選択してください';q('#cy-candidates').replaceChildren();
 const query=q('#cy-search').value.trim().replace(/\s/g,'');const matches=roster.filter(a=>a.pref===q('#cy-pref').value&&a.sex===q('#cy-sex').value&&(!query||a.name.replace(/\s/g,'').includes(query)||a.id.includes(query)));
 q('#cy-register-status').textContent=dataset?`${matches.length}名 · ${metadata()}`:'取得中です。通信できない場合はタイトルからDATAを開き、再取得してください。';
 for(const a of matches){const b=document.createElement('button');b.className='candidate';b.setAttribute('aria-pressed','false');const name=document.createElement('strong');name.textContent=a.name;const detail=document.createElement('p');detail.className='sub';detail.textContent=`${a.team} / ${a.category} / ${a.id}`;b.append(name,detail);b.onclick=()=>{selected=a.id;all('.candidate').forEach(c=>c.setAttribute('aria-pressed',c===b));q('#cy-register').disabled=false;q('#cy-register').textContent='この選手で登録'};q('#cy-candidates').append(b)}
}
all('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
all('[data-gender]').forEach(b=>b.onclick=()=>{gender=+b.dataset.gender;page=0;picker()});q('#cy-prev').onclick=()=>{page=0;picker()};q('#cy-next').onclick=()=>{page=1;picker()};q('#cy-avatar-save').onclick=()=>{state.avatar=draft;save();go('card')};
q('#cy-pref').onchange=q('#cy-sex').onchange=q('#cy-search').oninput=candidates;
q('#cy-register').onclick=()=>{const me=roster.find(a=>a.id===selected);if(!me)return;state.me=me.id;state.registered=true;state.rivals=state.rivals.filter(r=>r.id!==me.id);received=null;q('#cy-ex-status').textContent='';applyDataset(dataset);save();go('card')};
q('#cy-refresh').onclick=()=>refresh(true);all('[data-theme-group]').forEach(b=>b.onclick=()=>{themeGroup=+b.dataset.themeGroup;themePage=0;renderThemes()});q('#cy-theme-prev').onclick=()=>{themePage=0;renderThemes()};q('#cy-theme-next').onclick=()=>{themePage=1;renderThemes()};q('#cy-theme-save').onclick=()=>{state.background=themeDraft;save();go('card')};
q('#cy-receive').onclick=()=>{try{received=null;const r=decodeCard(q('#cy-friend-code').value);if(r.id===state.me)throw Error('自分のカードは友達に追加できません。');const person=roster.find(a=>a.id===r.id);if(!person)throw Error('取得済みSAJリストに見つかりません。DATAで最新データを確認してください。');received=r;card(q('#cy-received-card'),r.id,r.avatar,false);q('#cy-received').hidden=false;q('#cy-ex-status').textContent='この選手を友達一覧に追加します。'}catch(e){q('#cy-received').hidden=true;q('#cy-ex-status').textContent=e.message}};
q('#cy-add').onclick=()=>{if(!received)return;const idx=state.rivals.findIndex(r=>r.id===received.id);if(idx<0)state.rivals.push({...received});else state.rivals[idx]={...received};state.profiles[received.id]={...who(received.id),listLabel:`${dataset.season} No.${dataset.listNumber}`};received=null;save();go('rivals')};
q('#cy-camera').onclick=()=>q('#cy-camera-file').click();q('#cy-gallery').onclick=()=>q('#cy-gallery-file').click();q('#cy-camera-file').onchange=q('#cy-gallery-file').onchange=choosePhoto;q('#cy-photo-back').onclick=()=>go(photoBack);
q('#cy-url-save').onclick=()=>{const url=validUrl(q('#cy-url').value.trim());if(!url){q('#cy-share-status').textContent='https:// で始まる公開URLを入力してください。';return}state.url=url;save();render();q('#cy-share-status').textContent='紹介QRを生成しました。'};
q('#cy-copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.url);q('#cy-share-status').textContent='URLをコピーしました。'}catch{q('#cy-share-status').textContent='表示URLを長押ししてコピーしてください。'}};
window.addEventListener('online',()=>{lastAttempt=0;if(screen!=='title')refresh()});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&screen!=='title')refresh()});setInterval(()=>{if(!document.hidden&&screen!=='title')refresh()},60*60*1000);
new ResizeObserver(()=>{if(screen==='stats')chart()}).observe(q('#cy-chart'));
(async()=>{const db=await dbReady;if(db){const saved=await read(db,'settings','state');if(saved){if(validAvatar(saved.avatar))state.avatar=saved.avatar;if(validAvatar(saved.background))state.background=saved.background;if(validUrl(saved.url))state.url=saved.url;state.profiles=saved.profiles&&typeof saved.profiles==='object'?saved.profiles:{};state.history=Array.isArray(saved.history)?saved.history:[];if(validId(saved.me)&&!saved.me.startsWith('000000')){state.me=saved.me;state.registered=true}state.rivals=Array.isArray(saved.rivals)?saved.rivals.filter(r=>r&&validId(r.id)&&!r.id.startsWith('000000')&&validAvatar(r.avatar)):[];if(saved.me&&!state.me)q('#cy-storage').textContent='サンプル登録を終了しました。タイトルから実際の選手を登録してください。'}const cached=await read(db,'settings','saj-dataset');if(cached){try{applyDataset(validateDataset(cached));notice='端末の保存データを表示しています。'}catch{}}}else q('#cy-storage').textContent='端末保存が利用できません。';if(location.hostname.endsWith('.github.io'))state.url=new URL('./',location.href).href;ready=true;render();await refresh(true)})();
})();
