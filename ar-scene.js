import {targets} from './ar-targets.js';
import {readArchive,storyFrom,validRecord} from './ar-record.js';
import {makeSculpture} from './ar-sculpture.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
let record=null,target=null,engine=null,renderer=null,stream=null,running=false,serial=0,observer=null,timeout=null;
let mode='idle',found=false,sculpture=null,openStory=false;
const origin=location.origin;
function stopResources(){serial++;running=false;clearTimeout(timeout);observer?.disconnect();engine?.stopProcessVideo();stream?.getTracks().forEach(t=>t.stop());renderer?.setAnimationLoop(null);$('hotspot').hidden=true;}
function reset(){stopResources();location.reload();} // iframe/page destruction releases tracker GPU caches as well.
function fail(message){stopResources();$('status').textContent=message;$('scan-guide').hidden=true;$('replay').hidden=true;$('stop').textContent='返回重试';}
function setStory(show){openStory=show;$('story').hidden=!show;}
function apply(recordValue){
  record=recordValue;const explicit=params.get('target');
  target=targets[record?.arTargetId||record?.relief?.arTargetId||(!params.has('patternId')?explicit:null)];
  if(record?.deletedAt){$('intro').textContent='这份档案已移除。';return;}
  if(!target){$('intro').textContent='这件纹样还没有准备实物识别图，可以先返回数字档案查看作品。';$('start').textContent='识别图待准备';return;}
  $('source').src=new URL(target.image,location.href).href;
  $('name').textContent=record?.patternName||'绣片';$('identity').textContent=record?.patternId||'实物绣片';
  const story=storyFrom(record);$('story-title').textContent=story.title;$('story-body').textContent=story.body||'这件绣片的名称与故事尚待补充。';
  if(record){$('detail').href='./?patternId='+encodeURIComponent(record.patternId)+'#pattern-detail';$('back').href=$('detail').href;}
  else{$('record-note').textContent='名称与故事待确认；当前展示保留原图。';$('detail').textContent='进入数字展馆 →';}
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
  $('welcome').hidden=true;$('experience').hidden=false;$('mode-label').textContent=preview?'绣片效果预览 · 非相机识别':'实物图像识别';
  $('status').textContent=preview?'正在展开绣片…':'正在准备相机与识别素材…';$('scan-guide').hidden=preview;
  timeout=setTimeout(()=>{if(task===serial)fail('准备时间较长，请检查网络或相机权限，然后返回重试。');},30000);
  try{
    const T=await import('./ar-three.module.min.js');
    const img=new Image();img.src=new URL(target.image,location.href).href;await img.decode();
    if(task!==serial)return;
    const stage=$('stage'),scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.01,100);
    renderer=new T.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=T.SRGBColorSpace;
    stage.append(renderer.domElement);scene.add(new T.HemisphereLight(0xfff5e2,0x503731,2));
    const light=new T.DirectionalLight(0xffffff,2.1);light.position.set(.4,1,2);scene.add(light);
    const anchor=new T.Group();scene.add(anchor);sculpture=makeSculpture(T,img,record);anchor.add(sculpture.group);
    let video=null,videoWidth=0,videoHeight=0,postMatrix=null;
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
    observer=new ResizeObserver(resize);observer.observe(stage);
    if(preview){found=true;anchor.rotation.x=.08;resize();$('status').textContent='绣片正在浮起，点光点查看档案内容。';}
    else{
      if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('CAMERA_UNSUPPORTED');
      const [{Controller},response]=await Promise.all([import('./ar-mindar-image.prod.js'),fetch(new URL(target.compiled,location.href),{signal:AbortSignal.timeout(20000)})]);
      if(!response.ok)throw Error('RESOURCE');const buffer=await response.arrayBuffer();if(task!==serial)return;
      const cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:960},height:{ideal:720}},audio:false});
      if(task!==serial){cameraStream.getTracks().forEach(t=>t.stop());return;}stream=cameraStream;
      video=document.createElement('video');video.muted=true;video.playsInline=true;video.autoplay=true;stage.prepend(video);video.srcObject=stream;await video.play();
      if(task!==serial)return;videoWidth=video.videoWidth;videoHeight=video.videoHeight;video.width=videoWidth;video.height=videoHeight;
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
      resize();await engine.dummyRun(video);if(task!==serial)return;engine.processVideo(video);$('status').textContent='请对准这张完整绣片，保持光线均匀，稍停片刻。';
    }
    clearTimeout(timeout);$('replay').hidden=!preview;
    renderer.setAnimationLoop(now=>{
      if(!running)return;const revealed=sculpture.update(now,preview);scene.updateMatrixWorld(true);
      $('hotspot').hidden=!found||!revealed;
      if(found&&revealed){point.set(story.x/100-.5,(.5-story.y/100)*sculpture.ratio,.04);sculpture.surface.localToWorld(point);point.project(camera);
        const r=renderer.domElement.getBoundingClientRect(),v=$('viewport').getBoundingClientRect();const x=(point.x+1)/2*r.width+r.left-v.left,y=(1-point.y)/2*r.height+r.top-v.top;
        $('hotspot').hidden=point.z>1||x<24||x>v.width-24||y<24||y>v.height-24;$('hotspot').style.left=x+'px';$('hotspot').style.top=y+'px';}
      renderer.render(scene,camera);
    });
  }catch(error){if(task!==serial)return;const cameraError=error?.name==='NotAllowedError'||error?.message==='CAMERA_UNSUPPORTED';fail(cameraError?'相机未能开启。请用手机浏览器打开安全网址并允许相机；也可以返回观看绣片预览。':'识别素材暂未准备好，请返回重试；已建档的照片与故事不会丢失。');}
}
$('start').onclick=()=>enter(false);$('preview').onclick=()=>enter(true);
initialize().catch(()=>{$('intro').textContent='暂时无法读取这份档案，请返回数字展馆。';$('start').textContent='档案暂不可用';});
