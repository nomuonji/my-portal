'use strict';

const { createHash } = require('node:crypto');

const STATUSES = Object.freeze(['active', 'watching', 'paused', 'closed', 'rejected', 'completed']);

function clamp(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function validHttpsUrl(value, name = 'sourceUrl') {
  const text = clamp(value, 2048);
  if (!text) throw new Error(name + ' must be a valid HTTPS URL');
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(name + ' must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error(name + ' must be a valid HTTPS URL');
  }
  parsed.hash = '';
  return parsed;
}

function canonicalJobUrl(value) {
  const url = validHttpsUrl(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(utm_.+|fbclid|gclid|gh_src|source|ref|referrer|campaign|tracking)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

function jobOpportunityId(sourceUrl) {
  return 'job_' + createHash('sha256').update(canonicalJobUrl(sourceUrl)).digest('hex').slice(0, 32);
}

function safeJson(value, depth = 0) {
  if (depth > 8) return '[max-depth]';
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 10000);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeJson(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 200).forEach(([key, item]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
      out[String(key).slice(0, 160)] = safeJson(item, depth + 1);
    });
    return out;
  }
  return String(value).slice(0, 10000);
}

function normalizeJobOpportunity(input = {}, prior = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('job opportunity object required');
  }

  const sourceUrl = canonicalJobUrl(input.sourceUrl ?? prior.sourceUrl);
  const title = clamp(input.title ?? prior.title, 240);
  if (!title) throw new Error('title is required');

  const requestedStatus = input.status ?? prior.status ?? 'watching';
  if (!STATUSES.includes(requestedStatus)) {
    throw new Error('status must be one of: ' + STATUSES.join(', '));
  }

  const rawTags = input.tags ?? prior.tags;
  const tags = Array.from(new Set((Array.isArray(rawTags) ? rawTags : [])
    .map((tag) => clamp(tag, 60))
    .filter(Boolean))).slice(0, 30);

  const rawAttributes = input.attributes ?? prior.attributes ?? {};
  if (!rawAttributes || typeof rawAttributes !== 'object' || Array.isArray(rawAttributes)) {
    throw new Error('attributes must be an object');
  }

  return {
    schemaVersion: 1,
    title,
    sourcePublisher: clamp(input.sourcePublisher ?? prior.sourcePublisher ?? rawAttributes.sourcePublisher, 180) || 'UNKNOWN',
    summary: clamp(input.summary ?? prior.summary, 5000),
    sourceUrl,
    reward: clamp(input.reward ?? prior.reward, 1000),
    deadline: clamp(input.deadline ?? prior.deadline, 300),
    status: requestedStatus,
    tags,
    attributes: safeJson(rawAttributes),
  };
}

module.exports = {
  STATUSES,
  validHttpsUrl,
  canonicalJobUrl,
  jobOpportunityId,
  normalizeJobOpportunity,
};
