(() => {
  'use strict';
  const PUBLIC_KEY = {"key_ops":["verify"],"ext":true,"kty":"EC","x":"42tJMHvGbceDKK_B71EUUiySp7Sr5zcYV4uwy8il6Vs","y":"SIxtUhsb-po2oCR2EfisG5kJmeJfYBcG5lORH35RhDA","crv":"P-256"};
  const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
  async function verifyProof(proof) {
    try {
      if(!proof||!/^\d{8}$/.test(proof.playerId)||!/^[a-f0-9]{64}$/.test(proof.token)||typeof proof.receipt!=='string'||proof.receipt.length>2000)return false;
      const parts=proof.receipt.split('.');if(parts.length!==2)return false;
      const key=await crypto.subtle.importKey('jwk',PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode(parts[1]),new TextEncoder().encode(parts[0])))return false;
      const p=JSON.parse(new TextDecoder().decode(decode(parts[0])));
      return p.reward==='ssr-purple-v1'&&p.background===108&&p.playerId===proof.playerId&&p.tokenHash===await hash(proof.token);
    }catch{return false}
  }
  async function claim(code,proof) {
    let url;
    try{const project=new URL(window.YUKINAKA_STATS_CONFIG?.projectUrl);if(project.protocol!=='https:'||!project.hostname.endsWith('.supabase.co'))throw Error();url=project.origin+'/functions/v1/premium-background'}catch{throw Error('プレミアム背景はまだ設定されていません。')}
    let response;
    try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim',code,playerId:proof.playerId,token:proof.token}),signal:AbortSignal.timeout(15000),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'})}catch{throw Error('通信できません。同じ端末で再度コードを入力してください。')}
    if(response.status===429)throw Error('確認回数が多いため、1分ほど待って再度お試しください。');
    if(response.status===409)throw Error('このプレミアムコードは別の利用者が使用済みです。');
    if(response.status===401||response.status===400)throw Error('プレミアムコードを確認してください。');
    if(!response.ok)throw Error('プレミアム背景を確認できません。サーバーの設定または接続を確認してください。');
    const result=await response.json(),next={...proof,receipt:result.receipt};
    if(!await verifyProof(next))throw Error('プレミアム背景の所有証明を確認できません。');
    return next;
  }
  window.YukiNakaPremium=Object.freeze({verifyProof,claim});
})();
