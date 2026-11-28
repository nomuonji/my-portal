import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, LinearProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography} from '@mui/material';
import {ArrowForward, ArticleOutlined, BiotechOutlined, HistoryOutlined, OpenInNew, Refresh, Search, Inventory2Outlined} from '@mui/icons-material';
import {Link as RouterLink, useSearchParams} from 'react-router-dom';
import {fetchPortalWorld} from './WorldHome';
import {collection, doc, getDoc, getDocs, query, where} from '../documentDbClient';
import {db} from '../firebase';
import {fonts} from '../theme';

const KINDS = {research:'研究',experience:'実作・経験',hypothesis:'仮説'};
const DOMAINS = {'self-study':'自己研鑽','self-improvement':'自己改善','agent-self-improvement':'自己改善','monetization':'収益化','evaluation':'評価・検証','marketing':'マーケティング','creative-judgment':'創作判断','creative-cognition':'創作認知','video-production':'動画制作','web-design':'Webデザイン','ux':'UX','agent-operation':'エージェント運用','market-research':'市場調査','human-motives':'人間理解','software':'ソフトウェア','verification':'実証','humor':'ユーモア'};
const SELF_TAGS = new Set(['self-study','self-improvement','agent-self-improvement','autonomous-capability-development','自己研鑽','自律自己改善']);
const CONTEXTS = ['agent-agenda','W1Ezf9gmcFe7nwYePmd0'];
const DETAIL_FIELDS = [['何を観測したか','observation'],['何を学んだか','inference'],['何を実際に検証したか','validation'],['反例・限界','counterexamples'],['どこで使えるか','application']];
const domainName = key => DOMAINS[key] || key;
const day = value => {
  const d = value?.toDate ? value.toDate() : new Date(value || '');
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d) : '日付不明';
};
const safeHttp = value => {try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const previewText = (text,n=165) => {
  const v=String(text||'').replace(/\s+/g,' ').trim();
  return v.length>n?v.slice(0,n)+'…':v;
};
const eventIds = e => [...new Set(String((e?.summary||'')+' '+(e?.detail||'')).match(/\b[0-9a-f]{64}\b/g)||[])];
const isSelf = row => (row.domains||[]).some(d=>SELF_TAGS.has(d));
const metaSx={fontFamily:fonts.mono,fontSize:11,color:'text.secondary',letterSpacing:'.035em'};
const sectionSx={p:{xs:1.5,sm:2.2},minWidth:0};
const proseSx={whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:1.8};

function MemoryCard({row,onOpen}){
  const p=row.preview||{};
  const take=p.inference||p.observation;
  return <Paper component="article" variant="outlined" sx={{...sectionSx,display:'flex',flexDirection:'column',gap:1.1,position:'relative',borderTop:row.kind==='experience'?'2px solid var(--p-teal)':'2px solid var(--p-rule-strong)'}}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
      <Typography sx={metaSx}>{day(row.createdAt)} / {KINDS[row.kind]||row.kind||'記録'}</Typography>
      <Chip size="small" variant="outlined" label={row.status==='candidate'?'候補・正式採用とは別':row.status||'状態不明'}/>
    </Stack>
    <Typography component="h3" variant="h6" sx={{fontSize:'1.02rem',lineHeight:1.55,overflowWrap:'anywhere'}}>{row.title}</Typography>
    {take&&<Box><Typography variant="overline" color="text.secondary">{p.inference?'知見（記録抜粋）':'観測（記録抜粋）'}</Typography><Typography variant="body2" sx={{overflowWrap:'anywhere'}}>{previewText(take)}</Typography></Box>}
    {p.validation&&<Box sx={{borderLeft:'2px solid var(--p-teal)',pl:1.2,py:.2}}><Typography variant="overline" sx={{color:'var(--p-teal)'}}>検証状況（抜粋）</Typography><Typography variant="body2" sx={{overflowWrap:'anywhere'}}>{previewText(p.validation,125)}</Typography></Box>}
    <Box sx={{display:'flex',flexWrap:'wrap',gap:.5,mt:'auto'}}>{(row.domains||[]).slice(0,5).map(d=><Chip key={d} size="small" variant="outlined" label={domainName(d)}/>)}</Box>
    <Divider/>
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Typography sx={metaSx}>{(row.sourceUrls||[]).length} 出典 / {(row.materialIds||[]).length} 原典</Typography>
      <Button size="small" endIcon={<ArrowForward/>} onClick={()=>onOpen(row.id)}>根拠・限界を見る</Button>
    </Stack>
  </Paper>;
}

function EventCard({event,byId,onOpen}){
  const linked=eventIds(event).filter(id=>byId.has(id));
  return <Paper variant="outlined" component="article" sx={sectionSx}>
    <Typography sx={metaSx}>{day(event.createdAt)} / {event.source||'Context'}</Typography>
    <Typography component="h3" variant="subtitle1" sx={{my:.65,overflowWrap:'anywhere'}}>{event.summary}</Typography>
    {linked.length>0&&<Stack spacing={.45} sx={{my:1.2}}>{linked.map(id=><Button key={id} size="small" onClick={()=>onOpen(id)} startIcon={<ArticleOutlined/>} sx={{justifyContent:'flex-start',textAlign:'left',whiteSpace:'normal',overflowWrap:'anywhere'}}>{byId.get(id).title}</Button>)}</Stack>}
    <Box component="details" sx={{'& summary':{cursor:'pointer',fontSize:13,fontWeight:700,color:'text.secondary',py:.6}}}><summary>活動の詳細・制約</summary><Typography variant="body2" sx={{...proseSx,mt:1}}>{event.detail||'詳細記録なし'}</Typography></Box>
  </Paper>;
}

export default function SelfImprovement(){
  const [params,setParams]=useSearchParams();
  const memoryId=params.get('memory')||'';
  const [tab,setTab]=useState('results'),[rows,setRows]=useState([]),[contexts,setContexts]=useState([]),[outputs,setOutputs]=useState([]);
  const [loading,setLoading]=useState(true),[complete,setComplete]=useState(false),[errors,setErrors]=useState({});
  const [refresh,setRefresh]=useState(0),[scope,setScope]=useState('self'),[kind,setKind]=useState('all'),[domain,setDomain]=useState('all'),[search,setSearch]=useState(''),[visible,setVisible]=useState(18);
  const [detail,setDetail]=useState(null),[detailError,setDetailError]=useState(''),[outputDetail,setOutputDetail]=useState(null);
  const openMemory=useCallback(id=>setParams(old=>{const next=new URLSearchParams(old);next.set('memory',id);return next;}),[setParams]);
  const closeMemory=()=>setParams(old=>{const next=new URLSearchParams(old);next.delete('memory');return next;});
  useEffect(()=>{
    let active=true;
    setLoading(true);setComplete(false);setErrors({});setRows([]);setContexts([]);setOutputs([]);
    const err=(key,e)=>{if(active)setErrors(old=>({...old,[key]:e.message||String(e)}));};
    const loadMemories=async()=>{
      const seen=new Set(), all=new Map();let cursor=null;
      do{
        const p=new URLSearchParams({resource:'agent_memories',preview:'true'});
        if(cursor)p.set('before',cursor);
        const result=await fetchPortalWorld('?'+p);
        if(!active)return;
        for(const row of result.items||[])all.set(row.id,row);
        setRows([...all.values()]);
        cursor=result.nextCursor||null;
        if(cursor&&seen.has(cursor))throw Error('ページ送りが重複したため停止しました');
        if(cursor)seen.add(cursor);
        if(seen.size>=100&&cursor)throw Error('取得上限に到達しました。全件取得ではありません。');
      }while(cursor);
      if(active)setComplete(true);
    };
    const loadContext=async id=>{
      const v=await fetchPortalWorld('?resource=context&id='+encodeURIComponent(id));
      if(active)setContexts(old=>[...old.filter(x=>x.context?.id!==id),v]);
    };
    const loadOutputs=async()=>{
      const snapshot=await getDocs(query(collection(db,'outputs'),where('tags','array-contains','self-improvement')));
      if(active)setOutputs(snapshot.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status!=='archived'));
    };
    Promise.allSettled([loadMemories().catch(e=>err('記憶',e)),...CONTEXTS.map(id=>loadContext(id).catch(e=>err(id==='agent-agenda'?'Agenda':'自己研鑽履歴',e))),loadOutputs().catch(e=>err('制作物',e))]).then(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[refresh]);
  useEffect(()=>{
    let active=true;setDetail(null);setDetailError('');
    if(memoryId)fetchPortalWorld('?resource=agent_memory&id='+encodeURIComponent(memoryId)).then(v=>{if(active)setDetail(v);}).catch(e=>{if(active)setDetailError(e.message||String(e));});
    return ()=>{active=false;};
  },[memoryId,refresh]);
  const events=useMemo(()=>[...new Map(contexts.flatMap(c=>c.history||[]).map(e=>[e.id,e])).values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),[contexts]);
  const byId=useMemo(()=>new Map(rows.map(r=>[r.id,r])),[rows]);
  const linkedIds=useMemo(()=>new Set(events.flatMap(eventIds)),[events]);
  const scoped=useMemo(()=>rows.filter(r=>scope==='all'||isSelf(r)||linkedIds.has(r.id)),[rows,scope,linkedIds]);
  const domains=useMemo(()=>[...new Set(scoped.flatMap(r=>r.domains||[]))].sort((a,b)=>domainName(a).localeCompare(domainName(b),'ja')),[scoped]);
  const filtered=useMemo(()=>scoped.filter(r=>(kind==='all'||r.kind===kind)&&(domain==='all'||(r.domains||[]).includes(domain))&&(!search.trim()||[r.title,r.id,...(r.domains||[]),...Object.values(r.preview||{})].join(' ').toLowerCase().includes(search.trim().toLowerCase()))),[scoped,kind,domain,search]);
  const selfCount=rows.filter(r=>isSelf(r)||linkedIds.has(r.id)).length;
  const agenda=contexts.find(c=>c.context?.id==='agent-agenda')?.context;
  const latest=events.find(e=>eventIds(e).some(id=>byId.has(id)));
  const openOutput=async item=>{
    setOutputDetail({item,loading:true});
    try{
      if(!item.currentVersionId)throw Error('現行版のIDが未登録です');
      const snap=await getDoc(doc(db,'output_versions',item.currentVersionId));
      if(!snap.exists()||snap.data().outputId!==item.id)throw Error('現行版が確認できません');
      const version=snap.data();
      setOutputDetail(current=>current?.item.id===item.id?{item,version}:current);
    }catch(e){setOutputDetail(current=>current?.item.id===item.id?{item,error:e.message}:current);}
  };
  return <Box sx={{maxWidth:1260,mx:'auto',pb:4}}>
    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
      <Box><Typography variant="overline" sx={{color:'var(--p-teal)'}}>AGENT CAPABILITY / EVIDENCE PORTFOLIO</Typography>
      <Typography variant="h4" component="h1">自律自己改善</Typography>
      <Typography color="text.secondary" variant="body2" sx={{mt:.65,maxWidth:720}}>何を研究し、何を実作し、何が確かめられたか。能力の向上を、記録件数や自己採点と区別するための成果一覧です。</Typography></Box>
      <Button startIcon={<Refresh/>} variant="outlined" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>更新</Button>
    </Stack>
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,minmax(0,1fr))',md:'repeat(4,minmax(0,1fr))'},gap:1,mt:2.2}}>
      {[['自己改善関連',selfCount,'記録・履歴参照から抽出'],['実作・経験',rows.filter(r=>r.kind==='experience'&&(isSelf(r)||linkedIds.has(r.id))).length,'正式採用とは別'],['記録された活動',events.length,'Context取得分'],['登録済み制作物',outputs.length,'関連タグの現行成果物']].map(([label,count,note])=><Paper key={label} variant="outlined" sx={{p:{xs:1.2,sm:1.8}}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography sx={{fontFamily:fonts.mono,fontSize:{xs:26,sm:32},fontWeight:700,lineHeight:1.3}}>{loading&&count===0?'—':count}</Typography><Typography variant="caption" color="text.secondary">{note}</Typography></Paper>)}
    </Box>
    {loading&&<Box sx={{mt:1.5}}><LinearProgress/><Typography variant="caption" color="text.secondary">正本を取得中… {rows.length} 件読み込み済み</Typography></Box>}
    {Object.entries(errors).map(([key,msg])=><Alert key={key} severity="warning" sx={{mt:1}}>{key}の取得未完了：{msg}</Alert>)}
    {!loading&&!complete&&<Alert severity="warning" sx={{mt:1}}>記憶一覧は部分取得です。件数や検索結果を全件とみなさないでください。</Alert>}
    <Box sx={{mt:2.5,borderBottom:'1px solid',borderColor:'divider'}}><Tabs value={tab} onChange={(_,v)=>setTab(v)} variant="scrollable" scrollButtons="auto"><Tab value="results" icon={<BiotechOutlined/>} iconPosition="start" label="研究成果"/><Tab value="activity" icon={<HistoryOutlined/>} iconPosition="start" label="活動・課題"/><Tab value="outputs" icon={<Inventory2Outlined/>} iconPosition="start" label="制作物"/></Tabs></Box>
    {tab==='results'&&<Stack spacing={2} sx={{mt:2}}>
      {latest&&<Box><Typography variant="overline" color="text.secondary">LATEST LINKED ACTIVITY</Typography><EventCard event={latest} byId={byId} onOpen={openMemory}/></Box>}
      <Box>
        <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{mb:1.2}}>
          <TextField fullWidth size="small" label="タイトル・分野・抜粋を検索" value={search} onChange={e=>{setSearch(e.target.value);setVisible(18);}} InputProps={{startAdornment:<Search sx={{mr:.7,color:'text.secondary'}}/>}}/>
          <TextField select size="small" label="範囲" value={scope} onChange={e=>{setScope(e.target.value);setDomain('all');setVisible(18);}} sx={{minWidth:130}}><MenuItem value="self">自己改善関連</MenuItem><MenuItem value="all">全Agent Memory</MenuItem></TextField>
          <TextField select size="small" label="種類" value={kind} onChange={e=>{setKind(e.target.value);setVisible(18);}} sx={{minWidth:120}}><MenuItem value="all">すべて</MenuItem>{Object.entries(KINDS).map(([k,v])=><MenuItem key={k} value={k}>{v}</MenuItem>)}</TextField>
          <TextField select size="small" label="分野" value={domain} onChange={e=>{setDomain(e.target.value);setVisible(18);}} sx={{minWidth:145,maxWidth:{md:220}}}><MenuItem value="all">全分野</MenuItem>{domains.map(d=><MenuItem key={d} value={d}>{domainName(d)}</MenuItem>)}</TextField>
        </Stack>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{mb:1}}>
          <Typography variant="subtitle2">{filtered.length} 件中 {Math.min(visible,filtered.length)} 件表示{!complete?'（取得分）':''}</Typography>
          <Typography variant="caption" color="text.secondary">新しい順 / 候補は正式採用と区別</Typography>
        </Stack>
        <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',lg:'repeat(2,minmax(0,1fr))'},gap:1.2}}>{filtered.slice(0,visible).map(r=><MemoryCard row={r} key={r.id} onOpen={openMemory}/>)}</Box>
        {!filtered.length&&!loading&&<Paper variant="outlined" sx={sectionSx}><Typography color="text.secondary">該当する記録はありません。範囲・検索条件を変更できます。</Typography></Paper>}
        {visible<filtered.length&&<Button fullWidth variant="outlined" sx={{mt:1.5}} onClick={()=>setVisible(v=>v+18)}>さらに18件表示</Button>}
      </Box>
    </Stack>}
    {tab==='activity'&&<Stack spacing={1.5} sx={{mt:2}}>
      <Paper variant="outlined" sx={sectionSx}><Typography variant="overline" color="text.secondary">AGENT AGENDA</Typography><Typography variant="h6">現在の目標・課題・一時制約</Typography>
      {agenda?<><Typography variant="caption" color="text.secondary">状態更新：{day(agenda.updatedAt)}（活動履歴とは別）</Typography><Box component="details" sx={{mt:1,'& summary':{cursor:'pointer',fontWeight:700}}}><summary>現在地の全文</summary><Typography variant="body2" sx={{...proseSx,mt:1}}>{agenda.currentState||'未記録'}</Typography></Box><Box component="details" sx={{mt:1,'& summary':{cursor:'pointer',fontWeight:700}}}><summary>次の行動・運用方針</summary><Typography variant="body2" sx={{...proseSx,mt:1}}>{agenda.nextActions||'未記録'}</Typography></Box></>:<Typography color="text.secondary">Agendaは未取得です。</Typography>}
      <Button component={RouterLink} to="/exploration" size="small" endIcon={<ArrowForward/>} sx={{mt:1}}>正式Skillの実行版・本人評価は道場へ</Button></Paper>
      <Typography variant="h6" component="h2">活動履歴 <Typography component="span" variant="caption" color="text.secondary">取得されたContextの記録 / 新しい順</Typography></Typography>
      {events.map(e=><EventCard key={e.id} event={e} byId={byId} onOpen={openMemory}/>)}
    </Stack>}
    {tab==='outputs'&&<Stack spacing={1.5} sx={{mt:2}}>
      <Typography variant="body2" color="text.secondary">アウトプットDBの <code>self-improvement</code> タグ付き制作物を表示します。元の版・評価はアウトプットDBが正本です。</Typography>
      {!outputs.length&&!loading&&<Paper variant="outlined" sx={{...sectionSx,py:4,textAlign:'center'}}><Inventory2Outlined sx={{fontSize:36,color:'text.disabled'}}/><Typography variant="h6">関連制作物はまだ表示されていません</Typography><Typography variant="body2" color="text.secondary">過去チャットだけにある試作品は、恒久保存されるまでここには表示できません。登録数と制作実績は別です。</Typography></Paper>}
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',md:'repeat(2,minmax(0,1fr))'},gap:1.2}}>{outputs.map(item=><Paper key={item.id} variant="outlined" sx={sectionSx}><Typography sx={metaSx}>{item.type} / v{item.currentVersion||'—'} / {day(item.updatedAt)}</Typography><Typography variant="h6" component="h3" sx={{overflowWrap:'anywhere',my:.6}}>{item.title}</Typography><Typography variant="body2" sx={proseSx}>{item.summary}</Typography><Typography variant="caption" color="text.secondary" display="block" sx={{my:.7}}>評価記録 {item.ratingCount||0} 件</Typography><Button size="small" onClick={()=>openOutput(item)} endIcon={<ArrowForward/>}>現行版を見る</Button>{(Array.isArray(item.metadata?.memoryIds)?item.metadata.memoryIds:[]).filter(id=>byId.has(id)).map(id=><Button key={id} size="small" onClick={()=>openMemory(id)}>関連研究</Button>)}</Paper>)}</Box>
      <Button component={RouterLink} to="/outputs" variant="outlined" endIcon={<ArrowForward/>}>アウトプットDBを開く</Button>
    </Stack>}
    <Dialog open={Boolean(memoryId)} onClose={closeMemory} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{overflowWrap:'anywhere'}}>{detail?.title||'研究成果の詳細'}</DialogTitle>
      <DialogContent dividers>
        {detailError?<Alert severity="error">{detailError}</Alert>:!detail?<CircularProgress size={24}/>:<Stack spacing={2.4}>
          <Typography sx={metaSx}>{day(detail.createdAt)} / {KINDS[detail.kind]||detail.kind} / {detail.status==='candidate'?'候補（正式採用とは別）':detail.status}</Typography>
          {DETAIL_FIELDS.map(([label,key])=><Box key={key}><Typography variant="subtitle1" sx={{mb:.45,borderLeft:'2px solid var(--p-teal)',pl:1}}>{label}</Typography><Typography variant="body2" sx={proseSx}>{detail[key]||'未記録'}</Typography></Box>)}
          <Divider/><Typography variant="subtitle1">出典・原典</Typography>
          {!(detail.sourceUrls||[]).length&&!(detail.materialIds||[]).length&&<Typography variant="body2" color="text.secondary">外部出典・原典IDの登録なし。観測と検証記録を参照してください。</Typography>}
          {(detail.sourceUrls||[]).map(url=>safeHttp(url)?<Typography key={url} component="a" href={safeHttp(url)} target="_blank" rel="noopener noreferrer" variant="body2" sx={{overflowWrap:'anywhere',color:'primary.main'}}>{url} <OpenInNew sx={{fontSize:12}}/></Typography>:<Typography key={url} variant="body2">{url}</Typography>)}
          {(detail.materialIds||[]).map(id=><Typography key={id} sx={{...metaSx,overflowWrap:'anywhere'}}>原典ID {id}</Typography>)}
          <Typography sx={{...metaSx,overflowWrap:'anywhere'}}>Memory ID: {detail.id}</Typography>
        </Stack>}
      </DialogContent><DialogActions><Button onClick={closeMemory}>閉じる</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(outputDetail)&&!memoryId} onClose={()=>setOutputDetail(null)} maxWidth="md" fullWidth>
      <DialogTitle>{outputDetail?.item.title}</DialogTitle><DialogContent dividers>
      {outputDetail?.loading?<CircularProgress size={24}/>:outputDetail?.error?<Alert severity="error">{outputDetail.error}</Alert>:outputDetail?.version&&<Stack spacing={1.5}>
        <Typography sx={metaSx}>v{outputDetail.version.versionNumber} / {outputDetail.version.contentFormat}</Typography>
        {safeHttp(outputDetail.version.externalUrl)&&<Button component="a" href={safeHttp(outputDetail.version.externalUrl)} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNew/>}>元ファイルを開く</Button>}
        {outputDetail.version.contentFormat==='html'&&outputDetail.version.content&&<><Typography variant="caption" color="text.secondary">静的プレビュー（外部通信・スクリプト実行なし）</Typography><Box component="iframe" title="制作物の静的プレビュー" sandbox="" referrerPolicy="no-referrer" srcDoc={'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; form-action \'none\'; base-uri \'none\'">'+outputDetail.version.content} sx={{width:'100%',height:420,border:'1px solid',borderColor:'divider',bgcolor:'#fff'}}/></>}
        <Box component="details"><summary>保存された本文・コード</summary><Typography variant="body2" sx={proseSx}>{outputDetail.version.content||'本文なし'}</Typography></Box>
      </Stack>}
      </DialogContent><DialogActions><Button onClick={()=>setOutputDetail(null)}>閉じる</Button></DialogActions>
    </Dialog>
  </Box>;
}
