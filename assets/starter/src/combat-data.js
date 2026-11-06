/** Deterministic combat proxies in metres, world Y up, XYZ Euler radians.
 * Contacts explain declared targets. They are not IK, forces or tactical approval.
 * The reciprocal import contains function declarations only: base actor sampling
 * never invokes combat; sampleActions supplies those base states to this module.
 */
import {sampleActorAction} from './action-data.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
const clone=structuredClone;
const kinds=new Set(['sword','staff','projectile','node','barrier','manifestation','illusion','mark','shield']);
const eventKinds=new Set(['resource','damage','attrition','knowledge','visibility','light']);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const interval=(c,t,duration)=>t>=c.start&&(t<c.end||t===duration&&t===c.end);
const jsonValue=v=>v===null||typeof v==='boolean'||typeof v==='string'||finite(v)||Array.isArray(v)&&v.every(jsonValue)||object(v)&&Object.values(v).every(jsonValue);
export function actorScale(actor){const s=actor.scale??1;return (Array.isArray(s)?s:[s,s,s]).map(v=>v*(actor.height/1.8))}
export function actorDimensions(actor){const s=actorScale(actor);return {height:1.8*s[1],radius:(actor.radius??.22)*Math.max(s[0],s[2])/(actor.height/1.8)}}

/** Same rotation order as THREE.Euler(x,y,z,'XYZ'), without a browser dependency. */
export function combatPointToWorld(state,point){
  let [x,y,z]=point.map((v,i)=>v*state.scale[i]);
  const [rx,ry,rz]=state.rotation;
  [x,y]=[Math.cos(rz)*x-Math.sin(rz)*y,Math.sin(rz)*x+Math.cos(rz)*y];
  [x,z]=[Math.cos(ry)*x+Math.sin(ry)*z,-Math.sin(ry)*x+Math.cos(ry)*z];
  [y,z]=[Math.cos(rx)*y-Math.sin(rx)*z,Math.sin(rx)*y+Math.cos(rx)*z];
  return add(state.position,[x,y,z]);
}
function sampleKey(keys,t){
  let i=keys.findIndex(key=>key.t>t);if(i<0)i=keys.length;
  const a=keys[Math.max(0,i-1)],b=keys[Math.min(i,keys.length-1)],u=b.t===a.t?0:(t-a.t)/(b.t-a.t);
  const value={visible:a.visible,owner_id:a.owner_id,hand:a.hand,state:a.state};
  for(const field of ['position','rotation','scale'])value[field]=a[field].map((v,j)=>v+(b[field][j]-v)*u);
  delete value.t;return value;
}
const eventChannel=e=>e.channel??e.kind;
function leaves(value,prefix='',out={}){
  if(object(value)||Array.isArray(value)){for(const [k,v] of Object.entries(value))leaves(v,prefix+'/'+k,out);if(!Object.keys(value).length)out[prefix]=JSON.stringify(value)}
  else out[prefix]=value;
  return out;
}
function irreversibleErrors(events){
  const errors=[],groups=new Map();
  for(const e of events){const key=JSON.stringify([e.target_id,e.kind,eventChannel(e)]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e)}
  for(const group of groups.values()){
    let locked=false,previous=null;const direction=new Map(),seen=new Map();
    for(const e of group.sort((a,b)=>a.t-b.t)){
      const current=leaves(e.state);
      if(locked&&previous){for(const [path,old] of Object.entries(previous)){
        const next=current[path],history=seen.get(path)??new Set();
        if(!(path in current)||typeof old!==typeof next||old===null&&next!==null){errors.push(e.id+': irreversible state shape/type was reset at '+path);continue}
        if(typeof old==='number'&&next!==old){const sign=Math.sign(next-old);if(direction.has(path)&&direction.get(path)!==sign)errors.push(e.id+': irreversible numeric state reverses at '+path);else direction.set(path,sign)}
        else if(typeof old==='boolean'&&next!==old)errors.push(e.id+': irreversible boolean state was reset at '+path);
        else if(next!==old&&history.has(JSON.stringify(next)))errors.push(e.id+': irreversible state returns to an earlier value at '+path);
      }}
      for(const [path,value] of Object.entries(current)){if(!seen.has(path))seen.set(path,new Set());seen.get(path).add(JSON.stringify(value))}
      locked=locked||e.irreversible;previous=current;
    }
  }
  return errors;
}
function contactSource(c){return c.object_id?'object:'+c.object_id:'actor:'+c.actor_id+':'+(c.foot?'foot:'+c.foot:'hand:'+c.hand)}
function dependencies(scene,t){
  const graph=new Map();
  const connect=(from,to)=>{if(!graph.has(from))graph.set(from,[]);graph.get(from).push(to)};
  for(const item of scene.combat.objects){const key=sampleKey(item.keys,t);if(item.attachment==='hand'&&key.owner_id&&key.hand)connect('object:'+item.id,'actor:'+key.owner_id+':hand:'+key.hand)}
  for(const c of scene.combat.contacts)if(c.expected&&c.actor_id&&interval(c,t,scene.duration))connect(contactSource(c),'object:'+c.target_id);
  const done=new Set(),active=new Set();
  function visit(node){if(active.has(node))return true;if(done.has(node))return false;active.add(node);for(const next of graph.get(node)??[])if(visit(next))return true;active.delete(node);done.add(node);return false}
  return [...graph.keys()].some(visit);
}
export function validateCombatData(scene){
  const errors=[],expect=(ok,msg)=>{if(!ok)errors.push(msg)};
  if(!object(scene))return ['Combat sampling requires a scene object.'];
  if(scene.combat===undefined)return [];
  const combat=scene.combat;
  if(!object(combat))return ['combat must be an object when provided.'];
  expect(combat.schema_version==='PREVIS_COMBAT_V1','combat.schema_version must be PREVIS_COMBAT_V1.');
  expect(finite(scene.duration)&&scene.duration>0,'Combat requires a finite positive scene.duration.');
  for(const name of ['objects','contacts','events'])expect(Array.isArray(combat[name]),'combat.'+name+' must be an explicit array.');
  const actors=Array.isArray(scene.actors)?scene.actors.filter(object):[],actorIds=new Set(actors.map(a=>a.id));
  const objects=Array.isArray(combat.objects)?combat.objects:[],ids=new Set(actorIds),objectIds=new Set(),times=new Set([0,scene.duration]);
  if(scene.door)ids.add(scene.door.id??'door');
  for(const [i,item] of objects.entries()){
    const label='combat.objects['+i+']';
    if(!object(item)){errors.push(label+' must be an object.');continue}
    expect(text(item.id)&&!ids.has(item.id),label+': IDs must be nonempty and globally unique.');ids.add(item.id);objectIds.add(item.id);
    expect(kinds.has(item.kind),label+': unsupported combat kind.');
    expect(vector(item.size)&&item.size.every(v=>v>0),label+'.size must be positive XYZ metres.');
    expect(typeof item.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(item.color),label+'.color must be #RRGGBB.');
    if(item.attachment!==undefined)expect(['world','hand'].includes(item.attachment),label+'.attachment must be world or hand.');
    if(item.hand_offset!==undefined)expect(vector(item.hand_offset),label+'.hand_offset must be finite XYZ metres in actor yaw space.');
    if(item.solid!==undefined)expect(typeof item.solid==='boolean',label+'.solid must be boolean.');
    if(item.light!==undefined){expect(object(item.light),label+'.light must be an object.');if(object(item.light)){expect(finite(item.light.intensity)&&item.light.intensity>=0&&item.light.intensity<=10000,label+'.light.intensity must be finite in [0,10000].');expect(finite(item.light.range)&&item.light.range>0,label+'.light.range must be positive.');if(item.light.color!==undefined)expect(typeof item.light.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(item.light.color),label+'.light.color must be #RRGGBB.');}}
    if(item.opacity!==undefined)expect(finite(item.opacity)&&item.opacity>=0&&item.opacity<=1,label+'.opacity must be in [0,1].');
    if(!Array.isArray(item.keys)||item.keys.length<2){errors.push(label+'.keys must have at least two keys.');continue}
    expect(item.keys[0]?.t===0&&item.keys.at(-1)?.t===scene.duration,label+'.keys must explicitly cover [0,scene.duration].');
    item.keys.forEach((key,j)=>{
      const name=label+'.keys['+j+']';if(!object(key)){errors.push(name+' must be an object.');return}
      expect(finite(key.t)&&key.t>=0&&key.t<=scene.duration,name+'.t must be finite inside the segment.');times.add(key.t);
      if(j)expect(finite(item.keys[j-1]?.t)&&key.t>item.keys[j-1].t,name+': key times must strictly increase (no duplicate state keys).');
      for(const field of ['position','rotation','scale'])expect(vector(key[field]),name+'.'+field+' must be finite XYZ.');
      if(vector(key.scale))expect(key.scale.every(v=>v>0),name+'.scale must be strictly positive.');
      expect(typeof key.visible==='boolean',name+'.visible must be explicit boolean.');
      expect(key.owner_id===null||text(key.owner_id)&&actorIds.has(key.owner_id),name+'.owner_id must be an existing actor or null.');
      expect(key.hand===null||['left','right'].includes(key.hand)&&actorIds.has(key.owner_id),name+'.hand needs an existing owner, or must be null.');
      expect(text(key.state),name+'.state must be a nonempty string.');
    });
  }
  const contacts=Array.isArray(combat.contacts)?combat.contacts:[],contactIds=new Set();
  for(const [i,c] of contacts.entries()){
    const label='combat.contacts['+i+']';if(!object(c)){errors.push(label+' must be an object.');continue}
    expect(text(c.id)&&!contactIds.has(c.id),label+': contact IDs must be unique.');contactIds.add(c.id);
    const actorSource=actorIds.has(c.actor_id)&&((['left','right'].includes(c.hand)&&c.foot===undefined)||(['left','right'].includes(c.foot)&&c.hand===undefined));
    const objectSource=objectIds.has(c.object_id)&&c.actor_id===undefined&&c.hand===undefined&&c.foot===undefined;
    expect(actorSource&&c.object_id===undefined||objectSource,label+': name one actor hand/foot or one source object_id.');
    expect(objectIds.has(c.target_id)&&c.target_id!==c.object_id,label+'.target_id must name a different existing combat object.');
    expect(vector(c.local_point),label+'.local_point must be finite target-local XYZ.');
    if(c.source_local_point!==undefined)expect(vector(c.source_local_point),label+'.source_local_point must be finite source-local XYZ.');
    expect(finite(c.start)&&finite(c.end)&&c.start>=0&&c.end>c.start&&c.end<=scene.duration,label+': contact range must be positive and inside the segment.');times.add(c.start);times.add(c.end);
    expect(typeof c.expected==='boolean',label+'.expected must be explicit boolean.');
  }
  for(let i=0;i<contacts.length;i++)for(let j=i+1;j<contacts.length;j++){
    const a=contacts[i],b=contacts[j];if(!object(a)||!object(b)||!a.actor_id||!a.expected||!b.expected)continue;
    expect(contactSource(a)!==contactSource(b)||a.end<=b.start||b.end<=a.start,'Overlapping combat contacts cannot drive the same limb.');
  }
  for(const actor of actors)for(const c of Array.isArray(actor.contacts)?actor.contacts:[])for(const other of contacts)if(object(other)&&other.expected&&other.actor_id===actor.id&&other.hand===c.hand)expect(c.end<=other.start||other.end<=c.start,'Door and combat contacts cannot overlap on the same hand.');
  const events=Array.isArray(combat.events)?combat.events:[],eventIds=new Set(),eventKeys=new Set();
  for(const [i,e] of events.entries()){
    const label='combat.events['+i+']';if(!object(e)){errors.push(label+' must be an object.');continue}
    expect(text(e.id)&&!eventIds.has(e.id),label+': event IDs must be unique.');eventIds.add(e.id);
    expect(finite(e.t)&&e.t>=0&&e.t<=scene.duration,label+'.t must be finite inside the segment.');
    expect(actorIds.has(e.target_id)||objectIds.has(e.target_id),label+'.target_id must exist.');
    expect(eventKinds.has(e.kind),label+': invalid event kind.');expect(jsonValue(e.state),label+'.state must be a finite JSON value.');
    expect(typeof e.irreversible==='boolean',label+'.irreversible must be explicit boolean.');
    if(e.channel!==undefined)expect(text(e.channel),label+'.channel must be nonempty.');
    if(e.source_beat_id!==undefined)expect(text(e.source_beat_id),label+'.source_beat_id must be nonempty.');
    const key=JSON.stringify([e.t,e.target_id,e.kind,eventChannel(e)]);expect(!eventKeys.has(key),label+': duplicate time/state channel key.');eventKeys.add(key);
  }
  if(!errors.length){
    errors.push(...irreversibleErrors(events));
    for(const t of [...times].sort((a,b)=>a-b)){
      const held=new Map();for(const item of objects){const key=sampleKey(item.keys,t);if(key.visible&&key.owner_id&&key.hand){const id=key.owner_id+':'+key.hand;expect(!held.has(id),'Two visible combat objects claim the same owner hand at '+t+'s: '+id);held.set(id,item.id)}}
      expect(!dependencies(scene,t),'Combat hand/object dependency cycle at '+t+'s.');
    }
  }
  return errors;
}
function inputError(errors,code='COMBAT_INPUT_INVALID'){const error=new Error(errors.join('\n'));error.code=code;error.problems=errors;throw error}
export function sampleCombat(scene,t,actorStates){
  const errors=validateCombatData(scene);
  if(!finite(scene?.duration)||scene.duration<=0)errors.push('Combat sampling requires a positive finite scene.duration.');
  if(!finite(t)||t<0||t>scene?.duration)errors.push('Combat time must be finite inside [0,scene.duration].');
  if(errors.length)inputError(errors);
  const actors=clone(actorStates??Object.fromEntries((scene.actors??[]).map(a=>[a.id,sampleActorAction(scene,a,t)])));
  const combat=scene.combat;
  if(!combat)return {schema_version:'PREVIS_COMBAT_V1',time:t,basis:'SAMPLED_PROXY',objects:{},actors,contacts:[],events:[],state:{}};
  const objects=Object.fromEntries(combat.objects.map(o=>[o.id,null])),resolving=new Set(),byId=new Map(combat.objects.map(o=>[o.id,o]));
  const limbName=c=>c.foot?'feet':'hands',side=c=>c.foot??c.hand;
  const resolveLimb=(actorId,limb,hand)=>{
    const node='actor:'+actorId+':'+(limb==='feet'?'foot:':'hand:')+hand;
    if(resolving.has(node))inputError(['Combat limb/object dependency cycle.']);resolving.add(node);
    const c=combat.contacts.find(c=>c.expected&&c.actor_id===actorId&&(limb==='feet'?c.foot===hand:c.hand===hand)&&interval(c,t,scene.duration));
    const target=c?{position:combatPointToWorld(resolveObject(c.target_id),c.local_point),contact:clone(c),basis:'COMBAT_LOCAL_CONTACT'}:clone(actors[actorId][limb][hand]);
    resolving.delete(node);return target;
  };
  const resolveObject=id=>{
    if(Object.hasOwn(objects,id)&&objects[id]!==null)return objects[id];const node='object:'+id;if(resolving.has(node))inputError(['Combat limb/object dependency cycle.']);resolving.add(node);
    const item=byId.get(id),key=sampleKey(item.keys,t);
    let position=key.position;
    if(item.attachment==='hand'&&key.owner_id&&key.hand){
      const hand=resolveLimb(key.owner_id,'hands',key.hand),yaw=actors[key.owner_id].yaw,offset=item.hand_offset??[0,0,0],c=Math.cos(yaw),s=Math.sin(yaw);
      position=add(hand.position,[offset[0]*c+offset[2]*s,offset[1],-offset[0]*s+offset[2]*c]);
    }
    objects[id]={...clone(item),...key,position,proxy:true};delete objects[id].keys;
    resolving.delete(node);return objects[id];
  };
  for(const item of combat.objects)resolveObject(item.id);
  for(const actor of scene.actors)for(const limb of ['hands','feet'])for(const hand of ['left','right'])actors[actor.id][limb][hand]=resolveLimb(actor.id,limb,hand);
  for(const actor of scene.actors)if(actor.prop?.type==='key'){
    const a=actors[actor.id],offset=actor.prop.offset??[0,-.075,0],c=Math.cos(a.yaw),s=Math.sin(a.yaw);
    a.prop.position=add(a.hands[actor.prop.hand].position,[offset[0]*c+offset[2]*s,offset[1],-offset[0]*s+offset[2]*c]);
  }
  const contacts=combat.contacts.filter(c=>interval(c,t,scene.duration)).map(c=>{
    const target=objects[c.target_id],targetPosition=combatPointToWorld(target,c.local_point);
    const sourcePosition=c.object_id?combatPointToWorld(objects[c.object_id],c.source_local_point??[0,0,0]):actors[c.actor_id][limbName(c)][side(c)].position;
    return {...clone(c),source_position:clone(sourcePosition),target_position:targetPosition,gap_m:distance(sourcePosition,targetPosition),target_visible:target.visible,basis:'DECLARED_PROXY_CONTACT'};
  });
  const events=combat.events.filter(e=>e.t<=t).slice().sort((a,b)=>a.t-b.t||a.id.localeCompare(b.id)).map(e=>clone(e)),state=Object.fromEntries([...new Set(events.map(e=>e.target_id))].map(id=>[id,{}]));
  for(const e of events)Object.defineProperty(state[e.target_id],eventChannel(e),{value:clone(e.state),enumerable:true,writable:true,configurable:true});
  return {schema_version:'PREVIS_COMBAT_V1',time:t,basis:'SAMPLED_PROXY',objects,actors,contacts,events,state};
}
export function sampleCombatObject(scene,id,t,actorStates){const objects=sampleCombat(scene,t,actorStates).objects,value=Object.hasOwn(objects,id)?objects[id]:null;if(!value)inputError(['Unknown combat object ID: '+id]);return value}
