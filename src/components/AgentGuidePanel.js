import React,{useEffect,useState} from 'react';
import {
  Alert,Box,Button,Chip,Collapse,Paper,Stack,TextField,Typography
} from '@mui/material';
import {
  AutoStoriesOutlined as BookIcon,ContentCopyOutlined as CopyIcon,
  EditOutlined as EditIcon,SaveOutlined as SaveIcon,ExpandMoreOutlined as ExpandIcon,
  CheckCircleOutlineOutlined as CheckIcon
} from '@mui/icons-material';

/** Visual editor for the same canonical agentGuide returned by world_map_get.
 * This is NOT a global ChatGPT Custom Instruction editor.
 */
export default function AgentGuidePanel({guide,metadataRevision,storage,updatedAt,api,onSaved}) {
  const [expanded,setExpanded]=useState(false);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(guide||{title:'',instructions:'',minimalCustomInstruction:''});
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  useEffect(()=>{if(!editing)setDraft(guide||{title:'',instructions:'',minimalCustomInstruction:''});},[guide,editing]);
  const copy = async ()=>{
    try {await navigator.clipboard.writeText(guide.minimalCustomInstruction||'');setCopied(true);}
    catch(e){setError('コピーに失敗しました。表示されている短い指示文を選択してコピーしてください。');}
  };
  const save = async ()=>{
    setSaving(true);setError('');
    try {
      await api('',{method:'POST',body:JSON.stringify({
        action:'world_map_update',expectedRevision:metadataRevision,
        agentGuide:{
          title:draft.title,instructions:draft.instructions,
          minimalCustomInstruction:draft.minimalCustomInstruction
        },confirm:true
      })});
      setEditing(false);
      await onSaved();
    }catch(e){setError(e.message||'起動ガイドを更新できませんでした');}
    finally{setSaving(false);}
  };
  if(!guide)return null;
  return (
    <Paper variant="outlined" sx={{p:{xs:1.8,md:2.5},mt:3,borderRadius:1.5}}>
      <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} spacing={1.3}>
        <Box>
          <Typography variant="overline" sx={{color:'text.disabled'}}>00 — Agent entry</Typography>
          <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap gap={1}>
            <BookIcon color="primary"/>
            <Typography variant="h6" fontWeight={900}>{guide.title||'Agent Guide'}</Typography>
            <Chip size="small" variant="outlined" label={`v${guide.version||1}`}/>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{mt:.55,lineHeight:1.7}}>
            エージェントが最初に読む起動ルールの正本。参照先、ContextとSkillの使い方、確認と保存の基準をMy Portal側で管理します。
          </Typography>
        </Box>
        <Button size="small" startIcon={<EditIcon/>} onClick={()=>{setExpanded(true);setEditing(true);setCopied(false);}} disabled={saving}>
          起動ルールを編集
        </Button>
      </Stack>
      {storage!=='persisted'&&<Alert severity="warning" sx={{mt:1.3}}>
        保存済みの起動ルールを確認できないため、デフォルトを表示しています。DB接続・書き込み状態を確認してください。
      </Alert>}
      <Box sx={{mt:2}}>
        <Typography variant="subtitle2" fontWeight={850}>ChatGPTのカスタム指示には、これだけ</Typography>
        <Stack direction={{xs:'column',sm:'row'}} spacing={1} alignItems="stretch" sx={{mt:.65}}>
          <Paper variant="outlined" sx={{py:1.15,px:1.3,borderRadius:1.7,flex:1,bgcolor:'action.hover'}}>
            <Typography variant="body2" sx={{lineHeight:1.7,whiteSpace:'pre-wrap'}}>{guide.minimalCustomInstruction}</Typography>
          </Paper>
          <Button variant="outlined" size="small" startIcon={copied?<CheckIcon/>:<CopyIcon/>} onClick={copy}>
            {copied?'コピー済み':'コピー'}
          </Button>
        </Stack>
      </Box>
      <Button size="small" sx={{mt:1.1}} onClick={()=>setExpanded(x=>!x)} endIcon={<ExpandIcon sx={{transform:expanded?'rotate(180deg)':'none'}}/>}>
        {expanded?'ガイドを閉じる':'My Portalに保存された全ルールを見る'}
      </Button>
      <Collapse in={expanded}>
        <Box sx={{pt:1.4}}>
          {editing?(
            <Stack spacing={1.4}>
              <TextField size="small" fullWidth label="タイトル" value={draft.title||''} onChange={e=>setDraft(x=>({...x,title:e.target.value}))}/>
              <TextField size="small" fullWidth label="短いカスタム指示" value={draft.minimalCustomInstruction||''}
                multiline minRows={2} inputProps={{maxLength:350}} onChange={e=>setDraft(x=>({...x,minimalCustomInstruction:e.target.value}))}/>
              <TextField fullWidth label="Agent Guide本文（My Portalが正本）" value={draft.instructions||''}
                multiline minRows={16} inputProps={{maxLength:20000}}
                onChange={e=>setDraft(x=>({...x,instructions:e.target.value}))}
                sx={{'& textarea':{fontFamily:'monospace',fontSize:12.5,lineHeight:1.7}}}/>
              {error&&<Alert severity="error">{error}</Alert>}
              <Stack direction="row" gap={1} justifyContent="flex-end">
                <Button disabled={saving} onClick={()=>{setEditing(false);setDraft(guide);setError('');}}>キャンセル</Button>
                <Button variant="contained" startIcon={<SaveIcon/>} disabled={saving||draft.instructions?.length<250||!draft.minimalCustomInstruction?.includes('world_map_get')||!draft.title?.trim()} onClick={save}>
                  My Portalに保存
                </Button>
              </Stack>
            </Stack>
          ):(
            <Paper variant="outlined" sx={{p:2,borderRadius:1.8,maxHeight:530,overflow:'auto'}}>
              <Typography component="pre" variant="body2" sx={{fontFamily:'monospace',fontSize:12.4,lineHeight:1.8,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>
                {guide.instructions}
              </Typography>
            </Paper>
          )}
          {updatedAt&&<Typography variant="caption" color="text.secondary" sx={{display:'block',mt:.8}}>DB更新: {new Date(updatedAt).toLocaleString('ja-JP')}</Typography>}
          {!editing&&error&&<Alert severity="error" sx={{mt:1}}>{error}</Alert>}
        </Box>
      </Collapse>
    </Paper>
  );
}
