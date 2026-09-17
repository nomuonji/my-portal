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

const TOOLS = [
  {
    name: 'portal_status',
    description: 'My Portal本体DBの接続状態と、MCPから操作可能なコレクション一覧を返します。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'portal_get',
    description: 'My Portal本体DBの指定コレクションから、IDが分かっている1件を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        id: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['collection', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'portal_search',
    description: 'My Portal本体DBを検索します。短文メモ、アイデア、ストック、趣味、プロジェクト等を横断的に扱うための読み取りツールです。',
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
  },
  {
    name: 'portal_create',
    description: 'My Portal本体DBにデータを新規作成します。ideas/stocks/hobbies/projects等の既存UIと同じFirestoreへ保存されます。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        data: objectSchema,
        id: { type: 'string', maxLength: 500, description: '明示的なIDが必要な場合のみ指定。タグコレクション等で利用。' },
        overwrite: { type: 'boolean', default: false, description: '指定IDが既に存在するときに置換を許可するか。通常はfalse。' },
      },
      required: ['collection', 'data'],
      additionalProperties: false,
    },
  },
  {
    name: 'portal_update',
    description: 'My Portal本体DBの既存データを部分更新します。既存フィールドは保持され、patchの内容だけが更新されます。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        id: { type: 'string', minLength: 1, maxLength: 500 },
        patch: objectSchema,
      },
      required: ['collection', 'id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'portal_delete',
    description: 'My Portal本体DBの1件を削除します。破壊的操作のためconfirm=trueが必須です。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionSchema,
        id: { type: 'string', minLength: 1, maxLength: 500 },
        confirm: { type: 'boolean', description: '削除を確定するときだけtrue。' },
      },
      required: ['collection', 'id', 'confirm'],
      additionalProperties: false,
    },
  },
];

module.exports = { COLLECTION_ENUM, TOOLS };
