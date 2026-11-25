import React,{useCallback,useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,Dialog,DialogActions,DialogContent,DialogTitle,Paper,Stack,Tab,Tabs,TextField,Typography,CircularProgress} from '@mui/material';
export default function AgentMemoryPanel({api}){
 const [tab,setTab]=useState('inbox'),[items,setItems]=useState([]),[cursor,setCursor]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[detail,setDetail]=useState(null),[query,setQuery]=useState(''),[domain,setDomain]=useState(''),[key,setKey]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async(before)=>{
  setBusy(true);setError('');
  try{
   const resource=tab==='inbox'?'learning_inbox':tab==='materials'?'learning_materials':'agent_memories';
   const params=new URLSearchParams({resource});
   if(before)params.set('before',before);
   if(tab==='memories'){if(query)params.set('q',query);if(domain)params.set('domain',domain);}
   const result=await api('?'+params.toString());
   const rows=result.items||[];
   setItems(old=>before?[...old,...rows]:rows);
   setCursor(result.nextCursor||(tab==='materials'&&rows.length===30?rows.at(-1).id:null));
  }catch(e){setError(e.message);if(!before)setItems([]);}
  finally{setBusy(false);}
 },[api,tab,query,domain]);
 useEffect(()=>{setItems([]);setCursor(null);load();},[load]);
 const receive=async(id)=>{
  setBusy(true);setError('');
  try{const r=await api('',{method:'POST',body:JSON.stringify({action:'learning_inbox_receive',id})});
   if(r.status!=='received')throw Error('受領を確認できませんでした');
   setNotice('原典をAgent Memoryに受領しました');await load();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const open=async(id)=>{
  setError('');setBusy(true);
  try{setDetail(await api('?resource='+(tab==='materials'?'learning_material':'agent_memory')+'&id='+encodeURIComponent(id)));}
  catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const saveKey=async()=>{
  setBusy(true);setError('');
  try{const r=await api('',{method:'POST',body:JSON.stringify({action:'learning_inbox_set_key',key})});
   if(!r.configured)throw Error('設定を確認できません');setKey('');setNotice('送信キーを設定しました');
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 return <Box sx={{mt:4,pt:2,borderTop:theme=>'1px solid '+theme.palette.divider}}>
  <Typography variant="overline" color="text.secondary">AGENT KNOWLEDGE</Typography>
  <Typography variant="h6" component="h2" fontWeight={850}>Agent Memory — エージェント専用記憶</Typography>
  <Typography variant="body2" color="text.secondary" sx={{mb:2}}>ユーザー提供教材、自律研究、経験・仮説の蓄積。Contextの進捗やSkillの実行規則とは独立しています。受領・研究記録は正式採用を意味しません。</Typography>
  <Paper variant="outlined" sx={{p:2,borderRadius:2}}>
   <Stack direction={{xs:'column',sm:'row'}} spacing={1} alignItems={{sm:'center'}}>
    <TextField fullWidth size="small" type="password" autoComplete="new-password" label="学習送信キー（変更時のみ）" value={key} onChange={e=>setKey(e.target.value)}/>
    <Button disabled={busy||!/^learn-[A-Za-z0-9-]{12,80}$/.test(key)} variant="outlined" onClick={saveKey}>設定</Button>
   </Stack>
   <Tabs value={tab} onChange={(_,v)=>{setTab(v);setNotice('');setDetail(null);}} variant="scrollable" scrollButtons="auto" sx={{mt:2}}>
    <Tab value="inbox" label="受け渡し Inbox"/><Tab value="materials" label="原典教材"/><Tab value="memories" label="研究・経験・仮説"/>
   </Tabs>
   {tab==='memories'&&<Stack spacing={1} direction={{xs:'column',sm:'row'}} sx={{my:1}}>
    <TextField size="small" label="記憶検索" value={query} onChange={e=>setQuery(e.target.value)}/><TextField size="small" label="分野（完全一致）" value={domain} onChange={e=>setDomain(e.target.value)}/>
   </Stack>}
   <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{my:1}}>
    <Typography variant="caption" color="text.secondary">{items.length} 件表示</Typography><Button size="small" disabled={busy} onClick={()=>load()}>更新</Button>
   </Stack>
   {notice&&<Alert severity="success" sx={{mb:1}}>{notice}</Alert>}
   {error&&<Alert severity="error" sx={{mb:1}}>{error}</Alert>}
   {busy&&<CircularProgress size={20}/>}
   {!busy&&!items.length&&<Typography color="text.secondary" sx={{py:2}}>表示する記録がありません。</Typography>}
   <Stack spacing={1}>
   {items.map(item=><Paper key={item.id} variant="outlined" sx={{p:1.5,overflowWrap:'anywhere'}}>
    <Stack direction="row" alignItems="start" justifyContent="space-between" spacing={1}>
      <Typography fontWeight={700}>{item.title||item.postKey||item.id}</Typography>
      <Chip size="small" variant="outlined" label={tab==='inbox'?'未受領':item.learningStatus==='unverified'?'未検証':item.status==='candidate'?'候補':item.status||'記録'}/>
    </Stack>
    {item.sourceUrl&&<Typography variant="body2" component="a" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</Typography>}
    {item.truncated&&<Typography variant="caption" color="text.secondary" display="block">元投稿の省略あり</Typography>}
    {item.domains?.length>0&&<Typography variant="caption" color="text.secondary" display="block">{item.domains.join(' / ')}</Typography>}
    <Button size="small" disabled={busy} onClick={()=>tab==='inbox'?receive(item.id):open(item.id)}>{tab==='inbox'?'原典を受領':'詳細を表示'}</Button>
   </Paper>)}
   </Stack>
   {cursor&&<Button disabled={busy} onClick={()=>load(cursor)}>さらに表示</Button>}
  </Paper>
  <Dialog open={Boolean(detail)} onClose={()=>setDetail(null)} maxWidth="md" fullWidth>
    <DialogTitle>{detail?.title||'教材原典'}</DialogTitle>
    <DialogContent dividers>
      {detail?.post?<Stack spacing={1}><Typography variant="subtitle2">{detail.post.author?.name} {detail.post.author?.handle}</Typography>
      <Typography variant="body2" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.post.text}</Typography>
      {detail.post.quoted&&<Typography variant="body2" sx={{whiteSpace:'pre-wrap'}}>引用: {detail.post.quoted.text}</Typography>}
      <Typography component="a" href={detail.sourceUrl} target="_blank" rel="noreferrer">投稿元</Typography></Stack>:
      <Stack spacing={2}>{[['観測・根拠','observation'],['推論','inference'],['反例・限界','counterexamples'],['実務応用','application'],['検証状況','validation']].map(([label,k])=><Box key={k}><Typography fontWeight={700}>{label}</Typography><Typography variant="body2" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail?.[k]||'未記録'}</Typography></Box>)}
      {detail?.sourceUrls?.map(u=><Typography key={u} variant="body2" sx={{overflowWrap:'anywhere'}}>{u}</Typography>)}</Stack>}
    </DialogContent><DialogActions><Button onClick={()=>setDetail(null)}>閉じる</Button></DialogActions>
  </Dialog>
 </Box>;
}
