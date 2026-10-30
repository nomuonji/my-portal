const confirmSchema = {
  type: 'boolean',
  description: 'ユーザーがこの成果物DBへの具体的な保存・更新を明示的に依頼した場合のみtrue。',
};

const objectSchema = { type: 'object', additionalProperties: true };

const TOOLS = [
  {
    name: 'output_list',
    description: 'My PortalのアウトプットDBを検索します。成果物タイプ・タグ・タイトル・概要で横断検索します。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 500 },
        type: { type: 'string', maxLength: 80 },
        status: { type: 'string', enum: ['active', 'archived'] },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 100 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 1000, default: 300 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'output_get',
    description: '成果物の詳細、全バージョン、各版へのフィードバック履歴を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 180 },
        includeVersions: { type: 'boolean', default: true },
        includeFeedback: { type: 'boolean', default: true },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'output_create',
    description: '新しい成果物と初版をアウトプットDBへ保存します。typeはsong/lyrics/article/video/script/image/code/prompt/other等を自由に指定できます。metadataも拡張可能なJSONです。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        type: { type: 'string', maxLength: 80, default: 'other' },
        summary: { type: 'string', maxLength: 3000 },
        content: { type: 'string', maxLength: 50000 },
        contentFormat: { type: 'string', maxLength: 40, default: 'markdown' },
        externalUrl: { type: 'string', maxLength: 3000 },
        changeSummary: { type: 'string', maxLength: 2000 },
        promptNotes: { type: 'string', maxLength: 5000 },
        model: { type: 'string', maxLength: 160 },
        tags: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
        metadata: objectSchema,
        confirm: confirmSchema,
      },
      required: ['title', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'output_version_create',
    description: '既存成果物の本文を上書きせず、新しい版として追加します。旧版と旧版に紐づく評価は保持されます。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 180 },
        content: { type: 'string', maxLength: 50000 },
        contentFormat: { type: 'string', maxLength: 40 },
        externalUrl: { type: 'string', maxLength: 3000 },
        changeSummary: { type: 'string', maxLength: 2000 },
        promptNotes: { type: 'string', maxLength: 5000 },
        model: { type: 'string', maxLength: 160 },
        confirm: confirmSchema,
      },
      required: ['id', 'content', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'output_feedback_add',
    description: '指定した成果物バージョンに、1〜5点の総合採点・観点別スコア・感想・改善点を追記します。フィードバック履歴は上書きしません。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 180 },
        versionId: { type: 'string', minLength: 1, maxLength: 220 },
        versionNumber: { type: 'integer', minimum: 1 },
        score: { type: 'number', minimum: 1, maximum: 5 },
        scores: objectSchema,
        verdict: { type: 'string', enum: ['love', 'good', 'revise', 'reject', 'review'], default: 'review' },
        feedback: { type: 'string', maxLength: 10000 },
        strengths: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
        improvements: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
        confirm: confirmSchema,
      },
      required: ['id', 'versionId', 'score', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'output_update',
    description: '成果物のタイトル・タイプ・タグ・概要・メタデータ・公開状態を更新します。本文はoutput_version_createで新しい版として保存してください。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 180 },
        title: { type: 'string', maxLength: 300 },
        type: { type: 'string', maxLength: 80 },
        summary: { type: 'string', maxLength: 3000 },
        tags: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
        metadata: objectSchema,
        status: { type: 'string', enum: ['active', 'archived'] },
        confirm: confirmSchema,
      },
      required: ['id', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

module.exports = { TOOLS };
