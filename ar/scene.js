import {targets} from './targets.js';
import {readArchive,storyFrom,validRecord} from './record.js';
import {makeSculpture} from './sculpture.js';
import {withDeadline,openCamera,waitForVideo,loadTarget} from './session.js?v=29';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
let record=null,target=null,engine=null,renderer=null,stream=null,running=false,serial=0,observer=null,timeout=null;
let mode='idle',found=false,sculpture=null,openStory=false;
let session=null,resizeFallback=null;
const origin=location.origin;
function stopResources(){serial++;running=false;clearTimeout(timeout);session?.abort();observer?.disconnect();if(resizeFallback)removeEventListener('resize',resizeFallback);try{engine?.stopProcessVideo();}catch{}stream?.getTracks().forEach(t=>t.stop());$('stage').querySelectorAll('video').forEach(v=>{v.pause();v.srcObject=null;});renderer?.setAnimationLoop(null);$('hotspot').hidden=true;}
function reset(){stopResources();location.reload();} // iframe/page destruction releases tracker GPU caches as well.
function fail(message){stopResources();$('status').textContent=message;$('scan-guide').hidden=true;$('replay').hidden=true;$('recovery').hidden=false;$('stop').textContent='返回重试';}
function setStory(show){openStory=show;$('story').hidden=!show;}
function apply(recordValue){
  record=recordValue;const explicit=params.get('target');
  target=targets[record?.arTargetId||record?.relief?.arTargetId||(!params.has('patternId')?explicit:null)];
  if(record?.deletedAt){$('intro').textContent='这份档案已移除。';return;}
  if(!target){$('intro').textContent='这件纹样还没有准备实物识别图，可以先返回数字档案查看作品。';$('start').textContent='识别图待准备';return;}
  $('name').textContent=record?.patternName||'让针线，浮现眼前';$('identity').textContent=record?.patternId||'瑶绣 · 实景观看';
  const story=storyFrom(record);$('story-title').textContent=story.title;$('story-body').textContent=story.body||'这件绣片的名称与故事尚待补充。';
  if(record){$('detail').href='./?patternId='+encodeURIComponent(record.patternId)+'#pattern-detail';$('back').href=$('detail').href;}
  else{$('record-note').textContent='';$('detail').textContent='进入数字展馆 →';}
  $('browser-note').hidden=!/MicroMessenger|QQ\//i.test(navigator.userAgent);
  $('start').disabled=false;$('start').textContent='开启相机 · 见纹';$('preview').disabled=false;
}
async function initialize(){
  if(parent!==window){$('back').hidden=true;$('exit').hidden=false;parent.postMessage({type:'yao-ar-ready'},origin);return;}
  const id=params.get('patternId');
  if(id){const result=await readArchive(id);$('record-note').textContent=result.message;if(!result.record){$('intro').textContent=result.message;$('start').textContent='档案暂不可用';return;}apply(result.record);}
  else apply(null);
}
addEventListener('message',e=>{if(parent===window||e.source!==parent||e.origin!==origin||e.data?.type!=='yao-ar-record'||record)return;
  const r=e.data.record;if(!validRecord(r,params.get('patternId')))return;apply(r);
});
$('exit').onclick=()=>{stopResources();parent.postMessage({type:'yao-ar-close'},origin);};
$('detail').onclick=e=>{if(parent!==window){e.preventDefault();$('exit').click();}};
$('stop').onclick=reset;$('close-story').onclick=()=>setStory(false);
$('hotspot').onclick=()=>{if(found)setStory(!openStory);};
$('replay').onclick=()=>{if(found)sculpture?.replay();};
addEventListener('pagehide',stopResources);
addEventListener('keydown',e=>{if(e.key==='Escape'){if(parent!==window)$('exit').click();else reset();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)fail('已暂停相机。返回后重新开启，即可继续观看。');});
// Turn runtime failures into an actionable state, never a fake successful scan.
addEventListener('unhandledrejection',e=>{if(running){e.preventDefault();fail('实景暂时中断，请返回重试；数字档案仍然保留。');}});
async function enter(preview){
  if(!target||running)return;running=true;const task=++serial;mode=preview?'preview':'camera';
  session=new AbortController();const signal=session.signal;
  $('welcome').hidden=true;$('experience').hidden=false;$('mode-label').textContent=preview?'绣片效果预览 · 非相机识别':'实物图像识别';
  $('status').textContent=preview?'正在展开绣片…':'请允许相机权限，正在打开后置相机…';$('scan-guide').hidden=true;
  $('recovery').hidden=true;
  try{
    const stage=$('stage');let video=null,videoWidth=0,videoHeight=0,postMatrix=null;
    if(!preview){
      if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('CAMERA_UNSUPPORTED');
      stream=await openCamera(navigator.mediaDevices,signal);if(task!==serial){stream.getTracks().forEach(t=>t.stop());return;}
      video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;video.autoplay=true;
      for(const name of ['playsinline','webkit-playsinline','muted','autoplay'])video.setAttribute(name,'');
      video.setAttribute('x5-playsinline','');video.setAttribute('x5-video-player-type','h5-page');
      video.style.cssText='width:100%;height:100%;left:0;top:0;object-fit:cover';stage.prepend(video);video.srcObject=stream;
      await withDeadline(video.play(),10000,'VIDEO_TIMEOUT',signal);await waitForVideo(video,signal);
      videoWidth=video.videoWidth;videoHeight=video.videoHeight;video.width=videoWidth;video.height=videoHeight;
      $('status').textContent='相机已开启 · 正在加载纹样，请保持页面打开';
      // Let the live video paint before loading/initializing the tracking engine.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    const img=new Image();img.src=new URL(target.image,location.href).href;
    // Load the independent assets concurrently, but only after the live camera paints.
    const trackerAssets=preview?null:Promise.all([
      withDeadline(import('../vendor/mindar/mindar-image.prod.js'),25000,'RESOURCE_TIMEOUT',signal),
      loadTarget(new URL(target.compiled,location.href),signal,percent=>{if(task===serial)$('status').textContent='相机已开启 · 识别素材'+(percent===null?'加载中':`已加载 ${percent}%`);})
    ]);
    trackerAssets?.catch(()=>{}); // The original promise is awaited below; no uncaught rejection while other resources load.
    const [T]=await Promise.all([
      withDeadline(import('../vendor/three160/three.module.min.js'),25000,'RESOURCE_TIMEOUT',signal),
      withDeadline(img.decode(),25000,'RESOURCE_TIMEOUT',signal)
    ]);
    if(task!==serial)return;
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.01,100);
    renderer=new T.WebGLRenderer({alpha:true,antialias:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;
    stage.append(renderer.domElement);scene.add(new T.HemisphereLight(0xfff5e2,0x503731,2));
    const light=new T.DirectionalLight(0xffffff,2.1);light.position.set(.4,1,2);scene.add(light);
    const anchor=new T.Group();scene.add(anchor);sculpture=makeSculpture(T,img,record);anchor.add(sculpture.group);
    const story=storyFrom(record),point=new T.Vector3();
    const resize=()=>{
      const w=stage.clientWidth,h=stage.clientHeight;if(w<1||h<1)return;
      if(preview){renderer.setSize(w,h);renderer.domElement.style.left='0px';renderer.domElement.style.top='0px';camera.aspect=w/h;camera.position.z=Math.max(2.1,1.6/camera.aspect);camera.updateProjectionMatrix();}
      else if(video&&engine){
        // Video and WebGL use the exact same oversized cover rectangle. This
        // avoids any disagreement between camera crop and tracked coordinates.
        const scale=Math.max(w/videoWidth,h/videoHeight),vw=videoWidth*scale,vh=videoHeight*scale;
        renderer.setSize(vw,vh);for(const el of [video,renderer.domElement]){el.style.width=vw+'px';el.style.height=vh+'px';el.style.left=(w-vw)/2+'px';el.style.top=(h-vh)/2+'px';}
        camera.projectionMatrix.fromArray(engine.getProjectionMatrix());camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
    };
    if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(resize);observer.observe(stage);}else{resizeFallback=resize;addEventListener('resize',resize);}
    if(preview){found=true;anchor.rotation.x=.08;resize();$('status').textContent='绣片正在浮起，点光点查看档案内容。';}
    else{
      $('status').textContent='相机已开启 · 正在准备图像识别';
      const [{Controller},buffer]=await trackerAssets;if(task!==serial)return;
      anchor.matrixAutoUpdate=false;anchor.visible=false;
      engine=new Controller({inputWidth:videoWidth,inputHeight:videoHeight,maxTrack:1,warmupTolerance:4,missTolerance:7,onUpdate:data=>{
        if(!running||task!==serial||data.type!=='updateMatrix'||data.targetIndex!==target.targetIndex)return;
        const visible=data.worldMatrix!==null;anchor.visible=visible;
        if(visible){anchor.matrix.fromArray(data.worldMatrix).multiply(postMatrix);anchor.matrixWorldNeedsUpdate=true;}
        if(visible&&!found){sculpture.replay();$('status').textContent='纹样已浮起 · 移动手机，从不同角度看针线';}
        else if(!visible&&found){setStory(false);$('status').textContent='暂时离开纹样了，请重新对准完整图案。';}
        found=visible;$('scan-guide').hidden=visible;$('replay').hidden=!visible;if(!visible)$('hotspot').hidden=true;
      }});
      const {dimensions}=engine.addImageTargetsFromBuffer(buffer);const [w,h]=dimensions[target.targetIndex]||[];if(!w||!h)throw Error('RESOURCE');
      postMatrix=new T.Matrix4().compose(new T.Vector3(w/2,h/2,0),new T.Quaternion(),new T.Vector3(w,w,w));
      resize();$('status').textContent='相机已开启 · 正在启动识别，请稍候';
      await new Promise(resolve=>setTimeout(resolve,0));
      await withDeadline(engine.dummyRun(video),20000,'TRACKER_TIMEOUT',signal);if(task!==serial)return;
      engine.processVideo(video);$('scan-guide').hidden=false;$('status').textContent='请对准面前的完整绣片，保持光线均匀，稍停片刻。';
      timeout=setTimeout(()=>{if(task===serial&&!found)$('status').textContent='尚未找到纹样。请对准已准备的完整绣片，避免反光，让图案占画面约一半；缓慢调整距离。';},12000);
    }
    $('replay').hidden=!preview;
    renderer.setAnimationLoop(now=>{
      if(!running)return;const revealed=sculpture.update(now,preview);scene.updateMatrixWorld(true);
      $('hotspot').hidden=!found||!revealed;
      if(found&&revealed){point.set(story.x/100-.5,(.5-story.y/100)*sculpture.ratio,.04);sculpture.surface.localToWorld(point);point.project(camera);
        const r=renderer.domElement.getBoundingClientRect(),v=$('viewport').getBoundingClientRect();const x=(point.x+1)/2*r.width+r.left-v.left,y=(1-point.y)/2*r.height+r.top-v.top;
        $('hotspot').hidden=point.z>1||x<24||x>v.width-24||y<24||y>v.height-24;$('hotspot').style.left=x+'px';$('hotspot').style.top=y+'px';}
      renderer.render(scene,camera);
    });
  }catch(error){if(task!==serial)return;
    const cameraError=['NotAllowedError','NotFoundError','NotReadableError'].includes(error?.name)||/^(CAMERA|VIDEO)_/.test(error?.message||'');
    fail(cameraError?'相机未能显示实景。请在手机浏览器打开此页面，并允许相机权限后重试。':error?.message==='TRACKER_TIMEOUT'?'识别未能启动。请关闭其他相机页面，再用手机浏览器重新打开。':'素材加载未完成。请切换稳定网络后返回重试；不会丢失已建档的内容。');
  }
}
$('start').onclick=()=>enter(false);$('preview').onclick=()=>enter(true);
initialize().catch(()=>{$('intro').textContent='暂时无法读取这份档案，请返回数字展馆。';$('start').textContent='档案暂不可用';});
