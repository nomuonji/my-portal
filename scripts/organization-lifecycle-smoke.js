'use strict';

const assert = require('node:assert/strict');
const policy = require('../functions/organizationLifecycle');

const organization = { status: 'graduation_ready' };
const handoff = {
  targetSystem: 'independent-operator',
  canonicalOwner: 'independent manager',
  verifiedAt: '2026-10-08T00:00:00Z',
  humanApproval: 'human-approved handoff',
  evidence: ['independent scheduler stopped old runner; target verified'],
};
function mustReject(fn, pattern) {
  assert.throws(fn, pattern);
}

assert.equal(policy.isManaged('incubating'), true);
assert.equal(policy.isManaged('graduation_ready'), true);
assert.equal(policy.isManaged('independent'), false);
mustReject(() => policy.assertCanManage({ status: 'independent' }), /ORGANIZATION_NOT_HQ_MANAGED/);
mustReject(() => policy.validateLifecycleTransition('incubating', 'independent'), /organization_graduate/);
mustReject(() => policy.validateLifecycleTransition('independent', 'incubating'), /IMMUTABLE/);

mustReject(() => policy.validateGraduation({
  organization, managerJobs: [{ id: 'j1', status: 'active' }], handoff,
}), /Manager Job is still active/);
mustReject(() => policy.validateGraduation({
  organization, managerJobs: [{ id: 'j1', status: 'paused' }],
  managerRuns: [{ managerJobId: 'j1', status: 'running' }], handoff,
}), /Manager Run is still open/);
mustReject(() => policy.validateGraduation({
  organization, managerJobs: [{ id: 'j1', status: 'paused' }],
  workItems: [{ sourceType: 'manager_job', sourceId: 'j1', status: 'review' }], handoff,
}), /Worker tasks remain open/);
mustReject(() => policy.validateGraduation({
  organization, handoff: { ...handoff, humanApproval: '' },
}), /human approval/);
mustReject(() => policy.validateGraduation({
  organization: { status: 'incubating' }, handoff,
}), /graduation_ready/);

assert.doesNotThrow(() => policy.validateGraduation({
  organization,
  managerJobs: [{ id: 'j1', status: 'paused' }],
  managerRuns: [{ managerJobId: 'j1', status: 'completed' }],
  workItems: [{ sourceType: 'manager_job', sourceId: 'j1', status: 'archived' }],
  handoff,
}));
console.log('Organization ownership/graduation regression check passed');
