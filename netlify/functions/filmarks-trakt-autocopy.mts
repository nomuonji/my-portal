/**
 * One-time, owner-authorized Filmarks -> Trakt copy.
 * Netlify invokes this ONLY on a published deploy schedule, not via public URL.
 * No new user interaction, tokens, secret URLs, or unprotected trigger endpoints.
 *
 * Work becomes inert once all 55 Filmarks items are imported, unresolved
 * or have exhausted three recoverable-error attempts. The cron runs only
 * on the UTC date of the authorized one-time transfer (2026-10-18, 09-10h),
 * never every day or week, and is subsequently removed. We remove this function
 * once the one-time job has completed and been audited.
 */
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { initializeFirestore } from "firebase-admin/firestore";
import * as connectionsImport from "../../functions/mediaAccountConnections.js";
const connections: any=(connectionsImport as any).default??connectionsImport;

export const config={schedule:"* 9-10 18 10 *"};

function ensureBackend(){
 if(getApps().length)return getApp();
 const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ||(globalThis as any).Netlify?.env?.get?.("FIREBASE_SERVICE_ACCOUNT_JSON");
 if(!raw)throw Error("FIREBASE_SERVICE_ACCOUNT_JSON not configured");
 const account=JSON.parse(raw);
 const app=initializeApp({credential:cert(account),projectId:account.project_id||"my-portal-d05fd"});
 initializeFirestore(app,{preferRest:true});
 return app;
}
export default async function filmarksTraktAutoCopy(){
 ensureBackend();
 const before=await connections.filmarksImportReport();
 const work=(before.rows||[]).filter((r: any)=>
  r.status==="pending"||(r.status==="error"&&(r.attempts||0)<3));
 if(!work.length){
  console.log("filmarks-trakt-autocopy settled",JSON.stringify({
   total:before.total,imported:before.imported,
   unresolved:before.unresolved,errors:before.errors,pending:before.pending}));
  return;
 }
 const conn=await connections.traktConnection();
 if(!conn.connected||conn.username!=="__c4a362"){
  console.error("filmarks-trakt-autocopy blocked: owner Trakt identity not connected");
  return;
 }
 try{
  const after=await connections.filmarksImportBatch({limit:5});
  console.log("filmarks-trakt-autocopy checkpoint",JSON.stringify({
   total:after.total,imported:after.imported,unresolved:after.unresolved,
   pending:after.pending,errors:after.errors,processed:after.processedThisCall}));
 }catch(e:any){
  console.error("filmarks-trakt-autocopy stopped",String(e?.message||e).slice(0,180));
 }
}
