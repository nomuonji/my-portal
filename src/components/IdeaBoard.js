import React from 'react';
import { db } from '../firebase';
import CollectionBoard from './CollectionBoard';

function IdeaBoard() {
  return (
    <CollectionBoard
      database={db}
      collectionName="ideas"
      tagsCollectionName="tags"
      eyebrow="IDEA LIBRARY"
      title="アイデアボード"
      description="考えかけの断片から育った案まで、タグと検索で軽く見渡せるアイデアの置き場です。"
      manageLabel="アイデアを追加・編集"
      manageRoute="/idea"
      emptyMessage="検索条件を変えるか、新しいアイデアを追加してください。"
      deleteConfirmMessage="本当にこのアイデアを削除しますか？"
    />
  );
}

export default IdeaBoard;
