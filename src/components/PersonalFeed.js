import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../firebase';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogContent, IconButton,
  InputBase, Stack, Typography, Tooltip,
} from '@mui/material';
import {
  ArrowBack, ArrowForward, BookmarkBorder, Bookmark, FavoriteBorder, Favorite, Close,
  PlayArrow, OpenInNew, VisibilityOff, Refresh, Search, DoneAll, CloudDownload, RssFeed,
} from '@mui/icons-material';

const V = {
  bg:'var(--p-bg)',surface:'var(--p-surface)',sunken:'var(--p-sunken)',ink:'var(--p-ink)',muted:'var(--p-muted)',
  faint:'var(--p-faint)',rule:'var(--p-rule)',ruleStrong:'var(--p-rule-strong)',accent:'var(--p-accent)',
  teal:'var(--p-teal)',amber:'var(--p-amber)',pink:'var(--p-pink)',
};
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const clamp = lines => ({display:'-webkit-box',WebkitLineClamp:lines,WebkitBoxOrient:'vertical',overflow:'hidden'});

const PAGE = 30;
// Cached so pending read marks can be sent with keepalive while the page is closing.
let lastToken = '';
async function request(path='',body=null){
  const user=auth.currentUser;
  if(!user)throw new Error('My Portal にログインしてください');
  lastToken=await user.getIdToken();
  const response=await fetch('/api/agent-ideas'+path,{
    method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+lastToken,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'読み込みに失敗しました ('+response.status+')');
  return data;
}
function ago(value){
  const t=Date.parse(value||'');
  if(!Number.isFinite(t))return '';
  const m=Math.max(0,Math.round((Date.now()-t)/60000));
  if(m<60)return m+'分前';
  const h=Math.round(m/60);
  if(h<24)return h+'時間前';
  const d=Math.round(h/24);
  return d<8?d+'日前':new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',timeZone:'Asia/Tokyo'}).format(new Date(t));
}

function Segmented({value,onChange,options,label}){
  return <Box role="group" aria-label={label} sx={{display:'inline-flex',border:'1px solid '+V.ruleStrong,borderRadius:1.2,overflow:'hidden',flexShrink:0}}>
    {options.map(([key,text],i)=><Box key={key} component="button" type="button" onClick={()=>onChange(key)} aria-pressed={value===key}
      sx={{border:0,borderLeft:i?'1px solid '+V.ruleStrong:0,background:value===key?V.ink:'transparent',color:value===key?V.bg:V.muted,
        font:'inherit',fontSize:12.5,fontWeight:700,px:1.4,py:.65,cursor:'pointer',whiteSpace:'nowrap','&:hover':{color:value===key?V.bg:V.ink}}}>{text}</Box>)}
  </Box>;
}
function Actions({item,onAction,busy,compact=true}){
  const liked=item.feedback==='loved',saved=item.feedback==='saved',dis=Boolean(busy);
  const btn={fontSize:12,fontWeight:600,minWidth:0,color:V.muted,borderRadius:1,px:compact?.6:1.1,py:.1,minHeight:30,
    '&:hover':{background:V.sunken,color:V.ink},'& .MuiButton-startIcon':{mr:compact?0:.6}};
  return <Stack direction="row" alignItems="center" sx={{flexShrink:0}} onClick={e=>e.stopPropagation()}>
    <Button title="好き（好みの学習に使います）" size="small" disabled={dis} aria-pressed={liked} aria-label={liked?'好きを解除':'好き'}
      startIcon={liked?<Favorite sx={{color:V.pink}}/>:<FavoriteBorder/>} onClick={()=>onAction(item,liked?'new':'loved')} sx={btn}>{compact?'':'好き'}</Button>
    <Button title="あとで（30日残ります）" size="small" disabled={dis} aria-pressed={saved} aria-label={saved?'保存を解除':'あとで'}
      startIcon={saved?<Bookmark sx={{color:V.accent}}/>:<BookmarkBorder/>} onClick={()=>onAction(item,saved?'new':'saved')} sx={btn}>{compact?'':'あとで'}</Button>
    <IconButton title="興味なし（似たものを下げます）" aria-label="興味なし" size="small" disabled={dis}
      onClick={()=>onAction(item,'skipped')} sx={{color:V.faint,p:.7,'&:hover':{color:V.ink}}}><VisibilityOff sx={{fontSize:16}}/></IconButton>
  </Stack>;
}
function Why({item}){
  if(item.exploration&&!item.why?.length)return <Typography component="span" sx={{fontSize:10.5,color:V.amber,fontFamily:MONO}}>未学習</Typography>;
  if(!item.why?.length)return null;
  return <Stack direction="row" gap={.6} sx={{flexWrap:'wrap',minWidth:0}}>
    {item.why.slice(0,2).map(w=><Typography key={w.label} component="span" sx={{fontSize:10.5,fontFamily:MONO,color:w.direction==='up'?V.teal:V.faint,whiteSpace:'nowrap'}}>
      {w.direction==='up'?'↑':'↓'} {w.label}</Typography>)}
  </Stack>;
}
function SourceLine({item}){
  return <Stack direction="row" gap={.8} alignItems="baseline" sx={{minWidth:0}}>
    <Typography component="span" sx={{fontSize:11.5,fontWeight:700,color:item.origin==='agent'?V.amber:V.accent,minWidth:0}} noWrap>{item.sourceTitle}</Typography>
    {item.author&&<Typography component="span" sx={{fontSize:11.5,color:V.muted,minWidth:0}} noWrap>{item.author}</Typography>}
    <Typography component="span" sx={{fontFamily:MONO,fontSize:10.5,color:V.faint,flexShrink:0}}>{ago(item.publishedAt)}</Typography>
  </Stack>;
}
function ArticleRow({item,onAction,onOpen,busy,watch}){
  const read=Boolean(item.readAt);
  return <Stack component="article" ref={watch} data-id={item.id} direction="row" gap={1.4} sx={{py:1.5,borderBottom:'1px solid '+V.rule,minWidth:0,opacity:read?.58:1}}>
    {item.thumbnail&&<Box component="img" src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={e=>{e.currentTarget.style.display='none';}}
      sx={{width:{xs:64,sm:96},height:{xs:64,sm:64},objectFit:'cover',borderRadius:1,flexShrink:0,background:V.sunken,display:{xs:'none',sm:'block'}}}/>}
    <Box sx={{flex:1,minWidth:0}}>
      <SourceLine item={item}/>
      <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer" onClick={()=>onOpen(item)}
        sx={{display:'block',textDecoration:'none',color:'inherit',mt:.3,'&:hover h3':{color:V.accent}}}>
        <Typography component="h3" sx={{fontSize:15,fontWeight:read?500:700,lineHeight:1.5,...clamp(2)}}>{item.title}</Typography>
      </Box>
      {item.excerpt&&<Typography sx={{fontSize:12.5,lineHeight:1.6,color:V.muted,mt:.3,...clamp(2)}}>{item.excerpt}</Typography>}
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{mt:.5}}>
        <Why item={item}/>
        <Box sx={{ml:'auto'}}><Actions item={item} onAction={onAction} busy={busy}/></Box>
      </Stack>
    </Box>
  </Stack>;
}
function VideoCard({item,onPlay,onAction,busy,watch}){
  const read=Boolean(item.readAt);
  return <Box component="article" ref={watch} data-id={item.id} sx={{minWidth:0,display:'flex',flexDirection:'column',opacity:read?.6:1}}>
    <Box component="button" onClick={()=>onPlay(item)} aria-label={'再生: '+item.title}
      sx={{border:0,p:0,cursor:'pointer',width:'100%',aspectRatio:'16 / 9',position:'relative',borderRadius:1.2,overflow:'hidden',background:V.sunken,'&:hover .play':{opacity:1}}}>
      {item.thumbnail?<Box component="img" loading="lazy" src={item.thumbnail} alt="" sx={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>:
        <Box sx={{height:'100%',display:'grid',placeItems:'center',color:V.faint}}><PlayArrow sx={{fontSize:40}}/></Box>}
      <Box className="play" sx={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'rgba(0,0,0,.28)',opacity:0,transition:'opacity .15s'}}>
        <Box sx={{display:'grid',placeItems:'center',borderRadius:'50%',width:46,height:46,background:'rgba(255,255,255,.92)',color:'#111'}}><PlayArrow/></Box>
      </Box>
    </Box>
    <Stack sx={{pt:1,flex:1}} gap={.4}>
      <SourceLine item={item}/>
      <Typography component="h3" onClick={()=>onPlay(item)} sx={{fontSize:14,fontWeight:read?500:700,lineHeight:1.5,cursor:'pointer',...clamp(2),'&:hover':{color:V.accent}}}>{item.title}</Typography>
      <Box sx={{flex:1}}/>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Why item={item}/>
        <Actions item={item} onAction={onAction} busy={busy}/>
      </Stack>
    </Stack>
  </Box>;
}

export default function PersonalFeed(){
  const [ids,setIds]=useState([]);
  const [items,setItems]=useState([]);
  const [meta,setMeta]=useState({total:0,unreadTotal:0,sources:[],lastRun:null});
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [fetching,setFetching]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [sort,setSort]=useState('score');
  const [media,setMedia]=useState('both');
  const [view,setView]=useState('unread');
  const [queryInput,setQueryInput]=useState('');
  const [query,setQuery]=useState('');
  const [source,setSource]=useState('');
  const [showSkipped,setShowSkipped]=useState(false);
  const [playing,setPlaying]=useState(null);
  const [busy,setBusy]=useState('');
  const [autoRead,setAutoRead]=useState(()=>{try{return localStorage.getItem('discover.autoRead')!=='off';}catch{return true;}});
  const generation=useRef(0);
  const cursor=useRef(0);

  useEffect(()=>{const t=setTimeout(()=>setQuery(queryInput.trim()),350);return()=>clearTimeout(t);},[queryInput]);
  useEffect(()=>{try{localStorage.setItem('discover.autoRead',autoRead?'on':'off');}catch{}},[autoRead]);

  // ---- queue: one ranked id list per filter set, then pages of full items
  const loadQueue=useCallback(async()=>{
    const gen=++generation.current;
    setLoading(true);setError('');
    try{
      const p=new URLSearchParams({resource:'discover_queue',sort,view,pageSize:String(PAGE)});
      if(media!=='both')p.set('type',media);
      if(source)p.set('sourceId',source);
      if(query)p.set('q',query);
      if(showSkipped)p.set('includeSkipped','true');
      const r=await request('?'+p.toString());
      if(gen!==generation.current)return;
      setIds(r.ids||[]);setItems(r.items||[]);cursor.current=(r.items||[]).length;
      setMeta({total:r.total||0,unreadTotal:r.unreadTotal||0,sources:r.sources||[],lastRun:r.lastRun||null});
    }catch(e){if(gen===generation.current)setError(e.message);}
    finally{if(gen===generation.current)setLoading(false);}
  },[sort,view,media,source,query,showSkipped]);
  useEffect(()=>{loadQueue();},[loadQueue]);

  const loadMore=useCallback(async()=>{
    if(loadingMore||loading||cursor.current>=ids.length)return;
    const gen=generation.current;
    const next=ids.slice(cursor.current,cursor.current+PAGE);
    setLoadingMore(true);
    try{
      const r=await request('?resource=discover_items&ids='+next.join(','));
      if(gen!==generation.current)return;
      cursor.current+=next.length;
      setItems(prev=>{const have=new Set(prev.map(x=>x.id));return prev.concat((r.items||[]).filter(x=>!have.has(x.id)));});
    }catch(e){setError(e.message);}finally{setLoadingMore(false);}
  },[ids,loading,loadingMore]);

  const sentinel=useRef(null);
  useEffect(()=>{
    const el=sentinel.current;
    if(!el)return;
    const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))loadMore();},{rootMargin:'800px 0px'});
    io.observe(el);
    return()=>io.disconnect();
  },[loadMore,items.length]);

  // ---- read on scroll: an item that was on screen and then scrolled off the top is read
  const pending=useRef(new Set());
  const readById=useRef(new Map());
  const flushTimer=useRef(null);
  const flush=useCallback((closing=false)=>{
    clearTimeout(flushTimer.current);
    const list=[...pending.current];
    if(!list.length)return;
    pending.current.clear();
    if(closing&&lastToken){
      fetch('/api/agent-ideas',{method:'POST',keepalive:true,headers:{Authorization:'Bearer '+lastToken,'Content-Type':'application/json'},
        body:JSON.stringify({action:'discover_mark_read',ids:list})}).catch(()=>{});
      return;
    }
    request('',{action:'discover_mark_read',ids:list}).catch(()=>{list.forEach(id=>pending.current.add(id));});
  },[]);
  const markReadLocal=useCallback(list=>{
    // Only ids currently shown as unread; readById is kept in sync with the rendered items.
    const fresh=list.filter(id=>id&&readById.current.get(id)===false);
    if(!fresh.length)return;
    fresh.forEach(id=>{readById.current.set(id,true);pending.current.add(id);});
    const at=new Date().toISOString();
    setItems(prev=>prev.map(x=>fresh.includes(x.id)&&!x.readAt?{...x,readAt:at}:x));
    setMeta(m=>({...m,unreadTotal:Math.max(0,m.unreadTotal-fresh.length)}));
    clearTimeout(flushTimer.current);
    flushTimer.current=setTimeout(()=>flush(),2500);
  },[flush]);
  useEffect(()=>{
    const onHide=()=>{if(document.visibilityState==='hidden')flush(true);};
    const onLeave=()=>flush(true);
    document.addEventListener('visibilitychange',onHide);
    window.addEventListener('pagehide',onLeave);
    return()=>{document.removeEventListener('visibilitychange',onHide);window.removeEventListener('pagehide',onLeave);flush(true);};
  },[flush]);
  useEffect(()=>{readById.current=new Map(items.map(x=>[x.id,Boolean(x.readAt)]));},[items]);
  const observer=useMemo(()=>{
    if(typeof IntersectionObserver==='undefined')return null;
    // When anything scrolls off the top, every item now above the screen counts as read.
    // A fast flick can carry items from below the screen to above it in one frame, and those
    // never produce an event of their own, so they are found by position instead.
    return new IntersectionObserver(entries=>{
      const top=entries[0]?.rootBounds?.top||0;
      if(!entries.some(e=>!e.isIntersecting&&e.boundingClientRect.bottom<=top+1))return;
      const above=[];
      document.querySelectorAll('article[data-id]').forEach(el=>{
        if(el.getBoundingClientRect().bottom<=top+1&&readById.current.get(el.dataset.id)===false)above.push(el.dataset.id);
      });
      markReadLocal(above);
    },{threshold:0});
  },[markReadLocal]);
  useEffect(()=>()=>observer&&observer.disconnect(),[observer]);
  const watch=useCallback(el=>{if(el&&observer&&autoRead)observer.observe(el);},[observer,autoRead]);
  useEffect(()=>{if(!autoRead&&observer)observer.disconnect();},[autoRead,observer]);

  // ---- actions
  const patch=(id,next)=>setItems(prev=>prev.map(x=>x.id===id?{...x,...next}:x));
  const react=async(item,status)=>{
    setBusy(item.id);setError('');
    try{
      const saved=await request('',{action:'discover_feedback',id:item.id,status,expectedRevision:item.revision});
      if(!item.readAt)setMeta(m=>({...m,unreadTotal:Math.max(0,m.unreadTotal-1)}));
      patch(item.id,{feedback:saved.feedback==='seen'?'new':saved.feedback,revision:saved.revision,readAt:item.readAt||new Date().toISOString()});
    }catch(e){setError(e.message);}finally{setBusy('');}
  };
  const opened=item=>{
    if(!item.readAt){patch(item.id,{readAt:new Date().toISOString(),opened:true});setMeta(m=>({...m,unreadTotal:Math.max(0,m.unreadTotal-1)}));}
    request('',{action:'discover_opened',id:item.id}).catch(()=>{});
  };
  const play=item=>{setPlaying(item);opened(item);};
  const markAllLoaded=()=>markReadLocal(items.filter(x=>!x.readAt).map(x=>x.id));
  const fetchNow=async()=>{
    setFetching(true);setError('');setNotice('');
    try{
      let fetched=0,created=0,errors=[];
      for(let round=0;round<8;round++){
        const r=await request('',{action:'discover_fetch_now'});
        fetched+=r.fetched||0;created+=r.created||0;errors=errors.concat(r.errors||[]);
        setNotice(`取得中… ${fetched}件の情報源を確認、新着 ${created}件`);
        if(!r.remaining)break;
      }
      setNotice(fetched?`${fetched}件の情報源を確認、新着 ${created}件`+(errors.length?`（取得失敗 ${errors.length}件: ${errors.map(e=>e.error).slice(0,2).join(' / ')}）`:''):'今は取得間隔内です（各情報源は既定で1時間おき）');
      flush();
      await loadQueue();
    }catch(e){setError(e.message);}finally{setFetching(false);}
  };
  const videos=items.filter(x=>x.type==='video');
  const articles=items.filter(x=>x.type!=='video');
  const switchVideo=delta=>{
    const i=videos.findIndex(x=>x.id===playing?.id);
    if(i>=0&&videos.length>1)play(videos[(i+delta+videos.length)%videos.length]);
  };
  const showVideo=media!=='article'&&videos.length>0, showArticle=media!=='video';
  const hasMore=cursor.current<ids.length;
  const noSources=!loading&&!meta.sources.length&&!query&&!source;
  const lastRun=meta.lastRun;

  return <Box sx={{maxWidth:1280,mx:'auto',pb:6,color:V.ink}}>
    <Box component="header" sx={{pt:{xs:1,md:1.5}}}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography sx={{fontFamily:MONO,fontSize:{xs:11,md:12},letterSpacing:'.06em',color:V.muted}}>
          DISCOVER — RSS · 未読 {meta.unreadTotal}
        </Typography>
        <Stack direction="row" gap={.5}>
          <Button component={Link} to="/curation-sources" size="small" startIcon={<RssFeed sx={{fontSize:16}}/>} sx={{color:V.muted,'&:hover':{color:V.ink}}}>情報源</Button>
          <Button component={Link} to="/taste" size="small" endIcon={<ArrowForward sx={{fontSize:15}}/>} sx={{color:V.muted,'&:hover':{color:V.ink}}}>好みの記録</Button>
        </Stack>
      </Stack>
      <Stack direction={{xs:'column',md:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',md:'flex-end'}} gap={1.5} sx={{mt:.6}}>
        <Box>
          <Typography component="h1" sx={{fontSize:{xs:30,md:40},fontWeight:900,letterSpacing:'-.035em',lineHeight:1.1}}>Discover</Typography>
          <Typography sx={{fontSize:{xs:13.5,md:14.5},color:V.muted,mt:.8,maxWidth:640,lineHeight:1.7}}>
            登録した情報源の新着を、反応から学んだ順に。読み流した記事は既読になって次から出ません。記事は1週間で消え、反応だけが学習に残ります。
          </Typography>
        </Box>
        <Stack direction="row" gap={1} sx={{flexShrink:0}}>
          <Button onClick={fetchNow} disabled={fetching} variant="outlined" startIcon={fetching?<CircularProgress size={14}/>:<CloudDownload/>}>新着を取得</Button>
          <IconButton onClick={()=>{flush();loadQueue();}} disabled={loading} aria-label="再読み込み" sx={{border:'1px solid '+V.ruleStrong,borderRadius:1.2}}><Refresh fontSize="small"/></IconButton>
        </Stack>
      </Stack>
    </Box>

    <Box sx={{position:{md:'sticky'},top:{md:-24},zIndex:3,mt:{xs:2.5,md:3},mx:{xs:-1,sm:-1.5,md:-3},px:{xs:1,sm:1.5,md:3},
      py:1.2,background:V.bg,borderTop:'1px solid '+V.rule,borderBottom:'1px solid '+V.rule}}>
      <Stack direction="row" gap={1} alignItems="center" sx={{flexWrap:'wrap'}}>
        <Segmented label="並び順" value={sort} onChange={setSort} options={[['score','おすすめ'],['new','新着']]}/>
        <Segmented label="表示" value={view} onChange={setView} options={[['unread','未読'],['all','すべて'],['saved','あとで・好き']]}/>
        <Segmented label="種類" value={media} onChange={setMedia} options={[['both','全部'],['article','記事'],['video','動画']]}/>
        <Box sx={{display:'flex',alignItems:'center',gap:.6,border:'1px solid '+V.ruleStrong,borderRadius:1.2,background:V.surface,px:1.1,height:33,
          flex:{xs:'1 1 100%',sm:'1 1 180px'},maxWidth:{sm:280},ml:{sm:'auto'},'&:focus-within':{borderColor:V.accent}}}>
          <Search sx={{fontSize:17,color:V.faint}}/>
          <InputBase inputProps={{'aria-label':'検索'}} placeholder="検索" value={queryInput} onChange={e=>setQueryInput(e.target.value)} sx={{fontSize:13,flex:1,minWidth:0,color:V.ink}}/>
          {queryInput&&<IconButton onClick={()=>setQueryInput('')} size="small" aria-label="検索を消去" sx={{p:.3,color:V.muted}}><Close sx={{fontSize:15}}/></IconButton>}
        </Box>
      </Stack>
      {meta.sources.length>1&&<Stack direction="row" alignItems="center" gap={.5} sx={{overflowX:'auto',mt:1,pb:.2,scrollbarWidth:'none','&::-webkit-scrollbar':{display:'none'}}} aria-label="情報源">
        {[{id:'',title:'すべての情報源'},...meta.sources].map(s=><Box key={s.id||'all'} component="button" type="button" onClick={()=>setSource(s.id)} aria-pressed={source===s.id}
          sx={{flexShrink:0,border:'1px solid '+(source===s.id?V.ink:'transparent'),background:source===s.id?V.surface:'transparent',color:source===s.id?V.ink:V.muted,
            font:'inherit',fontSize:12.5,fontWeight:source===s.id?700:500,borderRadius:5,px:1.2,py:.3,cursor:'pointer',whiteSpace:'nowrap','&:hover':{color:V.ink}}}>
          {s.title}{s.id&&s.unread?<Box component="span" sx={{fontFamily:MONO,fontSize:10.5,color:V.faint,ml:.6}}>{s.unread}</Box>:null}</Box>)}
      </Stack>}
    </Box>

    {error&&<Alert severity="error" sx={{mt:2}}>{error} <Button onClick={loadQueue} size="small">再試行</Button></Alert>}
    {notice&&<Alert severity="info" onClose={()=>setNotice('')} sx={{mt:2}}>{notice}</Alert>}
    {loading?<Stack alignItems="center" sx={{py:10}}><CircularProgress size={28}/></Stack>:
     noSources?<Box sx={{mt:4,border:'1px dashed '+V.ruleStrong,borderRadius:1.5,px:3,py:6,textAlign:'center',color:V.muted,lineHeight:1.8,fontSize:14}}>
       まだ記事がありません。<br/>情報源ライブラリでRSSを購読するか、「新着を取得」を押してください。
       <Box sx={{mt:2}}><Button component={Link} to="/curation-sources" variant="contained" startIcon={<RssFeed/>}>情報源ライブラリへ</Button></Box>
     </Box>:
     !items.length?<Box sx={{mt:4,px:3,py:6,textAlign:'center',color:V.muted,fontSize:14,lineHeight:1.8}}>
       {view==='unread'?'未読はありません。':'該当する記事はありません。'}
       {view==='unread'&&<Box sx={{mt:1.5}}><Button onClick={()=>setView('all')} size="small" variant="outlined">既読も表示</Button></Box>}
     </Box>:
     <Box sx={{mt:2.5,display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:showVideo&&showArticle?'minmax(0,1.35fr) minmax(0,1fr)':'minmax(0,1fr)'},gap:{xs:4,lg:5},alignItems:'start'}}>
       {showArticle&&<Box component="section" aria-label="記事" sx={{minWidth:0}}>
         <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{pb:1,borderBottom:'1px solid '+V.ink}}>
           <Typography component="h2" sx={{fontSize:17,fontWeight:800}}>記事</Typography>
           <Stack direction="row" gap={.5} alignItems="center">
             <Tooltip title="画面の上に流れていった記事を自動で既読にします（好みの学習には使いません）">
               <Button size="small" onClick={()=>setAutoRead(x=>!x)} aria-pressed={autoRead} sx={{color:autoRead?V.teal:V.faint,fontSize:12}}>
                 スクロールで既読 {autoRead?'ON':'OFF'}</Button></Tooltip>
             <Tooltip title="読み込み済みの未読をまとめて既読に"><span>
               <Button size="small" onClick={markAllLoaded} startIcon={<DoneAll sx={{fontSize:16}}/>} sx={{color:V.muted,fontSize:12}}>まとめて既読</Button></span></Tooltip>
           </Stack>
         </Stack>
         {articles.length?articles.map(item=><ArticleRow key={item.id} item={item} onAction={react} onOpen={opened} busy={busy===item.id} watch={watch}/>):
           <Typography sx={{color:V.muted,fontSize:13,py:5,textAlign:'center'}}>このページに記事はありません。</Typography>}
       </Box>}
       {showVideo&&<Box component="section" aria-label="動画" sx={{minWidth:0}}>
         <Typography component="h2" sx={{fontSize:17,fontWeight:800,pb:1,mb:2,borderBottom:'1px solid '+V.ink}}>動画</Typography>
         <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',sm:'repeat(2,minmax(0,1fr))',lg:showArticle?'minmax(0,1fr)':'repeat(3,minmax(0,1fr))',xl:showArticle?'repeat(2,minmax(0,1fr))':'repeat(4,minmax(0,1fr))'},columnGap:2,rowGap:3}}>
           {videos.map(item=><VideoCard key={item.id} item={item} onPlay={play} onAction={react} busy={busy===item.id} watch={watch}/>)}
         </Box>
       </Box>}
     </Box>}
    {!loading&&items.length>0&&<Box ref={sentinel} sx={{py:3,textAlign:'center',color:V.faint,fontSize:12}}>
      {loadingMore?<CircularProgress size={20}/>:hasMore?<Button size="small" onClick={loadMore} sx={{color:V.muted}}>さらに読み込む（残り {ids.length-cursor.current}）</Button>:'ここまで'}
    </Box>}

    <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} sx={{mt:3,pt:2,borderTop:'1px solid '+V.rule}} gap={1.5}>
      <Typography sx={{fontSize:11.5,color:V.faint,lineHeight:1.7,maxWidth:780}}>
        「好き」「興味なし」は好みの記録にも残ります。「あとで」と記事を開いたことは弱い関心として並び順だけに使います。既読は学習に使いません。同じ情報源が続かないように並べ替えています。
        {lastRun?.startedAt&&<> 自動取得 {lastRun.status==='done'?ago(lastRun.at)+'（新着 '+(lastRun.created||0)+'件'+(lastRun.errors?.length?'・失敗 '+lastRun.errors.length+'件':'')+'）':ago(lastRun.startedAt)+' 開始・未完了'}</>}
      </Typography>
      <Button onClick={()=>setShowSkipped(x=>!x)} size="small" sx={{color:V.muted,whiteSpace:'nowrap',alignSelf:'flex-start'}}>
        {showSkipped?'興味なしを隠す':'興味なしも表示'}
      </Button>
    </Stack>

    <Dialog open={Boolean(playing)} onClose={()=>setPlaying(null)} fullWidth maxWidth="lg"
      PaperProps={{sx:{background:'#0f1012',color:'#f2f1ec',border:'1px solid #2a2b2e','--p-ink':'#f2f1ec','--p-muted':'#a8a69f','--p-faint':'#7b7972','--p-sunken':'#1c1d20','--p-accent':'#ff7d5c','--p-pink':'#ff8fb0','--p-teal':'#6fd3c1','--p-amber':'#f0b85a','--p-rule':'rgba(255,255,255,.12)'}}}>
      <Stack direction="row" alignItems="center" gap={.4} sx={{px:2,py:1.2}}>
        <Typography sx={{flex:1,minWidth:0,fontWeight:700,fontSize:14}} noWrap>{playing?.title}</Typography>
        <IconButton aria-label="前の動画" onClick={()=>switchVideo(-1)} sx={{color:'inherit'}}><ArrowBack/></IconButton>
        <IconButton aria-label="次の動画" onClick={()=>switchVideo(1)} sx={{color:'inherit'}}><ArrowForward/></IconButton>
        <IconButton aria-label="閉じる" onClick={()=>setPlaying(null)} sx={{color:'inherit'}}><Close/></IconButton>
      </Stack>
      <DialogContent sx={{pt:0,px:{xs:1,md:2}}}>
        {playing?.videoId&&<Box sx={{aspectRatio:'16/9',width:'100%'}}>
          <Box component="iframe" key={playing.videoId} title={playing.title} src={'https://www.youtube-nocookie.com/embed/'+playing.videoId+'?rel=0'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
            sx={{width:'100%',height:'100%',border:0,borderRadius:1}}/>
        </Box>}
        {playing&&<Stack gap={1} sx={{pt:1.5}}>
          <SourceLine item={playing}/>
          {playing.excerpt&&<Typography sx={{color:'#c9c7c0',fontSize:13,lineHeight:1.7,...clamp(4)}}>{playing.excerpt}</Typography>}
          <Stack direction="row" alignItems="center" gap={.6}>
            <Actions item={items.find(x=>x.id===playing.id)||playing} onAction={react} busy={busy===playing.id} compact={false}/>
            <Button href={playing.url} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNew sx={{fontSize:14}}/>} size="small" sx={{color:'#ff7d5c',ml:'auto'}}>YouTubeで開く</Button>
          </Stack>
        </Stack>}
      </DialogContent>
    </Dialog>
  </Box>;
}
