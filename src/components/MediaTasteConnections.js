import React,{useCallback,useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,Stack,TextField,Typography} from '@mui/material';
import {OpenInNew,Refresh,Link as LinkIcon} from '@mui/icons-material';
import {auth} from '../firebase';
const border='#303842',mint='#92e0c4',muted='#a0b0bd';
async function call(resource,body){
 const user=auth.currentUser;if(!user)throw Error('My Portalにログインしてください');
 const r=await fetch('/api/agent-ideas'+(body?'':'?resource='+resource),{
  method:body?'POST':'GET',headers:{Authorization:'Bearer '+await user.getIdToken(),
   'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const payload=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(payload.error||'連携APIが失敗しました');
 return payload;
}
// One callback exchange per browser document (survives React StrictMode mount replay).
let traktCallbackJob=null;
function finishTraktCallback(){
 if(traktCallbackJob)return traktCallbackJob;
 const q=new URLSearchParams(window.location.search),code=q.get('code'),state=q.get('state'),error=q.get('error');
 window.history.replaceState(window.history.state,'','/trakt/callback');
 traktCallbackJob=(!code||!state||error)
  ?Promise.resolve({ok:false,message:'Traktから認証コードが返されませんでした。もう一度連携してください。'})
  :call('',{action:'trakt_authorize_finish',code,state})
   .then(x=>({ok:!!x.connected,message:x.connected?
    'Traktの連携が完了しました。今後は映画の観たい・評価をAIから管理できます。':
    'Trakt認証を完了できませんでした。'}))
   .catch(e=>({ok:false,message:'Trakt認証エラー: '+e.message}));
 return traktCallbackJob;
}
export function TraktOAuthCallback(){
 const [state,setState]=useState({ok:null,message:'Traktの認証を確認しています…'});
 useEffect(()=>{let mounted=true;finishTraktCallback().then(x=>{if(mounted)setState(x)});return ()=>{mounted=false}},[]);
 return <Box sx={{maxWidth:620,mx:'auto',p:3}}>
  <Typography variant="h6" sx={{mb:2}}>Traktアカウントの認証</Typography>
  <Alert severity={state.ok===null?'info':state.ok?'success':'error'}>{state.message}</Alert>
  <Button href="/taste" sx={{mt:2,color:mint}}>好みの記録へ戻る</Button>
 </Box>;
}
export default function MediaTasteConnections(){
 const [lastInfo,setLastInfo]=useState(null),[traktInfo,setTraktInfo]=useState(null);
 const [lastProfile,setLastProfile]=useState(null),[traktProfile,setTraktProfile]=useState(null);
 const [apiKey,setApiKey]=useState(''),[clientId,setClientId]=useState('');
 const [busy,setBusy]=useState(''),[errors,setErrors]=useState({}),[message,setMessage]=useState({});
 const refresh=useCallback(async()=>{
  const infos=await Promise.allSettled([call('lastfm_connection'),call('trakt_connection')]);
  if(infos[0].status==='fulfilled')setLastInfo(infos[0].value);else setErrors(e=>({...e,lastfm:infos[0].reason?.message}));
  if(infos[1].status==='fulfilled')setTraktInfo(infos[1].value);else setErrors(e=>({...e,trakt:infos[1].reason?.message}));
  const l=infos[0].status==='fulfilled'?infos[0].value:null;
  const t=infos[1].status==='fulfilled'?infos[1].value:null;
  if(l?.apiConfigured){
   call('lastfm_profile').then(setLastProfile).catch(e=>setErrors(x=>({...x,lastfm:e.message})));
  }
  if(t?.connected){
   call('trakt_profile').then(setTraktProfile).catch(e=>setErrors(x=>({...x,trakt:e.message})));
  }
 },[]);
 useEffect(()=>{refresh()},[refresh]);
 const act=async(service,operation)=>{
  setBusy(service);setErrors(e=>({...e,[service]:''}));setMessage(m=>({...m,[service]:''}));
  try{await operation();await refresh()}
  catch(e){setErrors(x=>({...x,[service]:e.message}))}
  finally{setBusy('')}
 };
 const saveLast=()=>act('lastfm',async()=>{
  await call('',{action:'lastfm_configure',apiKey});
  setApiKey('');setMessage(m=>({...m,lastfm:'Last.fm APIキーをサーバーに設定しました'}));
 });
 const saveTrakt=()=>act('trakt',async()=>{
  await call('',{action:'trakt_client_configure',clientId});
  setClientId('');setMessage(m=>({...m,trakt:'Trakt Client IDを登録しました'}));
 });
 const startTrakt=()=>act('trakt',async()=>{
  const x=await call('',{action:'trakt_authorize_start'});
  if(!x.url?.startsWith('https://auth.trakt.tv/'))throw Error('認証先URLが不正です');
  window.location.assign(x.url);
 });
 return <Stack gap={2} sx={{mt:2}}>
  <Box sx={{p:2,border:'1px solid '+border,borderRadius:2,background:'#101923'}}>
   <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
    <Box>
     <Typography sx={{fontSize:16,fontWeight:800}}>Trakt / 映画・ドラマ</Typography>
     <Typography sx={{fontSize:12,color:muted}}>ログインアカウント候補: __c4a362</Typography>
    </Box>
    <Button href="https://app.trakt.tv/profile/me" target="_blank" size="small"
     endIcon={<OpenInNew/>} sx={{color:mint}}>プロフィール</Button>
   </Stack>
   <Stack direction="row" gap={1} sx={{mt:1.5}} flexWrap="wrap" alignItems="center">
    <Chip size="small" label={traktInfo?.connected?'アカウント接続済':'認証待ち'} sx={{color:traktInfo?.connected?mint:'#ecd0a0',background:'#25303a'}}/>
    {traktInfo?.connected&&<Chip size="small" label={'@'+traktInfo.username} sx={{color:'#dce5eb',background:'#26313c'}}/>}
    {!!traktProfile&&<Chip size="small" label={'観たい '+(traktProfile.watchlist?.length||0)+'件 · 評価 '+(traktProfile.ratings?.length||0)+'件'} sx={{color:'#dce5eb',background:'#26313c'}}/>}
    <Button size="small" startIcon={<Refresh/>} onClick={refresh} sx={{color:mint}}>更新</Button>
   </Stack>
   <Typography sx={{fontSize:12,color:muted,lineHeight:1.8,mt:1}}>
    公式OAuth（PKCE）で一度認証すれば、ChatGPTから視聴記録を参照し、明示的な指示に基づいて「観たい」と評価を登録できます。
   </Typography>
   {!traktInfo?.connected&&<Stack gap={1.2} sx={{mt:1.5}}>
    <Typography sx={{fontSize:12,color:muted,lineHeight:1.7}}>
     <a href="https://developer.trakt.tv/apps" target="_blank" rel="noreferrer" style={{color:mint}}>TraktのMy Apps <OpenInNew sx={{fontSize:12}}/></a>
     でAPIアプリを作成してください。GitHubアカウントの本人確認が必要な場合があります。
     名前: <strong>My Portal</strong>、Redirect URI:
    </Typography>
    <Typography component="code" sx={{fontSize:11,p:1.2,background:'#202b36',color:mint,wordBreak:'break-all'}}>
     https://my-portal-agent.netlify.app/trakt/callback
    </Typography>
    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
     <TextField size="small" label="Trakt Client ID" value={clientId} onChange={e=>setClientId(e.target.value)}
      sx={{minWidth:190,'& input':{color:'#fff'}}}/>
     <Button variant="outlined" size="small" disabled={!!busy||!clientId.trim()} onClick={saveTrakt}
      sx={{borderColor:border,color:mint}}>IDを保存</Button>
     <Button variant="contained" size="small" disabled={!!busy||!traktInfo?.clientConfigured||!traktInfo?.encryptionConfigured}
      onClick={startTrakt} startIcon={<LinkIcon/>} sx={{background:mint,color:'#10201c'}}>Traktで認可</Button>
    </Stack>
    <Typography sx={{fontSize:11,color:muted}}>Client Secretは不要です。トークンはMy Portalのサーバーで暗号化保存します。</Typography>
   </Stack>}
   {errors.trakt&&<Alert severity="error" sx={{mt:1.2}}>{errors.trakt}</Alert>}
   {message.trakt&&<Alert severity="success" sx={{mt:1.2}}>{message.trakt}</Alert>}
  </Box>
  <Box sx={{p:2,border:'1px solid '+border,borderRadius:2,background:'#101923'}}>
   <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
    <Box>
     <Typography sx={{fontSize:16,fontWeight:800}}>Last.fm / @goodhangedman</Typography>
     <Typography sx={{fontSize:12,color:muted}}>曲の再生履歴・アーティスト・お気に入り曲</Typography>
    </Box>
    <Button href="https://www.last.fm/user/goodhangedman" target="_blank"
     endIcon={<OpenInNew/>} size="small" sx={{color:mint}}>プロフィール</Button>
   </Stack>
   <Stack direction="row" gap={1} sx={{mt:1.5}} flexWrap="wrap" alignItems="center">
    <Chip size="small" label={lastInfo?.apiConfigured?'公式API設定済み':'APIキー設定待ち'}
     sx={{color:lastInfo?.apiConfigured?mint:'#ecd0a0',background:'#25303a'}}/>
    {!!lastProfile&&<Chip size="small" label={'Scrobble '+lastProfile.playcount+'件'}
     sx={{color:'#dce5eb',background:'#26313c'}}/>}
    <Button size="small" onClick={refresh} startIcon={<Refresh/>} sx={{color:mint}}>更新</Button>
   </Stack>
   <Typography sx={{fontSize:12,color:muted,lineHeight:1.8,mt:1}}>
    公式APIキーだけで、公開されている再生履歴を参照できます。編集権限は不要です。再生しただけの曲を「好き」と断定しません。
   </Typography>
   {!lastInfo?.apiConfigured&&<Stack gap={1} sx={{mt:1.3}}>
    <Typography sx={{fontSize:12,color:muted}}>
     <a href="https://www.last.fm/api/account/create" target="_blank" rel="noreferrer" style={{color:mint}}>Last.fm APIアカウントを作成 <OpenInNew sx={{fontSize:12}}/></a>
     し、API Keyのみ下に入力してください。Secretは不要です。
    </Typography>
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
     <TextField size="small" label="Last.fm API Key" value={apiKey} onChange={e=>setApiKey(e.target.value)}
      sx={{minWidth:230,'& input':{color:'#fff'}}}/>
     <Button variant="outlined" size="small" disabled={!!busy||!apiKey.trim()} onClick={saveLast}
      sx={{color:mint,borderColor:border}}>キーを保存</Button>
    </Stack>
   </Stack>}
   {lastProfile?.playcount===0&&<Typography sx={{fontSize:11,color:muted,mt:1}}>
    まだ0再生です。音楽サービスからLast.fmへScrobble連携するとデータが蓄積されます。
   </Typography>}
   {errors.lastfm&&<Alert severity="error" sx={{mt:1.2}}>{errors.lastfm}</Alert>}
   {message.lastfm&&<Alert severity="success" sx={{mt:1.2}}>{message.lastfm}</Alert>}
  </Box>
 </Stack>;
}
