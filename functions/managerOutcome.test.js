const test = require('node:test');
const assert = require('node:assert/strict');
const { isMaterialReceipt, trustedTargetProgress } = require('./managerOutcome');

const job = {
  id: 'site-seo-operations',
  targetProgress: {
    'shikaku.antonbase.com': { actionCount: 1, lastDeliveryStatus: 'live_verified', lastAssignedAt: '2026-09-27T16:59:54Z' },
    'bungu.antonbase.com': { actionCount: 1, lastDeliveryStatus: 'live_verified' },
  },
};

test('read-only audits with borrowed commit references are not counted as changes', () => {
  const audit = {
    sourceType: 'manager_job', sourceId: job.id, status: 'archived', updatedAt: '2026-09-27T16:33:34Z',
    metadata: { execution: { mutationAllowed: false } },
    executionReceipt: {
      targetId: 'shikaku.antonbase.com', actionType: 'content_revision', deliveryStatus: 'live_verified',
      artifacts: ['commit:4113cebaf61974a3aa480e58dd2cf3d8afbeea05', 'https://shikaku.antonbase.com/'],
    },
  };
  assert.equal(isMaterialReceipt(audit), false);
  const progress = trustedTargetProgress(job, [audit]);
  assert.equal(progress['shikaku.antonbase.com'].actionCount, 0);
  assert.equal(progress['shikaku.antonbase.com'].lastDeliveryStatus, undefined);
  assert.equal(progress['shikaku.antonbase.com'].lastAssignedAt, '2026-09-27T16:59:54Z');
});

test('a committed implementation counts once and live evidence is required for live_verified', () => {
  const implementation = {
    id: 'W7sazpIl8KxfR6vU3fAU',
    sourceType: 'manager_job', sourceId: job.id, status: 'archived', updatedAt: '2026-09-27T17:00:00Z',
    metadata: { execution: { mutationAllowed: true } },
    executionReceipt: {
      targetId: 'bungu.antonbase.com', actionType: 'content_revision', deliveryStatus: 'live_verified',
      artifacts: ['commit:3201f1f63a82db6589d0953084bd24b93960f0c5', 'https://bungu.antonbase.com/__seo-verify/marker.txt'],
    },
  };
  const progress = trustedTargetProgress(job, [implementation, implementation]);
  assert.equal(progress['bungu.antonbase.com'].actionCount, 1);
  assert.equal(progress['bungu.antonbase.com'].lastDeliveryStatus, 'live_verified');
  assert.equal(progress['bungu.antonbase.com'].lastLiveAt, implementation.updatedAt);

  const noLiveUrl = { ...implementation, executionReceipt: { ...implementation.executionReceipt, artifacts: ['commit:3201f1f63a82db6589d0953084bd24b93960f0c5'] } };
  assert.equal(trustedTargetProgress(job, [noLiveUrl])['bungu.antonbase.com'].lastDeliveryStatus, 'committed');
});

test('local draft or URL check without a commit does not count as a material action', () => {
  const item = {
    sourceType: 'manager_job', sourceId: job.id, status: 'archived',
    metadata: { execution: { mutationAllowed: true } },
    executionReceipt: {
      targetId: 'bungu.antonbase.com', actionType: 'technical_fix', deliveryStatus: 'local_ready',
      artifacts: ['https://bungu.antonbase.com/'],
    },
  };
  assert.equal(isMaterialReceipt(item), false);
  assert.equal(trustedTargetProgress(job, [item])['bungu.antonbase.com'].actionCount, 0);
});

test('CMS published snapshot is material only with exact published readback, no fabricated commit', () => {
  const job = { id:'culture-institute-manager', targetProgress:{} };
  const receipt = {
    targetId:'culture-institute',actionType:'cms_publish',deliveryStatus:'committed',
    artifacts:['cms:culture-institute:internet-culture@r2','https://my-portal-agent.netlify.app/api/public-content?site=culture-institute&slug=internet-culture'],
    validation:'editorial complete; published_projection_readback_ok (revision 2)',
  };
  const item={ id:'cms-one',sourceType:'manager_job',sourceId:job.id,status:'archived',metadata:{execution:{mutationAllowed:true}},updatedAt:'2026-10-09T00:00:00Z',executionReceipt:receipt };
  assert.equal(isMaterialReceipt(item),true);
  assert.equal(trustedTargetProgress(job,[item,item])['culture-institute'].actionCount,1);
  assert.equal(trustedTargetProgress(job,[item])['culture-institute'].lastDeliveryStatus,'committed');
  assert.equal(isMaterialReceipt({...item,executionReceipt:{...receipt,artifacts:receipt.artifacts.slice(0,1)}}),false);
  assert.equal(isMaterialReceipt({...item,executionReceipt:{...receipt,validation:'draft only'}}),false);
  assert.equal(isMaterialReceipt({...item,executionReceipt:{...receipt,deliveryStatus:'local_ready'}}),false);
  assert.equal(isMaterialReceipt({...item,metadata:{execution:{mutationAllowed:false}}}),false);
  assert.equal(isMaterialReceipt({...item,executionReceipt:{...receipt,artifacts:receipt.artifacts.map(x=>x.replace('culture-institute','knowledge-institute'))}}),false);
});
