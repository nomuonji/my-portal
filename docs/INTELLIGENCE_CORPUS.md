# Creative Intelligence raw corpus

## Murakami RADIO

村上RADIO公式アーカイブを、Creative Intelligenceの外部教師コーパスとして保存する。

### Canonical rule

- 正本は `intelligence_raw_documents.rawHtml`。
- 取得したHTMLは要約・整形・文体正規化せず保存する。
- `derivedText` は検索・分析用の派生データであり、正本ではない。
- URL、回番号、放送日、タイトル、取得時のHTTPメタデータ、raw SHA-256、byte数を保持する。
- 同一URLは決定的IDでupsertし、hashが同じ場合は本文を書き換えない。
- ラジ父の `humor_examples` とは混ぜない。

### MCP

- `intelligence_corpus_status`
- `intelligence_raw_documents_search`
- `intelligence_raw_document_get`
- `intelligence_sync_murakami_radio`

`intelligence_sync_murakami_radio` は公式一覧を毎回読み、旧 `index_YYYYMMDD.html`、新 `/report/<id>`、および第20回の特設 `/toshikoshisp2020/` を発見する。取得は1回最大6ページに制限し、複数回に分けて全件同期する。

### Copyright / use boundary

保存したraw corpusは私的な分析・参照用。公開再配布や、原文の長文コピーを生成物として出すためのデータセットにはしない。Methodでは文体・構文・思考操作を分析しつつ、参照元へ遡れるようrawを保持する。
