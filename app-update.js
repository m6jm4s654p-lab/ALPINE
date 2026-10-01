(() => {
  'use strict';
  const loadedVersion=document.documentElement.dataset.appVersion;
  const root=document.getElementById('snow-cyber');
  const guardKey='yukinaka.update.reload.v1';
  let checking=true,registration=null;
  if(root)root.inert=true;
  const notice=document.createElement('div');
  notice.textContent='最新版を確認しています…';
  notice.setAttribute('role','status');
  notice.style.cssText='position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#070d17;color:#f1f7ff;font:14px system-ui';
  document.body.append(notice);
  function finish(){checking=false;if(root)root.inert=false;notice.remove()}
  function reload(version){
    if(!checking)return;
    const url=new URL(location.href);
    // URL guard works even when sessionStorage is unavailable.
    if(url.searchParams.get('yn-version')===version)return;
    try{const last=JSON.parse(sessionStorage.getItem(guardKey)||'null');if(last?.version===version&&Date.now()-last.at<600000)return;sessionStorage.setItem(guardKey,JSON.stringify({version,at:Date.now()}))}catch{}
    url.searchParams.set('yn-version',version);
    notice.textContent='最新版に更新しています…';
    location.replace(url.href);
  }
  async function checkVersion(){
    if(navigator.onLine===false)return;
    try{
      const response=await fetch(new URL('./version.json',location.href),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(7000)});
      if(!response.ok)return;
      const data=await response.json();
      if(typeof data.version!=='string'||!/^[a-zA-Z0-9._-]{1,80}$/.test(data.version))return;
      if(data.version!==loadedVersion)reload(data.version);
    }catch{/* Offline startup keeps the stored app available. */}
  }
  async function checkWorker(){
    if(!('serviceWorker' in navigator)||location.protocol!=='https:')return;
    try{registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});if(navigator.onLine!==false)await registration.update()}catch{}
  }
  const timeout=setTimeout(finish,8000);
  Promise.allSettled([checkVersion(),checkWorker()]).finally(()=>{clearTimeout(timeout);finish()});
  // A restored browser page is another startup; never reload in the middle of editing.
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
})();
