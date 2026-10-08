const CMS_ACTION_TYPES = new Set(['cms_publish', 'cms_update']);
const MATERIAL_ACTION_TYPES = new Set([
  'content_revision', 'internal_link', 'new_article', 'technical_fix', 'merge_prune',
  ...CMS_ACTION_TYPES,
]);

function hasCommitEvidence(receipt) {
  return Array.isArray(receipt?.artifacts) && receipt.artifacts.some((artifact) =>
    /(?:^commit:|\/commit\/)[0-9a-f]{7,40}\b/i.test(String(artifact))
    || /^.+@[0-9a-f]{40}$/i.test(String(artifact))
  );
}

// CMS deliveries have a published snapshot revision instead of a Git commit.
// This only counts readback-marked receipts; an internal artifact/draft is not a delivery.
function hasCmsEvidence(receipt) {
  if (!CMS_ACTION_TYPES.has(receipt?.actionType)) return false;
  if (!String(receipt.validation || '').includes('published_projection_readback_ok')) return false;
  const artifacts = Array.isArray(receipt.artifacts) ? receipt.artifacts : [];
  return artifacts.some((artifact) => {
    const match = /^cms:([a-z0-9_-]+):([a-z0-9][a-z0-9/-]*)@r([1-9][0-9]*)$/.exec(String(artifact));
    if (!match || match[1] !== receipt.targetId) return false;
    return artifacts.some((candidate) => {
      try {
        const url = new URL(candidate);
        return url.protocol === 'https:' && url.hostname === 'my-portal-agent.netlify.app'
          && url.pathname === '/api/public-content'
          && url.searchParams.get('site') === match[1]
          && url.searchParams.get('slug') === match[2];
      } catch { return false; }
    });
  });
}

function isMaterialReceipt(item) {
  const receipt = item?.executionReceipt;
  return item?.metadata?.execution?.mutationAllowed !== false
    && MATERIAL_ACTION_TYPES.has(receipt?.actionType)
    && ['committed', 'live_verified'].includes(receipt?.deliveryStatus)
    && (CMS_ACTION_TYPES.has(receipt?.actionType) ? hasCmsEvidence(receipt) : hasCommitEvidence(receipt));
}

function hasLiveEvidence(receipt) {
  if (receipt?.deliveryStatus !== 'live_verified' || !Array.isArray(receipt.artifacts)) return false;
  if (CMS_ACTION_TYPES.has(receipt.actionType)) {
    if (!String(receipt.validation || '').includes('live_html_readback_ok')) return false;
    return receipt.artifacts.some((artifact) => {
      try {
        const url = new URL(artifact);
        return url.protocol === 'https:' && url.hostname !== 'my-portal-agent.netlify.app'
          && url.pathname.startsWith('/features/');
      } catch { return false; }
    });
  }
  return receipt.artifacts.some((artifact) => /^https:\/\//i.test(String(artifact)));
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

module.exports = { isMaterialReceipt, hasLiveEvidence, hasCommitEvidence, hasCmsEvidence, CMS_ACTION_TYPES, MATERIAL_ACTION_TYPES, trustedTargetProgress };
