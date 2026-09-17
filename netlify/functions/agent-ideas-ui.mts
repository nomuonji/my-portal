import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as storeImport from "../../functions/agentIdeasStore.js";

const store: any = (storeImport as any).default ?? storeImport;
const DEFAULT_ACCESS_KEY_HASH = "f174c5b44462f5b25b12902b20bca1cf24e1153c9a2baec7db89a9b436a07618";
const SESSION_COOKIE = "agent_ideas_ui";

function env(name: string): string | undefined {
  try {
    const value = (globalThis as any).Netlify?.env?.get(name);
    if (value) return String(value);
  } catch {}
  const fallback = process.env[name];
  return fallback ? String(fallback) : undefined;
}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  return left.length === right.length && timingSafeEqual(left, right);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function accessKeyHash() {
  return (env("AGENT_IDEAS_MCP_ACCESS_KEY_HASH") || DEFAULT_ACCESS_KEY_HASH).trim();
}

function signingKey() {
  return (env("AGENT_IDEAS_MCP_SIGNING_KEY") || accessKeyHash()).trim();
}

function sameAccessKey(value: string) {
  return Boolean(value) && safeEqual(sha256(value), accessKeyHash());
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signSession() {
  const body = encode({ exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 });
  const signature = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySession(value: string | undefined) {
  if (!value) return false;
  const [body, signature] = value.split(".");
  if (!body || !signature) return false;
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookies(request: Request) {
  const raw = request.headers.get("cookie") || "";
  const result: Record<string, string> = {};
  raw.split(";").forEach((entry) => {
    const index = entry.indexOf("=");
    if (index < 0) return;
    result[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1).trim());
  });
  return result;
}

function authorized(request: Request) {
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (sameAccessKey(bearer)) return true;
  return verifySession(cookies(request)[SESSION_COOKIE]);
}

function ensureFirebaseAdmin() {
  if (getApps().length) return;
  const raw = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured on Netlify");
  let serviceAccount: any;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id || "my-portal-d05fd",
  });
}

function database() {
  ensureFirebaseAdmin();
  return store.DATABASE_ID === "(default)" ? getFirestore() : getFirestore(store.DATABASE_ID);
}

async function bodyObject(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { return await request.json(); } catch { return {}; }
  }
  const raw = await request.text();
  return Object.fromEntries(new URLSearchParams(raw));
}

function serializeSnapshot(snapshot: any) {
  return store.serialize({ id: snapshot.id, ...snapshot.data() });
}

async function listRuns(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 80, 1), 150);
  const status = url.searchParams.get("status");
  let query: any = database().collection(store.COLLECTIONS.runs).orderBy("updatedAt", "desc");
  if (status) query = query.where("status", "==", status);
  const snapshot = await query.limit(limit).get();
  return snapshot.docs.map(serializeSnapshot);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loginPage(error = "") {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Idea Space</title><style>body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 15% 10%,#eef8ff,#dfeef6 48%,#edf3f5);color:#173047}.card{width:min(92vw,420px);margin:12vh auto;background:rgba(255,255,255,.86);backdrop-filter:blur(18px);border:1px solid rgba(78,125,153,.18);border-radius:22px;padding:28px;box-shadow:0 24px 80px rgba(41,78,100,.14)}h1{margin:0 0 8px;font-size:24px}p{color:#637b8b;line-height:1.65}input,button{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;font:inherit}input{border:1px solid #c4d6e0;background:#fff;margin:12px 0}button{border:0;background:#5577e8;color:#fff;font-weight:800;cursor:pointer}.err{color:#bb334a;background:#fff0f2;padding:9px 11px;border-radius:10px;font-size:13px}</style></head><body><div class="card"><h1>Agent Idea Space</h1><p>エージェントが保存したアイデアと作業セッションを確認・管理します。</p>${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}<form method="post" action="/agent-ideas/login"><input type="password" name="access_key" placeholder="Agent Idea Space access key" autocomplete="current-password" required autofocus><button type="submit">開く</button></form></div></body></html>`;
}

function appPage() {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Idea Space | My Portal</title>
<style>
:root{font-family:Inter,"Noto Sans JP",system-ui,-apple-system,sans-serif;color:#173047;background:#e8f2f6}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 8% 6%,rgba(255,255,255,.98),rgba(225,241,248,.88) 35%,rgba(231,237,242,.96) 100%)}button,input,textarea,select{font:inherit}.top{height:58px;display:flex;align-items:center;gap:14px;padding:0 20px;border-bottom:1px solid rgba(72,119,147,.15);background:rgba(248,252,254,.78);backdrop-filter:blur(18px);position:sticky;top:0;z-index:20}.brand{font-weight:900;letter-spacing:.08em}.badge{font-size:11px;padding:4px 8px;border-radius:999px;background:#e9f0ff;color:#4263c7}.tabs{display:flex;gap:5px;margin-left:auto}.tab{border:0;background:transparent;padding:8px 12px;border-radius:10px;color:#6d8190;cursor:pointer;font-weight:700}.tab.active{background:#fff;color:#27465d;box-shadow:0 4px 16px rgba(49,84,107,.09)}.logout{border:0;background:transparent;color:#718796;cursor:pointer}.page{padding:18px;max-width:1700px;margin:auto}.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}.toolbar input,.toolbar select{border:1px solid rgba(78,125,153,.2);background:rgba(255,255,255,.8);border-radius:11px;padding:9px 11px;color:#29475d}.toolbar input{min-width:260px}.primary{border:0;border-radius:11px;padding:10px 14px;background:#5577e8;color:#fff;font-weight:800;cursor:pointer}.secondary{border:1px solid rgba(78,125,153,.2);border-radius:11px;padding:9px 12px;background:rgba(255,255,255,.76);color:#3d5d73;font-weight:700;cursor:pointer}.spacer{flex:1}.status{font-size:12px;color:#6d8392}.board{display:grid;grid-template-columns:repeat(5,minmax(230px,1fr));gap:12px;align-items:start;overflow-x:auto;padding-bottom:18px}.lane{min-width:230px;border:1px solid rgba(74,119,146,.16);border-radius:16px;background:rgba(255,255,255,.48);backdrop-filter:blur(14px);padding:10px;min-height:310px}.laneHead{display:flex;align-items:center;gap:8px;font-weight:900;font-size:13px;margin-bottom:9px}.dot{width:7px;height:28px;border-radius:6px}.count{margin-left:auto;background:rgba(75,112,138,.09);padding:2px 7px;border-radius:999px;font-size:11px}.card{background:rgba(255,255,255,.88);border:1px solid rgba(75,117,142,.14);border-radius:12px;padding:11px;margin:8px 0;box-shadow:0 4px 14px rgba(50,88,110,.07);cursor:pointer;transition:.16s}.card:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(50,88,110,.13)}.title{font-weight:850;font-size:13px;line-height:1.45}.summary{font-size:12px;color:#68808f;line-height:1.55;margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.chip{font-size:10px;padding:3px 6px;border-radius:999px;background:#eef4f7;color:#587082}.meta{font-size:10px;color:#91a1ab;margin-top:8px}.runs{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px}.panel{background:rgba(255,255,255,.58);border:1px solid rgba(74,119,146,.16);border-radius:16px;backdrop-filter:blur(14px);padding:12px}.run{background:rgba(255,255,255,.88);border:1px solid rgba(74,119,146,.14);border-radius:13px;padding:13px;margin:8px 0;cursor:pointer}.run.active{border-left:4px solid #56a87b}.run.paused{border-left:4px solid #d5a23e}.run.completed{border-left:4px solid #6c86df}.run.failed{border-left:4px solid #c85b69}.runTitle{font-weight:850}.detail{position:fixed;right:16px;top:72px;bottom:16px;width:min(430px,calc(100vw - 32px));background:rgba(250,253,254,.96);border:1px solid rgba(68,111,137,.18);border-radius:18px;box-shadow:0 22px 70px rgba(43,77,99,.19);z-index:30;padding:18px;overflow:auto;display:none}.detail.open{display:block}.detailClose{float:right;border:0;background:#eef3f6;border-radius:9px;padding:6px 9px;cursor:pointer}.detail h2{font-size:19px;margin:3px 36px 8px 0}.detail h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#7f94a1;margin-top:20px}.body{white-space:pre-wrap;font-size:13px;line-height:1.7;color:#405e72}.listItem{padding:8px 0;border-bottom:1px solid rgba(83,123,145,.1);font-size:12px}.empty{padding:28px;text-align:center;color:#8296a3}.error{background:#fff0f2;color:#a83348;border:1px solid #f0cad2;padding:10px 12px;border-radius:10px;margin-bottom:12px}dialog{border:0;border-radius:18px;padding:0;box-shadow:0 25px 90px rgba(28,58,78,.3);width:min(560px,92vw)}dialog::backdrop{background:rgba(26,48,62,.3);backdrop-filter:blur(3px)}.dialogBody{padding:20px}.dialogBody h2{margin:0 0 12px}.dialogBody label{display:block;font-size:12px;font-weight:800;color:#617988;margin-top:12px}.dialogBody input,.dialogBody textarea{width:100%;border:1px solid #c8d8e0;border-radius:10px;padding:10px;margin-top:5px}.dialogBody textarea{min-height:100px;resize:vertical}.dialogActions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}@media(max-width:900px){.board{grid-template-columns:repeat(5,250px)}.runs{grid-template-columns:1fr}.top{padding:0 10px}.brand{font-size:13px}.page{padding:10px}.toolbar input{min-width:170px;flex:1}.detail{right:8px;top:66px;bottom:8px;width:calc(100vw - 16px)}}
</style>
</head>
<body>
<header class="top"><div class="brand">MY PORTAL · AGENT IDEAS</div><span class="badge">Agent memory</span><div class="tabs"><button class="tab active" data-tab="ideas">Ideas</button><button class="tab" data-tab="sessions">Sessions</button></div><form method="post" action="/agent-ideas/logout"><button class="logout">ログアウト</button></form></header>
<main class="page">
<div id="error"></div>
<section id="ideasView">
  <div class="toolbar"><input id="search" placeholder="アイデアを検索"><select id="statusFilter"><option value="">すべての状態</option><option>active</option><option>paused</option><option>promoted</option><option>archived</option></select><span class="status" id="ideaStatus"></span><span class="spacer"></span><button class="primary" id="newSessionFromIdeas">＋ セッション開始</button></div>
  <div class="board" id="board"></div>
</section>
<section id="sessionsView" hidden>
  <div class="toolbar"><span class="status" id="runStatus"></span><span class="spacer"></span><button class="primary" id="newSession">＋ 新しいセッション</button></div>
  <div class="runs"><div class="panel"><div id="runList"></div></div><div class="panel" id="runInspector"><div class="empty">セッションを選択してください</div></div></div>
</section>
</main>
<aside class="detail" id="detail"><button class="detailClose" id="detailClose">✕</button><div id="detailContent"></div></aside>
<dialog id="sessionDialog"><form method="dialog" class="dialogBody" id="sessionForm"><h2>Agent Session</h2><p class="summary">目的を残しておくと、ChatGPT側の探索と後続セッションをつなぎやすくなります。</p><label>目的<input id="objective" required placeholder="例: このアイデアから収益化できる派生案を探索する"></label><label>進め方・制約<textarea id="instructions" placeholder="調査条件、避けたい方向、評価軸など"></textarea></label><input type="hidden" id="seedIdeaId"><div class="dialogActions"><button type="button" class="secondary" id="cancelSession">キャンセル</button><button type="submit" class="primary">セッションを作成</button></div></form></dialog>
<script>
const maturity = [
  {id:'seed',label:'Seed',color:'#79a9e8'},
  {id:'exploring',label:'Exploring',color:'#9b79df'},
  {id:'developed',label:'Developed',color:'#55a9a0'},
  {id:'validated',label:'Validated',color:'#dfa94e'},
  {id:'execution_ready',label:'Ready',color:'#5dab79'}
];
let ideas=[], runs=[], selectedIdea=null, selectedRun=null;
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmt=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)};
async function api(path,options={}){const response=await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});if(response.status===401){location.reload();throw new Error('認証が切れました');}const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||data.message||('HTTP '+response.status));return data}
function showError(error){$('error').innerHTML='<div class="error">'+esc(error.message||error)+'</div>';setTimeout(()=>{$('error').innerHTML=''},7000)}
function renderIdeas(){const q=$('search').value.trim().toLowerCase();const status=$('statusFilter').value;const filtered=ideas.filter(i=>(!status||i.status===status)&&(!q||[i.title,i.summary,i.content,...(i.tags||[]),...(i.domains||[])].join(' ').toLowerCase().includes(q)));$('ideaStatus').textContent=filtered.length+' ideas';$('board').innerHTML=maturity.map(l=>{const items=filtered.filter(i=>(i.maturity||'seed')===l.id);return '<section class="lane"><div class="laneHead"><span class="dot" style="background:'+l.color+'"></span>'+l.label+'<span class="count">'+items.length+'</span></div>'+ (items.length?items.map(cardHtml).join(''):'<div class="empty">まだありません</div>')+'</section>'}).join('');document.querySelectorAll('[data-idea]').forEach(el=>el.addEventListener('click',()=>openIdea(el.dataset.idea)))}
function cardHtml(i){return '<article class="card" data-idea="'+esc(i.id)+'"><div class="title">'+esc(i.title||'Untitled')+'</div><div class="summary">'+esc(i.summary||i.content||'')+'</div><div class="chips">'+(i.tags||[]).slice(0,3).map(t=>'<span class="chip">#'+esc(t)+'</span>').join('')+'</div><div class="meta">'+esc(i.createdBy?.agent||'agent')+' · '+fmt(i.updatedAt||i.createdAt)+'</div></article>'}
async function openIdea(id){try{const data=await api('/api/agent-ideas/ideas/'+encodeURIComponent(id));selectedIdea=data.root;$('detailContent').innerHTML='<h2>'+esc(data.root.title||'Untitled')+'</h2><div class="chips"><span class="chip">'+esc(data.root.status||'active')+'</span><span class="chip">'+esc(data.root.maturity||'seed')+'</span>'+(data.root.domains||[]).map(t=>'<span class="chip">'+esc(t)+'</span>').join('')+'</div><p class="summary">'+esc(data.root.summary||'')+'</p><div class="body">'+esc(data.root.content||'')+'</div><button class="primary" id="startFromIdea" style="margin-top:14px">このアイデアでセッション開始</button><h3>Relations</h3>'+list(data.relations,r=>esc(r.type)+' → '+esc(r.fromIdeaId===id?r.toIdeaId:r.fromIdeaId))+'<h3>Sources</h3>'+list(data.sources,s=>esc(s.title||s.url||s.type))+'<h3>Evaluations</h3>'+list(data.evaluations,e=>'<b>'+esc(e.evaluator||'agent')+'</b> '+esc(e.comment||''));$('detail').classList.add('open');$('startFromIdea').onclick=()=>openSession(id)}catch(e){showError(e)}}
function list(items,render){return items&&items.length?items.map(x=>'<div class="listItem">'+render(x)+'</div>').join(''):'<div class="empty">なし</div>'}
function renderRuns(){const ordered=[...runs].sort((a,b)=>(a.status==='active'?-1:0)-(b.status==='active'?-1:0)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));$('runStatus').textContent=ordered.filter(r=>r.status==='active').length+' active / '+ordered.length+' total';$('runList').innerHTML=ordered.length?ordered.map(r=>'<div class="run '+esc(r.status||'')+'" data-run="'+esc(r.id)+'"><div class="runTitle">'+esc(r.objective||'Untitled session')+'</div><div class="meta">'+esc(r.agent||'agent')+' · '+esc(r.status||'active')+' · '+fmt(r.updatedAt||r.startedAt)+'</div></div>').join(''):'<div class="empty">セッションはまだありません</div>';document.querySelectorAll('[data-run]').forEach(el=>el.addEventListener('click',()=>selectRun(el.dataset.run)))}
function selectRun(id){selectedRun=runs.find(r=>r.id===id);if(!selectedRun)return;const prompt='@my-portal この作業セッションを継続してください。\\nSession ID: '+selectedRun.id+'\\n目的: '+(selectedRun.objective||'')+'\\n指示: '+(selectedRun.instructions||'')+'\\nSeed Idea IDs: '+(selectedRun.seedIdeaIds||[]).join(', ');$('runInspector').innerHTML='<div class="runTitle">'+esc(selectedRun.objective)+'</div><div class="chips"><span class="chip">'+esc(selectedRun.status)+'</span><span class="chip">rev '+esc(selectedRun.revision||1)+'</span></div><h3>Instructions</h3><div class="body">'+esc(selectedRun.instructions||'—')+'</div><h3>Findings</h3>'+list(selectedRun.findings,x=>esc(x))+'<h3>Next actions</h3>'+list(selectedRun.nextActions,x=>esc(x))+'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="secondary" id="copyRun">ChatGPT再開文をコピー</button>'+(selectedRun.status==='active'?'<button class="primary" id="finishRun">完了にする</button>':'')+'</div>';$('copyRun').onclick=async()=>{await navigator.clipboard.writeText(prompt);$('copyRun').textContent='コピーしました'};if($('finishRun'))$('finishRun').onclick=()=>finishRun(selectedRun.id)}
function openSession(seed=''){$('seedIdeaId').value=seed||'';$('objective').value=seed&&selectedIdea?'「'+(selectedIdea.title||'このアイデア')+'」をさらに展開する':'';$('instructions').value='';$('sessionDialog').showModal()}
async function createSession(event){event.preventDefault();try{const seed=$('seedIdeaId').value;const run=await api('/api/agent-ideas/runs',{method:'POST',body:JSON.stringify({objective:$('objective').value,instructions:$('instructions').value,seedIdeaIds:seed?[seed]:[],agent:'portal-session',trigger:'manual'})});$('sessionDialog').close();await loadRuns();selectRun(run.id);switchTab('sessions')}catch(e){showError(e)}}
async function finishRun(id){const findings=prompt('今回の主な発見（任意）')||'';const next=prompt('次にやること（任意）')||'';try{await api('/api/agent-ideas/runs/'+encodeURIComponent(id)+'/finish',{method:'POST',body:JSON.stringify({status:'completed',findings:findings?[findings]:[],nextActions:next?[next]:[]})});await loadRuns();selectRun(id)}catch(e){showError(e)}}
async function loadIdeas(){try{const data=await api('/api/agent-ideas/ideas?limit=120');ideas=data.items||[];renderIdeas()}catch(e){showError(e)}}
async function loadRuns(){try{runs=await api('/api/agent-ideas/runs?limit=100');renderRuns()}catch(e){showError(e)}}
function switchTab(name){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));$('ideasView').hidden=name!=='ideas';$('sessionsView').hidden=name!=='sessions';if(name==='sessions')loadRuns()}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));$('search').oninput=renderIdeas;$('statusFilter').onchange=renderIdeas;$('detailClose').onclick=()=>$('detail').classList.remove('open');$('newSession').onclick=()=>openSession();$('newSessionFromIdeas').onclick=()=>openSession(selectedIdea?.id||'');$('cancelSession').onclick=()=>$('sessionDialog').close();$('sessionForm').onsubmit=createSession;loadIdeas();loadRuns();
</script>
</body></html>`;
}

async function routeApi(request: Request, url: URL) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
  try {
    ensureFirebaseAdmin();
    const path = url.pathname;

    if (path === "/api/agent-ideas/ideas" && request.method === "GET") {
      const result = await store.ideaSearch({
        query: url.searchParams.get("q") || undefined,
        status: url.searchParams.get("status") || undefined,
        maturity: url.searchParams.get("maturity") || undefined,
        limit: Number(url.searchParams.get("limit")) || 120,
        scanLimit: 500,
      });
      return json(result);
    }

    const ideaMatch = path.match(/^\/api\/agent-ideas\/ideas\/([^/]+)$/);
    if (ideaMatch && request.method === "GET") {
      return json(await store.ideaGetContext({
        id: decodeURIComponent(ideaMatch[1]),
        depth: 1,
        includeSources: true,
        includeEvaluations: true,
        includeRuns: true,
        includeArtifacts: true,
      }));
    }

    if (path === "/api/agent-ideas/runs" && request.method === "GET") {
      return json(await listRuns(url));
    }

    if (path === "/api/agent-ideas/runs" && request.method === "POST") {
      const body = await bodyObject(request);
      return json(await store.runStart({
        objective: body.objective,
        instructions: body.instructions || "",
        seedIdeaIds: Array.isArray(body.seedIdeaIds) ? body.seedIdeaIds : [],
        agent: body.agent || "portal-session",
        trigger: body.trigger || "manual",
        metadata: { source: "my-portal-ui" },
      }), 201);
    }

    const finishMatch = path.match(/^\/api\/agent-ideas\/runs\/([^/]+)\/finish$/);
    if (finishMatch && request.method === "POST") {
      const body = await bodyObject(request);
      return json(await store.runFinish({
        id: decodeURIComponent(finishMatch[1]),
        status: body.status || "completed",
        findings: Array.isArray(body.findings) ? body.findings : [],
        nextActions: Array.isArray(body.nextActions) ? body.nextActions : [],
        metadataPatch: { finishedFrom: "my-portal-ui" },
      }));
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export default async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/agent-ideas/")) return routeApi(request, url);

  if (url.pathname === "/agent-ideas/login" && request.method === "POST") {
    const body = await bodyObject(request);
    if (!sameAccessKey(String(body.access_key || ""))) {
      return new Response(loginPage("アクセスキーが違います。"), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/agent-ideas",
        "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(signSession())}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`,
      },
    });
  }

  if (url.pathname === "/agent-ideas/logout" && request.method === "POST") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/agent-ideas",
        "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    });
  }

  if (url.pathname === "/agent-ideas") {
    const html = authorized(request) ? appPage() : loginPage();
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  return json({ error: "Not found" }, 404);
};

export const config = {
  path: [
    "/agent-ideas",
    "/agent-ideas/login",
    "/agent-ideas/logout",
    "/api/agent-ideas/*",
  ],
};
