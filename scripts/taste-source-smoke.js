'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const parserUrl='data:text/javascript;base64,'+readFileSync(require.resolve('../src/components/tasteSourceImport.js')).toString('base64');
const {normalizeRows,summarise}=require('../functions/personalTasteExternalStore');

test('Official Booklog CSV preserves quoted commas and embedded newlines but excludes private memo',async()=>{
 const {parseBooklog}=await import(parserUrl);
 const csv='サービスID,アイテムID,13桁ISBN,カテゴリ,評価,読書状況,レビュー,タグ,非公開メモ,登録日時,読了日,タイトル,作者名\r\n'+
 '1,B0TEST123,9784000000000,文学,5,読み終わった,"前半は面白い,\n後半は静か","SF,海外","秘密の個人メモ",2025/01/02,2025/03/02,"猫の,ゆりかご",ヴォネガット\r\n';
 const rows=parseBooklog(csv);
 assert.equal(rows.length,1);
 assert.equal(rows[0].title,'猫の,ゆりかご');
 assert.equal(rows[0].rating,'5');
 assert.equal(rows[0].review,undefined);
 assert.equal(JSON.stringify(rows).includes('秘密の個人メモ'),false);
 const withReviews=parseBooklog(csv,{includeReviews:true});
 assert.match(withReviews[0].review,/前半は面白い,\n後半は静か/);
 const normalized=normalizeRows('booklog',rows);
 assert.equal(normalized[0].rating,5);
 assert.equal(summarise(normalized,'booklog').read,1);
});
test('Filmarks Clip URLs produce interest only; site community score does not become user score',async()=>{
 const {parseFilmarks}=await import(parserUrl);
 const html='<a href="https://filmarks.com/movies/25464"><img alt="時計じかけのオレンジ"></a>'+
 '<a href="https://filmarks.com/movies/25464">時計じかけのオレンジ</a>3.8';
 const parsed=parseFilmarks(html);
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].title,'時計じかけのオレンジ');
 const normalized=normalizeRows('filmarks',parsed);
 assert.equal(normalized[0].signal,'want_to_watch');
 assert.equal(normalized[0].rating,undefined);
 assert.equal(summarise(normalized,'filmarks').wantToWatch,1);
 assert.throws(()=>normalizeRows('filmarks',[{title:'他サービス',movieId:'99',url:'https://other.example/movie/99'}]),/movie ID required|Conflicting Filmarks ID/);
});
test('A CSV without quotes supports 0 as unrated rather than a negative judgment',async()=>{
 const {parseBooklog}=await import(parserUrl);
 const csv='1,B001,,小説,0,読みたい,,,,,,読みたい本,作者';
 const rows=parseBooklog(csv);
 const record=normalizeRows('booklog',rows)[0];
 assert.equal(record.rating,null);
 assert.equal(record.signal,'bookshelf_record');
 assert.equal(record.readingStatus,'読みたい');
});
