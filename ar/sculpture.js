// A photographic shallow relief, not a reconstructed solid or an AI-generated
// replacement. Its local coordinates also define the story anchor.
export function makeSculpture(T,image,record){
  const ratio=image.naturalHeight/image.naturalWidth;
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=Math.round(160*ratio);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const sample=(u,v)=>{const i=(Math.min(canvas.height-1,Math.max(0,Math.round(v*(canvas.height-1))))*canvas.width+Math.min(canvas.width-1,Math.max(0,Math.round(u*(canvas.width-1)))))*4;return [data[i]/255,data[i+1]/255,data[i+2]/255];};
  const depth=Math.max(1,Math.min(4,Number(record?.relief?.settings?.depth)||2));
  const group=new T.Group(),surface=new T.Group();group.add(surface);
  const texture=new T.Texture(image);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
  const geometry=new T.PlaneGeometry(1,ratio,144,144),positions=geometry.attributes.position,uv=geometry.attributes.uv;
  const height=(u,v)=>{const [r,g,b]=sample(u,v);return (r*.3+g*.59+b*.11)*.009*depth;};
  for(let i=0;i<positions.count;i++)positions.setZ(i,height(uv.getX(i),1-uv.getY(i)));
  geometry.computeVertexNormals();
  const material=new T.MeshStandardMaterial({map:texture,roughness:.92,metalness:0,side:T.DoubleSide,transparent:true,opacity:0});
  surface.add(new T.Mesh(geometry,material));
  const backing=new T.Mesh(new T.BoxGeometry(.996,ratio*.996,.006),new T.MeshStandardMaterial({color:0x29140f,roughness:1,transparent:true,opacity:0}));
  backing.position.z=-.004;surface.add(backing);
  const coords=[],colors=[],origins=[];
  for(let y=2;y<canvas.height;y+=4)for(let x=2;x<160;x+=4){
    const u=x/160,v=y/canvas.height,c=sample(u,v);if(Math.max(...c)<.25)continue;
    const px=u-.5,py=(.5-v)*ratio;coords.push(px,py,height(u,v));
    const color=new T.Color().setRGB(...c,T.SRGBColorSpace);colors.push(color.r,color.g,color.b);
    origins.push(px*1.03,py*1.03,-.1-(x%7)*.015);
  }
  const pointGeo=new T.BufferGeometry();pointGeo.setAttribute('position',new T.Float32BufferAttribute(origins,3));pointGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  const pointMat=new T.PointsMaterial({size:.009,vertexColors:true,transparent:true,opacity:1,depthWrite:false});
  surface.add(new T.Points(pointGeo,pointMat));
  let born=performance.now();
  return {group,surface,ratio,height,replay(){born=performance.now();},update(now,preview=false){
    const t=Math.min(1,(now-born)/2800),ease=1-Math.pow(1-t,3);
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const p=reduce?1:ease;surface.position.z=.004+.20*p;
    surface.rotation.x=reduce?0:-.10*Math.sin(t*Math.PI);
    surface.rotation.z=reduce?0:Math.sin(now/2300)*.015*p;
    if(preview)group.rotation.y=reduce?-.12:Math.sin(now/4000)*.20;
    material.opacity=Math.min(1,Math.max(0,(p-.2)/.8));backing.material.opacity=material.opacity;
    pointMat.opacity=(1-p)*.9;
    const a=pointGeo.attributes.position;for(let i=0;i<a.count;i++)for(let axis=0;axis<3;axis++)a.array[i*3+axis]=origins[i*3+axis]+(coords[i*3+axis]-origins[i*3+axis])*p;a.needsUpdate=true;
    return p>.92;
  }};
}
