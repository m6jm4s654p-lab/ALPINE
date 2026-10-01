(() => {
  'use strict';
  const ID_KEY = 'yukinaka.stats.device.v1';
  const TOUCH_KEY = 'yukinaka.stats.latest.v2';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let pending = null;
  let retryAfter = 0;

  function endpoint() {
    try {
      const url = new URL(window.YUKINAKA_STATS_CONFIG?.projectUrl);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port) return null;
      return `${url.origin}/functions/v1/device-stats`;
    } catch { return null; }
  }

  async function post(body) {
    const url = endpoint();
    if (!url) throw Error('端末数の集計はまだ設定されていません。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      if (response.status === 401) throw Error('コードを確認してください。');
      if (response.status === 429) throw Error('確認回数が多いため、1分ほど待って再度お試しください。');
      if (!response.ok) throw Error('端末数を取得できません。時間をおいて再度お試しください。');
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw Error('通信できません。接続を確認して再度お試しください。');
      throw error;
    } finally { clearTimeout(timer); }
  }

  // Separate from player data: never exported or replaced by player transfers.
  function register() {
    if (!endpoint() || navigator.onLine === false || Date.now() < retryAfter) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      try {
        let id = localStorage.getItem(ID_KEY);
        if (!uuid.test(id || '')) {
          id = crypto.randomUUID();
          localStorage.setItem(ID_KEY, id);
        }
        const localNow=new Date(Date.now()+9*3600000);
        const weekKey=localNow.getUTCFullYear()+'-'+(localNow.getUTCMonth()+1)+'-'+(Math.floor((localNow.getUTCDate()-1)/7)+1);
        const receipt = `${endpoint()}:${id}`;
        let previous;try{previous=JSON.parse(localStorage.getItem(TOUCH_KEY)||'null')}catch{previous=null}
        if(previous?.receipt===receipt&&previous.weekKey===weekKey&&Number.isFinite(previous.time)&&Date.now()>=previous.time&&Date.now()-previous.time<300000)return;
        const result = await post({ action: 'register', deviceId: id });
        if (result.ok !== true) throw Error('Registration failed');
        localStorage.setItem(TOUCH_KEY, JSON.stringify({receipt,weekKey,time:Date.now()}));
      } catch {
        // Storage blocked or offline: never generate ephemeral IDs or block the app.
        retryAfter = Date.now() + 60000;
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  function registerLocked() {
    // Avoid two newly opened tabs creating different IDs at the same time.
    if (navigator.locks) return navigator.locks.request(ID_KEY, register).catch(() => {});
    return register();
  }

  window.YukiNakaStats = Object.freeze({
    isAdminCandidate: value => /^[a-z0-9]{8,80}$/i.test(value.trim()) && !/^(YN|AC3)/i.test(value.trim()),
    async getTotal(code) {return (await this.getReport(code)).total},
    async getReport(code) {
      await registerLocked();
      const result = await post({ action: 'count', code: code.trim() });
      if (!Number.isSafeInteger(result.total) || result.total < 0) throw Error('端末数の応答を確認できません。');
      if(result.weekly===undefined)return {total:result.total,historyAvailable:false};
      if(!Number.isSafeInteger(result.unknown)||result.unknown<0||result.unknown>result.total||!Array.isArray(result.weekly))throw Error('アクセス履歴の応答を確認できません。');
      const seen=new Set();
      for(const r of result.weekly){const key=r.year+'-'+r.month+'-'+r.week;if(!Number.isInteger(r.year)||r.year<2000||r.year>9999||!Number.isInteger(r.month)||r.month<1||r.month>12||!Number.isInteger(r.week)||r.week<1||r.week>5||!Number.isSafeInteger(r.count)||r.count<0||r.count>result.total||seen.has(key))throw Error('アクセス履歴の応答を確認できません。');seen.add(key)}
      return {...result,historyAvailable:true,weekly:result.weekly.slice().sort((a,b)=>b.year-a.year||b.month-a.month||b.week-a.week)};
    },
  });
  void registerLocked();
  window.addEventListener('online', () => { void registerLocked(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void registerLocked(); });
})();

