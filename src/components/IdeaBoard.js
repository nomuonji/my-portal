import React from 'react';
import { db } from '../firebase';
import CollectionBoard from './CollectionBoard';

function IdeaBoard() {
  return (
    <CollectionBoard
      database={db}
      collectionName="ideas"
      tagsCollectionName="tags"
      eyebrow="QUICK IDEAS"
      title="アイデアボード"
      description="思いついた単語・短いフレーズ・一行アイデアを、どんどん置いて眺めるための短文メモ空間です。"
      manageLabel="アイデアを追加"
      manageRoute="/idea"
      emptyMessage="検索条件を変えるか、新しい短いアイデアを追加してください。"
      deleteConfirmMessage="本当にこのアイデアを削除しますか？"
    />
  );
}

export default IdeaBoard;
