import * as T from 'three';
import {TextPool,newSlot} from '../../frontend/src/features/arena/editor/textSlots';

export async function measure(labels:boolean){
 const canvas=document.createElement('canvas');document.body.replaceChildren(canvas);
 const gl=new T.WebGLRenderer({canvas,antialias:true});gl.setSize(1280,720);
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-10,10,5.625,-5.625,.1,50);
 camera.position.z=10;scene.background=new T.Color('#344149');
 const pool=new TextPool(),panel=new T.PlaneGeometry(1.8,.93),mat=new T.MeshBasicMaterial({color:'#2b3026'});
 for(let i=0;i<100;i++){
   const root=new T.Group();root.position.set(i%10*2-9,Math.floor(i/10)*1.05-4.725,0);
   root.add(new T.Mesh(panel,mat));scene.add(root);
   if(labels){
    const slot=newSlot();slot.width=1.7;slot.height=.4;slot.position=[0,.2,0];
    pool.add(root,{title:slot,detail:{...slot,position:[0,-.2,0]}},{title:{text:['СКЛАД','EXIT','СЕКТОР А'][i%3]},detail:{text:'Отсек № '+i}});
   }
 }
 const samples:number[]=[],cpu:number[]=[];let previous=0;
 await new Promise<void>(done=>{let frame=0;function tick(t:number){const start=performance.now();gl.render(scene,camera);if(frame>30){samples.push(t-previous);cpu.push(performance.now()-start)}previous=t;if(++frame<180)requestAnimationFrame(tick);else done()}requestAnimationFrame(tick)});
 const percentile=(a:number[],p:number)=>a.sort((x,y)=>x-y)[Math.floor(a.length*p)];
 const result={median:percentile(samples,.5),p95:percentile(samples,.95),renderP95:percentile(cpu,.95),calls:gl.info.render.calls,textures:gl.info.memory.textures};
 pool.dispose();scene.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose()});mat.dispose();gl.dispose();gl.forceContextLoss();
 return result;
}
