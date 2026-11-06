// Original, redistributable geometry and interpolation helpers. Upstream prose is
// read only from a user supplied project; none is embedded in these blueprints.
export const clone=value=>structuredClone(value);
export const point=(east,north,height=0)=>[east,height,-north];
export const mix=(a,b,u)=>Array.isArray(a)?a.map((v,i)=>mix(v,b[i],u)):a+(b-a)*u;
export const clean=value=>Object.is(value,-0)?0:value;
export function pathKeys(rows,duration){
  const result=rows.map(([t,position])=>({t,position:[...position]}));
  if(result[0].t!==0)result.unshift({t:0,position:[...result[0].position]});
  if(result.at(-1).t!==duration)result.push({t:duration,position:[...result.at(-1).position]});
  return result;
}
export function sampleTrack(keys,t){
  let left=keys[0],right=keys.at(-1);
  for(const key of keys){if(key.t<=t)left=key;if(key.t>t){right=key;break}}
  const u=right.t===left.t?0:Math.max(0,Math.min(1,(t-left.t)/(right.t-left.t)));
  const value=clone(left);
  for(const field of ['position','rotation','scale','yaw','target'])if(left[field]!==undefined&&right[field]!==undefined)value[field]=mix(left[field],right[field],u);
  value.t=t;return value;
}
export function actor(id,color,rows,duration,{yaw=0,left,right,height=1.78,...extras}={}){
  const value={id,color,height,geometry:'humanoid',pose:'idle',path:pathKeys(rows,duration),yawKeys:[{t:0,yaw},{t:duration,yaw}],...extras};
  if(left||right)value.handKeys=Object.fromEntries(Object.entries({left,right}).filter(([,v])=>v).map(([hand,keys])=>[hand,pathKeys(keys,duration)]));
  return value;
}
export function object(id,kind,size,color,rows,duration,extras={}){
  let previous={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],visible:true,owner_id:null,hand:null,state:'INTACT'};
  const keys=[];
  for(const row of rows){const [t,position,patch={}]=row;previous={...previous,position:[...position],...clone(patch)};keys.push({t,...clone(previous)})}
  if(keys[0].t!==0)keys.unshift({...clone(keys[0]),t:0});
  if(keys.at(-1).t!==duration)keys.push({...clone(keys.at(-1)),t:duration});
  return {id,kind,size,color,keys,...extras};
}
export function fixed(id,kind,size,color,position,duration,patch={}){return object(id,kind,size,color,[[0,position,patch],[duration,position,patch]],duration)}
export function attachedRows(actorRows,duration,offset=[0,.9,0]){return pathKeys(actorRows,duration).map(key=>[key.t,key.position.map((v,i)=>v+offset[i])])}
export function fromHands(actorValue,hand,offset=[0,0,0]){return actorValue.handKeys[hand].map(key=>[key.t,key.position.map((v,i)=>v+offset[i])])}
export function stepped(rows,changes){
  return [...new Set([...rows.map(row=>row[0]),...changes.map(row=>row[0])])].sort((a,b)=>a-b).map(t=>{
    const keys=rows.map(([time,position])=>({t:time,position}));
    const patch=changes.filter(([time])=>time<=t).reduce((value,[,next])=>({...value,...clone(next)}),{});
    return [t,sampleTrack(keys,t).position,patch];
  });
}
export function event(id,t,target_id,kind,state,source_beat_id,irreversible=true){return {id,t,target_id,kind,state,irreversible,...(source_beat_id?{source_beat_id}:{})}}
export function contact(id,actor_id,hand,target_id,start,end,local_point=[0,0,0]){return {id,actor_id,hand,target_id,local_point,start,end,expected:true}}
export function localFrameTime(t,start,fps=60){const a=t*fps,b=start*fps;return Number.isFinite(fps)&&Math.abs(a-Math.round(a))<1e-7&&Math.abs(b-Math.round(b))<1e-7?(Math.round(a)-Math.round(b))/fps:clean(t-start);}
export function cutKeys(keys,start,end,fps=60){
  return [sampleTrack(keys,start),...keys.filter(key=>key.t>start&&key.t<end).map(clone),sampleTrack(keys,end)].map(key=>({...key,t:key.t===start?0:key.t===end?clean(end-start):localFrameTime(key.t,start,fps)}));
}
export function cutActor(value,start,end,fps=60){
  const result={...clone(value),path:cutKeys(value.path,start,end,fps)};
  for(const field of ['yawKeys','gazeKeys'])if(value[field])result[field]=cutKeys(value[field],start,end,fps);
  for(const field of ['handKeys','footKeys'])if(value[field])result[field]=Object.fromEntries(Object.entries(value[field]).map(([side,keys])=>[side,cutKeys(keys,start,end,fps)]));
  return result;
}
export function cutCombat(combat,start,end,fps=60){
  const previous=new Map();
  for(const value of combat.events)if(value.t<start)previous.set(value.target_id+'\0'+value.kind+'\0'+(value.channel??''),value);
  for(const value of combat.events)if(value.t===start)previous.delete(value.target_id+'\0'+value.kind+'\0'+(value.channel??''));
  const events=[...previous.values()].map(value=>({...clone(value),t:0,source_time_s:value.t,carried_from_prior_segment:true}));
  events.push(...combat.events.filter(value=>value.t>=start&&value.t<=end).map(value=>({...clone(value),source_time_s:value.t,t:localFrameTime(value.t,start,fps)})));
  events.sort((a,b)=>a.t-b.t||a.id.localeCompare(b.id));
  return {schema_version:'PREVIS_COMBAT_V1',objects:combat.objects.map(value=>({...clone(value),keys:cutKeys(value.keys,start,end,fps)})),contacts:combat.contacts.filter(value=>value.end>start&&value.start<end).map(value=>({...clone(value),source_start_s:value.start,source_end_s:value.end,start:localFrameTime(Math.max(value.start,start),start,fps),end:Math.min(value.end,end)===end?clean(end-start):localFrameTime(value.end,start,fps)})),events};
}
export function addCameras(blueprint,shots){
  return shots.map((shot,index)=>{
    const camera=blueprint.cameras[index]??blueprint.cameras[0];
    const from={position:[...camera[0]],target:[...camera[1]],fov:camera[2]??52},to={position:[...(camera[3]??camera[0])],target:[...(camera[4]??camera[1])],fov:camera[2]??52};
    return {...clone(shot),camera:{keys:[{t:shot.start,...from},{t:shot.end,...to}],interpolation:'linear',offset:{position:[0,0,0],target:[0,0,0],fov:0}}};
  });
}
export function battlefield(bounds,ground=0){return {type:'battlefield',bounds:{min:[...bounds[0]],max:[...bounds[1]]},ground:{y:ground},worldZero:[0,0,0]}}

/** Small numeric execution helper, identical XYZ basis to the rendered proxies.
 * It samples a declared contact, rather than inferring one from an intersection.
 */
export function transformPoint(state,local){
 let [x,y,z]=local.map((v,i)=>v*state.scale[i]);const [rx,ry,rz]=state.rotation;
 [x,y]=[Math.cos(rz)*x-Math.sin(rz)*y,Math.sin(rz)*x+Math.cos(rz)*y];
 [x,z]=[Math.cos(ry)*x+Math.sin(ry)*z,-Math.sin(ry)*x+Math.cos(ry)*z];
 [y,z]=[Math.cos(rx)*y-Math.sin(rx)*z,Math.sin(rx)*y+Math.cos(rx)*z];
 return state.position.map((v,i)=>v+[x,y,z][i]);
}
export function contactHandKeys(actorValue,hand,target,contacts,duration){
 const initial=clone(actorValue.handKeys[hand]),points=new Map(initial.map(key=>[key.t,key]));
 for(const c of contacts)for(const t of [c.start,c.end])points.set(t,{t,position:transformPoint(sampleTrack(target.keys,t),c.local_point)});
 const baseline=[...points.values()].sort((a,b)=>a.t-b.t),times=new Set(baseline.map(key=>key.t));
 for(const c of contacts){for(let n=Math.ceil(c.start*20);n/20<c.end;n++)times.add(n/20);for(const key of target.keys)if(key.t>=c.start&&key.t<=c.end)times.add(key.t)}
 return [...times].filter(t=>t>=0&&t<=duration).sort((a,b)=>a-b).map(t=>{const active=contacts.find(c=>t>=c.start&&t<=c.end);return {t,position:active?transformPoint(sampleTrack(target.keys,t),active.local_point):sampleTrack(baseline,t).position}});
}
