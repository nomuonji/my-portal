const MATERIAL_ACTION_TYPES = new Set([
  'content_revision', 'internal_link', 'new_article', 'technical_fix', 'merge_prune',
]);

function hasCommitEvidence(receipt) {
  return Array.isArray(receipt?.artifacts) && receipt.artifacts.some((artifact) =>
    /(?:^commit:|\/commit\/)[0-9a-f]{7,40}\b/i.test(String(artifact))
    || /^.+@[0-9a-f]{40}$/i.test(String(artifact))
  );
}

function isMaterialReceipt(item) {
  const receipt = item?.executionReceipt;
  return item?.metadata?.execution?.mutationAllowed !== false
    && MATERIAL_ACTION_TYPES.has(receipt?.actionType)
    && ['committed', 'live_verified'].includes(receipt?.deliveryStatus)
    && hasCommitEvidence(receipt);
}

function hasLiveEvidence(receipt) {
  return receipt?.deliveryStatus === 'live_verified'
    && Array.isArray(receipt.artifacts)
    && receipt.artifacts.some((artifact) => /^https:\/\//i.test(String(artifact)));
}

function trustedTargetProgress(job, workItems) {
  const progress = {};
  for (const [targetId, previous] of Object.entries(job.targetProgress || {})) {
    const { actionCount, lastActionAt, lastDeliveryStatus, lastLiveAt, ...other } = previous || {};
    progress[targetId] = { ...other, actionCount: 0 };
  }

  const completed = (workItems || [])
    .filter((item) => item.sourceType === 'manager_job' && item.sourceId === job.id)
    .filter((item) => ['in_progress', 'review', 'archived'].includes(item.status))
    .filter(isMaterialReceipt)
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));

  const countedIds = new Set();
  for (const item of completed) {
    if (item.id && countedIds.has(item.id)) continue;
    if (item.id) countedIds.add(item.id);
    const receipt = item.executionReceipt;
    const targetId = receipt.targetId;
    const previous = progress[targetId] || { actionCount: 0 };
    const deliveryStatus = hasLiveEvidence(receipt) ? 'live_verified' : 'committed';
    progress[targetId] = {
      ...previous,
      actionCount: Number(previous.actionCount || 0) + 1,
      lastActionAt: item.updatedAt || null,
      lastDeliveryStatus: deliveryStatus,
      ...(deliveryStatus === 'live_verified' ? { lastLiveAt: item.updatedAt || null } : {}),
    };
  }
  return progress;
}

module.exports = { isMaterialReceipt, hasLiveEvidence, hasCommitEvidence, MATERIAL_ACTION_TYPES, trustedTargetProgress };
