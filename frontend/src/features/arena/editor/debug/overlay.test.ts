import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {corners,DebugOverlay} from './overlay';
import {initial,type Preview} from './types';
describe('compiled draft overlay',()=>{
 it.each([17,33,37.5,47.5])('uses exact oriented corners at %d degrees',angle=>{
 const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
 const b=[0,0,0,4*c+.2*s,2,4*s+.2*c,c,0,-s,0,1,0,s,0,c,2,1,.1];
 const p=corners(b);expect(p[7][0]).toBeCloseTo(2*c+.1*s);expect(p[7][1]).toBe(2);expect(p[7][2]).toBeCloseTo(-2*s+.1*c);
 });
 it('batches 500 collider lines per layer, respects hidden and selected, and clears cleanly',()=>{
 const boxes=Array.from({length:500},(_,i)=>[i,0,0,1,2,3]),ids=boxes.map((_,i)=>String(i));
 const data={manifest:{boxes,bullet_boxes:boxes},debug:{owners:{boxes:ids,bullet_boxes:ids},spawns:[]}} as unknown as Preview;
 const o=new DebugOverlay(),p={...initial,playable:false,excluded:false,boxes:true,bullet_boxes:true};
 o.rebuild(data,p,new Set(),new Set(['1']),new T.Box3());const geometry=o.root.children[0];expect(geometry.children.length).toBe(2);
 expect((geometry.children[0] as T.LineSegments).geometry.attributes.position.count).toBe(499*24);
 o.rebuild(data,{...p,selectedOnly:true},new Set(['1','2']),new Set(['1']),new T.Box3());expect((geometry.children[0] as T.LineSegments).geometry.attributes.position.count).toBe(24);
 o.dispose();expect(geometry.children.length).toBe(0);
 });
});
