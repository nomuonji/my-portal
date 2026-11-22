'use strict';

// A user verdict for a visual artifact must not be requested if only a
// provisional plan or an expiring sandbox path was recorded. Text drafts,
// product IDs and idea IDs remain valid reviewable material.
function trialArtifactStatus(trial={}) {
  const ref=String(trial.ref||'').trim();
  const secureImage=/^https:\/\/[^\s]+$/i.test(String(trial.imageUrl||''));
  const secureMedia=/^https:\/\/[^\s]+$/i.test(String(trial.mediaUrl||''));
  if(secureImage||secureMedia) return {ready:true,status:'ready',reason:null};
  if(/^planned:/i.test(ref))return {ready:false,status:'artifact_missing',
    reason:'完成画像・映像がまだ登録されていません。説明文の採否を完成品の合格として扱いません。'};
  if(/^sandbox:\/\//i.test(ref)||/^file:\/\//i.test(ref)||/^\/working_dir\//i.test(ref))
    return {ready:false,status:'artifact_temporary',
      reason:'一時作業領域のファイル参照です。恒久的なHTTPS閲覧URLを登録するまで本人評価を求めません。'};
  return {ready:true,status:'ready',reason:null};
}
function publicMediaUrl(value){
 const url=String(value??'').trim();
 if(!url)return '';
 if(url.length>1000||!/^https:\/\/[^\s]+$/i.test(url))
   throw new Error('trial.mediaUrl must be a public HTTPS URL, not a local or expiring sandbox ref');
 return url;
}
module.exports={trialArtifactStatus,publicMediaUrl};
