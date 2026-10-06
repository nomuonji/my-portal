import * as publicCmsImport from "../../functions/publicCmsStore.js";
const store:any=(publicCmsImport as any).default ?? publicCmsImport;
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60, stale-while-revalidate=300","Access-Control-Allow-Origin":"*"}})}
export default async (request:Request)=>{
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS"}});
  if(request.method!=="GET") return json({error:"Method not allowed"},405);
  try{
    const url=new URL(request.url);
    const siteId=url.searchParams.get("site")||"";
    const slug=url.searchParams.get("slug");
    if(!siteId) return json({error:"site is required"},400);
    if(slug){ const item=await store.publicGet({siteId,slug}); return item?json({item}):json({error:"Not found"},404); }
    const items=await store.publicList({siteId,limit:Number(url.searchParams.get("limit")||100)});
    return json({siteId,items,count:items.length});
  }catch(error){return json({error:error instanceof Error?error.message:String(error)},400)}
};
export const config={path:["/api/public-content","/api/public-content/*"]};
