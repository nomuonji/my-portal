import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {Link} from 'react-router-dom';
import { auth } from '../firebase';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogContent, IconButton,
  InputBase, Stack, Typography,
} from '@mui/material';
import {
  ArrowBack, ArrowForward, BookmarkBorder, Bookmark, FavoriteBorder,
  Favorite, Close, PlayArrow, OpenInNew, VisibilityOff, Refresh, Search,
  Check,
} from '@mui/icons-material';

const dateText = value => {
  if (!value || Number.isNaN(Date.parse(value))) return '公開日未確認';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(new Date(value));
};
const sourceDate = item => item.publishedAt || null;
const youtubeThumb = item => item.videoId ? 'https://i.ytimg.com/vi/' + item.videoId + '/hqdefault.jpg' : item.thumbnail || '';
const cleanText = value => String(value||'').toLocaleLowerCase('ja-JP');
const ranges = [{key:'3d',label:'72時間'},{key:'7d',label:'7日間'},{key:'30d',label:'30日間'},{key:'all',label:'すべて'}];
const V = {
  bg:'var(--p-bg)',surface:'var(--p-surface)',sunken:'var(--p-sunken)',ink:'var(--p-ink)',muted:'var(--p-muted)',
  faint:'var(--p-faint)',rule:'var(--p-rule)',ruleStrong:'var(--p-rule-strong)',accent:'var(--p-accent)',
  accentSoft:'var(--p-accent-soft)',teal:'var(--p-teal)',amber:'var(--p-amber)',pink:'var(--p-pink)',
};
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
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
const clamp = lines => ({display:'-webkit-box',WebkitLineClamp:lines,WebkitBoxOrient:'vertical',overflow:'hidden'});
function Meta({item,fallback}){
  return <Stack direction="row" alignItems="baseline" gap={.8} sx={{minWidth:0,flexWrap:'wrap'}}>
    <Typography component="span" sx={{fontSize:11.5,fontWeight:700,color:V.accent}}>{item.category||fallback}</Typography>
    <Typography component="span" sx={{fontSize:11.5,color:V.muted,minWidth:0}} noWrap>{item.creator||'配信元'}</Typography>
    <Typography component="span" sx={{fontFamily:MONO,fontSize:10.5,color:V.faint}}>{dateText(sourceDate(item))}</Typography>
  </Stack>;
}
function CurationAction({item,onAction,busy,compact=false}){
  const liked=item.feedback==='loved',saved=item.feedback==='saved';
  const btn={fontSize:12,fontWeight:600,minWidth:0,color:V.muted,borderRadius:1,px:compact?.6:1.1,py:.1,minHeight:30,whiteSpace:'nowrap',
    '&:hover':{background:V.sunken,color:V.ink},'& .MuiButton-startIcon':{mr:compact?0:.6}};
  return <Stack direction="row" alignItems="center" gap={.1} sx={{flexWrap:'nowrap'}} onClick={e=>e.stopPropagation()}>
    <Button title="この題材が好き" size="small" disabled={Boolean(busy)} aria-label={liked?'好きの評価を解除':'好きと評価する'} aria-pressed={liked}
      startIcon={liked?<Favorite sx={{color:V.pink}}/>:<FavoriteBorder/>}
      onClick={()=>onAction(item,liked?'new':'loved')} sx={{...btn,...(liked&&{color:V.ink})}}>{compact?'':'好き'}</Button>
    <Button title="後で見返す" size="small" disabled={Boolean(busy)} aria-label={saved?'保存を解除':'あとで見る'} aria-pressed={saved}
      startIcon={saved?<Bookmark sx={{color:V.accent}}/>:<BookmarkBorder/>}
      onClick={()=>onAction(item,saved?'new':'saved')} sx={{...btn,...(saved&&{color:V.ink})}}>{compact?'':'保存'}</Button>
    <IconButton title="興味なし" aria-label="興味なしとして非表示" size="small" disabled={Boolean(busy)}
      onClick={()=>onAction(item,'skipped')} sx={{color:V.faint,p:.7,'&:hover':{color:V.ink}}}><VisibilityOff sx={{fontSize:16}}/></IconButton>
  </Stack>;
}
const SCORE_AXIS_LABELS = {tasteFit:'好みとの一致',discovery:'未知の発見',payoff:'元作品の体験'};
function RecommendationScore({item}){
 const score=item.selfEvaluation;
 if(!score||score.version!=='discover-taste-v3'){
  return <Typography sx={{color:V.faint,fontSize:10.5,fontFamily:MONO}}>旧掲載・旧採点</Typography>;
 }
 const fit=score.scores.tasteFit==null?'—':score.scores.tasteFit;
 const label=score.lane==='familiar'?'好みの近傍':'探索枠';
 const provenance=score.fitBasis==='user_feedback'?'本人の明示的な好き':score.fitBasis==='expression_inference'?'本人ツイートからの推測':score.fitBasis==='hypothesis'?'弱い仮説':'好み未確定';
 return <Box component="details" onClick={e=>e.stopPropagation()} sx={{fontSize:11,minWidth:0,
   '& summary':{cursor:'pointer',listStyle:'none',color:V.muted,'&::-webkit-details-marker':{display:'none'},'&:hover':{color:V.ink}}}}>
   <Box component="summary" sx={{display:'flex',alignItems:'center',gap:.9,flexWrap:'wrap'}}>
     <Box component="span" sx={{fontWeight:700,color:score.lane==='familiar'?V.teal:V.amber}}>{label}</Box>
     <Box component="span" sx={{fontFamily:MONO,fontSize:10.5}}>好み {fit} · 発見 {score.scores.discovery} · 体験 {score.scores.payoff}</Box>
     <Box component="span" sx={{color:V.faint}}>根拠 ▾</Box>
   </Box>
   <Stack gap={.6} sx={{mt:1,p:1.3,background:V.sunken,borderRadius:1,lineHeight:1.55}}>
     <Typography sx={{fontSize:11,color:V.muted}}>{provenance}</Typography>
     {Object.entries(SCORE_AXIS_LABELS).map(([key,name])=><Typography key={key} sx={{fontSize:11.5,color:V.ink,lineHeight:1.55}}>
       <Box component="span" sx={{fontWeight:700}}>{name}：</Box>{score.reasons?.[key]||'根拠未記録'}
     </Typography>)}
     {score.expressionMechanism&&<Typography sx={{fontSize:11.5,color:V.ink,lineHeight:1.55}}>本人の発想パターン（仮説）：{score.expressionMechanism}</Typography>}
     {score.evidencePostIds?.length>0&&<Box sx={{display:'flex',gap:1,flexWrap:'wrap'}}>
      {score.evidencePostIds.map(id=><Box key={id} component="a" href={'https://x.com/i/status/'+id.slice(2)} target="_blank" rel="noopener noreferrer"
        sx={{fontSize:11,color:V.accent,fontFamily:MONO}}>tweet {id.slice(-6)}</Box>)}
     </Box>}
     {score.rawReferences?.map((reference,i)=><Typography key={reference.id+'-'+i} sx={{fontSize:11,color:V.muted,lineHeight:1.5}}>
       参考作品（本人の投稿ではない）：{reference.dataset==='radichichi'?'ラジ父':'村上RADIO'} / {reference.id} — {reference.mechanism}
     </Typography>)}
     <Typography sx={{fontSize:11.5,color:V.ink,lineHeight:1.55}}><Box component="span" sx={{fontWeight:700}}>弱点：</Box>{score.weakness}</Typography>
     <Typography sx={{fontSize:10.5,color:V.faint}}>AIの推測です。ツイートは表現の痕跡、参考作品は外部データ。好きだという証明ではありません。</Typography>
   </Stack>
 </Box>;
}
function VideoCard({item,onOpen,onAction,busy}){
  const thumb=youtubeThumb(item);
  return <Box component="article" sx={{minWidth:0,display:'flex',flexDirection:'column'}}>
    <Box component="button" onClick={()=>onOpen(item)} aria-label={'動画を再生: '+item.title}
      sx={{border:0,p:0,cursor:'pointer',display:'block',width:'100%',aspectRatio:'16 / 9',position:'relative',borderRadius:1.2,overflow:'hidden',
        background:V.sunken,color:'#fff','&:hover img':{transform:'scale(1.03)'},'&:hover .video-play':{opacity:1}}}>
      {thumb ? <Box component="img" loading="lazy" src={thumb} alt="" sx={{width:'100%',height:'100%',objectFit:'cover',display:'block',transition:'transform .3s ease'}}/> :
        <Box sx={{height:'100%',display:'grid',placeItems:'center',color:V.faint}}><PlayArrow sx={{fontSize:40}}/></Box>}
      <Box className="video-play" sx={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'rgba(0,0,0,.28)',opacity:0,transition:'opacity .15s'}}>
        <Box sx={{display:'grid',placeItems:'center',borderRadius:'50%',width:48,height:48,background:'rgba(255,255,255,.92)',color:'#111'}}><PlayArrow/></Box>
      </Box>
    </Box>
    <Stack sx={{pt:1.1,flex:1}} gap={.5}>
      <Meta item={item} fallback="映像"/>
      <Box component="button" onClick={()=>onOpen(item)} sx={{border:0,background:'transparent',color:'inherit',p:0,cursor:'pointer',textAlign:'left','&:hover h3':{color:V.accent}}}>
        <Typography component="h3" sx={{fontSize:14.5,fontWeight:700,lineHeight:1.5,...clamp(2)}}>{item.title}</Typography>
      </Box>
      {item.description&&<Typography sx={{fontSize:12.5,color:V.muted,lineHeight:1.6,...clamp(2)}}>{item.description}</Typography>}
      <Box sx={{flex:1}}/>
      <RecommendationScore item={item}/>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{minWidth:0,ml:-.6}}>
        <CurationAction item={item} onAction={onAction} busy={busy} compact/>
        <IconButton href={item.url} target="_blank" rel="noopener noreferrer" size="small" aria-label="YouTubeで見る" sx={{color:V.faint,'&:hover':{color:V.ink}}}><OpenInNew sx={{fontSize:15}}/></IconButton>
      </Stack>
    </Stack>
  </Box>;
}
function ArticleRow({item,onAction,busy}){
  const has=sourceDate(item);
  const d=has?new Date(item.publishedAt):null;
  return <Stack component="article" direction="row" gap={{xs:1.4,md:2}} alignItems="flex-start"
    sx={{py:1.8,borderBottom:'1px solid '+V.rule,minWidth:0}}>
    <Box sx={{width:38,flexShrink:0,pt:.3,fontFamily:MONO,textAlign:'right'}}>
      <Typography sx={{fontFamily:MONO,fontSize:17,fontWeight:600,lineHeight:1,color:V.ink}}>
        {has?d.toLocaleDateString('ja-JP',{day:'2-digit',timeZone:'Asia/Tokyo'}).replace('日',''):'–'}
      </Typography>
      <Typography sx={{fontFamily:MONO,fontSize:10,color:V.faint,mt:.4}}>
        {has?d.toLocaleDateString('en-US',{month:'short',timeZone:'Asia/Tokyo'}).toUpperCase():''}
      </Typography>
    </Box>
    <Box sx={{flex:1,minWidth:0}}>
      <Meta item={item} fallback="記事"/>
      <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer"
        sx={{display:'block',textDecoration:'none',color:'inherit',mt:.4,'&:hover h3':{color:V.accent}}}>
        <Typography component="h3" sx={{fontSize:15,fontWeight:700,lineHeight:1.55}}>{item.title}</Typography>
      </Box>
      {item.description&&<Typography sx={{fontSize:12.5,lineHeight:1.65,color:V.muted,mt:.4,...clamp(2)}}>{item.description}</Typography>}
      {item.reason&&<Typography sx={{fontSize:12,lineHeight:1.6,color:V.ink,mt:.7,pl:1.2,borderLeft:'2px solid '+V.rule,...clamp(2)}}>{item.reason}</Typography>}
      <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',sm:'center'}} gap={.5} sx={{mt:.8}}>
        <RecommendationScore item={item}/>
        <Box sx={{ml:{xs:-.6,sm:0}}}><CurationAction item={item} onAction={onAction} busy={busy} compact/></Box>
      </Stack>
    </Box>
  </Stack>;
}
function SectionHeading({title,count,subtitle}){
  return <Box sx={{mb:2,pb:1.2,borderBottom:'1px solid '+V.ink}}>
    <Stack direction="row" alignItems="baseline" gap={1}>
      <Typography component="h2" sx={{fontSize:18,fontWeight:800,lineHeight:1.3}}>{title}</Typography>
      <Typography component="span" sx={{fontFamily:MONO,fontSize:12,color:V.muted}}>{count}</Typography>
    </Stack>
    {subtitle&&<Typography sx={{fontSize:12,color:V.muted,mt:.3}}>{subtitle}</Typography>}
  </Box>;
}
function Empty({label}){
  return <Box sx={{border:'1px dashed '+V.ruleStrong,borderRadius:1.5,px:2,py:6,textAlign:'center',color:V.muted,fontSize:13,lineHeight:1.75}}>
    この期間の{label}はまだありません。<br/>期間を「すべて」にすると過去の分も見られます。
  </Box>;
}
function Segmented({value,onChange,options,label}){
  return <Box role="group" aria-label={label} sx={{display:'inline-flex',border:'1px solid '+V.ruleStrong,borderRadius:1.2,overflow:'hidden',flexShrink:0}}>
    {options.map(([key,text],i)=><Box key={key} component="button" type="button" onClick={()=>onChange(key)} aria-pressed={value===key}
      sx={{border:0,borderLeft:i?'1px solid '+V.ruleStrong:0,background:value===key?V.ink:'transparent',color:value===key?V.bg:V.muted,
        font:'inherit',fontSize:12.5,fontWeight:700,px:1.5,py:.7,cursor:'pointer',whiteSpace:'nowrap',
        '&:hover':{color:value===key?V.bg:V.ink}}}>{text}</Box>)}
  </Box>;
}
export default function PersonalFeed(){
 const [items,setItems]=useState([]);
 const [rejected,setRejected]=useState([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [range,setRange]=useState('30d');
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
   const [data,audit]=await Promise.all([
    request('?resource=personal_feed&limit=500'+(showSkipped?'&includeSkipped=true':'')),
    request('?resource=personal_feed_rejected&limit=20').catch(()=>({items:[]}))
   ]);
   setItems(data.items||[]);
   setRejected(audit.items||[]);
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
   // Newly scored entries lead the old unscored editorial starter batch.
   // Within each group, show genuinely recent source publications first;
   // scores are transparent predictions rather than faux user-preference truth.
   const ratedA=Number(a.selfEvaluation?.version==='discover-taste-v3'&&a.selfEvaluation?.passed);
   const ratedB=Number(b.selfEvaluation?.version==='discover-taste-v3'&&b.selfEvaluation?.passed);
   // Editorial issues are explicitly ordered; not just news publication recency.
   const priority=Number(b.editorialPriority||0)-Number(a.editorialPriority||0);
   return priority||ratedB-ratedA||(tb||0)-(ta||0)||Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0);
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
 const showVideo=media!=='article',showArticle=media!=='video';
 const rangeLabel=(ranges.find(r=>r.key===range)||{}).label;
 return <Box sx={{maxWidth:1460,mx:'auto',pb:6,color:V.ink}}>
   <Box component="header" sx={{pt:{xs:1,md:1.5}}}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
     <Typography sx={{fontFamily:MONO,fontSize:{xs:11,md:12},letterSpacing:'.06em',color:V.muted}}>
      DISCOVER — {savedOnly?'保存したもの':rangeLabel} · {matches.length} items
     </Typography>
     <Button component={Link} to="/taste" size="small" endIcon={<ArrowForward sx={{fontSize:15}}/>} sx={{color:V.muted,'&:hover':{color:V.ink}}}>好みの記録</Button>
    </Stack>
    <Stack direction={{xs:'column',md:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',md:'flex-end'}} gap={1.5} sx={{mt:.6}}>
     <Box>
      <Typography component="h1" sx={{fontSize:{xs:30,md:40},fontWeight:900,letterSpacing:'-.035em',lineHeight:1.1}}>Discover</Typography>
      <Typography sx={{fontSize:{xs:13.5,md:14.5},color:V.muted,mt:.9,maxWidth:620,lineHeight:1.7}}>
       ネット文化を主役に、動画・配信・界隈の実作品を拾ってきた棚。気になったら「好き」か「保存」、違ったら非表示に。
      </Typography>
     </Box>
     <Button onClick={load} disabled={loading} variant="outlined" startIcon={<Refresh/>} sx={{flexShrink:0}}>更新</Button>
    </Stack>
   </Box>

   <Box sx={{position:{md:'sticky'},top:{md:-24},zIndex:3,mt:{xs:2.5,md:3.5},mx:{xs:-1,sm:-1.5,md:-3},px:{xs:1,sm:1.5,md:3},
     py:1.3,background:V.bg,borderTop:'1px solid '+V.rule,borderBottom:'1px solid '+V.rule}}>
    <Stack direction="row" gap={1} alignItems="center" sx={{flexWrap:'wrap'}}>
     <Segmented label="種類" value={media} onChange={setMedia} options={[['both','全部'],['video','動画'],['article','記事']]}/>
     <Segmented label="期間" value={range} onChange={setRange} options={ranges.map(r=>[r.key,r.label])}/>
     <Box sx={{display:'flex',alignItems:'center',gap:.6,border:'1px solid '+V.ruleStrong,borderRadius:1.2,background:V.surface,px:1.1,height:34,
       flex:{xs:'1 1 100%',sm:'1 1 200px'},maxWidth:{sm:320},ml:{sm:'auto'},'&:focus-within':{borderColor:V.accent}}}>
      <Search sx={{fontSize:17,color:V.faint}}/>
      <InputBase inputProps={{'aria-label':'話題を検索'}} placeholder="話題を検索" value={query}
       onChange={e=>setQuery(e.target.value)} sx={{color:V.ink,fontSize:13,flex:1,minWidth:0}}/>
      {query&&<IconButton onClick={()=>setQuery('')} size="small" aria-label="検索を消去" sx={{color:V.muted,p:.3}}><Close sx={{fontSize:15}}/></IconButton>}
     </Box>
    </Stack>
    <Stack direction="row" alignItems="center" gap={.5} sx={{overflowX:'auto',mt:1.1,pb:.2,scrollbarWidth:'none','&::-webkit-scrollbar':{display:'none'}}} aria-label="ジャンル">
     {topics.map(value=><Box key={value} component="button" type="button" onClick={()=>setTopic(value)} aria-pressed={topic===value}
      sx={{flexShrink:0,border:'1px solid '+(topic===value?V.ink:'transparent'),background:topic===value?V.surface:'transparent',
       color:topic===value?V.ink:V.muted,font:'inherit',fontSize:12.5,fontWeight:topic===value?700:500,borderRadius:5,px:1.2,py:.35,cursor:'pointer',whiteSpace:'nowrap',
       '&:hover':{color:V.ink}}}>{value}</Box>)}
     <Box sx={{width:'1px',height:18,background:V.rule,mx:.6,flexShrink:0}}/>
     <Button onClick={()=>setSavedOnly(x=>!x)} startIcon={savedOnly?<Bookmark/>:<BookmarkBorder/>} size="small" aria-pressed={savedOnly}
      sx={{flexShrink:0,color:savedOnly?V.accent:V.muted,fontSize:12.5,fontWeight:savedOnly?700:500,minHeight:28}}>保存したもの</Button>
    </Stack>
   </Box>

   {error&&<Alert severity="error" sx={{mt:2}}>{error} <Button onClick={load} size="small">再試行</Button></Alert>}
   {loading?<Stack alignItems="center" sx={{py:10}}><CircularProgress size={28}/></Stack>:
    <Box sx={{mt:3,display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:media==='both'?'minmax(0,1.2fr) minmax(0,1fr)':'minmax(0,1fr)'},gap:{xs:5,lg:5},alignItems:'start'}}>
     {showVideo&&<Box component="section" aria-label="動画" sx={{minWidth:0}}>
      <SectionHeading title="動画" count={videos.length} subtitle="サムネイルで選んで、その場で再生"/>
      {videos.length?<Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',sm:'repeat(2,minmax(0,1fr))',lg:media==='both'?'repeat(2,minmax(0,1fr))':'repeat(4,minmax(0,1fr))'},columnGap:2,rowGap:3.2}}>
        {videos.slice(0,expanded.video).map(item=><VideoCard key={item.id} item={item} onOpen={setActive} onAction={update} busy={busy}/>)}
       </Box>:<Empty label="動画"/>}
      {videos.length>expanded.video&&<Button fullWidth variant="outlined" onClick={()=>setExpanded(x=>({...x,video:x.video+18}))} sx={{mt:3}}>
       動画をさらに表示 <Box component="span" sx={{fontFamily:MONO,fontSize:11.5,color:V.muted,ml:1}}>残り {videos.length-expanded.video}</Box></Button>}
     </Box>}
     {showArticle&&<Box component="section" aria-label="記事・読みもの" sx={{minWidth:0}}>
      <SectionHeading title="記事・読みもの" count={articles.length} subtitle="見出しと要点、選んだ理由を一列で"/>
      {articles.length?<Box sx={{minWidth:0,mt:-1.8}}>{articles.slice(0,expanded.article).map(item=><ArticleRow key={item.id} item={item} onAction={update} busy={busy}/>)}</Box>:<Empty label="記事"/>}
      {articles.length>expanded.article&&<Button fullWidth variant="outlined" onClick={()=>setExpanded(x=>({...x,article:x.article+40}))} sx={{mt:3}}>
       記事をさらに表示 <Box component="span" sx={{fontFamily:MONO,fontSize:11.5,color:V.muted,ml:1}}>残り {articles.length-expanded.article}</Box></Button>}
     </Box>}
    </Box>}
   {rejected.length>0&&<Box component="details" sx={{mt:5,borderTop:'1px solid '+V.rule,pt:2,
      '& summary':{color:V.muted,fontSize:12.5,fontWeight:700,cursor:'pointer','&:hover':{color:V.ink}}}}>
      <Box component="summary">AIの選考で落とした候補 <Box component="span" sx={{fontFamily:MONO,fontWeight:500}}>{rejected.length}</Box></Box>
      <Typography sx={{fontSize:12,color:V.muted,mt:1}}>メインには出していない候補です。AIの暫定採点と、落とした理由の記録。</Typography>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},columnGap:3}}>
      {rejected.map(x=><Box key={x.id} sx={{mt:1.4,pt:1.4,borderTop:'1px solid '+V.rule}}>
        <Typography sx={{fontSize:13,fontWeight:700}}>{x.title}</Typography>
        <Typography sx={{fontSize:11,color:V.muted,fontFamily:MONO,mt:.3}}>
          好み {x.selfEvaluation?.scores?.tasteFit??'—'} · 発見 {x.selfEvaluation?.scores?.discovery??'—'} · 体験 {x.selfEvaluation?.scores?.payoff??'—'}
        </Typography>
        <Typography sx={{fontSize:12,color:V.muted,mt:.3}}>落とした理由：{x.selfEvaluation?.weakness||'未記録'}</Typography>
      </Box>)}
      </Box>
    </Box>}
   <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} sx={{mt:5,pt:2,borderTop:'1px solid '+V.rule}} gap={1.5}>
    <Typography sx={{fontSize:11.5,color:V.faint,lineHeight:1.7,maxWidth:760}}>
     AIの採点は本人ツイートの発想パターンからの仮説です。「保存」は好みの根拠にしません。本文・映像は転載せず、配信元へリンクします。
    </Typography>
    <Button onClick={()=>setShowSkipped(x=>!x)} size="small" sx={{color:V.muted,whiteSpace:'nowrap',alignSelf:'flex-start'}}>
     {showSkipped?'非表示にしたものを隠す':'非表示にしたものも表示'}
    </Button>
   </Stack>
   <Dialog open={Boolean(active)} onClose={()=>setActive(null)} fullWidth maxWidth="lg"
    PaperProps={{sx:{background:'#0f1012',color:'#f2f1ec',border:'1px solid #2a2b2e','--p-ink':'#f2f1ec','--p-muted':'#a8a69f','--p-faint':'#7b7972','--p-sunken':'#1c1d20','--p-accent':'#ff7d5c','--p-pink':'#ff8fb0','--p-rule':'rgba(255,255,255,.12)'}}}>
    <Stack direction="row" alignItems="center" gap={.4} sx={{px:2,py:1.2}}>
     <Typography sx={{flex:1,minWidth:0,fontWeight:700,fontSize:14}} noWrap>{active?.title}</Typography>
     <IconButton aria-label="前の動画" onClick={()=>switchVideo(-1)} sx={{color:'inherit'}}><ArrowBack/></IconButton>
     <IconButton aria-label="次の動画" onClick={()=>switchVideo(1)} sx={{color:'inherit'}}><ArrowForward/></IconButton>
     <IconButton aria-label="閉じる" onClick={()=>setActive(null)} sx={{color:'inherit'}}><Close/></IconButton>
    </Stack>
    <DialogContent sx={{pt:0,px:{xs:1,md:2}}}>
     {active?.videoId&&<Box sx={{aspectRatio:'16/9',width:'100%'}}>
      <Box component="iframe" key={active.videoId} title={active.title}
       src={'https://www.youtube-nocookie.com/embed/'+active.videoId+'?rel=0'}
       allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
       allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
       sx={{width:'100%',height:'100%',border:0,borderRadius:1}}/>
     </Box>}
     {active&&<Stack gap={1.1} sx={{pt:1.6}}>
      <Meta item={active} fallback="映像"/>
      {active.description&&<Typography sx={{color:'#c9c7c0',fontSize:13,lineHeight:1.7}}>{active.description}</Typography>}
      {active.reason&&<Typography sx={{fontSize:12.5,lineHeight:1.6,pl:1.2,borderLeft:'2px solid rgba(255,255,255,.2)'}}>{active.reason}</Typography>}
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={.6} sx={{ml:-.6}}>
       <CurationAction item={active} onAction={update} busy={busy}/>
       <Button onClick={()=>update(active,'seen')} disabled={Boolean(busy)} startIcon={<Check/>} size="small" sx={{fontSize:12,color:'#a8a69f'}}>視聴済み</Button>
       <Button href={active.url} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNew sx={{fontSize:14}}/>} size="small" sx={{color:'#ff7d5c',ml:'auto'}}>元の動画を開く</Button>
      </Stack>
     </Stack>}
    </DialogContent>
   </Dialog>
 </Box>;
}
