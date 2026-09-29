const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSeoManagerWorkItem } = require('./managerWorkItemPolicy');

const seoJob = {
  requireExecutionReceipt: true,
  allowedActionTypes: ['content_revision', 'technical_fix', 'verification_only'],
  metadata: { stabilization: { mode: 'action-first' } },
};

function action(overrides = {}) {
  return {
    title: 'Update the page using verified Search Console evidence',
    reason: 'Search Console shows 1,240 impressions and 0.4% CTR for this exact page/query pair; inspection confirms the section does not answer that query intent.',
    objective: 'Improve the named article section in response to a documented search performance issue.',
    instructions: 'Edit only the named article section, preserve its factual meaning, validate the build, commit the change, and verify the production URL and page metadata.',
    executionMode: 'agent',
    metadata: {
      actionType: 'content_revision',
      execution: {
        mutationAllowed: true,
        primaryRepo: 'owner/site',
        relevantPaths: ['src/content/article.md'],
        boundedScope: 'Update the H2 section about the exact observed user question.',
        acceptanceCriteria: ['The page directly answers the observed query intent.'],
        validationStrategy: 'Run the site build and verify the canonical production page.',
        evidence: [{ source: 'Search Console page/query export', finding: 'The target query has 1,240 impressions and 0.4% CTR over the last 28 days.' }],
      },
    },
    ...overrides,
  };
}

test('allows an evidence-backed, scoped material SEO change', () => {
  assert.doesNotThrow(() => validateSeoManagerWorkItem(action(), seoJob));
});

test('rejects an agent task without a material action type or source-backed finding', () => {
  const noReason = action({ reason: 'SEO work is needed.' });
  assert.throws(() => validateSeoManagerWorkItem(noReason, seoJob), /decision reason/);

  const noAction = action({ metadata: { execution: {} } });
  assert.throws(() => validateSeoManagerWorkItem(noAction, seoJob), /configured metadata.actionType/);

  const noEvidence = action({ metadata: { ...action().metadata, execution: { ...action().metadata.execution, evidence: [] } } });
  assert.throws(() => validateSeoManagerWorkItem(noEvidence, seoJob), /source-backed metadata.execution.evidence/);
});

test('rejects a material action without an explicit mutation target and acceptance criteria', () => {
  const unbounded = action({ metadata: { ...action().metadata, execution: { ...action().metadata.execution, relevantPaths: [], acceptanceCriteria: [] } } });
  assert.throws(() => validateSeoManagerWorkItem(unbounded, seoJob), /relevantPaths/);

  const noAcceptance = action({ metadata: { ...action().metadata, execution: { ...action().metadata.execution, acceptanceCriteria: [] } } });
  assert.throws(() => validateSeoManagerWorkItem(noAcceptance, seoJob), /acceptanceCriteria/);

  const readOnly = action({ metadata: { ...action().metadata, execution: { ...action().metadata.execution, mutationAllowed: false } } });
  assert.throws(() => validateSeoManagerWorkItem(readOnly, seoJob), /mutationAllowed=true/);
});

test('allows human-gated work and leaves non-SEO Manager jobs unchanged', () => {
  assert.doesNotThrow(() => validateSeoManagerWorkItem({ executionMode: 'human' }, seoJob));
  assert.doesNotThrow(() => validateSeoManagerWorkItem({}, { requireExecutionReceipt: true }));
});

test('verification-only work must identify the already deployed page, marker, and merged commit', () => {
  const verification = action({
    metadata: {
      actionType: 'verification_only',
      execution: {
        boundedScope: 'Verify the exact merged page and original Worker marker only.',
        validationStrategy: 'Anonymous no-redirect GET; assert 200, canonical, title, H1, robots, marker, and merged SHA.',
        evidence: [{ source: 'GitHub default branch', finding: 'The exact implementation commit is merged and deployment points to that commit.' }],
        targetUrl: 'https://example.com/article/',
        markerUrl: 'https://example.com/marker.txt',
        markerWorkItemId: 'original-work-item-id',
        mergedCommitSha: 'a'.repeat(40),
        expectedTitle: 'Article title',
        expectedH1: 'Article heading',
      },
    },
  });
  assert.doesNotThrow(() => validateSeoManagerWorkItem(verification, seoJob));
  delete verification.metadata.execution.mergedCommitSha;
  assert.throws(() => validateSeoManagerWorkItem(verification, seoJob), /mergedCommitSha/);
  verification.metadata.execution.mergedCommitSha = 'a'.repeat(40);
  verification.metadata.execution.markerUrl = 'https://other.example/marker.txt';
  assert.throws(() => validateSeoManagerWorkItem(verification, seoJob), /same registered host/);
});
