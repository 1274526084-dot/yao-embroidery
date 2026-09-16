// Read-only mobile data adapter. The archive identity is never derived from a
// motif name or from the latest unrelated local record.
export function validRecord(x,id){return !!(x&&x.patternId===id&&/^YX-\d{4}-\d{3,}$/.test(id)&&x.status==='published'&&x.reviewStatus==='human-reviewed'&&typeof x.patternName==='string'&&typeof x.image==='string'&&x.label);}
export function applyEdits(record,storage){
  try{const e=JSON.parse(storage.getItem('yao.collection.edits.v1')||'{}')[record.patternId];if(!e)return record;
    const p=e.patch||{},r={...record,deletedAt:e.deletedAt};
    for(const key of ['patternName','image','story','technique'])if(typeof p[key]==='string')r[key]=p[key];
    if(p.relief&&p.relief.hotspot&&typeof p.relief.hotspot.body==='string')r.relief=p.relief;
    if(p.label&&typeof p.label.intro_cn==='string')r.label=p.label;
    if(typeof p.image==='string'&&p.image!==record.image){r.arTargetId=undefined;if(r.relief)r.relief={...r.relief,arTargetId:undefined};}
    return r;
  }catch{return record;}
}
export async function readArchive(id,{storage=localStorage,fetcher=fetch,api=window.__YAO_COMPETITION_CONFIG__?.archiveApiUrl}={}){
  let cached=null;
  try{cached=JSON.parse(storage.getItem('yao.collection.records.v2')||'[]').find(x=>validRecord(x,id));}catch{}
  if(api){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),5000);try{
    const response=await fetcher(api.replace(/\/$/,'')+'/patterns/'+encodeURIComponent(id),{cache:'no-store',signal:abort.signal});
    if(response.status===404)return {record:null,message:'这份档案暂未发布或已下架。'};
    if(!response.ok)throw Error();const record=await response.json();if(!validRecord(record,id))throw Error();
    return {record:applyEdits(record,storage),message:''};
  }catch{if(cached)return {record:applyEdits(cached,storage),message:'暂未取得最新档案，正在读取此设备保存的内容。'};}
  finally{clearTimeout(timer);}}
  return {record:cached?applyEdits(cached,storage):null,message:cached?'此设备保存的数字档案。':'此设备尚未取得这份档案，请先在电脑完成云端发布。'};
}
export function storyFrom(record){
  const h=record?.relief?.hotspot;
  return {title:typeof h?.title==='string'?h.title:'纹样介绍',body:typeof record?.story==='string'&&record.story.trim()?record.story:(h?.body||record?.label?.intro_cn||''),x:Number.isFinite(h?.x)?Math.max(4,Math.min(96,h.x)):50,y:Number.isFinite(h?.y)?Math.max(4,Math.min(96,h.y)):50};
}
