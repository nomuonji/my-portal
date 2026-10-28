'use strict';
const str = (description, maxLength = 2000) => ({ type: 'string', description, maxLength });
const id = str('Item id: rss-… for feed items. (cur-… AI picks use personal_feed_feedback.)', 80);
const TOOLS = [
  {
    name: 'discover_source_list',
    description: 'List Discover RSS reader sources (registry = 情報源ライブラリ curation_sources) with fetch health (reader.lastStatus/lastError/lastNewCount) and what the reading model has learned about each source (learned.weight > 0 = reacted well). Use this before suggesting to add, pause or remove sources.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { includeArchived: { type: 'boolean' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'discover_source_test',
    description: 'Dry-run a site or feed URL without saving: finds the RSS/Atom feed (also from a blog page or a YouTube channel/@handle page), fetches and parses it, and returns a sample of items. Use to show the user what a source would add before registering it.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { url: str('Site page, YouTube channel page or feed URL (https)', 2048) }, required: ['url'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'discover_source_upsert',
    description: 'Add or edit a Discover reader source after the user agreed to it in conversation. New sources: give url (site/channel) or feedUrl; the feed is fetched and verified before it becomes active. Edit: give id plus fields. status=paused stops fetching; archived hides it (non-destructive). priority (-2..+2) nudges ranking; category labels the shelf. Only titles, links and short excerpts are stored.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        id: str('Existing source id (curation_…) to edit; omit to add', 80),
        url: str('Source site / channel page (https). Identity of a new source.', 2048),
        feedUrl: str('Feed URL if known (https). Re-verified on change.', 2048),
        title: str('Display name', 180),
        category: str('Shelf label, e.g. ネット文化, 音楽, 科学', 70),
        priority: { type: 'integer', minimum: -2, maximum: 2, description: 'Ranking nudge set by the user' },
        fetchIntervalMinutes: { type: 'integer', minimum: 30, maximum: 1440 },
        status: { type: 'string', enum: ['active', 'paused', 'candidate', 'archived'] },
        tags: { type: 'array', maxItems: 20, items: str('tag', 50) },
        notes: str('Why the user wants this source / what to watch for', 3000),
        selectionType: { type: 'string', enum: ['editorial', 'community_votes', 'jury_awards', 'curator_recommendation', 'discussion_highlights', 'other'] },
        selectionDescription: str('How items are selected at the source', 1500),
        clearItems: { type: 'boolean', description: 'Also delete this source\'s items the user has not reacted to (liked/saved/skipped/opened are kept). Use when the user wants a noisy source tidied up. If clearRemaining > 0, call again.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'discover_fetch_now',
    description: 'Fetch feeds immediately (normally an hourly scheduled job does this). With sourceId fetches just that source; force ignores intervals and HTTP caching. Each call has a ~7s budget (web request limit): if `remaining` > 0, call again to continue. Returns new item counts and per-source errors.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { sourceId: str('curation_… id', 80), force: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'discover_items_list',
    description: 'Read the Discover reader stream (last ~7 days; loved/saved kept 30 days), ranked by the learned interest model (sort=score) or by time (sort=new). Each item has score and why[] (features that pushed it up/down). AI-curated legacy picks appear as source "AI選書".',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        sort: { type: 'string', enum: ['score', 'new'] },
        sourceId: str('Filter to one source', 80),
        type: { type: 'string', enum: ['video', 'article'] },
        unreadOnly: { type: 'boolean' }, savedOnly: { type: 'boolean' }, includeSkipped: { type: 'boolean' },
        max: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'discover_item_feedback',
    description: 'Record the USER\'S explicit reaction to a reader item (only when the user said so). loved = like (also mirrored to the taste ledger), skipped = not interested (mirrored as a dislike of that item only), saved = watch later (weak interest, not a like), new = clear. The reaction is kept as a learning signal even after the item expires.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id, status: { type: 'string', enum: ['new', 'loved', 'saved', 'skipped'] }, note: str('User\'s reason, if given', 500) }, required: ['id', 'status'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'discover_taste_model_get',
    description: 'Summarize what the reader has learned from the user\'s reactions: liked/disliked terms, categories, authors and per-source affinity, signal count and the last scheduled run. Use it to discuss which sources to keep, pause, or add. It is a ranking aid, not proof of taste; the canonical explicit taste ledger is taste_evidence_list.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 5, maximum: 50 } } },
    annotations: { readOnlyHint: true },
  },
];
module.exports = { TOOLS };
