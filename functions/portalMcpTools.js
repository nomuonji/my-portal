const COLLECTION_ENUM = [
  'memos',
  'ideas',
  'tags',
  'keywords',
  'featureRequests',
  'reading_list_urls',
  'reading_list_youtube',
  'projects',
  'flashcards',
  'decks',
  'groups',
  'stocks',
  'stock_tags',
  'hobbies',
  'hobby_tags',
];

const collectionSchema = {
  type: 'string',
  enum: COLLECTION_ENUM,
  description: 'My Portal の既存データコレクション。',
};

const objectSchema = {
  type: 'object',
  additionalProperties: true,
};

const confirmSchema = {
  type: 'boolean',
  description: 'My Portal本体DBへの書き込みを明示的に確定する場合のみtrue。ユーザーがこの具体的な変更を明示的に依頼・承認していない限りtrueにしないこと。通常のエージェント作業はAgent Idea Spaceへ保存する。',
};

const TOOLS = [
  {
    name: 'portal_status',
    description: 'My Portal本体DBの接続状態と、MCPから読み取り可能なコレクション一覧を返します。Portalはread-mostlyで、通常のエージェント作業領域ではありません。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'portal_get',
    description: 'My Portal本体DBの指定コレクションから、IDが分かっている1件を読み取ります。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        id: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['collection', 'id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'portal_search',
    description: 'My Portal本体DBを検索します。短文メモ、アイデア、ストック、趣味、プロジェクト等を参照するための読み取り専用ツールです。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        query: { type: 'string', maxLength: 500, description: '本文や各フィールドに対する部分一致検索。省略可能。' },
        tag: { type: 'string', maxLength: 160, description: 'tags配列を持つコレクションでの完全一致タグ。省略可能。' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 500, description: '検索時に最大何件を走査するか。' },
      },
      required: ['collection'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'portal_create',
    description: 'My Portal本体DBへ新規作成します。通常のエージェント保存先には使わず、ユーザーがPortal本体への具体的な追加を明示的に依頼・承認した場合のみconfirm=trueで実行してください。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        data: objectSchema,
        id: { type: 'string', maxLength: 500, description: '明示的なIDが必要な場合のみ指定。タグコレクション等で利用。' },
        overwrite: { type: 'boolean', default: false, description: '指定IDが既に存在するときに置換を許可するか。通常はfalse。' },
        confirm: confirmSchema,
      },
      required: ['collection', 'data', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'portal_update',
    description: 'My Portal本体DBの既存データを部分更新します。通常のエージェント作業では使用せず、ユーザーがこの変更を明示的に依頼・承認した場合のみconfirm=trueで実行してください。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        id: { type: 'string', minLength: 1, maxLength: 500 },
        patch: objectSchema,
        confirm: confirmSchema,
      },
      required: ['collection', 'id', 'patch', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'portal_delete',
    description: 'My Portal本体DBの1件を削除します。破壊的操作であり、ユーザーがこの削除を明示的に依頼・承認した場合のみconfirm=trueで実行してください。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        id: { type: 'string', minLength: 1, maxLength: 500 },
        confirm: confirmSchema,
      },
      required: ['collection', 'id', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

module.exports = { COLLECTION_ENUM, TOOLS };
