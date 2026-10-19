import React,{useCallback,useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,Stack,TextField,Typography} from '@mui/material';
import {OpenInNew,Refresh,Link as LinkIcon} from '@mui/icons-material';
import {auth} from '../firebase';

const border='var(--p-rule)',muted='var(--p-muted)',mint='var(--p-ink)';
async function call(resource='',body){
 const user=auth.currentUser;if(!user)throw Error('My Portalにログインしてください');
 const path=body?'':'?resource='+resource;
 const r=await fetch('/api/agent-ideas'+path,{method:body?'POST':'GET',
  headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||'AniList連携に失敗しました');
 return data;
}
// React StrictMode mounts effects twice in development. Reuse exactly one
// OAuth exchange for this document and remove the JWT from browser history
// before doing any asynchronous work. Never put tokens into localStorage.
let oauthCallbackJob=null;
function finishAniListOAuthRedirect(){
 if(oauthCallbackJob)return oauthCallbackJob;
 const fragment=new URLSearchParams(window.location.hash.replace(/^#/,''));
 const token=fragment.get('access_token'),error=fragment.get('error');
 window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
 if(error||!token){
  oauthCallbackJob=Promise.resolve({ok:false,message:'AniListから認証情報が返されませんでした。もう一度連携を許可してください。'});
 }else{
  oauthCallbackJob=call('',{action:'anilist_authorize_token',token})
   .then(result=>result.connected?
    {ok:true,message:'AniList @topgear の操作連携が完了しました。'}:
    {ok:false,message:'AniListからの認可を確認できませんでした。'})
   .catch(e=>({ok:false,message:'連携できませんでした: '+e.message}));
 }
 return oauthCallbackJob;
}
export function AniListOAuthCallback(){
 const [state,setState]=useState({ok:null,message:'AniListの認証結果を確認しています…'});
 useEffect(()=>{
  let live=true;
  finishAniListOAuthRedirect().then(result=>{if(live)setState(result)});
  return ()=>{live=false};
 },[]);
 return <Box sx={{maxWidth:620,mx:'auto',p:3}}>
  <Typography variant="h6" sx={{mb:2}}>AniListアカウントの認証</Typography>
  <Alert severity={state.ok===null?'info':state.ok?'success':'error'}>{state.message}</Alert>
  <Button href="/taste" sx={{color:mint,mt:2}}>好みの記録に戻る</Button>
 </Box>;
}
export default function AniListConnectPanel(){
 const [info,setInfo]=useState(null),[profile,setProfile]=useState(null),[clientId,setClientId]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{
  setError('');
  try{
   const [connection,library]=await Promise.allSettled([call('anilist_connection'),call('anilist_profile')]);
   if(connection.status==='fulfilled')setInfo(connection.value);else setError(connection.reason?.message||'状態を取得できません');
   if(library.status==='fulfilled')setProfile(library.value);else setMessage('公開リストが取得できません: '+(library.reason?.message||''));
  }catch(e){setError(e.message)}
 },[]);
 useEffect(()=>{load()},[load]);
 const configure=async()=>{
  setBusy(true);setError('');setMessage('');
  try{const data=await call('',{action:'anilist_client_configure',clientId});setInfo(data);setMessage('Client IDを保存しました')}
  catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const authorize=async()=>{
  setBusy(true);setError('');
  try{const data=await call('',{action:'anilist_authorize_url'});window.location.assign(data.url)}
  catch(e){setError(e.message);setBusy(false)}
 };
 const anime=profile?.sources?.find(x=>x.type==='ANIME'),manga=profile?.sources?.find(x=>x.type==='MANGA');
 return <Box sx={{border:'1px solid var(--p-rule)',borderRadius:1.5,p:2,background:'var(--p-surface)',minWidth:0}}>
  <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
   <Box>
    <Typography sx={{fontSize:15,fontWeight:800}}>AniList / @topgear</Typography>
    <Typography sx={{fontSize:12,color:muted}}>漫画・アニメの記録を、AIの推薦とアカウント操作に使います</Typography>
   </Box>
   <Button href="https://anilist.co/user/topgear/" target="_blank" rel="noreferrer" size="small"
    sx={{color:mint}} endIcon={<OpenInNew/>}>プロフィール</Button>
  </Stack>
  <Stack direction="row" gap={1} flexWrap="wrap" sx={{my:1.5}}>
   <Chip size="small" label={'アニメ '+(anime?.count??'—')+'件'} sx={{color:'var(--p-ink)',background:'var(--p-sunken)'}}/>
   <Chip size="small" label={'漫画 '+(manga?.count??'—')+'件'} sx={{color:'var(--p-ink)',background:'var(--p-sunken)'}}/>
   <Chip size="small" label={info?.connected?'操作連携済み':'公開リスト参照のみ'}
    sx={{color:info?.connected?mint:'var(--p-amber)',background:'var(--p-sunken)'}}/>
   <Button size="small" onClick={load} startIcon={<Refresh/>} sx={{color:mint}}>再取得</Button>
  </Stack>
  <Typography sx={{fontSize:12,color:muted,lineHeight:1.8}}>
   公開リストはAPI Clientなしで参照できます。ChatGPTから作品の追加・進捗・評価を編集するには、AniListの最初の1回だけ認可が必要です。
  </Typography>
  {error&&<Alert severity="error" sx={{mt:1.5}}>{error}</Alert>}
  {message&&<Alert severity="info" sx={{mt:1.5}}>{message}</Alert>}
  {!info?.connected&&<Box sx={{mt:2,p:1.7,background:'var(--p-sunken)',borderRadius:1.2}}>
   <Typography sx={{fontWeight:750,fontSize:13}}>操作権限を接続する（初回のみ）</Typography>
   <Typography sx={{fontSize:12,color:muted,mt:1,lineHeight:1.8}}>
    <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer" style={{color:mint}}>AniListのAPI Client設定 <OpenInNew sx={{fontSize:12}}/></a>
    でアプリを1つ作成してください。
    Name は <strong>My Portal</strong>、Redirect URL は下記をそのまま登録します。
   </Typography>
   <Typography component="code" sx={{mt:1,p:1.2,display:'block',wordBreak:'break-all',fontSize:11,
    background:'var(--p-bg)',borderRadius:1,color:'var(--p-ink)',fontFamily:'"JetBrains Mono", monospace',userSelect:'all'}}>
    https://my-portal-agent.netlify.app/anilist/callback
   </Typography>
   <Stack direction="row" gap={1} flexWrap="wrap" sx={{mt:1.5}}>
    <TextField size="small" value={clientId} onChange={e=>setClientId(e.target.value)}
     label="AniList Client ID" placeholder="数字のみ" sx={{minWidth:160,'& input':{color:'var(--p-ink)'}}}/>
    <Button variant="outlined" size="small" onClick={configure} disabled={busy||!/^\d{1,15}$/.test(clientId)}
     sx={{color:mint,borderColor:border}}>IDを設定</Button>
    <Button size="small" variant="contained" onClick={authorize} disabled={busy||!info?.clientConfigured||!info?.encryptionConfigured}
     startIcon={<LinkIcon/>}>AniListの連携を許可</Button>
   </Stack>
   {!info?.encryptionConfigured&&<Typography sx={{mt:1,fontSize:11,color:'var(--p-amber)'}}>
    サーバー側の暗号鍵が未設定のため、編集用の認証は利用できません。
   </Typography>}
   <Typography sx={{fontSize:11,color:muted,lineHeight:1.6,mt:1.2}}>
    AniListの認可は作品リストの変更を含む広い権限です。アクセストークンは暗号化してサーバーに保存し、画面やAIへは返しません。有効期限後は再認証が必要です。
   </Typography>
  </Box>}
  {info?.connected&&<Typography sx={{mt:1.5,color:mint,fontSize:12}}>
   ChatGPTから作品追加・評価・進捗の更新が可能です。有効期限: {info.expiresAt?.slice(0,10)||'不明'}
  </Typography>}
 </Box>;
}
