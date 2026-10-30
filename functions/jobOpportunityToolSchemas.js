'use strict';

const stringSchema = (description, maxLength = 4000) => ({
  type: 'string',
  description,
  maxLength,
});

const optionalText = (description, maxLength = 4000) => ({
  ...stringSchema(description, maxLength),
});

const statusSchema = {
  type: 'string',
  enum: ['active', 'watching', 'paused', 'closed', 'rejected', 'completed'],
  description: '募集中はactive、適合性/詳細確認中はwatching、募集終了はclosed。根拠なしにactiveへしない。',
};

const TOOLS = [
  {
    name: 'job_opportunity_search',
    description: '専用job_opportunitiesコレクションからオンライン仕事を検索する。募集元、報酬、応募時の必須個人情報、本人確認、アカウント権限、保存期間、未確認点などを含む構造化レコードを返す。',
    inputSchema: {
      type: 'object',
      properties: {
        query: stringSchema('案件名、募集元、作業内容、URLなどの部分一致検索。省略可能。', 500),
        status: statusSchema,
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'job_opportunity_get',
    description: 'job_opportunitiesコレクションからIDまたは公式応募URLで仕事レコードを1件読み込む。',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringSchema('Job record ID.', 500),
        sourceUrl: stringSchema('Canonical HTTPS job-listing URL. Used when id is not supplied.', 2048),
      },
      required: [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'job_opportunity_upsert',
    description: 'URLごとに決定的IDを使い、job_opportunities専用コレクションへ仕事レコードを新規保存または更新する。再実行しても同じURLは重複せず、lastVerifiedAtが更新される。応募者本人の個人情報は保存しない。',
    inputSchema: {
      type: 'object',
      properties: {
        title: stringSchema('公式募集名。必須。', 240),
        sourcePublisher: stringSchema('求人元/募集元名。不明ならUNKNOWN。', 180),
        summary: stringSchema('仕事内容・日本からの応募可否・報酬・最大のプライバシーリスクを短くまとめる。', 5000),
        sourceUrl: stringSchema('公式募集ページURL。HTTPS必須。URLから安定IDを生成する。', 2048),
        reward: stringSchema('公式掲載の報酬条件。未掲載ならUNKNOWN。', 1000),
        deadline: stringSchema('期限。なければ空文字。', 300),
        status: statusSchema,
        tags: { type: 'array', items: stringSchema('短い分類タグ。', 60), maxItems: 30 },
        attributes: {
          type: 'object',
          additionalProperties: true,
          description: 'Structured fields: foundAt, listingUpdatedAt, locationEligibility, languages, jobType, tasks, payBasis, workload, contractType, requiredEquipment, applicationSteps, requiredApplicantData (field names and required/optional only, never actual applicant values), identityChecks, accountPermissions, privacyNoticeUrl, retentionAndSharing, withdrawalOrDeletion, signupFee, testsOrScreening, payoutMethods, currentAvailability, confidence, observedFacts, unknowns, riskNotes, nextCheckAfter, dedupeKey.',
        },
      },
      required: ['title', 'sourceUrl'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

module.exports = { TOOLS };
