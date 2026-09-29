const MATERIAL_ACTION_TYPES = new Set([
  'content_revision', 'internal_link', 'new_article', 'technical_fix', 'merge_prune',
]);

function managerJobRequiresReceipt(job) {
  return job?.requireExecutionReceipt === undefined
    ? job?.metadata?.requireExecutionReceipt === true
    : job.requireExecutionReceipt === true;
}

function requiredText(value, field, minLength = 1) {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(`SEO Manager Work Items require ${field}`);
  }
}

function requiredStringArray(value, field) {
  if (!Array.isArray(value) || !value.some((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`SEO Manager Work Items require metadata.execution.${field}`);
  }
}

function requiredHttpsUrl(value, field) {
  requiredText(value, field);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`SEO Manager Work Items require a valid HTTPS ${field}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`SEO Manager Work Items require a valid HTTPS ${field}`);
  return parsed;
}

/**
 * Fail closed when an action-first SEO Manager tries to create agent work that
 * has no concrete, evidence-backed outcome or executable validation contract.
 */
function validateSeoManagerWorkItem(input, job) {
  if (job?.metadata?.stabilization?.mode !== 'action-first' || !managerJobRequiresReceipt(job)) return;
  if ((input.executionMode || 'agent') === 'human') return;

  requiredText(input.reason, 'a decision reason tied to the observed opportunity', 40);
  requiredText(input.objective, 'objective', 20);
  requiredText(input.instructions, 'instructions', 80);

  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const execution = metadata.execution && typeof metadata.execution === 'object' && !Array.isArray(metadata.execution)
    ? metadata.execution
    : {};
  const actionType = String(metadata.actionType || '').trim();
  const allowedActionTypes = Array.isArray(job.allowedActionTypes)
    ? job.allowedActionTypes
    : (job.metadata?.allowedActionTypes || []);
  if (!allowedActionTypes.includes(actionType)) {
    throw new Error('SEO Manager Work Items require a configured metadata.actionType');
  }
  requiredText(execution.validationStrategy, 'validationStrategy');
  requiredText(execution.boundedScope, 'boundedScope', 20);

  const evidence = execution.evidence;
  if (!Array.isArray(evidence) || !evidence.some((entry) =>
    entry && typeof entry === 'object'
    && typeof entry.source === 'string' && entry.source.trim()
    && typeof entry.finding === 'string' && entry.finding.trim().length >= 20
  )) {
    throw new Error('SEO Manager Work Items require source-backed metadata.execution.evidence');
  }

  if (actionType === 'verification_only') {
    const target = requiredHttpsUrl(execution.targetUrl, 'targetUrl');
    const marker = requiredHttpsUrl(execution.markerUrl, 'markerUrl');
    if (marker.origin !== target.origin) {
      throw new Error('SEO Manager Work Items require markerUrl on the same registered host as targetUrl');
    }
    requiredText(execution.markerWorkItemId, 'markerWorkItemId');
    if (typeof execution.mergedCommitSha !== 'string' || !/^[0-9a-f]{40}$/i.test(execution.mergedCommitSha)) {
      throw new Error('SEO Manager Work Items require a full mergedCommitSha');
    }
    requiredText(execution.expectedTitle, 'expectedTitle');
    requiredText(execution.expectedH1, 'expectedH1');
    return;
  }

  if (!MATERIAL_ACTION_TYPES.has(actionType)) {
    throw new Error('SEO Manager Work Items must change a material artifact or verify an already deployed change');
  }
  if (execution.mutationAllowed !== true) {
    throw new Error('SEO Manager action Work Items require metadata.execution.mutationAllowed=true');
  }
  requiredText(execution.primaryRepo, 'primaryRepo');
  requiredStringArray(execution.relevantPaths, 'relevantPaths');
  if (execution.relevantPaths.some((path) => ['*', '**', '.', './'].includes(String(path).trim()))) {
    throw new Error('SEO Manager Work Items require specific relevantPaths, not a repository-wide placeholder');
  }
  requiredStringArray(execution.acceptanceCriteria, 'acceptanceCriteria');
}

module.exports = { validateSeoManagerWorkItem };
