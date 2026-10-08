'use strict';

// Shared policy for Manager Run lease recovery. Detection is pure and has no
// database side effects, so the dispatcher and manager_job_start agree.
const MISSING_LEASE_GRACE_MS = 2 * 60 * 60 * 1000;
function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'object' && typeof value.seconds === 'number') return value.seconds * 1000;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function staleManagerRunReason(run, atMs = Date.now()) {
  if (run?.status === 'ready' && !run.claimedBy) {
    const created = millis(run.createdAt);
    return created > 0 && created + MISSING_LEASE_GRACE_MS <= atMs ? 'unclaimed_ready_timeout' : null;
  }
  if (run?.status !== 'running') return null;
  const lease = millis(run.leaseExpiresAt);
  if (lease > 0) return lease <= atMs ? 'expired_lease' : null;
  // Old records without a lease are not immediately declared dead.
  const last = millis(run.lastHeartbeatAt) || millis(run.startedAt) || millis(run.updatedAt);
  return last > 0 && last + MISSING_LEASE_GRACE_MS <= atMs ? 'missing_lease_timeout' : null;
}

function staleRunsForJob(runs, jobId, atMs = Date.now()) {
  return (runs || []).filter(run =>
    run.managerJobId === jobId && staleManagerRunReason(run, atMs)
  );
}

function recoveryAlreadyStartedToday(runs, jobId, localDay, inTokyo) {
  return (runs || []).some(run =>
    run.managerJobId === jobId
    && typeof run.invocationId === 'string'
    && run.invocationId.includes(':recovery:')
    && millis(run.createdAt) > 0
    && inTokyo(millis(run.createdAt)).day === localDay
  );
}

module.exports = { millis, staleManagerRunReason, staleRunsForJob, recoveryAlreadyStartedToday };
