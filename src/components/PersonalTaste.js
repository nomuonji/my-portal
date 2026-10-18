import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {auth} from '../firebase';
import {Alert,Box,Button,Chip,CircularProgress,Dialog,DialogActions,DialogContent,DialogTitle,
  Divider,FormControl,InputLabel,MenuItem,Select,Stack,TextField,Typography} from '@mui/material';
import {Add,Refresh,Edit,History,OpenInNew,ThumbUpAltOutlined,ThumbDownAltOutlined,HelpOutline} from '@mui/icons-material';

const C={bg:'#0d1117',surface:'#171d26',border:'#303842',white:'#f0f2f5',muted:'#a0b0bd',mint:'#92e0c4'};
const TYPES={
 explicit_user:{label:'本人の明示評価',color:'#92e0c4',description:'本人が直接判断した。閲覧や保存から推測しない'},
 expression_inference:{label:'表現からの仮説',color:'#e0ca94',description:'本人の原文からの推測。視聴の好みは未確認'},
 external_reference:{label:'外部参考作品',color:'#a8b9f3',description:'ラジ父・村上RADIO等。本人の好みと混同しない'},
 watch_later:{label:'後で見る',color:'#a0b0bd',description:'メモや保存。好評価ではない'}
};
const DIRECTIONS={like:'好き',dislike:'嫌い',boundary:'判断・境界',unknown:'未確定'};
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
function Evidence({entry}){
 const color=TYPES[entry.evidenceKind]?.color||C.muted;
 return <Box sx={{p:{xs:1.8,md:2.2},background:C.surface,border:'1px solid '+C.border,borderRadius:2}}>
  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1.5} flexWrap="wrap">
   <Box sx={{flex:1,minWidth:0}}>
    <Stack direction="row" alignItems="center" flexWrap="wrap" gap={.8} sx={{mb:.9}}>
     <Chip size="small" label={TYPES[entry.evidenceKind]?.label||entry.evidenceKind} sx={{background:'#222b33',color,fontSize:11}}/>
     <Chip size="small" label={DIRECTIONS[entry.direction]||'未確定'} sx={{background:'#273039',color:C.white,fontSize:11}}/>
     <Typography sx={{color:C.muted,fontSize:11}}>{DOMAINS[entry.domain]||entry.domain}</Typography>
     <Chip size="small" label={TARGETS[entry.target?.kind]||'未分類'} sx={{background:'#242c36',color:C.muted,fontSize:10}}/>
     {entry.status!=='active'&&<Chip label="過去の判断" size="small"/>}
    </Stack>
    <Typography sx={{fontWeight:850,fontSize:16,lineHeight:1.5}}>{entry.title}</Typography>
    <Typography sx={{mt:.5,fontSize:12.7,lineHeight:1.9,color:'#ccd4da'}}>{entry.detail}</Typography>
    {!!entry.facets?.length&&<Stack direction="row" gap={.6} flexWrap="wrap" sx={{mt:1}}>{entry.facets.map(tag=>
     <Chip size="small" key={tag} variant="outlined" label={tag} sx={{color:C.mint,borderColor:'#3b6259',fontSize:11}}/>
    )}</Stack>}
    {entry.caveat&&<Typography sx={{fontSize:12.5,lineHeight:1.75,mt:.7,color:'#aebcca'}}>例外・留保：{entry.caveat}</Typography>}
   </Box>
  </Stack>
  <Box component="details" sx={{mt:1.25,'& summary':{fontSize:11.5,cursor:'pointer',color:C.mint,fontWeight:650}}}>
   <Box component="summary">元データ・出典 ({entry.sourceRefs?.length||0})</Box>
   <Stack gap={.65} sx={{mt:1}}>
    {(entry.sourceRefs||[]).map((src,i)=><Typography key={i} sx={{fontSize:11.5,color:C.muted,overflowWrap:'anywhere'}}>
     {src.kind==='user_message'?'本人の発言':src.kind==='user_post'?'本人の投稿':src.kind==='external_raw'?'外部参考資料':src.kind==='bookmark'?'後で見るメモ':src.kind==='discover_item'?'Discoverの評価':'出典'}：
     {src.url?<Box component="a" href={src.url} rel="noopener noreferrer" target="_blank" sx={{color:C.mint,ml:.5}}>{src.id||src.url} <OpenInNew sx={{fontSize:10}}/></Box>:<Box component="span" sx={{ml:.5}}>{src.id}</Box>}
     {src.note?' — '+src.note:''}
    </Typography>)}
    <Typography sx={{fontSize:10,color:'#8293a2'}}>最終更新：{entry.updatedAt?new Date(entry.updatedAt).toLocaleString('ja-JP'):'-'}</Typography>
   </Stack>
  </Box>
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
 return <Box sx={{background:C.bg,color:C.white,minHeight:'100%',borderRadius:2,mx:{xs:-1,md:-3},mt:{xs:-1,md:-3},
  px:{xs:2,md:3.5},py:3}}>
  <Stack direction={{xs:'column',md:'row'}} justifyContent="space-between" alignItems={{xs:'stretch',md:'center'}} gap={2}>
   <Box>
    <Typography sx={{fontSize:11,letterSpacing:'.18em',fontWeight:850,color:C.mint}}>PERSONAL TASTE / EVIDENCE LEDGER</Typography>
    <Typography component="h1" sx={{fontSize:{xs:24,md:31},fontWeight:950,mt:.4}}>好みの記録</Typography>
    <Typography sx={{fontSize:13,lineHeight:1.8,color:C.muted,mt:.5}}>
     好き嫌いの原文、AIの仮説、外部の参考作品、後で見るメモを混ぜずに蓄積。評価の変遷も残します。
    </Typography>
   </Box>
   <Stack direction="row" gap={1}>
    <Button onClick={load} startIcon={<Refresh/>} sx={{color:C.mint,textTransform:'none'}}>更新</Button>
    <Button variant="contained" onClick={()=>edit()} startIcon={<Add/>} sx={{background:C.mint,color:C.bg,textTransform:'none',fontWeight:850}}>好みを記録</Button>
   </Stack>
  </Stack>
  <Stack direction="row" gap={1} flexWrap="wrap" sx={{mt:2.5}}>
   {[['明示評価',summary.explicit||0],['表現からの仮説',summary.hypotheses||0],['外部参考',summary.referenceOnly||0],['後で見る',summary.watchLater||0]].map(([label,count])=>
    <Box key={label} sx={{px:1.5,py:1,border:'1px solid '+C.border,borderRadius:1.5,minWidth:125}}>
     <Typography sx={{fontSize:10.5,color:C.muted}}>{label}</Typography>
     <Typography sx={{fontWeight:900,fontSize:21,fontVariantNumeric:'tabular-nums'}}>{count}</Typography>
    </Box>)}
  </Stack>
  <Box sx={{mt:2.5,p:1.8,border:'1px solid '+C.border,borderRadius:1.5,background:'#101923'}}>
   <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
    <Typography sx={{fontSize:15,fontWeight:850}}>判断理由の傾向</Typography>
    {facet!=='all'&&<Button onClick={()=>setFacet('all')} size="small" sx={{color:C.mint}}>理由フィルタを解除</Button>}
   </Stack>
   <Typography sx={{fontSize:11.5,lineHeight:1.8,color:C.muted,mt:.6}}>
    本人が明示した評価のタグだけを集計。単発・繰り返し・相反する評価を分けます。AIの推測や後で見るメモは計算に入れません。
   </Typography>
   {visibleFacets.length?<Stack direction="row" flexWrap="wrap" gap={.9} sx={{mt:1.5}}>
    {visibleFacets.slice(0,24).map(x=><Button key={x.key} size="small" variant={facet===x.key?'contained':'outlined'}
     onClick={()=>setFacet(f=>f===x.key?'all':x.key)}
     sx={{borderColor:x.state==='mixed'?'#af815b':C.border,color:facet===x.key?C.bg:C.white,
      background:facet===x.key?C.mint:'transparent',textTransform:'none',fontSize:11.5}}>
     {x.label} · {x.like?'好'+x.like+' ':''}{x.dislike?'嫌'+x.dislike+' ':''}{x.boundary?'方針'+x.boundary:''} {x.state==='mixed'?'（賛否あり）':x.state==='single'?'（単発）':''}
    </Button>)}
   </Stack>:<Typography sx={{mt:1.5,fontSize:12,color:C.muted}}>
    この分野に登録された理由タグはありません。既存評価を「訂正」する際に具体的な理由を追加できます。
   </Typography>}
   <Typography sx={{mt:1.25,fontSize:11,color:C.muted}}>
    明示評価 {profile.explicitCount||0}件 · 理由未分類 {profile.uncategorized||0}件
    {profile.mayBeIncomplete?' · 集計上限に達しているため一部のみ':''}
   </Typography>
  </Box>
  <Box sx={{mt:1.5,p:1.65,border:'1px solid '+C.border,borderRadius:1.5,background:'#101923'}}>
   <Typography sx={{fontSize:12,color:'#bfd5df',lineHeight:1.85}}>
    **正しい解釈**：ツイートは「本人が書いた表現」であり、同じタイプの動画を好きとは限りません。
    ラジ父・村上RADIOは外部参考作品。「保存」は後で見る予定。明示的な「好き／嫌い」とは別に保持します。
   </Typography>
  </Box>
  <Stack direction={{xs:'column',sm:'row'}} gap={1} sx={{mt:2.5,mb:2}}>
   <TextField value={search} onChange={e=>setSearch(e.target.value)} placeholder="評価・理由・例外を検索" size="small"
    sx={{flex:1,input:{color:C.white},'& fieldset':{borderColor:C.border}}}/>
   <FormControl size="small" sx={{minWidth:150}}>
    <InputLabel sx={{color:C.muted}}>分野</InputLabel>
    <Select label="分野" value={domain} onChange={e=>setDomain(e.target.value)} sx={{color:C.white,'.MuiOutlinedInput-notchedOutline':{borderColor:C.border}}}>
     <MenuItem value="all">すべて</MenuItem>{Object.entries(DOMAINS).map(([key,value])=><MenuItem value={key} key={key}>{value}</MenuItem>)}
    </Select>
   </FormControl>
   <FormControl size="small" sx={{minWidth:170}}>
    <InputLabel sx={{color:C.muted}}>出典の種類</InputLabel>
    <Select label="出典の種類" value={kind} onChange={e=>setKind(e.target.value)} sx={{color:C.white,'.MuiOutlinedInput-notchedOutline':{borderColor:C.border}}}>
     <MenuItem value="all">すべて</MenuItem>{Object.entries(TYPES).map(([key,value])=><MenuItem key={key} value={key}>{value.label}</MenuItem>)}
    </Select>
   </FormControl>
   <Button size="small" sx={{color:C.muted,textTransform:'none'}} onClick={()=>setIncludeInactive(x=>!x)}>
    {includeInactive?'現在の判断だけ':'訂正前も表示'}
   </Button>
  </Stack>
  {error&&<Alert severity="error" sx={{mb:2}} onClose={()=>setError('')}>{error}</Alert>}
  {loading?<Box sx={{p:6,textAlign:'center'}}><CircularProgress sx={{color:C.mint}}/></Box>:
   <Stack gap={1.5}>{filtered.length?filtered.map(entry=><Box key={entry.id}>
    <Evidence entry={entry}/>
    <Stack direction="row" justifyContent="flex-end" gap={.5} sx={{mt:.3,mb:1}}>
     <Button size="small" startIcon={<History/>} sx={{fontSize:11,color:C.muted,textTransform:'none'}} onClick={()=>openHistory(entry.id)}>履歴</Button>
     <Button size="small" startIcon={<Edit/>} sx={{fontSize:11,color:C.mint,textTransform:'none'}} onClick={()=>edit(entry)}>
      {entry.evidenceKind==='explicit_user'?'訂正':'この仮説を評価'}
     </Button>
     {entry.status==='active'&&<Button size="small" sx={{fontSize:11,color:C.muted,textTransform:'none'}} onClick={()=>archive(entry)}>取り消す</Button>}
    </Stack></Box>):<Typography sx={{color:C.muted,py:6,textAlign:'center'}}>一致する評価はありません。</Typography>}</Stack>}
  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap" sx={{mt:3}}>
   <Typography sx={{color:C.muted,fontSize:12}}>まず本人の訂正・判断を記録。AIの仮説は今後の生データ分析で増やし、都度検証します。</Typography>
   <Button component={Link} to="/discover" sx={{color:C.mint,textTransform:'none'}}>Discoverに戻る →</Button>
  </Stack>
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
    <Box component="details" sx={{'& summary':{cursor:'pointer',fontSize:12,color:'#456f69'}}}>
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
    <Typography sx={{fontSize:12,color:'#637587'}}>ここで入力した内容だけを「本人の明示評価」として記録します。過去の参考資料や閲覧メモは自動で昇格させません。</Typography>
   </Stack></DialogContent>
   <DialogActions><Button onClick={()=>setDialog(null)} disabled={saving}>キャンセル</Button>
    <Button onClick={save} disabled={saving||form.title.trim().length<5||form.detail.trim().length<12} variant="contained">
     {saving?'保存中':'履歴付きで保存'}
    </Button></DialogActions>
  </Dialog>
  <Dialog open={!!history} onClose={()=>setHistory(null)} maxWidth="sm" fullWidth>
   <DialogTitle>評価の変更履歴</DialogTitle>
   <DialogContent><Stack gap={1.2}>
    {history?.loading?<CircularProgress/>:(history?.items||[]).map((event,i)=><Box key={event.id||i} sx={{pb:1.3,borderBottom:'1px solid #ddd'}}>
     <Typography sx={{fontWeight:800,fontSize:13}}>Revision {event.revision} · {event.action}</Typography>
     <Typography sx={{fontSize:11,color:'#666'}}>{event.createdAt?new Date(event.createdAt).toLocaleString('ja-JP'):''}</Typography>
     <Typography sx={{fontSize:12}}>{event.changeReason||event.snapshot?.title}</Typography>
    </Box>)}
   </Stack></DialogContent><DialogActions><Button onClick={()=>setHistory(null)}>閉じる</Button></DialogActions>
  </Dialog>
 </Box>;
}
