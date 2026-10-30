'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  canonicalJobUrl,
  jobOpportunityId,
  normalizeJobOpportunity,
  STATUSES,
} = require('../functions/jobOpportunityRules');
const { TOOLS } = require('../functions/jobOpportunityToolSchemas');
const { COLLECTION } = require('../functions/jobOpportunityStore');

test('canonical URLs ignore tracking fragments and parameters but keep job-specific query data', () => {
  assert.equal(
    canonicalJobUrl('https://jobs.example.org/posting/123/?utm_source=feed#apply'),
    'https://jobs.example.org/posting/123',
  );
  assert.equal(
    canonicalJobUrl('https://jobs.example.org/posting/123?jobId=123&ref=site'),
    'https://jobs.example.org/posting/123?jobId=123',
  );
  assert.equal(
    jobOpportunityId('https://jobs.example.org/posting/123?utm_source=one'),
    jobOpportunityId('https://jobs.example.org/posting/123?utm_source=two'),
  );
});

test('rejects insecure or credentialed job URLs', () => {
  for (const url of ['', 'http://jobs.example.org/x', 'https://user:pass@jobs.example.org/x', 'javascript:alert(1)']) {
    assert.throws(() => canonicalJobUrl(url), /valid HTTPS URL/);
  }
});

test('normalizes the known job fields and refuses unknown statuses', () => {
  const record = normalizeJobOpportunity({
    title: 'Remote Data Rater',
    sourcePublisher: 'Example',
    sourceUrl: 'https://jobs.example.org/remote-rater?utm_source=x',
    status: 'active',
    tags: ['remote', 'remote', 'privacy'],
    attributes: { requiredApplicantData: { email: 'required' }, accountPermissions: 'UNKNOWN' },
  });
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.sourceUrl, 'https://jobs.example.org/remote-rater');
  assert.equal(record.sourcePublisher, 'Example');
  assert.equal(record.status, 'active');
  assert.deepEqual(record.tags, ['remote', 'privacy']);
  assert.equal(record.attributes.requiredApplicantData.email, 'required');
  assert.deepEqual(STATUSES, ['active', 'watching', 'paused', 'closed', 'rejected', 'completed']);
  assert.throws(() => normalizeJobOpportunity({ title: 'Bad', sourceUrl: 'https://jobs.example.org', status: 'guaranteed' }), /status must be one of/);
});

test('requires title and source URL and limits mutable attributes to JSON-safe values', () => {
  assert.throws(() => normalizeJobOpportunity({ sourceUrl: 'https://jobs.example.org' }), /title is required/);
  assert.throws(() => normalizeJobOpportunity({ title: 'Missing URL' }), /valid HTTPS URL/);
  assert.throws(() => normalizeJobOpportunity({ title: 'bad', sourceUrl: 'https://jobs.example.org', attributes: [] }), /attributes must be an object/);
});

test('the dedicated store uses a job-specific collection and the stable job tools are exposed', () => {
  assert.equal(COLLECTION, 'job_opportunities');
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ['job_opportunity_search', 'job_opportunity_get', 'job_opportunity_upsert'],
  );
  const upsert = TOOLS.find((tool) => tool.name === 'job_opportunity_upsert');
  assert.ok(upsert.inputSchema.required.includes('sourceUrl'));
  assert.equal(upsert.annotations.readOnlyHint, false);
});
