import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, IconButton, Stack, Typography } from '@mui/material';
import { ArrowBack, ArrowForward, BookmarkBorder, Bookmark, FavoriteBorder, Favorite, Close, PlayArrow, OpenInNew, VisibilityOff, Refresh } from '@mui/icons-material';

const shelves=['すべて','動画','ネット文化','映画','音楽','ゲーム','科学','読みもの','保存済み'];
const typeLabels={video:'動画',article:'記事',website:'Web体験',music:'音楽',art:'アート',game:'ゲーム',other:'発見'};
const youTubeImage=item=>item.videoId ? 'https://i.ytimg.com/vi/'+item.videoId+'/hqdefault.jpg' : item.thumbnail || '';
const css={fontFamily:'"Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif'};
async function api(path='',body=null){
  const user=auth.currentUser;
  if(!user) throw new Error('My Portalにログインしてください');
  const token=await user.getIdToken();
  const response=await fetch('/api/agent-ideas'+path,{
    method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||'通信エラー: '+response.status);
  return data;
}
const readableDate=date=>date?new Date(date).toLocaleDateString('ja-JP'):'';
const cardBase={background:'#1a1a20',border:'1px solid #303039',borderRadius:'18px',overflow:'hidden',transition:'transform .16s,border-color .16s', '&:hover':{transform:'translateY(-3px)',borderColor:'#707080'}};
function ContentImage({item,hero=false}){
  const src=youTubeImage(item);
  return <Box sx={{aspectRatio:'16/9',background:'radial-gradient(circle at 72% 25%,#654064,#26243b 65%,#13141a)',position:'relative',overflow:'hidden'}}>
    {src?<Box component="img" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" sx={{height:'100%',width:'100%',objectFit:'cover',display:'block'}}/>:
      <Box sx={{fontSize:hero?72:43,color:'#e3d4ff',height:'100%',display:'grid',placeItems:'center'}}>✦</Box>}
    {item.videoId && <Box sx={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'linear-gradient(0deg,rgba(0,0,0,.38),transparent)'}}>
      <Box sx={{width:hero?62:48,height:hero?62:48,borderRadius:'50%',background:'rgba(0,0,0,.73)',display:'grid',placeItems:'center',border:'1px solid #fff8'}}><PlayArrow sx={{fontSize:hero?38:30}}/></Box>
    </Box>}
  </Box>;
}
export default function PersonalFeed(){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [shelf,setShelf]=useState('すべて');
  const [active,setActive]=useState(null);
  const [busy,setBusy]=useState('');
  const [includeSkipped,setIncludeSkipped]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{ const data=await api('?resource=personal_feed&limit=200'+(includeSkipped?'&includeSkipped=true':''));setItems(data.items||[]); }
    catch(e){setError(e.message);}
    finally{setLoading(false);}
  },[includeSkipped]);
  useEffect(()=>{load();},[load]);
  const visible=useMemo(()=>{
    return items.filter(item=>{
      if(item.feedback==='skipped'&&!includeSkipped)return false;
      if(shelf==='保存済み')return ['saved','loved'].includes(item.feedback);
      if(shelf==='動画')return item.type==='video';
      if(shelf==='読みもの')return item.type==='article';
      if(shelf==='すべて')return true;
      return item.category===shelf || (item.tags||[]).includes(shelf);
    });
  },[items,shelf,includeSkipped]);
  const hero=visible[0];
  const update=async(item,status)=>{
    setBusy(item.id+':'+status);setError('');
    try{
      const data=await api('',{action:'personal_feed_feedback',id:item.id,status,expectedRevision:item.revision});
      setItems(old=>old.map(x=>x.id===item.id?data:x));
      if(active?.id===item.id)setActive(data);
    }catch(e){setError(e.message);}
    finally{setBusy('');}
  };
  const visit=item=>{
    if(item.videoId){setActive(item);return;}
    window.open(item.url,'_blank','noopener,noreferrer');
  };
  const step=delta=>{
    const index=visible.findIndex(i=>i.id===active?.id);
    if(index>=0 && visible.length>1)setActive(visible[(index+delta+visible.length)%visible.length]);
  };
  const actionStyle={color:'#f5f2ff',borderColor:'#585867',textTransform:'none',fontWeight:700};
  const reactions=item=><Stack direction="row" gap={.8} flexWrap="wrap" onClick={e=>e.stopPropagation()}>
    <Button size="small" variant="outlined" sx={actionStyle} disabled={Boolean(busy)} onClick={()=>update(item,item.feedback==='loved'?'new':'loved')}
      startIcon={item.feedback==='loved'?<Favorite/>:<FavoriteBorder/>}>{item.feedback==='loved'?'好き':'好き'}</Button>
    <Button size="small" variant="outlined" sx={actionStyle} disabled={Boolean(busy)} onClick={()=>update(item,item.feedback==='saved'?'new':'saved')}
      startIcon={item.feedback==='saved'?<Bookmark/>:<BookmarkBorder/>}>{item.feedback==='saved'?'保存済み':'あとで'}</Button>
    <Button size="small" variant="text" sx={{color:'#aaa6b4',textTransform:'none'}} disabled={Boolean(busy)}
      onClick={()=>update(item,'skipped')} startIcon={<VisibilityOff/>}>興味なし</Button>
  </Stack>;
  return <Box sx={{...css,minHeight:'100%',background:'#0f0f14',color:'#f5f3fa',borderRadius:{xs:0,md:3},mx:{xs:-1,sm:-1.5,md:-3},mt:{xs:-1,sm:-1.5,md:-3},px:{xs:2,md:4},py:{xs:3,md:4}}}>
    <Stack direction={{xs:'column',md:'row'}} alignItems={{md:'center'}} justifyContent="space-between" gap={2} sx={{mb:3}}>
      <Box>
        <Typography sx={{fontSize:12,letterSpacing:'.19em',fontWeight:900,color:'#bd9aff'}}>JUST FOR YOU · DISCOVERY</Typography>
        <Typography component="h1" sx={{fontSize:{xs:29,md:42},lineHeight:1.18,fontWeight:900,letterSpacing:'-.04em',mt:.7}}>あなた専用の、寄り道。</Typography>
        <Typography sx={{color:'#a9a6b3',fontSize:14,mt:1}}>仕事にも勉強にもならなくていい。面白そうなものが流れてくる場所。</Typography>
      </Box>
      <Button onClick={load} disabled={loading} startIcon={<Refresh/>} sx={{alignSelf:{xs:'flex-start',md:'center'},color:'#ddd9e6'}}>更新する</Button>
    </Stack>
    <Stack direction="row" gap={1} sx={{overflowX:'auto',pb:1.5,mb:2}}>{shelves.map(name=>
      <Chip key={name} clickable label={name} onClick={()=>setShelf(name)}
        sx={{background:shelf===name?'#e4d1ff':'#26252c',color:shelf===name?'#171020':'#dedbe8',fontWeight:750,'&:hover':{background:shelf===name?'#e4d1ff':'#3b3545'},flexShrink:0}}/>
    )}</Stack>
    {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}
    {loading?<Box sx={{display:'flex',justifyContent:'center',py:10}}><CircularProgress sx={{color:'#bd9aff'}}/></Box>:
    visible.length===0?<Box sx={{textAlign:'center',py:10,border:'1px dashed #4a4655',borderRadius:3}}>
      <Typography sx={{fontSize:30,mb:1}}>✦</Typography>
      <Typography sx={{fontSize:18,fontWeight:800}}>{items.length===0?'キュレーションの準備中':'この棚はまだ空です'}</Typography>
      <Typography sx={{color:'#aaa6b4',fontSize:14,mt:1}}>実在するコンテンツを確認してから並べます。架空のおすすめは載せません。</Typography>
      {shelf!=='すべて'&&<Button onClick={()=>setShelf('すべて')} sx={{mt:2,color:'#d4b3ff'}}>全部を見る</Button>}
    </Box>:<>
      {hero&&<Box sx={{...cardBase,display:{xs:'block',md:'grid'},gridTemplateColumns:'minmax(0,1.25fr) minmax(0,1fr)',mb:4}}>
        <Box role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')visit(hero);}} onClick={()=>visit(hero)} sx={{cursor:'pointer'}}><ContentImage item={hero} hero/></Box>
        <Stack gap={2} justifyContent="center" sx={{p:{xs:2.4,md:3.2}}}>
          <Typography sx={{color:'#d5baff',fontSize:11,fontWeight:900,letterSpacing:'.12em'}}>今日の気になる一品 · {typeLabels[hero.type]||'発見'}</Typography>
          <Typography component="h2" sx={{fontSize:{xs:23,md:29},fontWeight:900,lineHeight:1.36}}>{hero.title}</Typography>
          <Typography sx={{color:'#bbb8c3',fontSize:14,lineHeight:1.75}}>{hero.description}</Typography>
          <Box sx={{borderLeft:'3px solid #b999ee',pl:1.5,color:'#e2d3fa',fontSize:13,lineHeight:1.7}}>なぜおすすめ？ {hero.reason}</Box>
          <Button onClick={()=>visit(hero)} variant="contained" startIcon={hero.videoId?<PlayArrow/>:<OpenInNew/>} sx={{alignSelf:'flex-start',background:'#e1cbff',color:'#1e1630',fontWeight:900,'&:hover':{background:'#cbaafa'}}}>{hero.videoId?'ここで再生':'コンテンツを見る'}</Button>
          {reactions(hero)}
        </Stack>
      </Box>}
      <Typography sx={{fontSize:21,fontWeight:850,mb:2}}>もっと寄り道する <Box component="span" sx={{fontSize:13,color:'#9995a3'}}>· {visible.length}件</Box></Typography>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,minmax(0,1fr))',lg:'repeat(3,minmax(0,1fr))'},gap:2.4}}>
        {visible.slice(1).map(item=><Box key={item.id} sx={cardBase}>
          <Box sx={{cursor:'pointer'}} role="button" tabIndex={0} onClick={()=>visit(item)} onKeyDown={e=>{if(e.key==='Enter')visit(item);}}><ContentImage item={item}/></Box>
          <Stack gap={1.2} sx={{p:2}}>
            <Stack direction="row" gap={1} alignItems="center"><Chip size="small" label={item.category||typeLabels[item.type]} sx={{background:'#393143',color:'#e6d5ff'}}/><Typography sx={{fontSize:11,color:'#9995a3'}}>{item.creator||readableDate(item.createdAt)}</Typography></Stack>
            <Typography onClick={()=>visit(item)} sx={{fontSize:17,fontWeight:850,lineHeight:1.45,cursor:'pointer'}}>{item.title}</Typography>
            <Typography sx={{fontSize:13,color:'#bcbac6',lineHeight:1.65}}>{item.description}</Typography>
            <Typography sx={{fontSize:12,color:'#c7a8f4',lineHeight:1.6}}>おすすめの理由：{item.reason}</Typography>
            <Button onClick={()=>visit(item)} size="small" startIcon={item.videoId?<PlayArrow/>:<OpenInNew/>} sx={{color:'#e5d0ff',alignSelf:'flex-start'}}>見る</Button>
            {reactions(item)}
          </Stack>
        </Box>)}
      </Box>
    </>}
    {items.some(i=>i.feedback==='skipped')&&<Button onClick={()=>setIncludeSkipped(x=>!x)} size="small" sx={{mt:4,color:'#88838e',textTransform:'none'}}>{includeSkipped?'見送り済みを隠す':'興味なしにしたものを表示'}</Button>}
    <Typography sx={{mt:5,fontSize:12,color:'#8f8b9a',lineHeight:1.7}}>外部コンテンツは作者・配信元のサイトで提供されます。動画は再生したときだけYouTubeプレーヤーを読み込みます。好みの評価はこのフィードの推薦改善用です。</Typography>
    <Dialog open={Boolean(active)} onClose={()=>setActive(null)} fullWidth maxWidth="lg" PaperProps={{sx:{background:'#101014',color:'#fff',border:'1px solid #333'}}}>
      <Stack direction="row" alignItems="center" gap={1} sx={{px:2,pt:1.4,pb:1}}>
        <Typography sx={{fontWeight:850,flex:1,minWidth:0}} noWrap>{active?.title}</Typography>
        <IconButton onClick={()=>step(-1)} sx={{color:'#fff'}} aria-label="前のコンテンツ"><ArrowBack/></IconButton>
        <IconButton onClick={()=>step(1)} sx={{color:'#fff'}} aria-label="次のコンテンツ"><ArrowForward/></IconButton>
        <IconButton onClick={()=>setActive(null)} sx={{color:'#fff'}} aria-label="閉じる"><Close/></IconButton>
      </Stack>
      <DialogContent sx={{px:{xs:1,md:2},pt:0}}>
        {active?.videoId&&<Box sx={{aspectRatio:'16/9',width:'100%'}}>
          <Box component="iframe" key={active.videoId} title={active.title} src={'https://www.youtube-nocookie.com/embed/'+active.videoId+'?rel=0'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sx={{width:'100%',height:'100%',border:0,borderRadius:1}}/>
        </Box>}
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" sx={{mt:1.4}}>
          <Button href={active?.url} target="_blank" rel="noopener noreferrer" startIcon={<OpenInNew/>} sx={{color:'#d8c0ff'}}>元のサイトで開く</Button>
          {active&&reactions(active)}
          {active&&<Button onClick={()=>update(active,'seen')} disabled={Boolean(busy)} sx={{color:'#a6a0b3'}}>見た</Button>}
        </Stack>
      </DialogContent>
    </Dialog>
  </Box>;
}
