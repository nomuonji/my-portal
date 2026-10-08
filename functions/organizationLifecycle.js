'use strict';

// Pure policy, shared by the registry and a deterministic lifecycle check.
// An independent organization has no My Portal execution owner.
const STATES = Object.freeze(['incubating', 'graduation_ready', 'independent', 'archived']);
const MANAGED_STATES = Object.freeze(['incubating', 'graduation_ready']);

function isManaged(state) {
  return MANAGED_STATES.includes(state);
}

function assertCanManage(organization) {
  if (!organization || !isManaged(organization.status)) {
    throw new Error('ORGANIZATION_NOT_HQ_MANAGED: HQ cannot schedule or delegate for an independent, archived, or unknown organization');
  }
}

function validateLifecycleTransition(current, next) {
  if (!STATES.includes(next)) throw new Error('Invalid organization lifecycle state: ' + next);
  if (current === next) return;
  if (current === 'independent') throw new Error('INDEPENDENT_ORGANIZATION_IMMUTABLE: detached organizations are not controlled by Agent HQ');
  if (next === 'independent') throw new Error('Use organization_graduate with evidence and no open HQ work');
  const transitions = {
    incubating: ['graduation_ready', 'archived'],
    graduation_ready: ['incubating', 'archived'],
    archived: ['incubating'],
  };
  if (!(transitions[current] || []).includes(next)) {
    throw new Error('Invalid organization lifecycle transition: ' + current + ' -> ' + next);
  }
}

function validateGraduation({ organization, managerJobs = [], managerRuns = [], workItems = [], handoff }) {
  if (organization?.status !== 'graduation_ready') {
    throw new Error('Graduation requires graduation_ready');
  }
  if (!handoff || !handoff.targetSystem || !handoff.canonicalOwner
      || !handoff.evidence?.length || !handoff.humanApproval || !handoff.verifiedAt) {
    throw new Error('Graduation requires verified handoff, canonical owner, evidence and explicit human approval');
  }
  if (managerJobs.some(job => job.status === 'active')) {
    throw new Error('Graduation blocked: an HQ Manager Job is still active');
  }
  const jobIds = new Set(managerJobs.map(job => job.id));
  if (managerRuns.some(run => jobIds.has(run.managerJobId) && ['ready', 'running'].includes(run.status))) {
    throw new Error('Graduation blocked: an HQ Manager Run is still open');
  }
  if (workItems.some(item => jobIds.has(item.sourceId) && item.sourceType === 'manager_job'
      && !['archived', 'done', 'cancelled'].includes(item.status))) {
    throw new Error('Graduation blocked: HQ Worker tasks remain open; migrate or close them first');
  }
}

module.exports = { STATES, MANAGED_STATES, isManaged, assertCanManage, validateLifecycleTransition, validateGraduation };
