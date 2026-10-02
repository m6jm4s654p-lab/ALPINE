(() => {
  'use strict';
  const root = document.getElementById('snow-cyber');
  const q = selector => root.querySelector(selector);
  const names = ['Mikaela Shiffrin', 'Lindsey Vonn', 'Marcel Hirscher', 'Aleksander Aamodt Kilde', 'Petra Vlhová', 'Lara Gut-Behrami', 'Federica Brignone', 'Marco Odermatt', 'Henrik Kristoffersen', 'Sofia Goggia'];
  const catalog = names.map((name, i) => ({ id: `rare_${String(i + 1).padStart(3, '0')}`, name, imageUrl: `./rare-cards/rare_${String(i + 1).padStart(3, '0')}.png` }));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const launchId = crypto.randomUUID();
  let session = null, busy = false, booted = false, drawDone = false, drawRetry = false;
  let collection = null, issued = null, refreshing = null, initializing = null, storageReadFailed = false;
  const dbReady = new Promise(resolve => {
    try {
      const request = indexedDB.open('yukinaka-rare-auth', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('auth');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  async function readSession() {
    const db = await dbReady;
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const r = db.transaction('auth').objectStore('auth').get('session');
        r.onsuccess = () => resolve(r.result || null); r.onerror = () => { storageReadFailed = true; resolve(null); };
      } catch { storageReadFailed = true; resolve(null); }
    });
  }
  async function storeSession(value) {
    const db = await dbReady;
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction('auth', 'readwrite');
        if (value) tx.objectStore('auth').put(value, 'session'); else tx.objectStore('auth').delete('session');
        tx.oncomplete = () => { session = value; resolve(true); }; tx.onabort = tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    });
  }
  function config() {
    try {
      const c = window.YUKINAKA_RARE_CONFIG, url = new URL(c.projectUrl);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port) return null;
      // Only publishable or legacy anon keys belong in the browser.
      const key = c.publishableKey;
      if (typeof key !== 'string') return null;
      if (!key.startsWith('sb_publishable_')) {
        const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role !== 'anon') return null;
      }
      return { base: url.origin, key };
    } catch { return null; }
  }
  const messages = {
    login_required: 'カードを確認できません。接続を確認して再度お試しください。',
    verified_email_required: '確認済みメールでログインしてください。',
    not_owner: 'このカードは現在のアカウントで所有していません。一覧を更新してください。',
    invalid_exchange: 'コードは使用済み・取消済み、または正しくありません。',
    expired_exchange: 'コードの有効期限が切れています。新しいコードを受け取ってください。',
    self_exchange: '自分が発行したカードは受け取れません。',
  };
  async function request(path, body, token = null) {
    const c = config();
    if (!c) throw Error('レアカードは準備中です。通常の選手カードはそのまま利用できます。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const r = await fetch(c.base + path, {
        method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 429) throw Error('送信が多いため、時間をおいてお試しください。');
        const error = Error(messages[result.error] || (path.startsWith('/auth/') ? 'カードの保存先を確認できません。時間をおいてお試しください。' : 'レアカードを確認できません。接続を確認して再度お試しください。'));
        error.status = r.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw Error('通信できません。接続後に再度お試しください。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function cleanSession(data) {
    if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !UUID.test(data.user?.id || '')) throw Error('ログインの応答を確認できません。');
    return { access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600), user: { id: data.user.id } };
  }
  async function refreshSession(force = false) {
    if (!session) throw Error(messages.login_required);
    if (!force && session.expires_at > Date.now() / 1000 + 60) return;
    if (refreshing) return refreshing;
    const refresh = async () => {
      const stored = await readSession();
      if (stored?.user?.id === session.user.id && stored.expires_at > Date.now() / 1000 + 60 && stored.access_token !== session.access_token) { session = stored; return; }
      try { if (!await storeSession(cleanSession(await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })))) throw Error('端末への保存に失敗しました。カードの移動を中止しました。'); }
      catch (error) {
        if ([400, 401, 403].includes(error.status)) { error.message = messages.login_required; }
        throw error;
      }
    };
    refreshing = (navigator.locks ? navigator.locks.request('yukinaka-rare-refresh', refresh) : refresh()).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function api(action, params = {}) {
    await refreshSession();
    try { return await request('/functions/v1/rare-cards', { action, ...params }, session.access_token); }
    catch (error) {
      // Replay uses the same launch ID; a lost draw response cannot consume a second draw.
      if (error.status !== 401) throw error;
      await refreshSession(true);
      return request('/functions/v1/rare-cards', { action, ...params }, session.access_token);
    }
  }
  function safeImage(raw) {
    try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function cleanCollection(data) {
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data.dateJst) || !Number.isInteger(data.drawCountToday) || data.drawCountToday < 0 || data.drawCountToday > 5 || !Array.isArray(data.types) || !Array.isArray(data.instances)) throw Error('コレクションの応答を確認できません。');
    const seen = new Set();
    const types = data.types.map(t => {
      if (!catalog.some(c => c.id === t.id) || seen.has(t.id) || typeof t.name !== 'string') throw Error('カード種類を確認できません。');
      seen.add(t.id); return { ...t, imageUrl: safeImage(t.imageUrl) || catalog.find(c => c.id === t.id).imageUrl };
    });
    if (types.length !== 10) throw Error('カード種類を確認できません。');
    seen.clear();
    const instances = data.instances.map(i => {
      if (!UUID.test(i.instanceId || '') || seen.has(i.instanceId) || !types.some(t => t.id === i.typeId)) throw Error('所持カードを確認できません。');
      if (i.exchange && (!UUID.test(i.exchange.id || '') || !Number.isFinite(Date.parse(i.exchange.expiresAt)))) throw Error('交換状態を確認できません。');
      seen.add(i.instanceId); return { ...i, imageUrl: safeImage(i.imageUrl) };
    });
    return { ...data, types, instances };
  }
  async function loadCollection() {
    collection = cleanCollection(await api('collection'));
    if (issued && !collection.instances.some(i => i.exchange?.id === issued.exchangeId)) issued = null;
    render();
  }
  function dateText(raw) { return new Date(raw).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function el(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function cardFace(type, owned) {
    const card = el('div', `rc-face${owned ? '' : ' rc-locked'}`);
    card.append(el('span', 'rc-tier', owned ? 'ULTRA RARE' : 'LOCK'));
    if (owned && type.imageUrl) {
      card.classList.add('rc-art'); card.setAttribute('aria-label', type.name);
      const image = el('img'); image.src = type.imageUrl; image.alt = type.name; image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer'; image.onerror = () => { image.remove(); card.classList.remove('rc-art'); }; card.append(image);
    }
    card.append(el('span', 'rc-mountain', '✦'), el('strong', 'rc-name', type.name), el('span', 'rc-number', type.id.replace('rare_', 'No. ') + ' / ALPINE LEGENDS'));
    return card;
  }
  function render() {
    const enabled = Boolean(config());
    q('#rc-unconfigured').hidden = enabled;
    q('#rc-refresh').disabled = busy || !enabled;
    q('#rc-redeem-form').hidden = !session || !enabled;
    q('#rc-issued').hidden = !issued;
    q('#rc-code').value = issued?.code || '';
    q('#rc-expiry').textContent = issued ? `有効期限：${dateText(issued.expiresAt)}（日本時間）` : '';
    const grid = q('#rc-grid'); grid.replaceChildren();
    for (const type of collection?.types || catalog) {
      const instances = collection?.instances.filter(i => i.typeId === type.id) || [];
      const group = el('article', 'rc-group'); group.append(cardFace(type, instances.length > 0));
      group.append(el('p', 'rc-quantity', instances.length ? `所持 ×${instances.length}` : '未所持'));
      if (instances.length) {
        const details = el('details'), summary = el('summary', 'link', '所持カード・交換'); details.append(summary);
        instances.forEach((instance, index) => {
          const row = el('div', 'rc-instance');
          row.append(el('small', '', `${index + 1}枚目 · ${instance.instanceId.slice(0, 8)}`));
          const issue = el('button', 'secondary', instance.exchange ? '新しいコードを発行' : '交換コードを発行'); issue.type = 'button'; issue.disabled = busy;
          issue.onclick = () => run(async () => {
            const result = await api('create', { cardInstanceId: instance.instanceId });
            if (!UUID.test(result.exchangeId || '') || !/^RC1-[0-9A-F]{64}$/.test(result.code || '') || !Number.isFinite(Date.parse(result.expiresAt))) throw Error('コードの応答を確認できません。');
            issued = { ...result, name: type.name };
            q('#rc-status').textContent = `${type.name} のコードを発行しました。相手が受け取ると、この1枚の所有権が相手へ移ります。`;
            await loadCollection(); q('#rc-issued').scrollIntoView({ block: 'nearest' });
          }); row.append(issue);
          if (instance.exchange) {
            row.append(el('small', '', `交換待ち · ${dateText(instance.exchange.expiresAt)}まで`));
            const cancel = el('button', 'link', 'コードを取り消す'); cancel.type = 'button'; cancel.disabled = busy;
            cancel.onclick = () => run(async () => {
              await api('cancel', { exchangeId: instance.exchange.id });
              if (issued?.exchangeId === instance.exchange.id) issued = null;
              q('#rc-status').textContent = '交換コードを取り消しました。'; await loadCollection();
            }); row.append(cancel);
          } details.append(row);
        }); group.append(details);
      } grid.append(group);
    }
    q('#rc-panel').setAttribute('aria-busy', String(busy));
    for (const id of ['rc-redeem']) q('#' + id).disabled = busy;
  }
  async function run(fn, silent = false) {
    if (busy) return;
    busy = true; render();
    try { await fn(); } catch (error) { if (!silent) q('#rc-status').textContent = error.message; }
    finally { busy = false; render(); }
  }
  async function drawLaunch() {
    if (drawDone || !session || !config()) return;
    drawRetry = true;
    const result = await api('draw', { requestId: launchId });
    if (typeof result.drawExecuted !== 'boolean' || typeof result.won !== 'boolean' || !Number.isInteger(result.drawCountToday) || result.drawCountToday < 0 || result.drawCountToday > 5) throw Error('カードの情報を確認できません。');
    if (result.won && (!catalog.some(t => t.id === result.card?.typeId) || !UUID.test(result.card?.instanceId || ''))) throw Error('カードの情報を確認できません。');
    drawDone = true; drawRetry = false;
    // drawDone suppresses duplicate UI. A replay after a lost network response
    // is still this page's first known result and must show its winning card.
    if (result.won) {
      const type = catalog.find(t => t.id === result.card.typeId);
      const win = q('#rc-win-card'); win.replaceChildren(cardFace({ ...type, imageUrl: safeImage(result.card.imageUrl) || type.imageUrl }, true));
      const dialog = q('#rc-win');
      // Wait for any existing mission/confirmation dialog to close.
      const show = () => {
        const other = root.querySelector('dialog[open]:not(#rc-win)');
        if (other) { other.addEventListener('close', show, { once: true }); return; }
        if (!dialog.open && session) dialog.showModal();
      }; show();
    }
  }
  const restored = readSession().then(value => {
    if (value) { try { session = cleanSession(value); } catch { /* Preserve the stored identity; initialization must fail closed. */ } }
    render();
  });
  async function ensureSession() {
    await restored;
    if (!config()) return;
    if (session) return;
    if (initializing) return initializing;
    const init = async () => {
      if (!await dbReady) throw Error('この端末ではカードの保存先を保存できません。');
      const stored = await readSession();
      if (storageReadFailed) throw Error('保存済みのカード情報を確認できません。新しい保存先は作成しません。');
      if (stored) { session = cleanSession(stored); return; }
      const next = cleanSession(await request('/auth/v1/signup', {}));
      if (!await storeSession(next)) throw Error('端末への保存に失敗しました。カードの取得を中止しました。');
    };
    initializing = (navigator.locks ? navigator.locks.request('yukinaka-rare-create', init) : init()).finally(() => { initializing = null; });
    return initializing;
  }
  const syncCollection = async () => { if (drawRetry) await drawLaunch().catch(() => {}); await loadCollection(); };
  q('#rc-refresh').onclick = () => run(async () => { await ensureSession(); if (!session) return; await drawLaunch(); await syncCollection(); });
  q('#rc-redeem-form').onsubmit = event => {
    event.preventDefault(); run(async () => {
      const code = q('#rc-receive-code').value.replace(/\s/g, '').toUpperCase();
      if (!/^RC1-[0-9A-F]{64}$/.test(code)) throw Error('RC1-で始まるレアカード用コードを入力してください。');
      const result = await api('redeem', { code });
      if (result.ok !== true) throw Error('受取結果を確認できません。');
      q('#rc-receive-code').value = ''; q('#rc-status').textContent = result.alreadyRedeemed ? 'このコードはすでに受け取り済みです。追加のカード移動はありません。' : 'レアカードを受け取りました！';
      await loadCollection();
    });
  };
  q('#rc-copy').onclick = async () => {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.code); q('#rc-status').textContent = '交換コードをコピーしました。'; }
    catch { q('#rc-code').select(); q('#rc-status').textContent = 'コードを選択しました。コピーして相手に渡してください。'; }
  };
  q('#rc-win-close').onclick = () => q('#rc-win').close();
  q('#rc-win-collection').addEventListener('click', () => q('#rc-win').close());
  window.YukiNakaRare = Object.freeze({
    launch() {
      if (booted) return; booted = true;
      void restored.then(() => run(async () => {
        await ensureSession(); if (session && config()) { await drawLaunch(); await loadCollection(); }
      }, true));
    },
    open() { void run(async () => { await ensureSession(); if (session && config()) { await drawLaunch().catch(() => {}); await syncCollection(); } }); },
  });
  window.addEventListener('online', () => { if (!drawDone) void run(async () => { await ensureSession(); if (session && config()) { await drawLaunch(); await loadCollection(); } }, true); });
  setInterval(() => { if (!busy && session && !q('#rc-panel').hidden && collection?.instances.some(i => i.exchange)) void run(loadCollection, true); }, 15000);
  render();
})();
