import React from 'react';
import { db } from '../firebase';
import CollectionBoard from './CollectionBoard';

function StockBoard() {
  return (
    <CollectionBoard
      database={db}
      collectionName="stocks"
      tagsCollectionName="stock_tags"
      eyebrow="QUICK STOCK"
      title="ストックボード"
      description="あとで使いたい単語・言い回し・短い知識断片を、一覧性優先でストックしておく場所です。"
      manageLabel="ストックを追加"
      manageRoute="/stock"
      emptyMessage="検索条件を変えるか、新しい短いストックを追加してください。"
      deleteConfirmMessage="本当にこのストックを削除しますか？"
    />
  );
}

export default StockBoard;
