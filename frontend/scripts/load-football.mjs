// Single event-loop load generator; avoids one Python thread per client/event on Windows.
import { io } from 'socket.io-client';
import fs from 'node:fs/promises';

const url=new URL(process.env.TEST_URL ?? 'http://127.0.0.1:8080').origin, count=100, seconds=30;
const sockets=[], counters=Array(count).fill(0), latencies=[], errors=[], sequences=new Map();
let measuring=false, closing=false, liveResolve;
const live=new Promise(resolve=>{liveResolve=resolve;});
async function connect(index) {
  const cookies=new Map();
  const request=async(path, init={})=>{
    const response=await fetch(url+path,{...init,headers:{Cookie:[...cookies.values()].join('; '),...init.headers}});
    for(const cookie of response.headers.getSetCookie()) {
      const pair=cookie.split(';')[0]; cookies.set(pair.split('=')[0],pair);
    }
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const initial=await request('/api/auth/session');
  await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':initial.csrf},body:JSON.stringify({login:`load-${String(index).padStart(3,'0')}`})});
  const socket=io(url,{transports:['websocket'],reconnection:false,autoConnect:false,extraHeaders:{Cookie:[...cookies.values()].join('; '),Origin:url}});
  sockets.push(socket);
  socket.on('snapshot', snapshot=>{
    if(snapshot.phase==='live' && snapshot.elapsed<75 && sockets.length===count) liveResolve();
    if(!measuring) return;
    const key=`${snapshot.match_id}:${snapshot.sequence}`, encoded=JSON.stringify(snapshot);
    if(sequences.has(key) && sequences.get(key)!==encoded) errors.push('inconsistent snapshot');
    sequences.set(key,encoded); counters[index]++;
    latencies.push(Math.max(0,Date.now()-snapshot.server_time*1000));
  });
  socket.on('disconnect',reason=>{if(!closing) errors.push(`disconnect: ${reason}`);});
  await new Promise((resolve,reject)=>{
    socket.once('connect',resolve); socket.once('connect_error',reject); socket.connect();
    setTimeout(()=>{if(!socket.connected)reject(new Error('connect timeout'));},15000).unref();
  });
}
try {
  for(let start=0;start<count;start+=10) await Promise.all(Array.from({length:10},(_,n)=>connect(start+n)));
  console.log('100 clients connected; waiting for full live measurement window');
  await Promise.race([live,new Promise((_,reject)=>setTimeout(()=>reject(new Error('no live match')),180000).unref())]);
  measuring=true;
  await new Promise(resolve=>setTimeout(resolve,seconds*1000));
  measuring=false;
} catch(error) {errors.push(error.message);}
const connected=sockets.filter(s=>s.connected).length;
closing=true;
for(const socket of sockets) socket.disconnect();
latencies.sort((a,b)=>a-b);
const percentile=q=>latencies.length?Math.round(latencies[Math.floor((latencies.length-1)*q)]*100)/100:null;
const result={requested_clients:count,connected_clients:connected,duration_seconds:seconds,received_snapshots:counters.reduce((a,b)=>a+b,0),minimum_per_client:Math.min(...counters),median_delivery_ms:percentile(.5),p95_delivery_ms:percentile(.95),identical_shared_snapshots:!errors.includes('inconsistent snapshot'),all_clients_retained:connected===count,errors,environment:'Windows Node.js event-loop client; localhost Docker Desktop PostgreSQL16 Redis7 Gunicorn1/120; simulation3.0'};
await fs.writeFile('../docs/football-v3-load-node.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(errors.length || connected!==count || !latencies.length) process.exitCode=1;
