'use strict';

const { getDocumentDb } = require('./documentDb');
const JOBS = 'memos/agent-control/routineJobs';
const RUNS = 'memos/agent-control/routineJobRuns';
const DATABASE = process.env.AGENT_IDEAS_DATABASE_ID || '(default)';
const MAX_WINDOW_MINUTES = 120;
const RUNNER_SLOTS = Object.freeze(['04:30','10:30','16:30']);
const MAX_JOBS_PER_TICK = 3;
const PRIORITIES = Object.freeze({critical:0,normal:1,background:2});

function db() { return getDocumentDb(DATABASE); }
function text(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }
function validId(id) { if (!/^[a-z][a-z0-9-]{2,79}$/.test(id)) throw new Error('Invalid routine job ID'); return id; }
function jst(now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid time');
  const local = new Date(date.getTime() + 9 * 3600000);
  return { day: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}
function validateSlots(slots) {
  if (!Array.isArray(slots) || !slots.length || slots.length > 24) throw new Error('slots must contain 1 to 24 HH:MM values');
  const unique = [...new Set(slots)];
  for (const value of unique) {
    if (typeof value !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) throw new Error('Invalid slot: ' + value);
  }
  return unique.sort();
}
function seedDraftJob() {
  return {
    id: 'tweets-draft-replenishment', title: 'SNS下書き補充',
    status: 'active', targetSystem: 'Tweets Operator',
    slots: ['04:30', '10:30', '16:30'], timeZone: 'Asia/Tokyo',
    description: '自動投稿有効アカウントの現行キャラクター下書きを、最大在庫5件まで不足分だけ補充する。SNSへの公開はしない。',
    instructions: [
      'Tweets Operatorで1回の下書き補充を実行する。',
      '1. get_system_health、list_accountsを読み、autoPostEnabled=trueのアカウントだけを対象にする。',
      '2. 各対象にget_generation_workを実行し、neededCountが1以上の場合だけget_accountで最新のキャラクター設定、文体、文字数、禁止事項を確認する。',
      '3. 一度に処理するのは最大20アカウント。neededCountと同じ件数の独自で重複しない日本語下書きを作成する。上限は各アカウント5件。',
      '4. create_draftsにはget_generation_workのcharacterVersionをexpectedCharacterVersionとして指定する。idempotencyKeyは実行枠・アカウント単位で安定させ、保存不明の再試行で新しいキーを生成しない。',
      '5. 保存後にget_generation_workで在庫を再確認する。十分な在庫の場合は何も書き込まない。',
      '6. publish_draft、sync_posts、update_account、delete_draft、delete_guidance、archive_productは絶対に呼ばない。投稿・公開は禁止。',
      '7. 認証情報、アクセストークン、非公開URLを報告や下書きへ出力しない。',
      '8. 実際に保存したアカウントID、件数、確認後の在庫を結果に記録する。認証失敗、世代競合、保存失敗、文字数超過、類似判定による拒否は原因と対象だけを報告する。'
    ].join('\n'),
    maxAccountsPerRun: 20, priority: 'critical', revision: 1,
  };
}
async function ensureSeed() {
  const database = db();
  const ref = database.collection(JOBS).doc('tweets-draft-replenishment');
  const existing = await ref.get();
  if (existing.exists) return;
  await database.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists) tx.set(ref, { ...seedDraftJob(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), seedVersion: 1 });
  });
}
async function list(input = {}) {
  await ensureSeed();
  const result = await db().collection(JOBS).limit(100).get();
  const items = result.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => a.id.localeCompare(b.id));
  const slotLoads = Object.fromEntries(RUNNER_SLOTS.map(slot => [slot, {active:items.filter(j=>j.status==='active' && j.slots?.includes(slot)).length,capacity:MAX_JOBS_PER_TICK}]));
  return { items, slotLoads, runnerSlots:RUNNER_SLOTS, maxJobsPerTick:MAX_JOBS_PER_TICK, timeZone: 'Asia/Tokyo', windowMinutes: MAX_WINDOW_MINUTES };
}
async function upsert(input = {}) {
  await ensureSeed();
  const id = validId(text(input.id, 80));
  const database = db(), ref = database.collection(JOBS).doc(id);
  const expectedRevision = input.expectedRevision == null ? null : Number(input.expectedRevision);
  if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) throw new Error('Invalid revision');
  return database.runTransaction(async (tx) => {
    const snap = await tx.get(ref), previous = snap.exists ? snap.data() : null;
    if (previous && expectedRevision !== previous.revision) throw new Error('Routine job revision mismatch');
    if (!previous && expectedRevision !== null) throw new Error('Routine job does not exist');
    const title = text(input.title ?? previous?.title, 180);
    const instructions = text(input.instructions ?? previous?.instructions, 12000);
    const status = text(input.status ?? previous?.status ?? 'paused', 20);
    const slots = validateSlots(input.slots ?? previous?.slots);
    if (!title || !instructions) throw new Error('Title and instructions are required');
    if (!['active', 'paused'].includes(status)) throw new Error('Invalid routine job status');
    const priority = text(input.priority ?? previous?.priority ?? (id==='tweets-draft-replenishment'?'critical':'normal'), 20);
    if (!(priority in PRIORITIES)) throw new Error('Invalid priority; choose critical, normal, or background');
    if (status==='active') {
      const unsupported = slots.filter(slot=>!RUNNER_SLOTS.includes(slot));
      if (unsupported.length) throw new Error('No ChatGPT runner is configured for '+unsupported.join(', ')+'; allowed: '+RUNNER_SLOTS.join(', '));
      const scheduleSnap = await tx.get(database.collection(JOBS).limit(100));
      for (const slot of slots) {
        const competing=scheduleSnap.docs.filter(d=>d.id!==id && d.data().status==='active' && d.data().slots?.includes(slot));
        if (competing.length>=MAX_JOBS_PER_TICK) throw new Error(slot+' is full ('+MAX_JOBS_PER_TICK+'/'+MAX_JOBS_PER_TICK+'); pause or reschedule another job before enabling this slot');
      }
    }
    const next = {
      id, title, description: text(input.description ?? previous?.description, 1000),
      instructions, targetSystem: text(input.targetSystem ?? previous?.targetSystem, 120),
      status, slots, timeZone: 'Asia/Tokyo', priority,
      maxAccountsPerRun: Math.max(1, Math.min(50, Number(input.maxAccountsPerRun ?? previous?.maxAccountsPerRun ?? 10) || 10)),
      revision: (previous?.revision || 0) + 1,
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tx.set(ref, next);
    return next;
  });
}
function candidate(job, local) {
  if (job.status !== 'active') return null;
  const slot = (job.slots || []).filter((value) => {
    const [h, m] = value.split(':').map(Number);
    const offset = local.minute - (h * 60 + m);
    return offset >= 0 && offset < MAX_WINDOW_MINUTES;
  }).sort().pop();
  if (!slot) return null;
  return { slotKey: local.day + '@' + slot, runId: job.id + '--' + local.day.replace(/-/g, '') + '--' + slot.replace(':', '') };
}
async function due(input = {}) {
  const now = input.at ? new Date(input.at).getTime() : Date.now();
  const local = jst(now), state = await list();
  const candidates = state.items.map(job=>({job,slot:candidate(job,local)})).filter(item=>item.slot);
  // Fetch slot claims concurrently; ordering by priority avoids starving stock refills
  // or once-daily tasks when multiple jobs are eligible.
  const claims = await Promise.all(candidates.map(({slot})=>db().collection(RUNS).doc(slot.runId).get()));
  const items = candidates.filter((_,i)=>!claims[i].exists)
    .sort((a,b)=>(PRIORITIES[a.job.priority??(a.job.id==='tweets-draft-replenishment'?'critical':'normal')]??1)-(PRIORITIES[b.job.priority??(b.job.id==='tweets-draft-replenishment'?'critical':'normal')]??1)
      || (a.job.slots?.length||3)-(b.job.slots?.length||3)
      || a.job.id.localeCompare(b.job.id))
    .map(({job,slot})=>({...job,...slot}));
  return { generatedAt:new Date(now).toISOString(),timeZone:'Asia/Tokyo',items,
    slotLoads:state.slotLoads,capacity:MAX_JOBS_PER_TICK,
    totalActive:state.items.filter(j=>j.status==='active').length };
}
async function claim(input = {}) {
  await ensureSeed();
  const id = validId(text(input.id, 80)), agent = text(input.agent, 120), requestedKey = text(input.slotKey, 32);
  if (!agent || !requestedKey) throw new Error('Agent and slotKey required');
  const local = jst(Date.now()), database = db();
  const jobRef = database.collection(JOBS).doc(id);
  return database.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new Error('Routine job not found');
    const job = snap.data(), slot = candidate(job, local);
    if (!slot || slot.slotKey !== requestedKey) throw new Error('Job not due in current schedule window');
    const runRef = database.collection(RUNS).doc(slot.runId);
    const previous = await tx.get(runRef);
    if (previous.exists) return { claimed: false, run: { id: slot.runId, ...previous.data() }, reason: 'already_claimed' };
    const run = { id: slot.runId, jobId: id, slotKey: slot.slotKey, status: 'running', agent, runnerId: text(input.runnerId, 120), jobRevision: job.revision, startedAt: new Date().toISOString(), finishedAt: null };
    tx.set(runRef, run);
    return { claimed: true, run, job };
  });
}
async function finish(input = {}) {
  const id = text(input.runId, 180), agent = text(input.agent, 120);
  const status = text(input.status, 20);
  if (!id || !agent || !['completed','failed'].includes(status)) throw new Error('runId, agent and completed/failed status required');
  const resultSummary = text(input.resultSummary, 3000);
  const validation = text(input.validation, 3000);
  if (status === 'completed' && !validation) throw new Error('Successful runs require validation evidence');
  if (status === 'failed' && !resultSummary) throw new Error('Failed runs require an error summary');
  const database = db(), ref = database.collection(RUNS).doc(id);
  return database.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Run not found');
    const run = snap.data();
    if (run.agent !== agent) throw new Error('Run is owned by another agent');
    if (run.status !== 'running') return { run, changed: false };
    const patch = { status, resultSummary, validation, result: input.result && typeof input.result === 'object' ? input.result : {}, finishedAt: new Date().toISOString() };
    tx.update(ref, patch);
    return { run: { ...run, ...patch }, changed: true };
  });
}
async function runs(input = {}) {
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 30));
  // A dashboard request for 30 rows must not read 300 Firestore documents.
  const scanLimit = input.jobId ? 300 : Math.min(300,Math.max(30,limit));
  const result = await db().collection(RUNS).orderBy('startedAt', 'desc').limit(scanLimit).get();
  const items = result.docs.map((snap) => ({ id: snap.id, ...snap.data() }))
    .filter((run) => !input.jobId || run.jobId === input.jobId)
    .sort((a,b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit)
    .map(run=>({...run,stalled:run.status==='running' && Date.now()-Date.parse(run.startedAt)>3*60*60*1000}));
  return { items, readLimit:scanLimit };
}
module.exports = { list, upsert, due, claim, finish, runs, RUNNER_SLOTS, MAX_JOBS_PER_TICK, candidate, validateSlots, jst };
