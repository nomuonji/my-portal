import React from 'react';
import { hobbyDb as db } from '../firebase';
import CollectionBoard from './CollectionBoard';

function HobbyBoard() {
  return (
    <CollectionBoard
      database={db}
      collectionName="hobbies"
      tagsCollectionName="hobby_tags"
      eyebrow="PERSONAL INTERESTS"
      title="趣味ボード"
      description="気になっていることや、また触れたいテーマを軽く蓄積して眺めるための個人ライブラリです。"
      manageLabel="趣味を追加・編集"
      manageRoute="/hobby"
      emptyMessage="検索条件を変えるか、新しい趣味メモを追加してください。"
      deleteConfirmMessage="本当にこの趣味を削除しますか？"
    />
  );
}

export default HobbyBoard;
