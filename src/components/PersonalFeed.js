import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogContent, IconButton,
  InputBase, Stack, Typography,
} from '@mui/material';
import {
  ArrowBack, ArrowForward, BookmarkBorder, Bookmark, FavoriteBorder,
  Favorite, Close, PlayArrow, OpenInNew, VisibilityOff, Refresh, Search,
  Newspaper, OndemandVideo, Schedule, Tune, Check,
} from '@mui/icons-material';

const dateText = value => {
  if (!value || Number.isNaN(Date.parse(value))) return '公開日未確認';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(value));
};
const absoluteDate = value => {
  if (!value || Number.isNaN(Date.parse(value))) return '公開日未確認';
  return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Tokyo'}).format(new Date(value));
};
const sourceDate = item => item.publishedAt || null;
const youtubeThumb = item => item.videoId ? 'https://i.ytimg.com/vi/' + item.videoId + '/hqdefault.jpg' : item.thumbnail || '';
const cleanText = value => String(value||'').toLocaleLowerCase('ja-JP');
const ranges = [{key:'3d',label:'72時間'},{key:'7d',label:'7日間'},{key:'30d',label:'30日間'},{key:'all',label:'すべて'}];
const colors = {
  bg:'#0b0d11',surface:'#171a20',border:'#292e36',muted:'#99a3b3',
  text:'#f2f5f7',accent:'#a5efda',bright:'#ebfff8',soft:'#203b36',
};
async function request(path='',body=null){
  const user=auth.currentUser;
  if(!user)throw new Error('My Portal にログインしてください');
  const response=await fetch('/api/agent-ideas'+path,{
    method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'読み込みに失敗しました ('+response.status+')');
  return data;
}
function CurationAction({item,onAction,busy,compact=false}){
  const liked=item.feedback==='loved',saved=item.feedback==='saved';
  const common={fontSize:compact?11:12,fontWeight:750,minWidth:0,color:'#c9d0d8',
    borderRadius:1.4,px:compact?.9:1.3,py:.15,whiteSpace:'nowrap',
    '&:hover':{background:'#303840'}};
  return <Stack direction="row" alignItems="center" gap={.2} sx={{flexWrap:'nowrap'}} onClick={e=>e.stopPropagation()}>
    <Button title="この題材が好き" size="small" disabled={Boolean(busy)} aria-label={liked?'好きの評価を解除':'好きと評価する'}
      startIcon={liked?<Favorite sx={{color:'#ff9cac'}}/>:<FavoriteBorder/>}
      onClick={()=>onAction(item,liked?'new':'loved')} sx={common}>{compact?'':'好き'}</Button>
    <Button title="後で見返す" size="small" disabled={Boolean(busy)} aria-label={saved?'保存を解除':'あとで見る'}
      startIcon={saved?<Bookmark sx={{color:colors.accent}}/>:<BookmarkBorder/>}
      onClick={()=>onAction(item,saved?'new':'saved')} sx={common}>{compact?'':'保存'}</Button>
    <IconButton title="興味なし" aria-label="興味なしとして非表示" size="small" disabled={Boolean(busy)}
      onClick={()=>onAction(item,'skipped')} sx={{color:'#8f99a5',p:.8}}><VisibilityOff sx={{fontSize:17}}/></IconButton>
  </Stack>;
}
function VideoCard({item,onOpen,onAction,busy}){
  return <Box component="article" sx={{minWidth:0,background:colors.surface,border:'1px solid '+colors.border,borderRadius:2,overflow:'hidden'}}>
    <Box component="button" onClick={()=>onOpen(item)} aria-label={'動画を再生: '+item.title}
      sx={{border:0,p:0,cursor:'pointer',display:'block',width:'100%',aspectRatio:'16 / 9',position:'relative',
        background:'#232b37',color:'#fff','&:hover .video-play':{transform:'translate(-50%,-50%) scale(1.08)'}}}>
      {youtubeThumb(item) ? <Box component="img" loading="lazy" src={youtubeThumb(item)} alt="" sx={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/> :
        <Box sx={{height:'100%',display:'grid',placeItems:'center',fontSize:38}}>▶</Box>}
      <Box className="video-play" sx={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
        display:'grid',placeItems:'center',borderRadius:'50%',width:42,height:42,background:'rgba(0,0,0,.68)',
        border:'1px solid rgba(255,255,255,.4)',transition:'transform .14s'}}><PlayArrow/></Box>
      <Box sx={{position:'absolute',bottom:6,left:8,fontSize:10,fontWeight:850,background:'rgba(0,0,0,.75)',borderRadius:.8,px:.8,py:.3}}>動画</Box>
    </Box>
    <Stack sx={{p:1.5}} gap={.7}>
      <Stack direction="row" alignItems="center" gap={.65} flexWrap="wrap">
        <Typography sx={{fontSize:11,color:colors.accent,fontWeight:850}}>{item.category||'映像'}</Typography>
        <Typography sx={{fontSize:11,color:colors.muted}}>{item.creator||'配信元'} · {dateText(sourceDate(item))}</Typography>
      </Stack>
      <Box component="button" onClick={()=>onOpen(item)} sx={{border:0,background:'transparent',color:'inherit',p:0,cursor:'pointer',textAlign:'left'}}>
        <Typography component="h3" sx={{fontSize:14.5,fontWeight:850,lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{item.title}</Typography>
      </Box>
      <Typography sx={{fontSize:12,color:'#b5bec9',lineHeight:1.65,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{item.description}</Typography>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{minWidth:0,pt:.5}}>
        <CurationAction item={item} onAction={onAction} busy={busy} compact/>
        <IconButton href={item.url} target="_blank" rel="noopener noreferrer" size="small" aria-label="YouTubeで見る" sx={{color:colors.muted}}><OpenInNew sx={{fontSize:15}}/></IconButton>
      </Stack>
    </Stack>
  </Box>;
}
function ArticleRow({item,onAction,busy}){
  return <Stack component="article" direction="row" gap={1.4} alignItems="flex-start"
    sx={{py:1.8,borderBottom:'1px solid '+colors.border,minWidth:0,'&:hover':{background:'#181d24'}}}>
    <Box sx={{width:37,flexShrink:0,textAlign:'center',pt:.2}}>
      <Typography sx={{color:colors.accent,fontSize:19,fontWeight:950,fontVariantNumeric:'tabular-nums',lineHeight:1}}>
        {sourceDate(item)?new Date(item.publishedAt).toLocaleDateString('ja-JP',{day:'2-digit',timeZone:'Asia/Tokyo'}):'–'}
      </Typography>
      <Typography sx={{color:'#77818e',fontSize:10,mt:.2}}>{sourceDate(item)?new Date(item.publishedAt).toLocaleDateString('ja-JP',{month:'numeric',timeZone:'Asia/Tokyo'})+'月':'日付'}</Typography>
    </Box>
    <Box sx={{flex:1,minWidth:0}}>
      <Stack direction="row" gap={.8} flexWrap="wrap" sx={{mb:.5}}>
        <Typography sx={{fontSize:10.5,color:colors.accent,fontWeight:850}}>{item.category||'記事'}</Typography>
        <Typography sx={{fontSize:10.5,color:colors.muted}}>{item.creator||'配信元'} · {dateText(sourceDate(item))}</Typography>
      </Stack>
      <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer"
        sx={{textDecoration:'none',color:'inherit','&:hover':{color:colors.accent}}}>
        <Typography component="h3" sx={{fontSize:14,fontWeight:850,lineHeight:1.55}}>{item.title}</Typography>
      </Box>
      <Typography sx={{fontSize:12.5,lineHeight:1.65,color:'#b2bcc9',mt:.45,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{item.description}</Typography>
      <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',sm:'center'}} gap={.5} sx={{mt:.75}}>
        <Typography sx={{color:'#8b9fb0',fontSize:11.5,lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:1,WebkitBoxOrient:'vertical',overflow:'hidden',flex:1}}>編集メモ：{item.reason}</Typography>
        <CurationAction item={item} onAction={onAction} busy={busy} compact/>
      </Stack>
    </Box>
  </Stack>;
}
function SectionHeading({icon:Icon,title,count,subtitle,highlight}){
  return <Stack direction="row" alignItems="center" gap={1} sx={{mb:1.8,borderBottom:'1px solid '+colors.border,pb:1.3}}>
    <Box sx={{width:30,height:30,borderRadius:1.4,display:'grid',placeItems:'center',
      background:highlight?'#1d4139':'#222b36',color:highlight?colors.accent:'#b9c8d9'}}><Icon sx={{fontSize:18}}/></Box>
    <Box sx={{flex:1,minWidth:0}}>
      <Typography component="h2" sx={{fontSize:18,fontWeight:950,lineHeight:1.2}}>{title} <Box component="span" sx={{fontSize:12,color:colors.muted,fontWeight:700,ml:.4}}>{count}件</Box></Typography>
      {subtitle&&<Typography sx={{fontSize:11,color:colors.muted,mt:.4}}>{subtitle}</Typography>}
    </Box>
  </Stack>;
}
function Empty({label}){
  return <Box sx={{border:'1px dashed #38404b',borderRadius:2,px:2,py:6,textAlign:'center',color:colors.muted,fontSize:13,lineHeight:1.75}}>
    {label}の新着はまだありません。<br/>古いコンテンツは期間「すべて」で確認できます。
  </Box>;
}
export default function PersonalFeed(){
 const [items,setItems]=useState([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [range,setRange]=useState('7d');
 const [media,setMedia]=useState('both');
 const [query,setQuery]=useState('');
 const [topic,setTopic]=useState('すべて');
 const [savedOnly,setSavedOnly]=useState(false);
 const [showSkipped,setShowSkipped]=useState(false);
 const [expanded,setExpanded]=useState({video:18,article:40});
 const [active,setActive]=useState(null);
 const [busy,setBusy]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const data=await request('?resource=personal_feed&limit=500'+(showSkipped?'&includeSkipped=true':''));
   setItems(data.items||[]);
  }catch(e){setError(e.message);}finally{setLoading(false);}
 },[showSkipped]);
 useEffect(()=>{load();},[load]);
 const topics=useMemo(()=>['すべて',...new Set(items.map(x=>x.category).filter(Boolean))].slice(0,15),[items]);
 const matches=useMemo(()=>{
  const now=Date.now();
  return items.filter(x=>{
   if(!showSkipped&&x.feedback==='skipped')return false;
   if(savedOnly&&!['saved','loved'].includes(x.feedback))return false;
   if(topic!=='すべて'&&x.category!==topic&&!(x.tags||[]).includes(topic))return false;
   if(query&&!cleanText([x.title,x.description,x.reason,x.creator,x.category,...(x.tags||[])].join(' ')).includes(cleanText(query.trim())))return false;
   if(range!=='all'&&!savedOnly){
    if(!sourceDate(x))return false;
    const t=Date.parse(x.publishedAt);
    const days={'3d':3,'7d':7,'30d':30}[range]||7;
    if(!Number.isFinite(t)||t>now+86400000||now-t>days*86400000)return false;
   }
   return true;
  }).sort((a,b)=>{
   const ta=Date.parse(a.publishedAt||0),tb=Date.parse(b.publishedAt||0);
   return (tb||0)-(ta||0)||Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0);
  });
 },[items,query,topic,range,savedOnly,showSkipped]);
 const videos=matches.filter(x=>x.type==='video');
 const articles=matches.filter(x=>x.type!=='video');
 const update=async(item,status)=>{
  setBusy(item.id+':'+status);setError('');
  try{
   const saved=await request('',{action:'personal_feed_feedback',id:item.id,status,expectedRevision:item.revision});
   setItems(prev=>prev.map(x=>x.id===item.id?saved:x));
   if(active?.id===item.id)setActive(saved);
  }catch(e){setError(e.message);}finally{setBusy('');}
 };
 const switchVideo=delta=>{
  const pool=videos.length?videos:items.filter(x=>x.type==='video');
  const i=pool.findIndex(x=>x.id===active?.id);
  if(i>=0&&pool.length>1)setActive(pool[(i+delta+pool.length)%pool.length]);
 };
 const tab=(key,label)=> <Button onClick={()=>setMedia(key)} key={key}
   sx={{textTransform:'none',fontWeight:850,fontSize:13,color:media===key?'#0c1818':colors.muted,
    background:media===key?colors.accent:'transparent',borderRadius:1.4,minWidth:0,px:1.6,
    '&:hover':{background:media===key?'#bfffe8':'#1d242b'}}}>{label}</Button>;
 const controlBtn=(isActive)=>({minWidth:0,whiteSpace:'nowrap',textTransform:'none',
  color:isActive?colors.bg:colors.muted,background:isActive?colors.bright:'transparent',
  borderRadius:1.2,fontWeight:800,fontSize:11.5,px:1.3,'&:hover':{background:isActive?colors.bright:'#26313a'}});
 const showVideo=media!=='article',showArticle=media!=='video';
 return <Box sx={{minHeight:'100%',background:colors.bg,color:colors.text,fontFamily:'"Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
  borderRadius:{xs:0,md:2},mx:{xs:-1,sm:-1.5,md:-3},mt:{xs:-1,sm:-1.5,md:-3},
  px:{xs:1.8,sm:2.5,md:3.3},py:{xs:2.3,md:3},'& button:focus-visible, & a:focus-visible':{outline:'2px solid '+colors.accent,outlineOffset:2}}}>
   <Stack direction={{xs:'column',md:'row'}} gap={2} justifyContent="space-between" sx={{pb:2,borderBottom:'1px solid '+colors.border}}>
    <Box>
     <Typography sx={{color:colors.accent,fontSize:10.5,fontWeight:950,letterSpacing:'.2em'}}>YOUR PRIVATE CULTURE WIRE</Typography>
     <Stack direction="row" alignItems="baseline" flexWrap="wrap" gap={1.5} sx={{mt:.45}}>
      <Typography component="h1" sx={{fontSize:{xs:27,md:34},letterSpacing:'-.045em',fontWeight:950,lineHeight:1.25}}>寄り道速報。</Typography>
      <Typography sx={{fontSize:12,color:colors.muted}}>最近の動画と記事を、好きそうな順に発見。</Typography>
     </Stack>
    </Box>
    <Stack direction="row" gap={1.5} alignItems="center">
     <Box sx={{textAlign:'right'}}>
      <Typography sx={{fontSize:19,fontWeight:950,fontVariantNumeric:'tabular-nums'}}>{matches.length}<Box component="span" sx={{fontSize:11,color:colors.muted,ml:.5}}>件</Box></Typography>
      <Typography sx={{fontSize:10.5,color:colors.muted}}>表示中の発見</Typography>
     </Box>
     <IconButton onClick={load} title="最新を読み込む" aria-label="最新を読み込む" disabled={loading} sx={{border:'1px solid '+colors.border,color:colors.accent,width:40,height:40}}><Refresh/></IconButton>
    </Stack>
   </Stack>
   <Stack direction={{xs:'column',lg:'row'}} gap={1.3} justifyContent="space-between" alignItems={{xs:'stretch',lg:'center'}} sx={{py:1.5}}>
    <Stack direction="row" gap={.4} sx={{background:'#171d23',p:.5,borderRadius:2,alignSelf:'flex-start'}}>{tab('both','全部')}{tab('video','動画')}{tab('article','記事・読みもの')}</Stack>
    <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1}>
     <Stack direction="row" gap={.2} sx={{p:.4,background:'#171d23',borderRadius:1.6}}>{ranges.map(r=>
      <Button key={r.key} onClick={()=>setRange(r.key)} sx={controlBtn(range===r.key)}>{r.label}</Button>)}</Stack>
     <Box sx={{display:'flex',alignItems:'center',gap:.5,background:'#171d23',border:'1px solid '+colors.border,borderRadius:1.5,px:1.2,height:36,flex:{xs:'1 1 160px',lg:'0 0 220px'}}}>
      <Search sx={{fontSize:17,color:colors.muted}}/><InputBase aria-label="ニュースを検索" placeholder="話題を検索" value={query}
       onChange={e=>setQuery(e.target.value)} sx={{color:colors.text,fontSize:12.5,flex:1,minWidth:0}}/>
      {query&&<IconButton onClick={()=>setQuery('')} size="small" aria-label="検索を消去" sx={{color:colors.muted}}><Close sx={{fontSize:14}}/></IconButton>}
     </Box>
    </Stack>
   </Stack>
   <Stack direction="row" alignItems="center" gap={.6} sx={{overflowX:'auto',pb:1.5,mb:1.6}} aria-label="ニュースのジャンル">
    <Tune sx={{fontSize:16,color:'#6d8d8a',mr:.3,flexShrink:0}}/>
    {topics.map(value=><Button key={value} onClick={()=>setTopic(value)} size="small" sx={{minWidth:0,flexShrink:0,
     textTransform:'none',border:'1px solid '+(topic===value?'#80c5b1':colors.border),
     borderRadius:9,color:topic===value?colors.accent:'#a9b2be',background:topic===value?colors.soft:'transparent',
     fontSize:11.5,fontWeight:750,px:1.3,whiteSpace:'nowrap'}}>{value}</Button>)}
    <Button onClick={()=>setSavedOnly(x=>!x)} startIcon={savedOnly?<Bookmark/>:<BookmarkBorder/>} size="small"
     sx={{flexShrink:0,color:savedOnly?colors.accent:colors.muted,textTransform:'none',ml:.5,fontSize:11.5}}>保存したもの</Button>
   </Stack>
   {error&&<Alert severity="error" sx={{mb:2}}>{error} <Button onClick={load} size="small">再試行</Button></Alert>}
   {loading?<Stack alignItems="center" sx={{py:10}}><CircularProgress sx={{color:colors.accent}}/></Stack>:
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:media==='both'?'minmax(0,1.15fr) minmax(0,1fr)':'minmax(0,1fr)'},gap:{xs:4,lg:3},alignItems:'start'}}>
     {showVideo&&<Box component="section" aria-label="動画ニュース" sx={{minWidth:0}}>
      <SectionHeading icon={OndemandVideo} title="動画" count={videos.length} subtitle="サムネイルでざっと選んで、ここで再生" highlight/>
      {videos.length?<Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,minmax(0,1fr))',sm:'repeat(3,minmax(0,1fr))',lg:media==='both'?'repeat(2,minmax(0,1fr))':'repeat(4,minmax(0,1fr))'},gap:1.3}}>
        {videos.slice(0,expanded.video).map(item=><VideoCard key={item.id} item={item} onOpen={setActive} onAction={update} busy={busy}/>)}
       </Box>:<Empty label="動画"/>}
      {videos.length>expanded.video&&<Button fullWidth onClick={()=>setExpanded(x=>({...x,video:x.video+18}))}
       sx={{mt:2,color:colors.accent,border:'1px solid '+colors.border,textTransform:'none'}}>動画をさらに18件表示 ({videos.length-expanded.video}件残り)</Button>}
     </Box>}
     {showArticle&&<Box component="section" aria-label="記事ニュース" sx={{minWidth:0}}>
      <SectionHeading icon={Newspaper} title="記事・読みもの" count={articles.length} subtitle="見出しと要点を同じ画面でまとめてチェック"/>
      {articles.length?<Box sx={{minWidth:0}}>{articles.slice(0,expanded.article).map(item=><ArticleRow key={item.id} item={item} onAction={update} busy={busy}/>)}</Box>:<Empty label="記事"/>}
      {articles.length>expanded.article&&<Button fullWidth onClick={()=>setExpanded(x=>({...x,article:x.article+40}))}
       sx={{mt:2,color:colors.accent,border:'1px solid '+colors.border,textTransform:'none'}}>記事をさらに40件表示 ({articles.length-expanded.article}件残り)</Button>}
     </Box>}
    </Box>}
   <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{mt:5,pt:2,borderTop:'1px solid '+colors.border}} gap={2}>
    <Typography sx={{fontSize:11.5,color:'#778392',lineHeight:1.7}}>
     公開日を確認できた作品のみ新着期間に表示。動画・記事の本文や映像は転載せず、配信元へつなぎます。
    </Typography>
    <Button onClick={()=>setShowSkipped(x=>!x)} size="small" sx={{color:colors.muted,whiteSpace:'nowrap',fontSize:11,textTransform:'none'}}>
     {showSkipped?'興味なしを隠す':'興味なしも表示'}
    </Button>
   </Stack>
   <Dialog open={Boolean(active)} onClose={()=>setActive(null)} fullWidth maxWidth="lg"
    PaperProps={{sx:{background:colors.bg,color:'#fff',border:'1px solid '+colors.border}}}>
    <Stack direction="row" alignItems="center" gap={.6} sx={{p:1.5}}>
     <Typography sx={{flex:1,minWidth:0,fontWeight:900,fontSize:14}} noWrap>{active?.title}</Typography>
     <IconButton aria-label="前の動画" onClick={()=>switchVideo(-1)} sx={{color:'#fff'}}><ArrowBack/></IconButton>
     <IconButton aria-label="次の動画" onClick={()=>switchVideo(1)} sx={{color:'#fff'}}><ArrowForward/></IconButton>
     <IconButton aria-label="閉じる" onClick={()=>setActive(null)} sx={{color:'#fff'}}><Close/></IconButton>
    </Stack>
    <DialogContent sx={{pt:0,px:{xs:1,md:2}}}>
     {active?.videoId&&<Box sx={{aspectRatio:'16/9',width:'100%'}}>
      <Box component="iframe" key={active.videoId} title={active.title}
       src={'https://www.youtube-nocookie.com/embed/'+active.videoId+'?rel=0'}
       allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
       allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
       sx={{width:'100%',height:'100%',border:0,borderRadius:1}}/>
     </Box>}
     {active&&<Stack gap={1} sx={{pt:1.5}}>
      <Typography sx={{color:'#a9bcc7',fontSize:13}}>{active.description}</Typography>
      <Typography sx={{color:colors.accent,fontSize:12}}>なぜおすすめ：{active.reason}</Typography>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
       <Button href={active.url} target="_blank" rel="noopener noreferrer" startIcon={<OpenInNew/>}
        sx={{textTransform:'none',color:colors.accent}}>元の動画を開く</Button>
       <CurationAction item={active} onAction={update} busy={busy}/>
       <Button onClick={()=>update(active,'seen')} disabled={Boolean(busy)} startIcon={<Check/>}
        sx={{textTransform:'none',fontSize:12,color:colors.muted}}>視聴済み</Button>
      </Stack>
     </Stack>}
    </DialogContent>
   </Dialog>
 </Box>;
}
