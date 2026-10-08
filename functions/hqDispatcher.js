'use strict';

// The external scheduler is a transport, not a source of business policy.
// The only dispatchable entities are active HQ-owned incubating Manager Jobs
// explicitly opted into metadata.hqDispatch.
const VALID_STATES = new Set(['incubating', 'graduation_ready']);
const { staleRunsForJob, recoveryAlreadyStartedToday } = require('./managerRunRecovery');

function inTokyo(atMs) {
  if (!Number.isFinite(atMs)) throw new Error('Invalid dispatch timestamp');
  // Japan has no daylight saving time. Keep the MVP's timezone explicit,
  // rather than accepting arbitrary timezones in an unvalidated policy.
  const local = new Date(atMs + 9 * 60 * 60 * 1000);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function dueForJob(job, owner, atMs) {
  const config = job?.metadata?.hqDispatch;
  if (!config || config.enabled !== true) return { due: false, reason: 'not_opted_in' };
  if (job.status !== 'active') return { due: false, reason: 'manager_not_active' };
  if (!job.organizationId || !owner || owner.id !== job.organizationId || !VALID_STATES.has(owner.status)
      || owner.controlPlane !== 'my-portal-agent-hq') {
    return { due: false, reason: 'organization_not_hq_managed' };
  }
  if (config.frequency !== 'daily' || config.timeZone !== 'Asia/Tokyo'
      || !Number.isInteger(config.localHour) || config.localHour < 0 || config.localHour > 23) {
    return { due: false, reason: 'invalid_dispatch_policy' };
  }
  const local = inTokyo(atMs);
  if (local.hour < config.localHour) return { due: false, reason: 'not_yet_due' };
  const lastMs = millis(job.lastStartedAt);
  if (lastMs && inTokyo(lastMs).day >= local.day) return { due: false, reason: 'already_started_this_local_day' };
  return {
    due: true,
    reason: 'due',
    id: job.id,
    organizationId: job.organizationId,
    projectId: job.projectId || null,
    managerMethodId: job.methodId || null,
    priority: job.priority || 'medium',
    localDay: local.day,
    localHour: config.localHour,
    invocationId: 'agent-hq-dispatch:' + job.id + ':' + local.day,
  };
}

function buildDispatchPlan(jobs, organizations, atMs = Date.now(), limit = 10, managerRuns = []) {
  const owners = new Map(organizations.map(o => [o.id, o]));
  const checked = jobs.filter(job => job?.metadata?.hqDispatch?.enabled === true)
    .map(job => {
      const normal = dueForJob(job, owners.get(job.organizationId), atMs);
      if (normal.due || normal.reason !== 'already_started_this_local_day') {
        return { jobId: job.id, ...normal };
      }
      // A Manager started earlier today but did not finish. Recover once at
      // the next eligible dispatcher tick, instead of losing the entire day.
      const stale = staleRunsForJob(managerRuns, job.id, atMs);
      const localDay = inTokyo(atMs).day;
      if (!stale.length || recoveryAlreadyStartedToday(managerRuns, job.id, localDay, inTokyo)) {
        return { jobId: job.id, ...normal };
      }
      const oldest = stale.sort((a, b) => millis(a.createdAt) - millis(b.createdAt))[0];
      return {
        jobId: job.id, due: true, reason: 'stale_manager_run_recovery',
        id: job.id, organizationId: job.organizationId,
        projectId: job.projectId || null, managerMethodId: job.methodId || null,
        priority: job.priority || 'medium', localDay,
        localHour: job.metadata.hqDispatch.localHour, staleManagerRunId: oldest.id,
        invocationId: 'agent-hq-dispatch:' + job.id + ':' + localDay + ':recovery:' + oldest.id,
      };
    });
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const due = checked.filter(item => item.due)
    .sort((a, b) => a.localHour - b.localHour
      || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2)
      || a.id.localeCompare(b.id));
  return {
    localDay: inTokyo(atMs).day,
    dueManagerJobs: due.slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50)),
    deferredCount: Math.max(due.length - Math.min(Math.max(Number(limit) || 10, 1), 50), 0),
    skipped: checked.filter(item => !item.due).map(item => ({ id: item.jobId, reason: item.reason })),
  };
}

function selectWorkerDispatch(items, jobs, organizations, limit = 3) {
  const owners = new Map(organizations.map(owner => [owner.id, owner]));
  const dispatchable = new Set(jobs.filter(job =>
    job.status === 'active'
    && job.metadata?.hqDispatch?.enabled === true
    && job.organizationId
    && VALID_STATES.has(owners.get(job.organizationId)?.status)
    && owners.get(job.organizationId)?.controlPlane === 'my-portal-agent-hq'
  ).map(job => job.id));
  const priority = { critical: 0, high: 1, medium: 2, low: 3 };
  return items.filter(item => item.sourceType === 'manager_job' &&
      dispatchable.has(item.sourceId) && (item.executionMode || 'agent') === 'agent'
      && ['ready', 'in_progress'].includes(item.status) && !item.claimedBy)
    .sort((a, b) => (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2)
      || String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
    .slice(0, Math.min(Math.max(Number(limit) || 3, 1), 20))
    .map(item => ({
      id: item.id,
      managerJobId: item.sourceId,
      projectId: item.projectId || null,
      status: item.status,
      workerMethodId: item.workerMethodId || item.metadata?.workerMethodId || null,
    }));
}

module.exports = { inTokyo, dueForJob, buildDispatchPlan, selectWorkerDispatch };
