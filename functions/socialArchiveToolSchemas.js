const confirmSchema = {
  type: 'boolean',
  description: 'ユーザーが具体的なインポート・更新を明示的に依頼した場合のみtrue。',
};

const metadataProperties = {
  category: { type: 'string', maxLength: 160 },
  tags: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 30 },
  starred: { type: 'boolean' },
  note: { type: 'string', maxLength: 4000 },
  classificationSource: { type: 'string', maxLength: 80 },
};

const TOOLS = [
  {
    name: 'social_archive_status',
    description: 'My Portal の過去SNS投稿アーカイブの件数・接続状態を確認します。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'social_post_get',
    description: 'social_posts の1投稿をIDで取得します。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, maxLength: 300 } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'social_posts_search',
    description: '過去SNS投稿を本文・アカウント・年・カテゴリ・タグ・投稿種別・お気に入りで検索します。見返しや分類作業に使います。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 500 },
        account: { type: 'string', maxLength: 200 },
        category: { type: 'string', maxLength: 160 },
        tag: { type: 'string', maxLength: 160 },
        type: { type: 'string', enum: ['post', 'reply', 'quote', 'repost'] },
        year: { type: 'integer', minimum: 2006, maximum: 2200 },
        starred: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 5000, default: 2000 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'social_import_posts',
    description: 'X等の公式アーカイブから正規化した過去投稿をMy Portalへ最大200件ずつupsertします。postIdから決定的IDを作るため再実行しても重複しません。',
    inputSchema: {
      type: 'object',
      properties: {
        importKey: { type: 'string', minLength: 1, maxLength: 160 },
        archiveName: { type: 'string', maxLength: 500 },
        account: {
          type: 'object',
          properties: {
            accountId: { type: 'string', maxLength: 200 },
            username: { type: 'string', maxLength: 200 },
            displayName: { type: 'string', maxLength: 500 },
            bio: { type: 'string', maxLength: 4000 },
            archiveCapturedAt: { type: 'string', maxLength: 80 },
          },
          additionalProperties: false,
        },
        posts: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              platform: { type: 'string', maxLength: 30 },
              postId: { type: 'string', minLength: 1, maxLength: 200 },
              accountId: { type: 'string', maxLength: 200 },
              username: { type: 'string', maxLength: 200 },
              text: { type: 'string', maxLength: 20000 },
              postedAt: { type: 'string', minLength: 1, maxLength: 80 },
              url: { type: 'string', maxLength: 2000 },
              type: { type: 'string', enum: ['post', 'reply', 'quote', 'repost'] },
              conversationId: { type: 'string', maxLength: 200 },
              replyToPostId: { type: 'string', maxLength: 200 },
              replyToUsername: { type: 'string', maxLength: 200 },
              quotedPostId: { type: 'string', maxLength: 200 },
              language: { type: 'string', maxLength: 30 },
              sourceClient: { type: 'string', maxLength: 500 },
              hashtags: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 30 },
              mentions: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 50 },
              links: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 20 },
              media: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 8 },
              metrics: { type: 'object', additionalProperties: true },
              ...metadataProperties,
            },
            required: ['postId', 'text', 'postedAt'],
            additionalProperties: false,
          },
        },
        overwriteMetadata: { type: 'boolean', default: false },
        complete: { type: 'boolean', default: false },
        confirm: confirmSchema,
      },
      required: ['importKey', 'posts', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'social_post_update_metadata',
    description: '過去投稿1件のカテゴリ・タグ・お気に入り・メモだけを更新します。投稿原文は変更しません。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 300 },
        ...metadataProperties,
        confirm: confirmSchema,
      },
      required: ['id', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'social_posts_update_metadata',
    description: '分類作業用。最大200投稿のカテゴリ・タグ・お気に入り・メモを一括更新します。投稿原文は変更しません。',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 300 },
              ...metadataProperties,
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
        confirm: confirmSchema,
      },
      required: ['updates', 'confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

module.exports = { TOOLS };
