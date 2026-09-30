import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHandler } from '../supabase/functions/device-stats/handler.mjs';
const ORIGIN = 'https://m6jm4s654p-lab.github.io';
const CODE = 'testOnlyCode123';
const ID = 'd01d7730-f868-45b6-9035-96d20714a143';
function fixture(options = {}) {
  const ids = new Set(), calls = [];
  let attempts = 0;
  const config = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only', ALLOWED_ORIGINS: ORIGIN, ADMIN_STATS_CODE: CODE, ...options.env };
  const handler = createHandler({ env: k => config[k], fetcher: async (url, init) => {
    calls.push({url, init});
    if (options.fail) return new Response('', {status:500});
    if (url.includes('/rpc/')) return Response.json(++attempts <= 30);
    if (init.method === 'POST') { ids.add(JSON.parse(init.body).device_id); return new Response(null,{status:201}); }
    return new Response(null, {headers: {'Content-Range': `*/${ids.size}`}});
  }});
  const request = (body, extra = {}) => handler(new Request('https://example.supabase.co/functions/v1/device-stats', {method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(body),...extra}));
  return {request, ids, calls};
}
test('register is idempotent; only authorized count returns a total', async () => {
  const f = fixture();
  for(let i=0;i<2;i++) assert.deepEqual(await (await f.request({action:'register',deviceId:ID})).json(),{ok:true});
  assert.equal(f.ids.size,1);
  assert.equal((await f.request({action:'count',code:'wrongCode123'})).status,401);
  assert.deepEqual(await (await f.request({action:'count',code:CODE})).json(),{total:1});
  assert.equal(f.calls.filter(c=>c.init.method==='HEAD').length,1);
  assert.ok(f.calls[0].init.headers.Prefer.includes('ignore-duplicates'));
});
test('zero is a valid total and missing secrets fail closed', async () => {
  assert.deepEqual(await (await fixture().request({action:'count',code:CODE})).json(),{total:0});
  assert.equal((await fixture({env:{ADMIN_STATS_CODE:''}}).request({action:'count',code:CODE})).status,503);
});
test('origin, method, payload size, UUID and extra personal fields are rejected', async () => {
  const f=fixture();
  assert.equal((await f.request({action:'register',deviceId:ID}, {headers:{Origin:'https://evil.example','Content-Type':'application/json'}})).status,403);
  assert.equal((await f.request(null,{method:'GET',body:undefined})).status,405);
  for (const body of [{action:'register',deviceId:'invalid'}, {action:'register',deviceId:ID,name:'private'}, {action:'count',code:'x'.repeat(1200)}, null, []]) assert.equal((await f.request(body)).status,400);
  assert.equal(f.calls.length,0);
  const preflight=await f.request(null,{method:'OPTIONS',body:undefined});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),ORIGIN);
});
test('database failure is not displayed as zero; attempts are rate limited', async () => {
  assert.equal((await fixture({fail:true}).request({action:'register',deviceId:ID})).status,503);
  const f=fixture();
  for(let i=0;i<30;i++) assert.equal((await f.request({action:'count',code:'wrongCode123'})).status,401);
  assert.equal((await f.request({action:'count',code:CODE})).status,429);
});
test('new Supabase secret key is never used as a bearer JWT', async () => {
  const f=fixture({env:{SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'})}});
  await f.request({action:'register',deviceId:ID});
  assert.equal(f.calls[0].init.headers.apikey,'sb_secret_test');
  assert.equal(f.calls[0].init.headers.Authorization,undefined);
});
const clientSource=await readFile(new URL('../device-stats.js',import.meta.url),'utf8');
function client({store=new Map(),fail=false,blocked=false,configured=true}={}) {
  const calls=[], listeners={};
  const sandbox={crypto,URL,AbortController,setTimeout,clearTimeout,Date,console, navigator:{onLine:true}, document:{hidden:false,addEventListener:(n,f)=>listeners[n]=f},localStorage:{getItem:k=>{if(blocked)throw Error();return store.get(k)??null},setItem:(k,v)=>{if(blocked)throw Error();store.set(k,v)}},fetch:async(url,init)=>{calls.push(JSON.parse(init.body));if(fail)throw new TypeError('offline');return Response.json(calls.at(-1).action==='count'?{total:17}:{ok:true})},addEventListener:(n,f)=>listeners[n]=f,YUKINAKA_STATS_CONFIG:{projectUrl:configured?'https://example.supabase.co':''}};
  sandbox.window=sandbox;
  vm.runInNewContext(clientSource,sandbox);
  return {sandbox,calls,store,listeners};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
test('browser persists ID and receipt, skips repeated registration, count sends no player data',async()=>{
  const first=client();await settle();
  assert.equal(first.calls.length,1);
  assert.deepEqual(Object.keys(first.calls[0]).sort(),['action','deviceId']);
  const second=client({store:first.store});await settle();
  assert.equal(second.calls.length,0);
  assert.equal(await second.sandbox.YukiNakaStats.getTotal(CODE),17);
  assert.deepEqual(second.calls,[{action:'count',code:CODE}]);
  assert.equal(second.sandbox.YukiNakaStats.isAdminCandidate(CODE),true);
  assert.equal(second.sandbox.YukiNakaStats.isAdminCandidate('YN42038'),false);
  assert.equal(second.sandbox.YukiNakaStats.isAdminCandidate('AC3ABCDEFG'),false);
});
test('blocked storage and absent configuration do not send temporary IDs; failure has no receipt',async()=>{
  for(const opts of [{blocked:true},{configured:false}]){const c=client(opts);await settle();assert.equal(c.calls.length,0)}
  const c=client({fail:true});await settle();
  assert.equal(c.store.has('yukinaka.stats.registered.v1'),false);
  const recovered=client({store:c.store});await settle();
  assert.equal(recovered.calls[0].deviceId,c.calls[0].deviceId);
});
