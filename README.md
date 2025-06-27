## Progress

### 2025-06-28

- Material-UIをインストールした。
- `App.js`を更新し、サイドバーのある基本的なレイアウトを作成した。
- ログイン後にサイドバーが表示され、各機能へのリンクが配置された。
- Firebaseの機密情報を`.env`ファイルに分離し、`.gitignore`に追加した。
- `GEMINI.md`を作成し、開発ガイドラインと進捗管理方法を記載した。
- `App.js`を修正し、モバイルファースト・レスポンシブ対応のサイドバーを実装した。
- `src/components/Memo.js`を作成し、メモの追加と表示の基本機能を実装した。
- `App.js`に`Memo`コンポーネントを組み込み、サイドバーからアクセスできるようにした。
- メモ機能に自動保存（デバウンス付き）、タグ付け、編集、削除機能を実装した。
- メモ機能にキーワード検索を実装した。
- `ListItem`の`button`属性に関する警告を解消するため、`ListItemButton`に置き換えた。
- Firestoreのセキュリティルールを修正し、認証済みユーザーからの`memos`コレクションへのアクセスを許可した。
- メモ機能にテキスト装飾（Markdown記法）を実装した。

## Implemented Features

- Google Authentication
- Basic layout with responsive sidebar
- Memo functionality (add, display, edit, auto-save, tag, delete, search, text formatting memos)