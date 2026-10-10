import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel,
  MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import {
  Add as AddIcon, ArrowOutward as OutIcon, BookmarkAddOutlined as ImportIcon,
  EditOutlined as EditIcon, Inventory2Outlined as ArchiveIcon,
} from '@mui/icons-material';
import { db } from '../firebase';
import { collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from '../documentDbClient';

const COLLECTION = 'curation_sources';
const TYPES = [
  ['editorial','編集者による選考'],['community_votes','コミュニティ投票'],
  ['jury_awards','審査・受賞'],['curator_recommendation','キュレーターの推薦'],
  ['discussion_highlights','会話・コメント選抜'],['other','その他の人間による選考'],
];
const STATUS = [['candidate','候補'],['active','取得可能（審査済み）'],['paused','停止'],['archived','アーカイブ']];
const RIGHTS = [['unreviewed','利用条件未確認'],['permitted','取得条件を確認済み'],['restricted','利用制限あり']];
const METHODS = [['rss','RSS'],['api','公式API'],['archive','アーカイブ'],['manual','手動参照']];
const VERIFICATION = [['untested','動作未確認'],['verified','取得動作を確認済み'],['failed','取得不可']];
const EMPTY = {
  title:'',url:'',feedUrl:'',selectionType:'editorial',selectionDescription:'',
  accessMethod:'manual',rightsStatus:'unreviewed',fetchVerification:'untested',
  rightsEvidenceUrl:'',status:'candidate',useCase:'',notes:'',tags:[],
};

// These are registry suggestions, NOT permission to scrape or republish content.
const SUGGESTED = [
  {title:'MetaFilter — Best of',url:'https://bestof.metafilter.com/',feedUrl:'https://rss.metafilter.com/bestof.rss',selectionType:'curator_recommendation',selectionDescription:'運営・人間の推薦による印象的な投稿や会話の選抜',accessMethod:'rss',tags:['英語','ネット文化']},
  {title:'MetaFilter — Popular Comments',url:'https://www.metafilter.com/',feedUrl:'https://rss.metafilter.com/popular-comments.rss',selectionType:'community_votes',selectionDescription:'ユーザーの評価を受けたコメント',accessMethod:'rss',tags:['英語','コメント']},
  {title:'Not Always Right',url:'https://notalwaysright.com/',feedUrl:'https://notalwaysright.com/feed/',selectionType:'editorial',selectionDescription:'読者の体験談から編集者が選択した掲載作品',accessMethod:'rss',tags:['英語','人間観察']},
  {title:'kottke.org',url:'https://kottke.org/',feedUrl:'https://feeds.kottke.org/main',selectionType:'curator_recommendation',selectionDescription:'編集者によるウェブ上の情報の推薦',accessMethod:'rss',tags:['英語','カルチャー']},
  {title:'Boing Boing',url:'https://boingboing.net/',feedUrl:'https://boingboing.net/feed',selectionType:'editorial',selectionDescription:'編集者によるネット文化・奇妙な情報の選択',accessMethod:'rss',tags:['英語','カルチャー']},
  {title:'デイリーポータルZ — 月刊新人賞',url:'https://dailyportalz.jp/backnumber/topic/363306',selectionType:'jury_awards',selectionDescription:'編集部の選考と選評がある読者投稿作品',accessMethod:'archive',tags:['日本語','選評']},
];

function httpsUrl(raw, optional=false) {
  const value=String(raw||'').trim();
  if(!value && optional)return '';
  if(!value || value.length>2048)throw new Error('HTTPSのURLを入力してください');
  let url;
  try{url=new URL(value);}catch{throw new Error('URLの形式を確認してください');}
  if(url.protocol!=='https:' || !url.hostname || url.username || url.password)
    throw new Error('HTTPSのURLを使用してください（認証情報を含むURLは不可）');
  url.hash='';
  return url.toString();
}
async function idFromUrl(raw) {
  const bytes=new TextEncoder().encode(httpsUrl(raw));
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return 'curation_'+Array.from(hash.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
}
function labelOf(options,key){return options.find(([id])=>id===key)?.[1]||key;}
function toPayload(form) {
  const title=String(form.title||'').trim();
  if(!title)throw new Error('情報源の名前を入力してください');
  const url=httpsUrl(form.url),feedUrl=httpsUrl(form.feedUrl,true);
  const rightsEvidenceUrl=httpsUrl(form.rightsEvidenceUrl,true);
  const tags=Array.from(new Set((Array.isArray(form.tags)?form.tags:[])
    .map(x=>String(x).trim()).filter(Boolean))).slice(0,20);
  const ready=form.rightsStatus==='permitted'&&form.fetchVerification==='verified'
    &&Boolean(rightsEvidenceUrl)&&(form.accessMethod!=='rss'||Boolean(feedUrl));
  if(form.status==='active'&&!ready)
    throw new Error('取得可能にするには、利用条件の根拠URLと取得動作の確認が必要です');
  return {
    schemaVersion:1,title:title.slice(0,180),url,feedUrl,
    selectionType:form.selectionType,selectionDescription:String(form.selectionDescription||'').trim().slice(0,1500),
    accessMethod:form.accessMethod,rightsStatus:form.rightsStatus,
    fetchVerification:form.fetchVerification,rightsEvidenceUrl,
    status:form.status,useCase:String(form.useCase||'').trim().slice(0,1200),
    notes:String(form.notes||'').trim().slice(0,3000),tags,storageScope:'url_metadata_only',
  };
}
function getReady(item){
  return item.status==='active'&&item.rightsStatus==='permitted'&&
    item.fetchVerification==='verified'&&Boolean(item.rightsEvidenceUrl)&&
    (item.accessMethod!=='rss'||Boolean(item.feedUrl));
}

export default function CurationSources() {
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState('all');
  const [typeFilter,setTypeFilter]=useState('all');
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState(EMPTY);
  const [tagText,setTagText]=useState('');
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    const q=query(collection(db,COLLECTION),orderBy('updatedAt','desc'));
    return onSnapshot(q,snapshot=>{
      setItems(snapshot.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    },e=>{setError('情報源を読み込めません: '+e.message);setLoading(false);});
  },[]);
  const filtered=useMemo(()=>{
    const needle=search.trim().toLocaleLowerCase();
    return items.filter(item=>(statusFilter==='all'||item.status===statusFilter)
      &&(typeFilter==='all'||item.selectionType===typeFilter)
      &&(!needle||[item.title,item.url,item.selectionDescription,item.useCase,...(item.tags||[])]
        .join(' ').toLocaleLowerCase().includes(needle)));
  },[items,search,statusFilter,typeFilter]);
  const edit=(item)=>{
    setForm(item?{...EMPTY,...item}:EMPTY);
    setEditing(item||{});
    setTagText((item?.tags||[]).join(', '));
    setError('');setNotice('');
  };
  const save=async()=>{
    setSaving(true);setError('');
    try{
      const payload=toPayload({...form,tags:tagText.split(/[,、\n]/)});
      const id=await idFromUrl(payload.url);
      if(editing?.id && editing.id!==id)throw new Error('URLを変更する場合は新しい情報源として登録してください');
      const ref=doc(db,COLLECTION,id);
      if(!editing?.id && (await getDoc(ref)).exists())throw new Error('このURLは登録済みです。編集画面から更新してください');
      if(editing?.id)await updateDoc(ref,{...payload,updatedAt:serverTimestamp()});
      else await setDoc(ref,{...payload,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      setEditing(null);
      setNotice('情報源を保存しました');
    }catch(e){setError(e.message||'保存に失敗しました');}
    finally{setSaving(false);}
  };
  const archive=async(item)=>{
    if(!window.confirm('「'+item.title+'」をアーカイブしますか？ データは削除されません。'))return;
    try{await updateDoc(doc(db,COLLECTION,item.id),{status:'archived',updatedAt:serverTimestamp()});setNotice('アーカイブしました');}
    catch(e){setError(e.message);}
  };
  const importSuggestions=async()=>{
    setSaving(true);setError('');
    try{
      const batch=writeBatch(db);let created=0;
      for(const example of SUGGESTED){
        const payload=toPayload({...EMPTY,...example});
        const ref=doc(db,COLLECTION,await idFromUrl(payload.url));
        if((await getDoc(ref)).exists())continue;
        batch.set(ref,{...payload,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        created++;
      }
      if(created)await batch.commit();
      setNotice(created+'件の候補を登録しました。取得・利用の許可は未確認のため、すべて候補のままです。');
    }catch(e){setError('候補の登録に失敗しました: '+e.message);}
    finally{setSaving(false);}
  };
  const field=(name,label,props={})=>(
    <TextField fullWidth size="small" label={label} value={form[name]||''}
      onChange={e=>setForm(current=>({...current,[name]:e.target.value}))} {...props}/>
  );
  const choice=(name,label,options)=>(
    <FormControl fullWidth size="small">
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={form[name]||options[0][0]}
        onChange={e=>setForm(current=>({...current,[name]:e.target.value}))}>
        {options.map(([value,title])=><MenuItem value={value} key={value}>{title}</MenuItem>)}
      </Select>
    </FormControl>
  );

  return (
    <Box sx={{maxWidth:1160,mx:'auto',pb:7}}>
      <Stack direction={{xs:'column',sm:'row'}} alignItems={{sm:'center'}}
        justifyContent="space-between" gap={2} sx={{mb:2}}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{letterSpacing:2,fontWeight:800}}>HUMAN-CURATED SOURCES</Typography>
          <Typography variant="h4" sx={{fontWeight:850,letterSpacing:'-0.04em'}}>情報源ライブラリ</Typography>
          <Typography variant="body2" color="text.secondary" sx={{mt:0.6}}>
            人間が選考・推薦・評価した継続的な情報源を保存します。個別の記事の「あとで読む」とは別の台帳です。
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon/>} onClick={()=>edit(null)}>情報源を追加</Button>
      </Stack>
      <Alert severity="info" sx={{mb:2}}>
        登録するだけでは自動取得されません。利用規約・機械取得の可否・元記事の権利を確認するまでは「候補」です。本文の転載は行いません。
      </Alert>
      {error&&<Alert severity="error" onClose={()=>setError('')} sx={{mb:2}}>{error}</Alert>}
      {notice&&<Alert severity="success" onClose={()=>setNotice('')} sx={{mb:2}}>{notice}</Alert>}
      <Stack direction={{xs:'column',sm:'row'}} spacing={1.2} sx={{mb:2}}>
        <TextField size="small" label="名前・ジャンル・選考内容から検索" value={search}
          onChange={e=>setSearch(e.target.value)} sx={{flex:1}}/>
        <FormControl size="small" sx={{minWidth:150}}>
          <InputLabel>状態</InputLabel>
          <Select label="状態" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <MenuItem value="all">すべての状態</MenuItem>
            {STATUS.map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{minWidth:175}}>
          <InputLabel>選考方式</InputLabel>
          <Select label="選考方式" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
            <MenuItem value="all">すべての方式</MenuItem>
            {TYPES.map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{mb:2}}>
        <Chip label={'登録 '+items.length} variant="outlined"/>
        <Chip label={'候補 '+items.filter(x=>x.status==='candidate').length} variant="outlined"/>
        <Chip label={'確認済み '+items.filter(getReady).length} variant="outlined"/>
      </Stack>
      {loading?<Box sx={{display:'flex',justifyContent:'center',py:5}}><CircularProgress/></Box>:(
        <>
          {!items.length&&
            <Card variant="outlined" sx={{mb:2,borderStyle:'dashed'}}>
              <CardContent>
                <Typography fontWeight={750}>まだ情報源がありません</Typography>
                <Typography variant="body2" color="text.secondary" sx={{my:1}}>
                  前に調べた人力選考サイト6件を、未検証の候補として登録できます。既存の登録は上書きしません。
                </Typography>
                <Button disabled={saving} startIcon={<ImportIcon/>} onClick={importSuggestions}>
                  調査済み候補6件を登録
                </Button>
              </CardContent>
            </Card>
          }
          <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,minmax(0,1fr))'},gap:1.5}}>
            {filtered.map(item=>(
              <Card key={item.id} variant="outlined" sx={{borderRadius:2.5}}>
                <CardContent sx={{display:'flex',flexDirection:'column',gap:1.2,height:'100%'}}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                    <Typography variant="h6" sx={{fontWeight:750,lineHeight:1.3,overflowWrap:'anywhere'}}>{item.title}</Typography>
                    <Chip size="small" variant="outlined" color={getReady(item)?'success':'default'}
                      label={labelOf(STATUS,item.status)}/>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{item.selectionDescription||'選考方法が未記録です'}</Typography>
                  <Stack direction="row" gap={0.6} flexWrap="wrap">
                    <Chip size="small" label={labelOf(TYPES,item.selectionType)}/>
                    <Chip size="small" variant="outlined" label={labelOf(METHODS,item.accessMethod)}/>
                    <Chip size="small" variant="outlined" label={labelOf(RIGHTS,item.rightsStatus)}/>
                    <Chip size="small" variant="outlined" label={labelOf(VERIFICATION,item.fetchVerification)}/>
                    {(item.tags||[]).map(tag=><Chip key={tag} size="small" variant="outlined" label={tag}/>)}
                  </Stack>
                  {item.useCase&&<Typography variant="body2">{item.useCase}</Typography>}
                  <Typography variant="caption" color="text.secondary" sx={{overflowWrap:'anywhere'}}>{item.url}</Typography>
                  <Box sx={{flex:1}}/>
                  <Divider/>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button size="small" component="a" href={item.url} target="_blank" rel="noopener noreferrer" endIcon={<OutIcon/>}>情報源</Button>
                    {item.feedUrl&&<Button size="small" component="a" href={item.feedUrl} target="_blank" rel="noopener noreferrer">フィード</Button>}
                    <Button size="small" startIcon={<EditIcon/>} onClick={()=>edit(item)}>編集</Button>
                    {item.status!=='archived'&&<Button size="small" color="inherit" startIcon={<ArchiveIcon/>} onClick={()=>archive(item)}>保管</Button>}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
          {!filtered.length&&items.length>0&&<Typography color="text.secondary" sx={{py:4,textAlign:'center'}}>条件に一致する情報源がありません。</Typography>}
        </>
      )}
      <Dialog open={Boolean(editing)} onClose={()=>!saving&&setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing?.id?'情報源を編集':'新しい情報源を登録'}</DialogTitle>
        <DialogContent dividers>
          <Stack gap={1.7} sx={{pt:1}}>
            {field('title','名前 *')}
            {field('url','公式サイト・選考結果のURL *',{disabled:Boolean(editing?.id)})}
            {field('feedUrl','RSS / API エンドポイント（任意）')}
            {choice('selectionType','人間による選考方式',TYPES)}
            {field('selectionDescription','人間が何をどう選んでいるか',{multiline:true,minRows:2})}
            {choice('accessMethod','取得手段',METHODS)}
            {choice('rightsStatus','利用条件',RIGHTS)}
            {choice('fetchVerification','取得可否の実測',VERIFICATION)}
            {field('rightsEvidenceUrl','利用条件の根拠URL（任意）')}
            {choice('status','運用状態',STATUS)}
            {field('useCase','発想・企画にどう役立つか',{multiline:true,minRows:2})}
            {field('notes','確認事項・懸念点',{multiline:true,minRows:2})}
            <TextField size="small" fullWidth label="タグ（カンマ区切り）" value={tagText}
              onChange={e=>setTagText(e.target.value)} />
            <Alert severity="warning" sx={{fontSize:'0.86rem'}}>
              「取得可能」に変更するには、利用条件と取得動作の双方の確認が必要です。登録済みのソースも、本文の保存・転載許可を意味しません。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{p:2}}>
          <Button disabled={saving} onClick={()=>setEditing(null)}>キャンセル</Button>
          <Button disabled={saving} variant="contained" onClick={save}>{saving?'保存中…':'保存'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
