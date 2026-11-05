// All coordinates are metres, Y up. Angles are radians. A hinged leaf spans
// local X=[0,width], Y=[0,height], Z=[-thickness/2,+thickness/2] from its hinge.
// Rotation is world Y = closedYaw + swingSign * angle (swingSign defaults to +1). New action tracks interpolate linearly;
// their angles are explicit, unwrapped values (no inferred shortest-path turn).
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const smooth=v=>{v=clamp(v);return v*v*(3-2*v)};
export const lerp=(a,b,v)=>a+(b-a)*v;
export const lerpVector=(a,b,v)=>a.map((n,i)=>lerp(n,b[i],v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
export const rotateY=(point,yaw)=>{const c=Math.cos(yaw),s=Math.sin(yaw);return [point[0]*c+point[2]*s,point[1],-point[0]*s+point[2]*c]};
const add=(a,b)=>a.map((value,i)=>value+b[i]);

export function validateActionData(scene){
  const errors=[],expect=(ok,message)=>{if(!ok)errors.push(message)};
  function keys(track,label,check){
    if(!Array.isArray(track)||track.length<2){errors.push(`${label} must have at least two keys.`);return}
    expect(track[0]?.t===0&&track.at(-1)?.t===scene.duration,`${label} must explicitly cover [0, scene.duration].`);
    track.forEach((key,i)=>{
      if(!object(key)){errors.push(`${label}[${i}] must be an object.`);return}
      expect(finite(key.t)&&key.t>=0&&key.t<=scene.duration,`${label}[${i}].t must be finite segment-local seconds inside the budget.`);
      if(i)expect(finite(track[i-1]?.t)&&key.t>track[i-1].t,`${label} times must strictly increase.`);
      check(key,`${label}[${i}]`);
    });
  }
  const door=scene.door;
  if(door!==null&&door!==undefined){
    if(!object(door))errors.push('door must be an object or null.');
    else if(door.type==='hinged-door'){
      if(door.id!==undefined)expect(typeof door.id==='string'&&door.id.trim().length>0,'door.id must be a nonempty string.');
      expect(vector(door.hinge),'Hinged door.hinge must be a finite world XYZ vector.');
      expect(vector(door.size)&&door.size.every(v=>v>0),'Hinged door.size must be positive [width,height,thickness] metres.');
      if(door.closedYaw!==undefined)expect(finite(door.closedYaw),'door.closedYaw must be finite radians.');
      if(door.swingSign!==undefined)expect(door.swingSign===1||door.swingSign===-1,'door.swingSign must be +1 or -1.');
      expect(door.openStart===undefined&&door.openEnd===undefined,'Hinged doors use angleKeys, not a sliding openStart/openEnd event.');
      keys(door.angleKeys,'door.angleKeys',(key,label)=>expect(finite(key.angle),`${label}.angle must be finite radians.`));
    }else{
      expect(door.type===undefined||door.type==='sliding-door','door.type must be sliding-door or hinged-door.');
      expect(door.angleKeys===undefined&&door.hinge===undefined&&door.size===undefined,'A hinged transform requires explicit door.type=hinged-door.');
      expect(finite(door.openStart)&&finite(door.openEnd)&&door.openStart>=0&&door.openEnd>door.openStart&&door.openEnd<=scene.duration,'Door event must be ordered and inside the timeline.');
    }
  }
  for(const [index,actor] of (Array.isArray(scene.actors)?scene.actors:[]).entries()){
    if(!object(actor))continue;
    const label=actor.id||`actors[${index}]`;
    if(actor.yawKeys!==undefined)keys(actor.yawKeys,`${label}.yawKeys`,(key,name)=>expect(finite(key.yaw),`${name}.yaw must be finite radians.`));
    if(actor.gazeKeys!==undefined)keys(actor.gazeKeys,`${label}.gazeKeys`,(key,name)=>expect(vector(key.target),`${name}.target must be a finite world XYZ vector.`));
    if(actor.contacts!==undefined){
      if(!Array.isArray(actor.contacts))errors.push(`${label}.contacts must be an array.`);
      else{
        for(const [i,contact] of actor.contacts.entries()){
          const name=`${label}.contacts[${i}]`;
          if(!object(contact)){errors.push(`${name} must be an object.`);continue}
          expect(['left','right'].includes(contact.hand),`${name}.hand must be left or right.`);
          expect(object(door)&&door.type==='hinged-door'&&contact.targetId===(door.id??'door'),`${name}.targetId must name the scene's hinged door.`);
          expect(finite(contact.start)&&finite(contact.end)&&contact.start>=0&&contact.end>contact.start&&contact.end<=scene.duration,`${name} must have a positive [start,end] inside the segment.`);
          expect(vector(contact.localPoint),`${name}.localPoint must be a finite door-local XYZ vector.`);
          if(vector(contact.localPoint)&&vector(door?.size))expect(contact.localPoint[0]>=0&&contact.localPoint[0]<=door.size[0]&&contact.localPoint[1]>=0&&contact.localPoint[1]<=door.size[1]&&Math.abs(contact.localPoint[2])<=door.size[2]/2+1e-9,`${name}.localPoint must lie in the hinged leaf's local bounds.`);
        }
        for(const hand of ['left','right']){
          const contacts=actor.contacts.filter(c=>object(c)&&c.hand===hand).slice().sort((a,b)=>a.start-b.start);
          for(let i=1;i<contacts.length;i++)expect(contacts[i].start>=contacts[i-1].end,`${label}: overlapping ${hand} contacts are ambiguous.`);
        }
      }
    }
    if(actor.prop!==undefined&&actor.prop!==null){
      expect(object(actor.prop)&&['key','block-rifle'].includes(actor.prop.type),`${label}.prop must be a key or block-rifle descriptor.`);
      if(actor.prop?.type==='key'){
        expect(['left','right'].includes(actor.prop.hand),`${label}: a key requires an explicit left or right hand.`);
        if(actor.prop.offset!==undefined)expect(vector(actor.prop.offset),`${label}.prop.offset must be finite actor-local XYZ metres.`);
      }
    }
  }
  return errors;
}

export function samplePath(keys,t){
  if(!Array.isArray(keys)||keys.length<2)throw new Error('samplePath requires at least two validated path keys.');
  let distance=0,heading=0;
  for(let i=1;i<keys.length;i++){
    const a=keys[i-1],b=keys[i];
    const delta=b.position.map((v,j)=>v-a.position[j]);
    const length=Math.hypot(...delta),horizontal=Math.hypot(delta[0],delta[2]);
    if(t>=a.t&&horizontal>.001)heading=Math.atan2(-delta[0],-delta[2]);
    if(t<=b.t||i===keys.length-1){
      const u=clamp((t-a.t)/(b.t-a.t));
      const velocity=delta.map(v=>v/(b.t-a.t));
      const moved=(left,right)=>Math.hypot(...right.position.map((v,j)=>v-left.position[j]))>.001;
      const starts=i===1||!moved(keys[i-2],a),ends=i===keys.length-1||!moved(b,keys[i+1]);
      const envelope=(starts?smooth((t-a.t)/.22):1)*(ends?smooth((b.t-t)/.22):1);
      return {position:lerpVector(a.position,b.position,u),distance:distance+length*u,velocity,heading,walking:Math.min(1,length/(b.t-a.t))*envelope};
    }
    distance+=length;
  }
}

export function sampleLinearKeys(keys,t,field){
  const bIndex=keys.findIndex(key=>key.t>=t);
  if(bIndex<=0)return structuredClone(keys[bIndex===0?0:keys.length-1][field]);
  const a=keys[bIndex-1],b=keys[bIndex],u=clamp((t-a.t)/(b.t-a.t));
  return Array.isArray(a[field])?lerpVector(a[field],b[field],u):lerp(a[field],b[field],u);
}
function actionTime(scene,t){
  if(!finite(t)||t<0||t>scene.duration)throw new Error('Action time must be finite segment-local seconds inside [0, scene.duration].');
  return t;
}
export function sampleDoor(scene,t){
  actionTime(scene,t);const door=scene.door;if(!door)return null;
  if(door.type==='hinged-door'){
    const angle=sampleLinearKeys(door.angleKeys,t,'angle');
    return {id:door.id??'door',type:'hinged-door',hinge:[...door.hinge],size:[...door.size],angle,swingSign:door.swingSign??1,yaw:(door.closedYaw??0)+(door.swingSign??1)*angle};
  }
  const open=smooth((t-door.openStart)/(door.openEnd-door.openStart));
  return {id:door.id??'door',type:'sliding-door',open,panelPositions:[[-(.8+1.52*open),0,scene.environment.doorZ],[.8+1.52*open,0,scene.environment.doorZ]]};
}
export function doorPointToWorld(doorState,localPoint){
  if(doorState?.type!=='hinged-door')throw new Error('A door-local contact requires a hinged door state.');
  return add(doorState.hinge,rotateY(localPoint,doorState.yaw));
}

/** Pure mannequin targets. Contact hands follow the current door transform exactly.
 * The rendered arms are explanatory segments, not anatomical IK or a reach proof.
 * Character forward is local -Z; left hand is local -X, right is local +X.
 */
export function sampleActorAction(scene,actor,t,doorState=sampleDoor(scene,t)){
  actionTime(scene,t);
  const path=samplePath(actor.path,t),scale=actor.height/1.8;
  const yaw=actor.yawKeys?sampleLinearKeys(actor.yawKeys,t,'yaw'):(actor.yaw??path.heading);
  const gaitPhase=path.distance/1.25*Math.PI*2;
  const modelPosition=[path.position[0],path.position[1]+Math.abs(Math.sin(gaitPhase))*.018*path.walking,path.position[2]];
  const toWorld=point=>add(modelPosition,rotateY(point.map(v=>v*scale),yaw));
  const hands={};
  for(const hand of ['left','right']){
    const angle=actor.pose==='aim'?.83:.1;
    // A key uses a stable, slightly separated hip hold. This is an explicit
    // mannequin execution fill, so the prop does not disappear inside the torso.
    const keyHand=actor.prop?.type==='key'&&actor.prop.hand===hand;
    const sign=hand==='left'?-1:1;
    const local=keyHand?[sign*.39,.88,.1]:[sign*.285,1.41-.32*Math.cos(angle)-.28*Math.cos(angle+.75),-.32*Math.sin(angle)-.28*Math.sin(angle+.75)];
    const contact=(actor.contacts??[]).find(c=>c.hand===hand&&t>=c.start&&(t<c.end||t===scene.duration&&t===c.end));
    hands[hand]={position:contact?doorPointToWorld(doorState,contact.localPoint):toWorld(local),contact:contact?structuredClone(contact):null,basis:contact?'DOOR_LOCAL_CONTACT':keyHand?'KEY_HIP_HOLD':'MANNEQUIN_REST'};
  }
  const target=actor.gazeKeys?sampleLinearKeys(actor.gazeKeys,t,'target'):null;
  let headYaw=0,headPitch=0;
  if(target){
    const eye=toWorld([0,1.64,0]),delta=target.map((v,i)=>v-eye[i]);
    if(Math.hypot(...delta)>1e-9){headYaw=Math.atan2(-delta[0],-delta[2])-yaw;headPitch=Math.atan2(delta[1],Math.hypot(delta[0],delta[2]))}
  }
  let prop=null;
  if(actor.prop?.type==='key')prop={...structuredClone(actor.prop),position:add(hands[actor.prop.hand].position,rotateY(actor.prop.offset??[0,-.075,0],yaw))};
  else if(actor.prop?.type==='block-rifle')prop={...structuredClone(actor.prop),position:toWorld([.06,1.08,-.42])};
  return {...path,modelPosition,yaw,gaitPhase,gaze:{target,headYaw,headPitch},hands,prop};
}
export function sampleActions(scene,t){
  actionTime(scene,t);const door=sampleDoor(scene,t);
  return {time:t,door,actors:Object.fromEntries(scene.actors.map(actor=>[actor.id,sampleActorAction(scene,actor,t,door)]))};
}
