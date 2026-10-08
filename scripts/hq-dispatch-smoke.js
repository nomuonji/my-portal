'use strict';
const assert = require('node:assert/strict');
const { inTokyo, dueForJob, buildDispatchPlan, selectWorkerDispatch } = require('../functions/hqDispatcher');

const at = Date.parse('2026-10-09T06:05:00Z'); // 15:05 in Tokyo
const beforeCulture = Date.parse('2026-10-08T23:01:00Z'); // 08:01 next day
const culture = {
  id: 'culture-institute-manager', status: 'active', organizationId: 'culture-institute',
  methodId: 'culture-method', metadata: { hqDispatch: { enabled: true, frequency: 'daily', timeZone: 'Asia/Tokyo', localHour: 8 } },
  lastStartedAt: '2026-10-08T03:22:00Z',
};
const knowledge = {
  id: 'knowledge-institute-manager', status: 'active', organizationId: 'knowledge-institute',
  metadata: { hqDispatch: { enabled: true, frequency: 'daily', timeZone: 'Asia/Tokyo', localHour: 15 } },
  lastStartedAt: '2026-10-08T03:22:00Z',
};
const seo = {
  id: 'site-seo-operations', status: 'active', organizationId: 'independent-seo',
  metadata: { hqDispatch: { enabled: true, frequency: 'daily', timeZone: 'Asia/Tokyo', localHour: 7 } },
};
const audit = { id: 'agent-hq-outcome-audit', status: 'active', metadata: {} };
const owners = [
  { id: 'culture-institute', status: 'incubating', controlPlane: 'my-portal-agent-hq' },
  { id: 'knowledge-institute', status: 'graduation_ready', controlPlane: 'my-portal-agent-hq' },
  { id: 'independent-seo', status: 'independent', controlPlane: 'sites-operator' },
];
const pair = [culture, knowledge, seo, audit];
assert.deepEqual(inTokyo(Date.parse('2026-10-08T23:00:00Z')), { day: '2026-10-09', hour: 8 });
assert.equal(buildDispatchPlan(pair, owners, Date.parse('2026-10-08T22:59:00Z')).dueManagerJobs.length, 0);
const morning = buildDispatchPlan(pair, owners, beforeCulture);
assert.deepEqual(morning.dueManagerJobs.map(o => o.id), [culture.id]);
const afternoon = buildDispatchPlan(pair, owners, at);
assert.deepEqual(afternoon.dueManagerJobs.map(o => o.id), [culture.id, knowledge.id]);
assert.equal(afternoon.dueManagerJobs[0].invocationId, 'agent-hq-dispatch:culture-institute-manager:2026-10-09');
assert.equal(afternoon.skipped.find(o => o.id === seo.id)?.reason, 'organization_not_hq_managed');
assert.equal(afternoon.deferredCount, 0);
assert.equal(buildDispatchPlan(pair, owners, at, 1).deferredCount, 1);

const after = { ...culture, lastStartedAt: '2026-10-09T00:10:00Z' };
assert.equal(dueForJob(after, owners[0], at).reason, 'already_started_this_local_day');
const graduated = { ...owners[0], status: 'independent' };
assert.equal(dueForJob(culture, graduated, at).reason, 'organization_not_hq_managed');
assert.equal(dueForJob({ ...culture, status: 'paused' }, owners[0], at).reason, 'manager_not_active');
assert.equal(dueForJob({ ...culture, metadata: { hqDispatch: { enabled: true, frequency: 'daily', timeZone: 'UTC', localHour: 8 } } }, owners[0], at).reason, 'invalid_dispatch_policy');
assert.equal(buildDispatchPlan([{ ...culture, metadata: {} }], owners, at).dueManagerJobs.length, 0);
const work = [
  { id: 'culture-open', status: 'ready', sourceType: 'manager_job', sourceId: culture.id, executionMode: 'agent', priority: 'medium' },
  { id: 'knowledge-open', status: 'in_progress', sourceType: 'manager_job', sourceId: knowledge.id, executionMode: 'agent', priority: 'high' },
  { id: 'seo-open', status: 'ready', sourceType: 'manager_job', sourceId: seo.id, executionMode: 'agent', priority: 'critical' },
  { id: 'unrelated', status: 'ready', sourceType: 'manual', sourceId: 'foo', executionMode: 'agent' },
  { id: 'claimed', status: 'ready', sourceType: 'manager_job', sourceId: culture.id, claimedBy: 'other-runner' },
  { id: 'human-only', status: 'ready', sourceType: 'manager_job', sourceId: culture.id, executionMode: 'human' },
];
assert.deepEqual(selectWorkerDispatch(work, pair, owners).map(w => w.id), ['knowledge-open', 'culture-open']);
assert.deepEqual(selectWorkerDispatch(work, pair, [{ ...owners[0], status: 'independent' }, owners[1]]).map(w => w.id), ['knowledge-open']);

const { staleManagerRunReason, staleRunsForJob, recoveryAlreadyStartedToday } = require('../functions/managerRunRecovery');
const atRecovery = Date.parse('2026-10-09T12:05:00Z'); // 21:05 JST, next dispatcher tick
const staleKnowledgeJob = { ...knowledge, lastStartedAt: '2026-10-09T06:05:00Z' };
const expiredManager = {
  id:'expired-mgr',managerJobId:knowledge.id,status:'running',claimedBy:'old-manager',
  createdAt:'2026-10-09T06:05:00Z',startedAt:'2026-10-09T06:05:10Z',
  leaseExpiresAt:'2026-10-09T07:00:00Z',createdWorkItemIds:['already-delegated'],
};
assert.equal(staleManagerRunReason(expiredManager,atRecovery),'expired_lease');
assert.equal(staleRunsForJob([expiredManager],knowledge.id,atRecovery).length,1);
assert.equal(staleManagerRunReason({ ...expiredManager,leaseExpiresAt:'2026-10-09T13:00:00Z' },atRecovery),null);
assert.equal(staleManagerRunReason({ ...expiredManager,status:'completed' },atRecovery),null);
assert.equal(staleManagerRunReason({ ...expiredManager,status:'ready',claimedBy:null },atRecovery),'unclaimed_ready_timeout');
assert.equal(staleManagerRunReason({ ...expiredManager,leaseExpiresAt:null,startedAt:'2026-10-09T09:00:00Z',lastHeartbeatAt:null },atRecovery),'missing_lease_timeout');
assert.equal(staleManagerRunReason({ ...expiredManager,leaseExpiresAt:null,startedAt:'2026-10-09T11:00:00Z',lastHeartbeatAt:null },atRecovery),null);
// Valid active leases and foreign organizations must never be superseded.
assert.equal(buildDispatchPlan([staleKnowledgeJob],owners,atRecovery,10,[{ ...expiredManager,leaseExpiresAt:'2026-10-09T13:00:00Z' }]).dueManagerJobs.length,0);
assert.equal(buildDispatchPlan([staleKnowledgeJob],owners,atRecovery,10,[]).dueManagerJobs.length,0);
const recover = buildDispatchPlan([staleKnowledgeJob],owners,atRecovery,10,[expiredManager]);
assert.equal(recover.dueManagerJobs.length,1);
assert.equal(recover.dueManagerJobs[0].reason,'stale_manager_run_recovery');
assert.equal(recover.dueManagerJobs[0].staleManagerRunId,'expired-mgr');
assert.equal(recover.dueManagerJobs[0].invocationId,'agent-hq-dispatch:knowledge-institute-manager:2026-10-09:recovery:expired-mgr');
const recoverAgain = { ...expiredManager,id:'recovery-attempt',invocationId:recover.dueManagerJobs[0].invocationId,createdAt:'2026-10-09T10:00:00Z' };
assert.equal(recoveryAlreadyStartedToday([recoverAgain],knowledge.id,'2026-10-09',inTokyo),true);
assert.equal(buildDispatchPlan([staleKnowledgeJob],owners,atRecovery,10,[expiredManager,recoverAgain]).dueManagerJobs.length,0);
assert.equal(buildDispatchPlan([staleKnowledgeJob],owners,atRecovery,10,[{
  ...expiredManager,status:'ready',claimedBy:null,leaseExpiresAt:null,
}]).dueManagerJobs.length,1);
assert.equal(buildDispatchPlan([staleKnowledgeJob],[{ ...owners[1],status:'independent' }],atRecovery,10,[expiredManager]).dueManagerJobs.length,0);
// Once the next local day is due, normal daily scheduling takes priority; no
// persistent block from a previous-day expired Manager.
const nextDay = Date.parse('2026-10-10T06:05:00Z');
assert.equal(buildDispatchPlan([staleKnowledgeJob],owners,nextDay,10,[expiredManager]).dueManagerJobs[0].reason,'due');

console.log('Agent HQ unified dispatch smoke passed: ownership, timezone, due, dedupe, worker scope, stale recovery');
