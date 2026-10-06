const confirmSchema = {
  type: 'boolean',
  description: 'ユーザーがこの公式コーパスの取得・保存を明示的に依頼した場合のみtrue。',
};

const TOOLS = [
  {
    name: 'intelligence_corpus_status',
    description: 'Creative Intelligence用のraw corpus保存状態を確認します。現在は村上RADIO datasetの件数を返します。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'intelligence_raw_document_get',
    description: 'Creative Intelligence raw corpusの1文書を取得します。rawHtmlは正本で、derivedTextは派生データです。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 300 },
        includeRawHtml: { type: 'boolean', default: false },
        includeDerivedText: { type: 'boolean', default: false },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'intelligence_raw_documents_search',
    description: '村上RADIO raw corpusを回番号・メタデータ・必要なら派生テキストで検索します。rawHtml本体は返しません。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 500 },
        contentKind: { type: 'string', enum: ['index', 'episode'] },
        episodeNumber: { type: 'integer', minimum: 1, maximum: 10000 },
        searchDerivedText: { type: 'boolean', default: false },
        includeDerivedText: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        scanLimit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'intelligence_sync_murakami_radio',
    description: 'TOKYO FM村上RADIO公式一覧から過去回URLを発見し、公式ページのraw HTMLを改変せずCreative Intelligence corpusへ保存します。旧index_YYYYMMDD形式、新report形式、第20回の特設toshikoshisp2020形式に対応し、同一URLは決定的IDでupsertします。1回最大6ページ。',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 6, default: 6 },
        confirm: confirmSchema,
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'intelligence_refresh_murakami_derived',
    description: '保存済みrawHtmlを再取得せずに解析し直し、村上RADIO全エピソードのderivedTextを更新します。rawHtmlとrawSha256は変更しません。派生抽出ロジック更新後の保守用です。',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
        confirm: confirmSchema,
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

module.exports = { TOOLS };
