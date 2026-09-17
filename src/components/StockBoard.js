import React from 'react';
import { db } from '../firebase';
import CollectionBoard from './CollectionBoard';

function StockBoard() {
  return (
    <CollectionBoard
      database={db}
      collectionName="stocks"
      tagsCollectionName="stock_tags"
      eyebrow="REFERENCE STOCK"
      title="ストックボード"
      description="あとで使いたい文章や知識を、ノイズの少ないカードでざっと眺められるストック棚です。"
      manageLabel="ストックを追加・編集"
      manageRoute="/stock"
      emptyMessage="検索条件を変えるか、新しいストックを追加してください。"
      deleteConfirmMessage="本当にこのストックを削除しますか？"
    />
  );
}

export default StockBoard;
