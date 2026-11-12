'use strict';

// Canonical stores a submarine's haul can index. The store stays the source of truth for the record itself
// (a Discover recommendation, a job listing); the submarine keeps the decision, the feedback history and the
// link to the 道場. Each adapter lists the records, renders them for the haul view, says which haul status a
// record's own state implies, and applies the user's evaluation back to the store when it has a field for it.

function text(value, max) { return value === undefined || value === null ? '' : String(value).trim().slice(0, max); }
function joinList(value, max) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v ? (v.label || v.name || JSON.stringify(v)) : String(v))).filter(Boolean).join('、').slice(0, max);
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => k + '：' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('、').slice(0, max);
  return text(value, max);
}
function details(pairs) { return pairs.map(([label, value]) => ({ label, value: joinList(value, 600) })).filter((d) => d.value); }

const DISCOVER_STATE = {
  new: { label: '未読', status: 'candidate' }, seen: { label: '見た', status: 'candidate' },
  saved: { label: 'あとで', status: 'candidate' }, loved: { label: '好き', status: 'confirmed' },
  skipped: { label: '興味なし', status: 'declined' },
};

function personalFeedAdapter(store) {
  const feed = () => store || require('./personalFeedStore');
  return {
    where: 'personal_feed',
    actions: [
      { key: 'loved', label: '好き', decision: 'confirmed', tone: 'good' },
      { key: 'saved', label: 'あとで', decision: 'candidate', tone: 'neutral' },
      { key: 'skipped', label: '興味なし', decision: 'declined', tone: 'bad' },
    ],
    // The feed's own state decides the haul status: a 好き in Discover is the confirmation.
    authoritative: true,
    async list() {
      const result = await feed().list({ limit: 500, includeSkipped: true });
      return (result.items || []).map(feedRow);
    },
    // One record, for a page of haul (no full scan).
    async one(id) {
      const current = await feed().get({ id });
      return feedRow(current.item || current);
    },
    async apply(recordId, action, note) {
      const current = await feed().get({ id: recordId });
      const item = current.item || current;
      if (!item || !item.revision) throw new Error('Discover recommendation not found: ' + recordId);
      await feed().feedback({ id: recordId, status: action, expectedRevision: item.revision, note });
    },
  };
}

function feedRow(item) {
  return ({
        id: item.id,
        ref: 'personal_feed:' + item.id,
        record: {
          kind: 'discover', title: text(item.title, 300), url: text(item.url, 1000),
          summary: text(item.description, 1600), reason: text(item.reason, 1000),
          weakness: text(item.selfEvaluation?.weakness, 600), source: text(item.creator || item.category, 140),
          type: text(item.type, 30), thumbnail: text(item.thumbnail, 1000),
          state: item.feedback || 'new', stateLabel: (DISCOVER_STATE[item.feedback] || DISCOVER_STATE.new).label,
          note: text(item.feedbackNote, 500), revision: item.revision, publishedAt: item.publishedAt || null,
        },
        status: (DISCOVER_STATE[item.feedback] || DISCOVER_STATE.new).status,
        foundAt: item.createdAt || null,
        evidence: text(item.reason, 1000),
      });
}

function jobAdapter(store) {
  const jobs = () => store || require('./jobOpportunityStore');
  return {
    where: 'job_opportunities',
    actions: [
      { key: 'apply', label: '応募する', decision: 'confirmed', tone: 'good' },
      { key: 'consider', label: '検討中', decision: 'candidate', tone: 'neutral' },
      { key: 'pass', label: '見送る', decision: 'declined', tone: 'bad' },
    ],
    // The job record has no field for the user's decision; the haul keeps it.
    authoritative: false,
    async list() {
      const result = await jobs().search({ limit: 100, scanLimit: 1000 });
      return (result.items || []).map(jobRow);
    },
    async one(id) {
      const current = await jobs().get({ id });
      return jobRow(current.item || current);
    },
    async apply() { /* The decision lives on the haul. */ },
  };
}

function jobRow(item) {
  {
        const a = item.attributes || {};
        const required = Array.isArray(a.requiredApplicantData) ? a.requiredApplicantData
          .filter((x) => x && x.requirement && x.requirement !== 'optional').map((x) => (x.label || x.field) + '（' + (x.requirement === 'required' ? '必須' : '不明') + '）')
          : a.requiredApplicantData && typeof a.requiredApplicantData === 'object'
            ? Object.entries(a.requiredApplicantData).filter(([, v]) => v && v !== 'optional').map(([k, v]) => k + '（' + (v === 'required' ? '必須' : '不明') + '）')
            : a.requiredApplicantData;
        return {
          id: item.id,
          ref: 'job_opportunities:' + item.id,
          record: {
            kind: 'job', title: text(item.title, 300), url: text(item.sourceUrl, 1000),
            summary: text(item.summary, 1600), reward: text(item.reward || a.reward, 300),
            source: text(item.sourcePublisher || a.sourcePublisher, 140),
            state: text(item.status, 30), stateLabel: item.status === 'active' ? '募集中' : '様子見',
            details: details([
              ['主な作業', a.tasks], ['応募できる地域', a.locationEligibility || a.location], ['稼働', a.workload || a.schedule],
              ['応募時に出す情報', required], ['本人確認', a.identityChecks], ['アカウント権限', a.accountPermissions],
              ['保存・共有', a.retentionAndSharing], ['選考', a.testsOrScreening], ['支払方法', a.payoutMethods],
              ['不明点', a.unknowns], ['リスク', a.riskNotes],
            ]),
            lastVerifiedAt: item.lastVerifiedAt || null,
          },
          status: 'candidate',
          foundAt: item.firstSeenAt || item.createdAt || null,
          evidence: text(item.summary, 1000),
        };
  }
}

const GENERIC = {
  where: 'here',
  actions: [
    { key: 'confirmed', label: '成果にする', decision: 'confirmed', tone: 'good' },
    { key: 'candidate', label: '保留', decision: 'candidate', tone: 'neutral' },
    { key: 'declined', label: '見送る', decision: 'declined', tone: 'bad' },
  ],
  authoritative: false,
  async list() { return []; },
  async one() { return null; },
  async apply() {},
};

function createCanonical(options) {
  const adapters = {
    personal_feed: (options && options.personal_feed) || personalFeedAdapter(options && options.personalFeedStore),
    job_opportunities: (options && options.job_opportunities) || jobAdapter(options && options.jobOpportunityStore),
  };
  return {
    adapterFor(where) { return adapters[where] || GENERIC; },
    syncable(where) { return Boolean(adapters[where]); },
  };
}

module.exports = { createCanonical, personalFeedAdapter, jobAdapter, GENERIC, DISCOVER_STATE };
