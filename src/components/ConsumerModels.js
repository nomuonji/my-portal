import React, {useEffect,useState} from 'react';
import {Alert,Box,Button,CircularProgress,Divider,Stack,Tab,Tabs,Typography} from '@mui/material';
import {auth} from '../firebase';

async function api(resource, params={}){
 const user=auth.currentUser;
 if(!user)throw new Error('My Portal にログインしてください');
 const search=new URLSearchParams({resource,...params});
 const response=await fetch('/api/agent-ideas?'+search,{headers:{Authorization:'Bearer '+await user.getIdToken()}});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'取得に失敗しました');
 return data;
}
export default function ConsumerModels(){
 const [models,setModels]=useState([]),[migration,setMigration]=useState(null),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[version,setVersion]=useState(''),[tab,setTab]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;api('consumer_models').then(data=>{if(active){setModels(data.items||[]);setMigration(data.migration);setLoading(false);}}).catch(e=>{if(active){setError(e.message);setLoading(false);}});return()=>{active=false;};},[]);
 useEffect(()=>{if(!selected)return;let active=true;setDetail(null);setError('');api('consumer_model',{id:selected,...(version?{version}:{})}).then(data=>{if(active)setDetail(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selected,version]);
 const m=detail?.model;
 return <Box sx={{maxWidth:900,mx:'auto',px:2,py:3}}>
 <Typography variant="h4" component="h1" sx={{mb:1}}>Consumer Models</Typography>
 <Typography color="text.secondary" sx={{mb:2}}>消費者の理解を蓄積する。Intelligenceとは別の、市場と行動の研究データ。</Typography>
 {migration&&!migration.keywordsCutoverVerified&&<Alert severity="warning" sx={{mb:2}}>移管途中：Firestoreのコピー {migration.firestoreSnapshotVerified?'検証済み':'未確認'}。{migration.legacySqliteRequirementWaived?'旧SQLiteは移管対象外（本人承認）。':'SQLite全行の照合は未完了。'} Keywordsの切替は未完了。</Alert>}
 {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}
 {loading?<CircularProgress size={25}/>:!selected?<Stack divider={<Divider/>} spacing={1}>{models.map(model=><Box key={model.id} sx={{py:1}}><Typography variant="h6"><Button sx={{textTransform:'none',p:0,fontSize:'1.1rem'}} onClick={()=>{setSelected(model.id);setVersion('');setTab(0);}}>{model.name}</Button></Typography><Typography variant="caption" color="text.secondary">v{model.version} · 調査語 {model.keywordCount} · ペルソナ {model.personaCount}</Typography><Typography sx={{mt:1}}>{model.summary}</Typography></Box>)}{!models.length&&<Typography>登録済みモデルなし</Typography>}</Stack>:<>
 <Button onClick={()=>{setSelected('');setVersion('');setDetail(null);}}>← モデル一覧</Button>
 {!m&&!error&&<CircularProgress size={25}/>}
 {m&&<><Typography variant="h5" sx={{my:2}}>{m.name} · v{m.version}</Typography>
 <Tabs value={tab} onChange={(_,v)=>setTab(v)} variant="scrollable" scrollButtons="auto">{['概要','人物像','観測・証拠','版履歴'].map(name=><Tab key={name} label={name}/>)}</Tabs>
 <Box sx={{pt:2}}>
 {tab===0&&<><Typography sx={{mb:2}}>{m.summary}</Typography>{(m.definition?.narrative||[]).map((section,i)=><Box key={i} sx={{mb:2}}><Typography variant="h6">{section.title}</Typography><Typography sx={{whiteSpace:"pre-wrap"}}>{section.text}</Typography></Box>)}{(m.provenance?.sources||[]).filter(s=>s.url).map((s,i)=><Typography key={i} variant="caption" display="block">原典：<a href={s.url} target="_blank" rel="noreferrer">{s.title||s.url}</a> · {s.label}</Typography>)}<Typography variant="h6" sx={{mt:2}}>考え方</Typography>{(m.thinking||[]).map((t,i)=><Typography key={i} sx={{py:1}}><Typography component="span" variant="caption" color="text.secondary">{t.label||'UNKNOWN'}　</Typography>{t.statement}</Typography>)}<Typography variant="h6" sx={{mt:2}}>好み</Typography><Typography>好む：{m.preferences?.like?.join('、')||'未確認'}</Typography><Typography>避ける：{m.preferences?.avoid?.join('、')||'未確認'}</Typography></>}
 {tab===1&&(m.personas||[]).map(p=><Box key={p.key} sx={{mb:3}}><Typography variant="h6">{p.name}</Typography><Typography color="text.secondary" variant="caption">合成ペルソナ</Typography><Typography>{p.oneLine}</Typography><Typography>{p.situation}</Typography><Typography>欲しいもの：{p.wants?.join('、')}</Typography><Typography>避けるもの：{p.avoids?.join('、')}</Typography></Box>)}
 {tab===2&&<><Typography variant="h6">検索観測</Typography>{(m.searchEvidence||[]).map((e,i)=><Box key={i} sx={{py:1,borderBottom:'1px solid var(--p-rule)'}}><Typography>{e.keyword}</Typography><Typography variant="caption" color="text.secondary">{e.volume==null?'需要不明':e.volume.toLocaleString()+' / 月'} · {e.side} · {e.sideCertainty||'未分類'} · {e.source} · {e.measuredAt}</Typography></Box>)}<Typography variant="h6" sx={{mt:3}}>本人側の声</Typography>{(m.voices||[]).map((v,i)=><Box key={i} sx={{py:1}}><Typography>{v.quote}</Typography><Typography variant="caption">{v.fit} · {v.observedAt} · <a href={v.url} target="_blank" rel="noreferrer">原典</a></Typography></Box>)}</>}
 {tab===3&&<Stack spacing={1}>{detail.versions.map(v=><Box key={v.version}><Button sx={{textTransform:'none'}} onClick={()=>setVersion(v.version)} disabled={v.version===m.version}>v{v.version}</Button><Typography color="text.secondary" variant="caption">{v.changeReason||''}</Typography></Box>)}<Button onClick={()=>setVersion('')}>最新版に戻る</Button></Stack>}
 </Box></>}
 </>}
 </Box>;
}
