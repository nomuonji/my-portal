/** Parsing happens in the user's browser; private Booklog memos are NOT uploaded. */
export function parseCsv(text){
 const input=String(text||'').replace(/^\uFEFF/,'');
 const rows=[],row=[];let cell='',quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(c==='"'){
   if(quoted&&input[i+1]==='"'){cell+='"';i++}else quoted=!quoted;
  }else if(c===','&&!quoted){row.push(cell);cell=''}
  else if((c==='\n'||c==='\r')&&!quoted){
   if(c==='\r'&&input[i+1]==='\n')i++;
   row.push(cell);if(row.some(x=>x.trim()))rows.push([...row]);row.length=0;cell='';
  }else cell+=c;
 }
 if(quoted)throw Error('CSVの引用符が閉じていません');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 return rows;
}
export function parseBooklog(text,{includeReviews=false}={}){
 const rows=parseCsv(text);
 if(!rows.length)throw Error('CSVにデータがありません');
 const header=rows[0].map(x=>x.normalize('NFKC').replace(/\s/g,''));
 const hasHeader=header.includes('タイトル')&&header.includes('評価');
 const columns={serviceId:0,itemId:1,isbn:2,category:3,rating:4,readingStatus:5,review:6,tags:7,
  registeredAt:9,finishedAt:10,title:11,author:12};
 const lookup={serviceId:['サービスID'],itemId:['アイテムID'],isbn:['13桁ISBN','ISBN'],
 category:['カテゴリ'],rating:['評価'],readingStatus:['読書状況','読書ステータス'],review:['レビュー'],tags:['タグ'],
 registeredAt:['登録日時','登録日'],finishedAt:['読了日'],title:['タイトル'],author:['作者名','著者名']};
 if(hasHeader){
  for(const [key,names] of Object.entries(lookup))columns[key]=header.findIndex(x=>names.includes(x));
 }
 const data=[];
 for(const row of rows.slice(hasHeader?1:0)){
  const get=key=>columns[key]>=0?String(row[columns[key]]||'').trim():'';
  const title=get('title');if(!title)continue;
  const record={title,author:get('author'),serviceId:get('serviceId'),itemId:get('itemId'),isbn:get('isbn'),
   rating:get('rating')||null,readingStatus:get('readingStatus'),category:get('category'),tags:get('tags'),
   registeredAt:get('registeredAt'),finishedAt:get('finishedAt')};
  if(includeReviews)record.review=get('review');
  data.push(record);
 }
 if(!data.length)throw Error('タイトルを取得できません。ブクログ公式のエクスポートCSVを指定してください');
 return data;
}
export function parseFilmarks(text){
 const data=new Map(),input=String(text||'');
 // Accept copied HTML (including image/title dual links). No external fetch.
 const html=/<a\b[^>]*href=["'](?:https:\/\/filmarks\.com)?\/movies\/(\d{1,12})[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
 let match;
 while((match=html.exec(input))){
  const id=match[1],inside=match[2];
  const title=inside.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()||
   (inside.match(/alt=["']([^"']+)["']/i)||[])[1]||'';
  if(title&&!(title===id))data.set(id,{movieId:id,title,url:'https://filmarks.com/movies/'+id});
 }
 // Accept pasted text with a movie link and title on the same line.
 for(const line of input.split(/\r?\n/)){
  const url=line.match(/https:\/\/filmarks\.com\/movies\/(\d{1,12})/);
  if(!url)continue;
  const before=line.slice(0,url.index).replace(/^[\s|,;:「\-]+|[\s|,;:」\-]+$/g,'').trim();
  const after=line.slice(url.index+url[0].length).replace(/^[\s|,;:「\-]+|[\s|,;:」\-]+$/g,'').trim();
  const title=(before||after).slice(0,220);
  if(title&&!/[<>]/.test(title))data.set(url[1],{movieId:url[1],title,url:'https://filmarks.com/movies/'+url[1]});
 }
 if(!data.size)throw Error('映画リンクと作品名の組を取得できません。例：時計じかけのオレンジ | https://filmarks.com/movies/25464');
 return [...data.values()];
}
