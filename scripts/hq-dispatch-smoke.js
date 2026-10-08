'use strict';
const assert = require('node:assert/strict');
const { inTokyo, dueForJob, buildDispatchPlan } = require('../functions/hqDispatcher');

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
console.log('Agent HQ unified dispatch smoke passed: ownership, timezone, due, dedupe, capacity');
