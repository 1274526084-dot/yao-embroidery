// Bounded startup operations. Late camera permission must not leave a live stream.
export function withDeadline(promise, milliseconds, code, signal) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);fn(value);};
    const cancel=()=>finish(reject,Error('CANCELLED'));
    const timer=setTimeout(()=>finish(reject,Error(code)),milliseconds);
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
export async function openCamera(mediaDevices,signal,milliseconds=15000) {
  let closed=false;
  // Invoke getUserMedia before any download/await to preserve the user's gesture.
  const pending=mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},audio:false});
  pending.then(value=>{if(closed||signal?.aborted)value.getTracks().forEach(track=>track.stop());},()=>{});
  try{return await withDeadline(pending,milliseconds,'CAMERA_TIMEOUT',signal);}
  catch(error){closed=true;throw error;}
}
export function waitForVideo(video,signal,milliseconds=10000) {
  let clean=()=>{};
  const ready=new Promise((resolve,reject)=>{
    const check=()=>{if(video.videoWidth>0&&video.videoHeight>0&&video.readyState>=2)resolve();};
    const error=()=>reject(Error('VIDEO_FAILED'));
    clean=()=>{for(const event of ['loadeddata','loadedmetadata','playing','resize'])video.removeEventListener(event,check);video.removeEventListener('error',error);};
    for(const event of ['loadeddata','loadedmetadata','playing','resize'])video.addEventListener(event,check);
    video.addEventListener('error',error);check();
  });
  return withDeadline(ready,milliseconds,'VIDEO_TIMEOUT',signal).finally(clean);
}
export async function loadTarget(url,signal,onProgress=()=>{},fetcher=fetch) {
  return withDeadline((async()=>{
    const response=await fetcher(url,{signal});if(!response.ok)throw Error('RESOURCE');
    const total=Number(response.headers?.get('content-length'))||0;
    if(!response.body?.getReader)return response.arrayBuffer();
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)throw Error('RESOURCE');chunks.push(value);onProgress(total?Math.min(99,Math.round(size/total*100)):null);}}
    finally{reader.releaseLock();}
    const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result.buffer;
  })(),25000,'RESOURCE_TIMEOUT',signal);
}
