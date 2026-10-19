import React, { useMemo, useState } from 'react';
import {
 Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
 DialogTitle, Divider, Paper, Stack, TextField, Typography
} from '@mui/material';
import {
 AccountTreeOutlined as TreeIcon, AddOutlined as AddIcon,
 HistoryOutlined as HistoryIcon, EditOutlined as EditIcon,
 BookmarkAddOutlined as SaveIcon
} from '@mui/icons-material';

const makeDraft = () => ({
 title:'',summary:'',purpose:'',decisions:'',currentState:'',nextActions:'',
 projectIds:[],domains:'',status:'active'
});
const decode = item=>({...makeDraft(),...item,domains:(item.domains||[]).join(', ')});
const encode = draft=>({
 title:draft.title,summary:draft.summary,purpose:draft.purpose,
 decisions:draft.decisions,currentState:draft.currentState,nextActions:draft.nextActions,
 projectIds:draft.projectIds||[],domains:draft.domains.split(/[,、\n]/).map(x=>x.trim()).filter(Boolean),
 status:draft.status
});
const shortDate = value => value ? new Date(value).toLocaleString('ja-JP') : '';
export default function ContextPanel({contexts=[],projects=[],query='',api,afterSave}) {
 const [detail,setDetail]=useState(null);
 const [draft,setDraft]=useState(makeDraft());
 const [editing,setEditing]=useState(false);
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [eventKind,setEventKind]=useState('correction');
 const [eventSummary,setEventSummary]=useState('');
 const [eventDetail,setEventDetail]=useState('');
 const [history,setHistory]=useState([]);
 const [projectFilter,setProjectFilter]=useState('all');
 const [domainFilter,setDomainFilter]=useState('all');
 const map = useMemo(()=>new Map(projects.map(x=>[x.id,x.name])),[projects]);
 const domains=useMemo(()=>[...new Set(contexts.flatMap(c=>c.domains||[]))].sort(),[contexts]);
 const visible=contexts.filter(c=>(projectFilter==='all'||c.projectIds?.includes(projectFilter))
  &&(domainFilter==='all'||c.domains?.includes(domainFilter))
  &&(!query||JSON.stringify(c).toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 const open = async c=>{
   setError('');setEditing(false);setEventSummary('');setEventDetail('');setHistory([]);
   setLoading(true);
   try {
    const item=await api(`?resource=context&id=${encodeURIComponent(c.id)}`);
    setDetail(item.context);setDraft(decode(item.context));setHistory(item.history||[]);
   } catch(e){setError(e.message);setDetail(c);setDraft(decode(c));}
   finally{setLoading(false);}
 };
 const create = ()=>{
   setDetail({id:null,revision:0,title:'新しいContext',projectIds:[],domains:[]});
   setDraft({...makeDraft(),title:'新しいContext'});
   setHistory([]);setEditing(true);setError('');
 };
 const save = async ()=>{
   const body=encode(draft);
   if(!body.title.trim()||!(body.projectIds.length||body.domains.length)){
     setError('タイトルと、ProjectまたはDomainの紐づけが必要です');return;
   }
   setSaving(true);setError('');
   try{
    const result=await api('',{method:'POST',body:JSON.stringify({
      action:'context_save',id:detail.id||undefined,context:body,expectedRevision:detail.revision||0,confirm:true
    })});
    setDetail(result.context);setDraft(decode(result.context));setHistory(result.history||[]);
    setEditing(false);await afterSave();
   }catch(e){setError(e.message);}
   finally{setSaving(false);}
 };
 const addEvent=async()=>{
   if(!detail?.id||!eventSummary.trim())return;
   setSaving(true);setError('');
   try{
    await api('',{method:'POST',body:JSON.stringify({
      action:'context_event_create',contextId:detail.id,kind:eventKind,summary:eventSummary,
      detail:eventDetail,source:'world-home',confirm:true
    })});
    const result=await api(`?resource=context&id=${encodeURIComponent(detail.id)}`);
    setHistory(result.history||[]);setEventSummary('');setEventDetail('');
    await afterSave();
   }catch(e){setError(e.message);}
   finally{setSaving(false);}
 };
 const toggleProject=id=>setDraft(d=>({...d,projectIds:d.projectIds.includes(id)?
     d.projectIds.filter(x=>x!==id):[...d.projectIds,id]}));
 return <>
  <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} spacing={1.25} sx={{mt:{xs:4,md:5},pt:1.6,mb:1.4,borderTop:theme=>`1px solid ${theme.palette.divider}`}}>
    <Box>
      <Typography variant="overline" sx={{color:'text.disabled'}}>04 — Continuity</Typography>
      <Stack direction="row" spacing={1} alignItems="center">
        <TreeIcon color="primary"/><Typography variant="h6" fontWeight={850}>Contexts</Typography>
        <Chip size="small" label={contexts.length} variant="outlined" />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{mt:.4}}>
        プロジェクトとドメイン別のコンテクスト。既決事項・現在地・訂正履歴を引き継ぐための独立した保存領域です。
      </Typography>
    </Box>
    <Button variant="contained" startIcon={<AddIcon/>} onClick={create}>Contextを作成</Button>
  </Stack>
  <Paper variant="outlined" sx={{p:1.2,mb:1.4,borderRadius:2.3}}>
    <Stack direction={{xs:'column',sm:'row'}} spacing={1}>
      <TextField select SelectProps={{native:true}} size="small" label="Project" value={projectFilter}
        onChange={e=>setProjectFilter(e.target.value)} fullWidth>
        <option value="all">すべてのProject</option>
        {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </TextField>
      <TextField select SelectProps={{native:true}} size="small" label="Domain" value={domainFilter}
        onChange={e=>setDomainFilter(e.target.value)} fullWidth>
        <option value="all">すべてのDomain</option>
        {domains.map(d=><option key={d} value={d}>{d}</option>)}
      </TextField>
    </Stack>
  </Paper>
  <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},gap:1.15}}>
    {visible.map(c=><Paper key={c.id} variant="outlined" sx={{p:2,borderRadius:2.3}}>
      <Stack direction="row" justifyContent="space-between" gap={1} alignItems="start">
        <Typography fontWeight={850} variant="subtitle1">{c.title}</Typography>
        <Chip size="small" label={c.status||'active'} variant="outlined"/>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{mt:.5,lineHeight:1.65}}>{c.summary||c.purpose||'概要未登録'}</Typography>
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={.6} sx={{mt:1.1}}>
        {(c.projectIds||[]).map(id=><Chip key={id} size="small" label={map.get(id)||id} color="primary" variant="outlined"/> )}
        {(c.domains||[]).slice(0,5).map(d=><Chip key={d} size="small" label={d} variant="outlined"/>)}
      </Stack>
      <Stack direction="row" gap={.6} sx={{mt:1.25}}>
        <Button size="small" onClick={()=>open(c)}>現在地と履歴を見る</Button>
        <Button size="small" startIcon={<EditIcon fontSize="small"/>} onClick={()=>{open(c).then(()=>setEditing(true));}}>編集</Button>
      </Stack>
    </Paper>)}
  </Box>
  {visible.length===0&&<Typography color="text.secondary" sx={{py:2}}>該当するContextがありません。</Typography>}
  <Dialog fullWidth maxWidth="md" open={Boolean(detail)} onClose={()=>{if(!saving)setDetail(null);}}>
    <DialogTitle sx={{fontWeight:850}}>Context — {detail?.title||'新規'}</DialogTitle>
    <DialogContent dividers>
      {loading?<CircularProgress size={24}/>:<Stack spacing={2}>
        {error&&<Alert severity="error">{error}</Alert>}
        {detail?.legacySpaceId&&<Alert severity="info" sx={{fontSize:13}}>旧AI側SpaceからコピーしたContextです。元のSpaceは履歴として保存されています。今後の更新はContexts側で管理します。</Alert>}
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Chip label={editing?'編集モード':'現在地'} variant="outlined"/>
          {!editing&&<Button startIcon={<EditIcon/>} onClick={()=>setEditing(true)}>編集</Button>}
        </Stack>
        {editing?<>
          {[
            ['title','タイトル',1],['summary','概要',2],['purpose','目的',2],
            ['decisions','既決事項・禁止事項',4],['currentState','現状',4],['nextActions','次にやること',2],
          ].map(([k,label,rows])=><TextField key={k} label={label} value={draft[k]||''}
             multiline={rows>1} minRows={rows>1?rows:undefined} size="small"
             onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} fullWidth/> )}
          <Typography variant="subtitle2">関連Project</Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={.6}>
            {projects.map(p=><Chip key={p.id} clickable onClick={()=>toggleProject(p.id)}
              color={draft.projectIds.includes(p.id)?'primary':'default'}
              variant={draft.projectIds.includes(p.id)?'filled':'outlined'}
              label={p.name}/>)}
          </Stack>
          <TextField label="Domains（カンマ区切り）" value={draft.domains||''} fullWidth
            onChange={e=>setDraft(d=>({...d,domains:e.target.value}))} />
          <TextField select SelectProps={{native:true}} label="状態" value={draft.status}
            onChange={e=>setDraft(d=>({...d,status:e.target.value}))}>
            <option value="active">active</option><option value="paused">paused</option><option value="archived">archived</option>
          </TextField>
        </>:<>
          {[
            ['目的',detail?.purpose],['既決事項・禁止事項',detail?.decisions],
            ['現在地',detail?.currentState],['次',detail?.nextActions],
          ].map(([k,v])=><Box key={k}>
            <Typography variant="subtitle2" fontWeight={850}>{k}</Typography>
            <Typography variant="body2" sx={{whiteSpace:'pre-wrap',mt:.35,lineHeight:1.7}}>{v||'未登録'}</Typography>
          </Box>)}
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={.5}>
            {(detail?.projectIds||[]).map(p=><Chip key={p} color="primary" size="small" label={map.get(p)||p}/>)}
            {(detail?.domains||[]).map(d=><Chip key={d} size="small" label={d} variant="outlined"/>)}
          </Stack>
        </>}
        <Divider/>
        <Stack direction="row" spacing={1} alignItems="center">
          <HistoryIcon color="action"/><Typography variant="subtitle1" fontWeight={850}>判断と訂正の履歴</Typography>
          <Chip label={history.length} size="small" variant="outlined"/>
        </Stack>
        {history.map(event=><Paper key={event.id} variant="outlined" sx={{p:1.25,borderRadius:1.7}}>
           <Typography variant="caption" color="text.secondary">{event.kind} · {shortDate(event.createdAt)}</Typography>
           <Typography variant="body2" sx={{mt:.3,fontWeight:700}}>{event.summary}</Typography>
           {event.detail&&<Typography variant="body2" color="text.secondary" sx={{mt:.35,whiteSpace:'pre-wrap'}}>{event.detail}</Typography>}
        </Paper>)}
        {history.length===0&&<Typography variant="body2" color="text.secondary">まだ履歴はありません。</Typography>}
        {detail?.id&&<Stack spacing={1.15}>
          <Typography variant="subtitle2" fontWeight={850}>判断・訂正・引き継ぎを追記</Typography>
          <TextField select SelectProps={{native:true}} size="small" value={eventKind} label="種類" onChange={e=>setEventKind(e.target.value)}>
            <option value="decision">確定した決定</option><option value="correction">訂正・手戻り防止</option>
            <option value="handoff">次回への引き継ぎ</option><option value="finding">発見</option><option value="update">状態変更</option>
          </TextField>
          <TextField label="残すべき結論" size="small" fullWidth multiline minRows={2} value={eventSummary}
            onChange={e=>setEventSummary(e.target.value)}/>
          <TextField label="判断の背景（任意）" size="small" multiline minRows={2} fullWidth value={eventDetail}
            onChange={e=>setEventDetail(e.target.value)}/>
          <Button startIcon={<SaveIcon/>} disabled={saving||!eventSummary.trim()}
            onClick={addEvent} variant="outlined">履歴に追記</Button>
        </Stack>}
      </Stack>}
    </DialogContent>
    <DialogActions>
      <Button disabled={saving} onClick={()=>{setDetail(null);setError('');}}>閉じる</Button>
      {editing&&<Button disabled={saving||loading} variant="contained" onClick={save}>Contextを保存</Button>}
    </DialogActions>
  </Dialog>
 </>;
}
