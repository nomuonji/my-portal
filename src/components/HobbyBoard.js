import React from 'react';
import { hobbyDb as db } from '../firebase';
import CollectionBoard from './CollectionBoard';

function HobbyBoard() {
  return (
    <CollectionBoard
      database={db}
      collectionName="hobbies"
      tagsCollectionName="hobby_tags"
      eyebrow="QUICK INTERESTS"
      title="趣味ボード"
      description="気になる物・人・場所・作品などを、短い名前や一言だけで気軽に放り込んでおく趣味メモです。"
      manageLabel="趣味メモを追加"
      manageRoute="/hobby"
      emptyMessage="検索条件を変えるか、新しい短い趣味メモを追加してください。"
      deleteConfirmMessage="本当にこの趣味を削除しますか？"
    />
  );
}

export default HobbyBoard;
