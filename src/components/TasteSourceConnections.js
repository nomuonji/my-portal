import React,{useCallback,useEffect,useState} from 'react';
import {Alert,Box,Button,Checkbox,Chip,FormControlLabel,Stack,TextField,Typography} from '@mui/material';
import {CloudUpload,OpenInNew,Refresh} from '@mui/icons-material';
import {auth} from '../firebase';
import {parseBooklog,parseFilmarks} from './tasteSourceImport';
import AniListConnectPanel from './AniListConnectPanel';

const border='#303842',muted='#a0b0bd',mint='#92e0c4';
const sources=[
 {service:'filmarks',label:'Filmarks · 観たい映画',url:'https://filmarks.com/users/postmodern137/clips',
  help:'Clip! は観たい作品の記録です。鑑賞済み・好きの証拠にはしません。'},
 {service:'booklog',label:'ブクログ · 本棚',url:'https://booklog.jp/users/nomuman',
  help:'読書状況と本人の数値評価は別々に保存します。本棚登録だけでは好きと判断しません。'}
];
async function call(path='',body){
 const user=auth.currentUser;if(!user)throw Error('My Portalへのログインが必要です');
 const response=await fetch('/api/agent-ideas'+path,{method:body?'POST':'GET',headers:{
  Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'
 },...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'接続に失敗しました');
 return result;
}
async function readTextFile(file){
 if(!file)throw Error('ファイルが選択されていません');
 if(file.size>4*1024*1024)throw Error('4MB以下のCSVを使用してください');
 const bytes=await file.arrayBuffer();
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
 catch{return new TextDecoder('shift_jis').decode(bytes)}
}
export default function TasteSourceConnections(){
 const [items,setItems]=useState([]),[working,setWorking]=useState(''),[error,setError]=useState('');
 const [message,setMessage]=useState(''),[clipText,setClipText]=useState('');
 const [bookFile,setBookFile]=useState(null),[includeReviews,setIncludeReviews]=useState(false);
 const [preview,setPreview]=useState(null);
 const refresh=useCallback(async()=>{
  try{const result=await call('?resource=taste_external_sources');setItems(result.items||[])}
  catch(e){setError(e.message)}
 },[]);
 useEffect(()=>{refresh()},[refresh]);
 const prepare=async service=>{
  setError('');setMessage('');setWorking(service);
  try{
   const rows=service==='booklog'?parseBooklog(await readTextFile(bookFile),{includeReviews}):parseFilmarks(clipText);
   if(rows.length>1200)throw Error('一度に1200件まで取り込めます');
   setPreview({service,rows});
  }catch(e){setError(e.message)}finally{setWorking('')}
 };
 const commit=async()=>{
  if(!preview)return;
  setWorking('commit');setError('');setMessage('');
  try{
   const r=await call('',{action:'taste_external_import',source:preview.service,rows:preview.rows});
   setMessage((preview.service==='booklog'?'ブクログ':'Filmarks')+' '+r.count+'件を'+
    (r.changed?'取り込みました。':'確認しました（変更なし）。'));
   setPreview(null);await refresh();
  }catch(e){setError(e.message)}finally{setWorking('')}
 };
 return <Box sx={{mt:3,p:{xs:1.6,md:2},border:'1px solid '+border,borderRadius:2,background:'#101923'}}>
  <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
   <Box>
    <Typography sx={{fontWeight:850,fontSize:17}}>外部の映画・読書記録</Typography>
    <Typography sx={{fontSize:12,color:muted,lineHeight:1.8,mt:.5}}>
     元サービスを正本として、手元の記録を任意のタイミングで同期します。サイトを自動巡回したり、パスワードを預かったりしません。
    </Typography>
   </Box>
   <Button size="small" startIcon={<Refresh/>} onClick={refresh} sx={{color:mint}}>更新</Button>
  </Stack>
  {error&&<Alert severity="error" onClose={()=>setError('')} sx={{mt:1.5}}>{error}</Alert>}
  {message&&<Alert severity="success" onClose={()=>setMessage('')} sx={{mt:1.5}}>{message}</Alert>}
  <AniListConnectPanel/>
  <Stack gap={2} sx={{mt:2}}>
   {sources.map(source=>{
    const data=items.find(x=>x.service===source.service);
    return <Box key={source.service} sx={{border:'1px solid '+border,borderRadius:1.5,p:1.7}}>
     <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
      <Box>
       <Typography sx={{fontSize:14,fontWeight:750}}>{source.label}</Typography>
       <Typography sx={{fontSize:11,color:muted,lineHeight:1.75,mt:.3}}>{source.help}</Typography>
      </Box>
      <Button size="small" component="a" href={source.url} target="_blank" rel="noreferrer"
       endIcon={<OpenInNew sx={{fontSize:14}}/>} sx={{color:mint,textTransform:'none'}}>元ページ</Button>
     </Stack>
     <Stack direction="row" flexWrap="wrap" gap={.75} alignItems="center" sx={{mt:1}}>
      <Chip size="small" label={data?.connected?'取込済 '+data.stats.count+'件':'未取り込み'}
       sx={{background:'#273039',color:'#d5e0e6',fontSize:11}}/>
      {data?.connected&&<Typography sx={{fontSize:11,color:muted}}>
       {source.service==='booklog'?'評価付き '+(data.stats.ratings||0)+'件 · 読了 '+(data.stats.read||0)+'件':'観たい作品の関心シグナル'}
       {' · '}{data.lastImportedAt?new Date(data.lastImportedAt).toLocaleDateString('ja-JP'):''}
      </Typography>}
     </Stack>
     {source.service==='booklog'?<Stack gap={1.1} sx={{mt:1.5}}>
      <Typography sx={{fontSize:12,color:muted,lineHeight:1.7}}>
       PC版ブクログの「本棚 → スパナ → エクスポート」から取得したCSVを選択してください。非公開メモは取り込みません。
      </Typography>
      <Box component="input" type="file" accept=".csv,text/csv" onChange={e=>{setBookFile(e.target.files?.[0]||null);setPreview(null)}}
       sx={{fontSize:12,color:muted,maxWidth:'100%'}}/>
      <FormControlLabel control={<Checkbox size="small" checked={includeReviews}
       onChange={e=>{setIncludeReviews(e.target.checked);setPreview(null)}}/>}
       label={<Typography sx={{fontSize:12}}>本人のレビュー本文も取り込む（任意・通常はオフ）</Typography>}/>
      <Button variant="outlined" size="small" onClick={()=>prepare('booklog')} disabled={!bookFile||!!working}
       startIcon={<CloudUpload/>} sx={{alignSelf:'flex-start',color:mint,borderColor:border}}>CSVを確認</Button>
     </Stack>:<Stack gap={1} sx={{mt:1.5}}>
      <Typography sx={{fontSize:12,color:muted,lineHeight:1.7}}>
       FilmarksのClip!一覧から作品名と映画URLの組を貼り付けてください。HTMLのリンク一覧、または「作品名 | 映画URL」の複数行に対応します。
      </Typography>
      <TextField multiline minRows={2} maxRows={6} size="small" value={clipText}
       onChange={e=>{setClipText(e.target.value);setPreview(null)}}
       placeholder={'時計じかけのオレンジ | https://filmarks.com/movies/25464'}
       sx={{'& textarea':{fontSize:12,color:'#f0f2f5'},'& fieldset':{borderColor:border}}}/>
      <Button variant="outlined" size="small" onClick={()=>prepare('filmarks')} disabled={!clipText.trim()||!!working}
       sx={{alignSelf:'flex-start',color:mint,borderColor:border}}>一覧を確認</Button>
     </Stack>}
     {!!data?.samples?.length&&<Box sx={{mt:1.3}}>
      <Typography sx={{fontSize:11,color:muted}}>保存済みの例</Typography>
      <Stack direction="row" flexWrap="wrap" gap={.6} sx={{mt:.7}}>
       {data.samples.slice(0,8).map(x=><Chip key={x.id} size="small" label={x.title}
        sx={{maxWidth:180,background:'#232e38',color:'#d3dce4',fontSize:10.5,'& .MuiChip-label':{overflow:'hidden',textOverflow:'ellipsis'}}}/>)}
      </Stack>
     </Box>}
    </Box>
   })}
  </Stack>
  {preview&&<Box sx={{mt:2,border:'1px solid '+mint,borderRadius:1.3,p:1.6}}>
   <Typography sx={{fontSize:13,fontWeight:850}}>取り込みプレビュー：{preview.rows.length}件</Typography>
   <Typography sx={{mt:.6,fontSize:12,color:muted}}>
    {preview.rows.slice(0,5).map(x=>x.title).join(' ／ ')}{preview.rows.length>5?' ほか':''}
   </Typography>
   <Typography sx={{mt:1,fontSize:11,color:muted}}>
    取り込み済みの同じソースは、この一覧で置き換わります。部分的なClip!ページだけを貼る場合は、以前の取り込み内容が置き換わる点に注意してください。
   </Typography>
   <Stack direction="row" gap={1} sx={{mt:1.4}}>
    <Button size="small" variant="contained" onClick={commit} disabled={!!working}
     sx={{background:mint,color:'#0d1117'}}>この{preview.rows.length}件を保存</Button>
    <Button size="small" onClick={()=>setPreview(null)} sx={{color:muted}}>やめる</Button>
   </Stack>
  </Box>}
 </Box>;
}
