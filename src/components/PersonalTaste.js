import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import TasteSourceConnections from './TasteSourceConnections';
import {auth} from '../firebase';
import {Alert,Box,Button,CircularProgress,Dialog,DialogActions,DialogContent,DialogTitle,
  FormControl,InputLabel,MenuItem,Select,Stack,TextField,Typography} from '@mui/material';
import {Add,Refresh,Edit,History,OpenInNew,ArrowForward} from '@mui/icons-material';

const V={bg:'var(--p-bg)',surface:'var(--p-surface)',sunken:'var(--p-sunken)',ink:'var(--p-ink)',muted:'var(--p-muted)',faint:'var(--p-faint)',
 rule:'var(--p-rule)',ruleStrong:'var(--p-rule-strong)',accent:'var(--p-accent)',amber:'var(--p-amber)',blue:'var(--p-blue)',green:'var(--p-green)',pink:'var(--p-pink)'};
const MONO='"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const TYPES={
 explicit_user:{label:'本人の明示評価',color:V.accent,description:'本人が直接判断した。閲覧や保存から推測しない'},
 expression_inference:{label:'表現からの仮説',color:V.amber,description:'本人の原文からの推測。視聴の好みは未確認'},
 external_reference:{label:'外部参考作品',color:V.blue,description:'ラジ父・村上RADIO等。本人の好みと混同しない'},
 watch_later:{label:'後で見る',color:V.faint,description:'メモや保存。好評価ではない'}
};
const DIRECTIONS={like:'好き',dislike:'嫌い',boundary:'判断・境界',unknown:'未確定'};
const DIRECTION_COLORS={like:V.green,dislike:V.pink,boundary:V.amber,unknown:V.faint};
const DOMAINS={discover:'Discover',humor:'ユーモア',writing:'文章・文体',design:'デザイン',ideas:'企画',media:'作品・文化',general:'全般'};
const TARGETS={item:'個別作品・提案',creator:'制作者',genre:'ジャンル',pattern:'表現・特徴',format:'形式',editorial_policy:'編集方針',unspecified:'未分類'};
async function api(path='',body=null){
 const user=auth.currentUser;if(!user)throw Error('My Portalにログインしてください');
 const response=await fetch('/api/agent-ideas'+path,{method:body?'POST':'GET',
  headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'通信に失敗しました ('+response.status+')');
 return data;
}
const initial={title:'',detail:'',domain:'discover',direction:'dislike',caveat:'',targetKind:'pattern',facetsText:'',appliesTo:['discover']};
const SOURCE_LABELS={user_message:'本人の発言',user_post:'本人の投稿',external_raw:'外部参考資料',bookmark:'後で見るメモ',discover_item:'Discoverの評価'};
function Dot({color,size=8}){
 return <Box component="span" aria-hidden sx={{display:'inline-block',width:size,height:size,borderRadius:'50%',background:color,flexShrink:0}}/>;
}
function Evidence({entry,onHistory,onEdit,onArchive}){
 const kind=TYPES[entry.evidenceKind];
 const dirColor=DIRECTION_COLORS[entry.direction]||V.faint;
 return <Box component="article" sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'150px minmax(0,1fr)'},columnGap:3,rowGap:.8,
   py:2.2,borderBottom:'1px solid '+V.rule,opacity:entry.status!=='active'?.62:1}}>
  <Stack direction={{xs:'row',md:'column'}} gap={{xs:1.2,md:.6}} alignItems={{xs:'center',md:'flex-start'}} sx={{flexWrap:'wrap',pt:{md:.4}}}>
   <Typography component="span" sx={{fontSize:12.5,fontWeight:800,color:dirColor}}>{DIRECTIONS[entry.direction]||'未確定'}</Typography>
   <Stack direction="row" alignItems="center" gap={.7}>
    <Dot color={kind?.color||V.faint} size={7}/>
    <Typography component="span" sx={{fontSize:11.5,color:V.muted}}>{kind?.label||entry.evidenceKind}</Typography>
   </Stack>
   <Typography component="span" sx={{fontSize:11,color:V.faint,fontFamily:MONO}}>
    {DOMAINS[entry.domain]||entry.domain} · {TARGETS[entry.target?.kind]||'未分類'}
   </Typography>
   {entry.status!=='active'&&<Typography component="span" sx={{fontSize:11,color:V.faint}}>過去の判断</Typography>}
  </Stack>
  <Box sx={{minWidth:0}}>
   <Typography component="h3" sx={{fontWeight:700,fontSize:16,lineHeight:1.5}}>{entry.title}</Typography>
   <Typography sx={{mt:.5,fontSize:13.5,lineHeight:1.85,color:V.ink,whiteSpace:'pre-wrap'}}>{entry.detail}</Typography>
   {entry.caveat&&<Typography sx={{fontSize:12.5,lineHeight:1.7,mt:.8,color:V.muted,pl:1.2,borderLeft:'2px solid '+V.rule}}>
    <Box component="span" sx={{fontWeight:700}}>例外・留保　</Box>{entry.caveat}</Typography>}
   {!!entry.facets?.length&&<Stack direction="row" gap={.5} flexWrap="wrap" sx={{mt:1}}>{entry.facets.map(tag=>
    <Box key={tag} component="span" sx={{fontSize:11.5,color:V.muted,border:'1px solid '+V.rule,borderRadius:.7,px:.8,py:.1}}>{tag}</Box>
   )}</Stack>}
   <Stack direction="row" alignItems="center" gap={.2} sx={{mt:1,ml:-.8,flexWrap:'wrap'}}>
    <Box component="details" sx={{flex:'1 1 100%',order:9,'& summary':{fontSize:12,cursor:'pointer',color:V.muted,'&:hover':{color:V.ink}}}}>
     <Box component="summary">出典 <Box component="span" sx={{fontFamily:MONO}}>{entry.sourceRefs?.length||0}</Box></Box>
     <Stack gap={.5} sx={{mt:.8,p:1.2,background:V.sunken,borderRadius:1}}>
      {(entry.sourceRefs||[]).map((src,i)=><Typography key={i} sx={{fontSize:11.5,color:V.muted,overflowWrap:'anywhere'}}>
       {SOURCE_LABELS[src.kind]||'出典'}：
       {src.url?<Box component="a" href={src.url} rel="noopener noreferrer" target="_blank" sx={{color:V.accent,ml:.5}}>{src.id||src.url} <OpenInNew sx={{fontSize:10}}/></Box>:<Box component="span" sx={{ml:.5,fontFamily:MONO,fontSize:11}}>{src.id}</Box>}
       {src.note?' — '+src.note:''}
      </Typography>)}
      <Typography sx={{fontSize:10.5,color:V.faint,fontFamily:MONO}}>updated {entry.updatedAt?new Date(entry.updatedAt).toLocaleString('ja-JP'):'-'} · rev {entry.revision||1}</Typography>
     </Stack>
    </Box>
    <Button size="small" startIcon={<Edit sx={{fontSize:'16px !important'}}/>} sx={{fontSize:12,color:V.ink}} onClick={()=>onEdit(entry)}>
     {entry.evidenceKind==='explicit_user'?'訂正':'この仮説を評価'}
    </Button>
    <Button size="small" startIcon={<History sx={{fontSize:'16px !important'}}/>} sx={{fontSize:12,color:V.muted}} onClick={()=>onHistory(entry.id)}>履歴</Button>
    {entry.status==='active'&&<Button size="small" sx={{fontSize:12,color:V.muted}} onClick={()=>onArchive(entry)}>取り消す</Button>}
   </Stack>
  </Box>
 </Box>;
}
function Section({index,title,count,subtitle,action,children}){
 return <Box component="section" sx={{mt:{xs:4.5,md:5.5}}}>
  <Stack direction="row" justifyContent="space-between" alignItems="flex-end" gap={1} sx={{pb:1.2,borderBottom:'1px solid '+V.ink}}>
   <Box sx={{minWidth:0}}>
    <Typography variant="overline" sx={{color:V.faint,display:'block'}}>{index}</Typography>
    <Stack direction="row" alignItems="baseline" gap={1}>
     <Typography component="h2" sx={{fontSize:18,fontWeight:800,lineHeight:1.3}}>{title}</Typography>
     {count!==undefined&&<Typography component="span" sx={{fontFamily:MONO,fontSize:12,color:V.muted}}>{count}</Typography>}
    </Stack>
    {subtitle&&<Typography sx={{fontSize:12.5,color:V.muted,mt:.3,maxWidth:760}}>{subtitle}</Typography>}
   </Box>
   {action}
  </Stack>
  {children}
 </Box>;
}
export default function PersonalTaste(){
 const [items,setItems]=useState([]),[summary,setSummary]=useState({}),[profile,setProfile]=useState({facets:[]});
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [domain,setDomain]=useState('all'),[kind,setKind]=useState('all'),[search,setSearch]=useState(''),[facet,setFacet]=useState('all');
 const [includeInactive,setIncludeInactive]=useState(false);
 const [dialog,setDialog]=useState(null),[form,setForm]=useState(initial);
 const [history,setHistory]=useState(null);
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const data=await api('?resource=taste_evidence&limit=300&includeInactive='+includeInactive);
   setItems(data.items||[]);setSummary(data.summary||{});setProfile(data.profile||{facets:[]});
  }catch(e){setError(e.message)}finally{setLoading(false)}
 },[includeInactive]);
 useEffect(()=>{load()},[load]);
 const visibleFacets=(profile.facets||[]).filter(x=>domain==='all'||x.domains.includes(domain));
 const filtered=useMemo(()=>items.filter(x=>
  (domain==='all'||(x.appliesTo||[x.domain]).includes(domain))&&(kind==='all'||x.evidenceKind===kind)&&
  (facet==='all'||(x.facets||[]).some(t=>t.normalize('NFKC').toLocaleLowerCase()===facet))&&
  (!search||[x.title,x.detail,x.caveat,x.domain,x.target?.label,...(x.facets||[])].join(' ').toLowerCase().includes(search.toLowerCase()))
 ),[items,domain,kind,facet,search]);
 const edit=(entry=null)=>{
  setHistory(null);setError('');
  if(entry&&entry.evidenceKind==='explicit_user'){
   setForm({title:entry.title,detail:entry.detail,domain:entry.domain,direction:entry.direction,
    caveat:entry.caveat||'',targetKind:entry.target?.kind||'unspecified',facetsText:(entry.facets||[]).join('、'),
    appliesTo:entry.appliesTo||[entry.domain]});
   setDialog({type:'edit',entry});
  }else{
   setForm(entry?{title:entry.title,detail:'この仮説・参考資料に対する本人の判断：',domain:entry.domain,
    direction:'dislike',caveat:'',targetKind:entry.target?.kind||'item',facetsText:'',appliesTo:[entry.domain]}:initial);
   setDialog({type:'new',entry});
  }
 };
 const save=async()=>{
  if(!dialog||!form.title.trim()||!form.detail.trim())return;
  setSaving(true);setError('');
  try{
   const time=Date.now().toString(36),original=dialog.entry;
   const isEdit=dialog.type==='edit';
   const previous=(original?.sourceRefs||[]).filter(x=>x.kind!=='other');
   const refs=isEdit?previous:[
    {kind:'user_message',id:'my-portal-user-ui-'+time,note:'本人がこの画面で直接入力した評価'},
    ...(original?[{kind:'other',id:original.id,note:'この候補や仮説についての本人の評価'}]:[])
   ];
   const {facetsText,targetKind,...main}=form;
   const facets=[...new Set(facetsText.split(/[、,\n]/).map(x=>x.trim()).filter(Boolean))];
   const record={...main,facets,target:{kind:targetKind,label:form.title.trim(),
     key:isEdit?(original.target?.key||''):''},
    evidenceKind:'explicit_user',confidence:1,status:'active',
    origin:'direct_user_ui',topicKey:isEdit?(original.topicKey||''):'',
    sourceRefs:refs};
   await api('',{action:'taste_evidence_upsert',id:isEdit?original.id:undefined,
    expectedRevision:isEdit?original.revision:undefined,record,
    changeReason:isEdit?'本人による直接の訂正':'本人が直接入力した好悪の評価'});
   setDialog(null);await load();
  }catch(e){setError(e.message)}finally{setSaving(false)}
 };
 const archive=async(entry)=>{
  if(!window.confirm('この評価を履歴に残したまま非表示にしますか？'))return;
  setSaving(true);setError('');
  try{const {id,revision,createdAt,updatedAt,...record}=entry;
   await api('',{action:'taste_evidence_upsert',id,expectedRevision:revision,
    record:{...record,status:'superseded'},changeReason:'本人がこの判断を取り消した'});
   await load();
  }catch(e){setError(e.message)}finally{setSaving(false)}
 };
 const openHistory=async(id)=>{setHistory({id,items:[],loading:true});try{
  const data=await api('?resource=taste_evidence_history&id='+encodeURIComponent(id));
  setHistory({id,items:data.items||[],loading:false});
 }catch(e){setError(e.message);setHistory(null)}};
 const counts={explicit_user:summary.explicit||0,expression_inference:summary.hypotheses||0,external_reference:summary.referenceOnly||0,watch_later:summary.watchLater||0};
 const selectSx={'& .MuiSelect-select':{py:'7px',fontSize:13}};
 return <Box sx={{maxWidth:1180,mx:'auto',pb:6,color:V.ink}}>
  <Box component="header" sx={{pt:{xs:1,md:1.5}}}>
   <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
    <Typography sx={{fontFamily:MONO,fontSize:{xs:11,md:12},letterSpacing:'.06em',color:V.muted}}>
     TASTE LEDGER — {profile.explicitCount??counts.explicit_user} 件の明示評価
    </Typography>
    <Button component={Link} to="/discover" size="small" endIcon={<ArrowForward sx={{fontSize:15}}/>} sx={{color:V.muted,'&:hover':{color:V.ink}}}>Discover</Button>
   </Stack>
   <Stack direction={{xs:'column',md:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',md:'flex-end'}} gap={1.5} sx={{mt:.6}}>
    <Box>
     <Typography component="h1" sx={{fontSize:{xs:30,md:40},fontWeight:900,letterSpacing:'-.035em',lineHeight:1.1}}>好みの記録</Typography>
     <Typography sx={{fontSize:{xs:13.5,md:14.5},lineHeight:1.7,color:V.muted,mt:.9,maxWidth:640}}>
      好き嫌いの判断と、その理由・例外・訂正の履歴。AIの仮説や「後で見る」メモとは混ぜずに保管します。
     </Typography>
    </Box>
    <Stack direction="row" gap={1} sx={{flexShrink:0}}>
     <Button onClick={load} variant="outlined" startIcon={<Refresh/>}>更新</Button>
     <Button variant="contained" onClick={()=>edit()} startIcon={<Add/>}>好みを記録</Button>
    </Stack>
   </Stack>
  </Box>

  <Box role="group" aria-label="出典の種類で絞り込む" sx={{mt:{xs:2.5,md:3.5},display:'grid',gridTemplateColumns:{xs:'repeat(2,minmax(0,1fr))',md:'repeat(4,minmax(0,1fr))'},
    borderTop:'1px solid '+V.rule,borderLeft:'1px solid '+V.rule,background:V.surface,borderRadius:1.5,overflow:'hidden'}}>
   {Object.entries(TYPES).map(([key,type])=>{
    const on=kind===key;
    return <Box key={key} component="button" type="button" aria-pressed={on} onClick={()=>setKind(k=>k===key?'all':key)}
     sx={{textAlign:'left',font:'inherit',color:'inherit',cursor:'pointer',border:0,borderRight:'1px solid '+V.rule,borderBottom:'1px solid '+V.rule,
      background:on?V.sunken:'transparent',px:{xs:1.5,md:2},py:{xs:1.4,md:1.7},position:'relative',
      boxShadow:on?'inset 0 -2px 0 '+type.color:'none','&:hover':{background:V.sunken}}}>
     <Stack direction="row" alignItems="center" gap={.8}>
      <Dot color={type.color}/>
      <Typography sx={{fontSize:12.5,fontWeight:700}}>{type.label}</Typography>
      <Typography sx={{fontFamily:MONO,fontSize:15,fontWeight:600,ml:'auto'}}>{counts[key]}</Typography>
     </Stack>
     <Typography sx={{fontSize:11.5,color:V.muted,lineHeight:1.55,mt:.5,display:{xs:'none',sm:'block'}}}>{type.description}</Typography>
    </Box>;
   })}
  </Box>

  <Section index="01 — Reasons" title="判断理由の傾向" count={visibleFacets.length||undefined}
   subtitle="本人が明示した評価のタグだけを集計しています。AIの推測や後で見るメモは含めません。押すと一覧を絞り込めます。"
   action={facet!=='all'&&<Button onClick={()=>setFacet('all')} size="small">解除</Button>}>
   {visibleFacets.length?<Stack direction="row" flexWrap="wrap" gap={.7} sx={{mt:1.8}}>
    {visibleFacets.slice(0,24).map(x=>{
     const on=facet===x.key;
     return <Box key={x.key} component="button" type="button" aria-pressed={on} onClick={()=>setFacet(f=>f===x.key?'all':x.key)}
      sx={{font:'inherit',cursor:'pointer',display:'inline-flex',alignItems:'baseline',gap:.8,border:'1px solid '+(on?V.ink:x.state==='mixed'?V.amber:V.ruleStrong),
       background:on?V.ink:V.surface,color:on?V.bg:V.ink,borderRadius:1,px:1.2,py:.55,fontSize:12.5,fontWeight:600,'&:hover':{borderColor:V.ink}}}>
      {x.label}
      <Box component="span" sx={{fontFamily:MONO,fontSize:11,fontWeight:500,color:on?V.bg:V.muted}}>
       {[x.like?'好'+x.like:'',x.dislike?'嫌'+x.dislike:'',x.boundary?'方針'+x.boundary:''].filter(Boolean).join(' ')}
      </Box>
      {x.state==='mixed'&&<Box component="span" sx={{fontSize:10.5,color:on?V.bg:V.amber}}>賛否あり</Box>}
      {x.state==='single'&&<Box component="span" sx={{fontSize:10.5,color:on?V.bg:V.faint}}>単発</Box>}
     </Box>;
    })}
   </Stack>:<Typography sx={{mt:1.8,fontSize:13,color:V.muted}}>
    この分野の理由タグはまだありません。評価を「訂正」するときに具体的な理由を足せます。
   </Typography>}
   <Typography sx={{mt:1.4,fontSize:11,color:V.faint,fontFamily:MONO}}>
    明示評価 {profile.explicitCount||0} · 理由未分類 {profile.uncategorized||0}{profile.mayBeIncomplete?' · 集計上限に達したため一部のみ':''}
   </Typography>
  </Section>

  <Section index="02 — Evidence" title="記録" count={filtered.length}
   subtitle={kind!=='all'?TYPES[kind]?.label+'だけを表示中':'すべての出典を表示中'}>
   <Stack direction={{xs:'column',sm:'row'}} gap={1} alignItems={{sm:'center'}} sx={{mt:1.8,mb:.5}}>
    <TextField value={search} onChange={e=>setSearch(e.target.value)} placeholder="評価・理由・例外を検索" size="small" sx={{flex:1}}
     inputProps={{'aria-label':'評価を検索'}}/>
    <FormControl size="small" sx={{minWidth:150}}>
     <InputLabel>分野</InputLabel>
     <Select label="分野" value={domain} onChange={e=>setDomain(e.target.value)} sx={selectSx}>
      <MenuItem value="all">すべて</MenuItem>{Object.entries(DOMAINS).map(([key,value])=><MenuItem value={key} key={key}>{value}</MenuItem>)}
     </Select>
    </FormControl>
    <Button size="small" variant={includeInactive?'contained':'outlined'} onClick={()=>setIncludeInactive(x=>!x)} sx={{whiteSpace:'nowrap'}}>
     訂正前も表示
    </Button>
   </Stack>
   {error&&<Alert severity="error" sx={{my:2}} onClose={()=>setError('')}>{error}</Alert>}
   {loading?<Box sx={{p:6,textAlign:'center'}}><CircularProgress size={28}/></Box>:
    filtered.length?<Box>{filtered.map(entry=><Evidence key={entry.id} entry={entry} onEdit={edit} onHistory={openHistory} onArchive={archive}/>)}</Box>:
    <Box sx={{my:2,border:'1px dashed '+V.ruleStrong,borderRadius:1.5,py:6,textAlign:'center'}}>
     <Typography sx={{color:V.muted,fontSize:13}}>一致する評価はありません。</Typography>
     <Button onClick={()=>edit()} startIcon={<Add/>} sx={{mt:1}}>好みを記録する</Button>
    </Box>}
  </Section>

  <Section index="03 — Connected records" title="つながっている記録"
   subtitle="AniList・Trakt・Last.fm・Filmarks・ブクログの記録。元サービスが正本で、観たい・再生しただけでは「好き」とは扱いません。">
   <TasteSourceConnections/>
  </Section>

  <Dialog open={!!dialog} onClose={()=>!saving&&setDialog(null)} maxWidth="sm" fullWidth>
   <DialogTitle>{dialog?.type==='edit'?'本人の評価を訂正':'好み・嫌いを一件記録'}</DialogTitle>
   <DialogContent><Stack gap={2} sx={{pt:1}}>
    <TextField label="何について？" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} fullWidth/>
    <TextField label="どう判断した？（具体的に）" multiline minRows={3} value={form.detail}
     onChange={e=>setForm(f=>({...f,detail:e.target.value}))} fullWidth/>
    <Stack direction="row" gap={2}>
     <FormControl fullWidth><InputLabel>判定</InputLabel>
      <Select label="判定" value={form.direction} onChange={e=>setForm(f=>({...f,direction:e.target.value}))}>
       <MenuItem value="like">好き</MenuItem><MenuItem value="dislike">嫌い</MenuItem><MenuItem value="boundary">判断・境界</MenuItem>
      </Select></FormControl>
     <FormControl fullWidth><InputLabel>分野</InputLabel>
      <Select label="分野" value={form.domain} onChange={e=>setForm(f=>({
       ...f,domain:e.target.value,
       appliesTo:f.appliesTo.length===1&&f.appliesTo[0]===f.domain?[e.target.value]:f.appliesTo
      }))}>
       {Object.entries(DOMAINS).map(([key,label])=><MenuItem key={key} value={key}>{label}</MenuItem>)}
      </Select></FormControl>
    </Stack>
    <FormControl fullWidth><InputLabel>評価した対象の範囲</InputLabel>
     <Select label="評価した対象の範囲" value={form.targetKind} onChange={e=>setForm(f=>({...f,targetKind:e.target.value}))}>
      {Object.entries(TARGETS).map(([key,label])=><MenuItem key={key} value={key}>{label}</MenuItem>)}
     </Select>
    </FormControl>
    <Box component="details" sx={{'& summary':{cursor:'pointer',fontSize:12,color:V.muted}}}>
     <Box component="summary">他の分野への適用範囲（任意）</Box>
     <FormControl fullWidth sx={{mt:1.5}}><InputLabel>この判断を参照する分野</InputLabel>
      <Select multiple label="この判断を参照する分野" value={form.appliesTo}
       renderValue={values=>values.map(v=>DOMAINS[v]).join('、')}
       onChange={e=>setForm(f=>({...f,appliesTo:e.target.value}))}>
       {Object.entries(DOMAINS).map(([key,label])=><MenuItem key={key} value={key}>{label}</MenuItem>)}
      </Select>
     </FormControl>
    </Box>
    <TextField label="判断理由のタグ（任意・読点区切り）" value={form.facetsText}
     onChange={e=>setForm(f=>({...f,facetsText:e.target.value}))} fullWidth
     helperText="例：作為的な奇抜さ、薄い公式速報。具体的な特徴だけを記録し、性格全体を決めつけません。"/>
    <TextField label="例外・誤解してほしくないこと（任意）" value={form.caveat} multiline minRows={2}
     onChange={e=>setForm(f=>({...f,caveat:e.target.value}))} fullWidth/>
    <Typography sx={{fontSize:12,color:V.muted}}>ここで入力した内容だけを「本人の明示評価」として記録します。過去の参考資料や閲覧メモは自動で昇格させません。</Typography>
   </Stack></DialogContent>
   <DialogActions><Button onClick={()=>setDialog(null)} disabled={saving}>キャンセル</Button>
    <Button onClick={save} disabled={saving||form.title.trim().length<5||form.detail.trim().length<12} variant="contained">
     {saving?'保存中':'履歴付きで保存'}
    </Button></DialogActions>
  </Dialog>
  <Dialog open={!!history} onClose={()=>setHistory(null)} maxWidth="sm" fullWidth>
   <DialogTitle>評価の変更履歴</DialogTitle>
   <DialogContent><Stack gap={1.2}>
    {history?.loading?<CircularProgress/>:(history?.items||[]).map((event,i)=><Box key={event.id||i} sx={{pb:1.3,borderBottom:'1px solid '+V.rule}}>
     <Typography sx={{fontWeight:800,fontSize:13}}>Revision {event.revision} · {event.action}</Typography>
     <Typography sx={{fontSize:11,color:V.muted,fontFamily:MONO}}>{event.createdAt?new Date(event.createdAt).toLocaleString('ja-JP'):''}</Typography>
     <Typography sx={{fontSize:12}}>{event.changeReason||event.snapshot?.title}</Typography>
    </Box>)}
   </Stack></DialogContent><DialogActions><Button onClick={()=>setHistory(null)}>閉じる</Button></DialogActions>
  </Dialog>
 </Box>;
}
