'use strict';

// A registry of HUMAN-SELECTED source feeds, not a cache of copyrighted posts.
// "Ready" describes technical/legal review, not automatic permission to ingest.
const { createHash } = require('node:crypto');
const SELECTION_TYPES = ['editorial','community_votes','jury_awards','curator_recommendation','discussion_highlights','other'];
const ACCESS_METHODS = ['rss','api','archive','manual'];
const STATUSES = ['candidate','active','paused','archived'];
const RIGHTS = ['unreviewed','permitted','restricted'];
const VERIFICATION = ['untested','verified','failed'];

function validUrl(value,name,{optional=false}={}){
  const text=String(value??'').trim();
  if(!text && optional)return '';
  if(!text || text.length>2048)throw new Error(name+' must be a valid HTTPS URL');
  let parsed;
  try{parsed=new URL(text)}catch{throw new Error(name+' must be a valid HTTPS URL')}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||!parsed.hostname)
    throw new Error(name+' must be a valid HTTPS URL');
  parsed.hash='';
  return parsed.toString();
}
function clamp(value,max=1000){return String(value??'').trim().slice(0,max)}
function enumValue(value,allowed,defaultValue){
  return allowed.includes(value)?value:defaultValue;
}
function sourceId(url) {
  return 'curation_'+createHash('sha256').update(validUrl(url,'url')).digest('hex').slice(0,32);
}
function normalizedSource(input={},old={}) {
  if(!input || typeof input!=='object'||Array.isArray(input))throw new Error('source object required');
  const url=validUrl(input.url??old.url,'url');
  const title=clamp(input.title??old.title,180);
  if(!title)throw new Error('title is required');
  const accessMethod=enumValue(input.accessMethod??old.accessMethod,ACCESS_METHODS,'manual');
  const feedUrl=validUrl(input.feedUrl??old.feedUrl,'feedUrl',{optional:true});
  const rightsStatus=enumValue(input.rightsStatus??old.rightsStatus,RIGHTS,'unreviewed');
  const fetchVerification=enumValue(input.fetchVerification??old.fetchVerification,VERIFICATION,'untested');
  const rightsEvidenceUrl=validUrl(input.rightsEvidenceUrl??old.rightsEvidenceUrl,'rightsEvidenceUrl',{optional:true});
  const requestedStatus=enumValue(input.status??old.status,STATUSES,'candidate');
  const status=requestedStatus==='active' && !(rightsStatus==='permitted'&&fetchVerification==='verified'&&rightsEvidenceUrl&&(accessMethod!=='rss'||feedUrl))
    ? 'candidate' :requestedStatus;
  return {
    schemaVersion:1,
    title,url,feedUrl,
    selectionType:enumValue(input.selectionType??old.selectionType,SELECTION_TYPES,'editorial'),
    selectionDescription:clamp(input.selectionDescription??old.selectionDescription,1500),
    accessMethod,rightsStatus,fetchVerification,rightsEvidenceUrl,status,
    useCase:clamp(input.useCase??old.useCase,1200),
    notes:clamp(input.notes??old.notes,3000),
    tags:Array.from(new Set((Array.isArray(input.tags??old.tags)?(input.tags??old.tags):[])
      .map(x=>clamp(x,50)).filter(Boolean))).slice(0,20),
    // A source can be active/approved for metadata/reference only.
    // This registry does NOT grant rights to cache or republish article bodies.
    storageScope:'url_metadata_only',
  };
}
module.exports={validUrl,sourceId,normalizedSource,SELECTION_TYPES,ACCESS_METHODS,STATUSES,RIGHTS,VERIFICATION};
