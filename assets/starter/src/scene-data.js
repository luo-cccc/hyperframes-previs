import {validateCombatData} from './combat-data.js';
import {validateActionData,clamp,smooth,lerp,lerpVector} from './action-data.js';
import {validateTimeMapping} from './time-mapping.js';
export {clamp,smooth,lerp,lerpVector,samplePath} from './action-data.js';

export function validateScene(s) {
  const errors=[];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
  const expect=(ok,message)=>{if(!ok)errors.push(message)};
  if(!object(s))return ['Scene must be a JSON object.'];
  const onFrame=t=>finite(t)&&finite(s.fps)&&Math.abs(t*s.fps-Math.round(t*s.fps))<1e-5;
  expect(s.schemaVersion===1,'schemaVersion must be 1.');
  expect(typeof s.id==='string'&&/^[a-z0-9-]+$/.test(s.id),'id must be a lowercase slug string.');
  expect(finite(s.duration)&&s.duration>0,'duration must be positive.');
  for(const key of ['width','height'])expect(Number.isInteger(s[key])&&s[key]>0&&s[key]%2===0,`${key} must be a positive even integer for H.264 yuv420p export.`);
  expect(finite(s.fps)&&s.fps>=1&&s.fps<=240,'fps must be between 1 and 240.');
  if(finite(s.duration)&&finite(s.fps))expect(onFrame(s.duration),'duration must contain a whole number of frames; choose an exact fps. A time mapping records clocks and never rounds the budget.');
  const env=object(s.environment)?s.environment:{};
  expect(object(s.environment),'environment must be an object.');
  expect(['corridor','dutyroom','battlefield'].includes(env.type),'Supported environment.type values are corridor, dutyroom and battlefield.');
  if(env.type==='battlefield'){
    expect(object(env.bounds)&&vector(env.bounds.min)&&vector(env.bounds.max)&&env.bounds.min.every((v,i)=>v<env.bounds.max[i]),'Battlefield environment.bounds requires finite min/max XYZ world bounds.');
    expect(object(env.ground)&&finite(env.ground.y),'Battlefield environment.ground.y must be an explicit finite world floor height.');
    expect(vector(env.worldZero),'Battlefield environment.worldZero must be finite XYZ (a declared world landmark).');
    if(object(env.bounds)&&vector(env.bounds.min)&&vector(env.bounds.max)&&object(env.ground)&&finite(env.ground.y))expect(env.ground.y>=env.bounds.min[1]&&env.ground.y<env.bounds.max[1],'Battlefield ground.y must lie inside explicit bounds.');
  }else for(const k of ['width','height','length'])expect(finite(env[k])&&env[k]>0,`environment.${k} must be positive.`);
  if(env.type==='corridor')expect(finite(env.doorZ),'environment.doorZ must be finite.');
  if(env.type==='dutyroom'){
    expect(vector(env.floorCenter),'Dutyroom environment.floorCenter must be finite world XYZ metres (the centre of the floor).');
    expect(s.door===null||s.door===undefined||s.door?.type==='hinged-door','Dutyroom doors must explicitly use type=hinged-door.');
  }
  errors.push(...validateActionData(s),...validateTimeMapping(s),...validateCombatData(s));
  const actors=Array.isArray(s.actors)?s.actors:[];
  expect(Array.isArray(s.actors),'actors must be an explicit array; an empty array is valid for a no-character shot.');
  const actorIds=new Set();
  actors.forEach((a,index)=>{
    if(!object(a)){errors.push(`actors[${index}] must be an object.`);return}
    const label=typeof a.id==='string'&&a.id?a.id:`actors[${index}]`;
    expect(typeof a.id==='string'&&a.id.length>0&&!actorIds.has(a.id),'Actor IDs must be nonempty and unique.');actorIds.add(a.id);
    expect(typeof a.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(a.color),`${label}: color must be #RRGGBB.`);
    expect(finite(a.height)&&a.height>0,`${label}: height must be positive.`);
    if(a.geometry!==undefined)expect(['humanoid','creature','manifestation'].includes(a.geometry),`${label}: geometry must be humanoid, creature or manifestation.`);
    if(a.scale!==undefined)expect(finite(a.scale)&&a.scale>0||vector(a.scale)&&a.scale.every(v=>v>0),`${label}: scale must be a positive scalar or positive XYZ vector.`);
    if(a.yaw!==undefined)expect(finite(a.yaw),`${label}: yaw must be a finite angle in radians.`);
    const keys=Array.isArray(a.path)?a.path:[];
    expect(Array.isArray(a.path)&&keys.length>=2,`${label}: path must be an array with at least two keys.`);
    expect(object(keys[0])&&keys[0].t===0&&object(keys.at(-1))&&finite(keys.at(-1).t)&&keys.at(-1).t>=s.duration,`${label}: path must cover the entire timeline.`);
    keys.forEach((key,i)=>{
      if(!object(key)){errors.push(`${label}: path[${i}] must be an object.`);return}
      expect(finite(key.t)&&key.t>=0&&vector(key.position),`${label}: invalid path key ${i}.`);
      if(i&&object(keys[i-1])&&finite(key.t)&&finite(keys[i-1].t))expect(key.t>keys[i-1].t,`${label}: path times must increase.`);
    });
  });
  const shots=Array.isArray(s.shots)?s.shots:[];
  expect(Array.isArray(s.shots)&&shots.length>0,'shots must be an array with at least one shot.');
  const shotIds=new Set();let end=0;
  shots.forEach((shot,index)=>{
    if(!object(shot)){errors.push(`shots[${index}] must be an object.`);return}
    const label=typeof shot.id==='string'&&shot.id?shot.id:`shots[${index}]`;
    expect(typeof shot.id==='string'&&shot.id.length>0&&!shotIds.has(shot.id),'Shot IDs must be nonempty and unique.');shotIds.add(shot.id);
    expect(finite(shot.start)&&finite(shot.end)&&shot.end>shot.start,`${label}: invalid time range.`);
    if(finite(shot.start)&&finite(end))expect(Math.abs(shot.start-end)<1e-6,`${label}: gap or overlap before shot.`);
    if(finite(shot.start)&&finite(s.fps))expect(onFrame(shot.start),`${label}: start ${shot.start}s is not on the ${s.fps}fps frame grid; choose an exact fps.`);
    if(finite(shot.end)&&finite(s.fps))expect(onFrame(shot.end),`${label}: end ${shot.end}s is not on the ${s.fps}fps frame grid; choose an exact fps.`);
    end=shot.end;
    const camera=object(shot.camera)?shot.camera:{};
    expect(object(shot.camera),`${label}: camera must be an object.`);
    const poses=[];
    const validPose=c=>object(c)&&vector(c.position)&&vector(c.target)&&finite(c.fov)&&c.fov>1&&c.fov<150;
    if(camera.keys!==undefined){
      expect(camera.from===undefined&&camera.to===undefined,`${label}: choose camera.keys or from/to, not both. A rig replacement must remove keys explicitly.`);
      expect(Array.isArray(camera.keys)&&camera.keys.length>=2,`${label}: camera.keys needs at least two keys.`);
      if(Array.isArray(camera.keys)&&camera.keys.length){
        expect(camera.keys[0]?.t===shot.start&&camera.keys.at(-1)?.t===shot.end,`${label}: camera.keys must cover the shot's exact [start,end] in segment-local absolute seconds.`);
        camera.keys.forEach((key,i)=>{
          expect(validPose(key)&&finite(key.t)&&key.t>=shot.start&&key.t<=shot.end,`${label}: invalid camera key ${i}.`);
          if(i)expect(finite(camera.keys[i-1]?.t)&&key?.t>camera.keys[i-1].t,`${label}: camera key times must strictly increase.`);
          poses.push(key);
        });
      }
      if(camera.interpolation!==undefined)expect(['linear','smooth'].includes(camera.interpolation),`${label}: key interpolation must be linear or smooth.`);
    }else{
      expect(camera.interpolation===undefined,`${label}: interpolation is only configurable for camera.keys; legacy from/to uses smooth easing.`);
      for(const name of ['from','to']){expect(validPose(camera[name]),`${label}: invalid ${name} camera.`);poses.push(camera[name])}
    }
    const offset=camera.offset;
    expect(object(offset)&&vector(offset.position)&&vector(offset.target)&&finite(offset.fov),`${label}: invalid camera offset.`);
    if(object(offset)&&finite(offset.fov))for(const pose of poses)if(object(pose)&&finite(pose.fov))expect(pose.fov+offset.fov>1&&pose.fov+offset.fov<150,`${label}: effective FOV is out of range.`);
  });
  expect(finite(end)&&finite(s.duration)&&Math.abs(end-s.duration)<1e-6,'Shots must cover exactly the declared duration.');
  return errors;
}

/** The same floor-centred box is used by builders and the sampled spatial audit. */
export function stageBounds(scene){
  const env=scene.environment;
  if(env.type==='battlefield')return {min:[...env.bounds.min],max:[...env.bounds.max],groundY:env.ground.y,worldZero:[...env.worldZero],basis:'BATTLEFIELD_EXPLICIT_BOUNDS',openAir:true};
  const center=env.type==='dutyroom'?env.floorCenter:[0,0,-1];
  return {min:[center[0]-env.width/2,center[1],center[2]-env.length/2],max:[center[0]+env.width/2,center[1]+env.height,center[2]+env.length/2],basis:env.type==='dutyroom'?'DUTYROOM_FLOOR_CENTER':'CORRIDOR_CENTER_Z_MINUS_ONE'};
}

export function sampleCamera(shot,t){
  let a,b,u;
  if(shot.camera.keys){
    const keys=shot.camera.keys,index=keys.findIndex(key=>key.t>=t);
    if(index<=0){a=b=keys[index===0?0:keys.length-1];u=0}
    else{a=keys[index-1];b=keys[index];u=clamp((t-a.t)/(b.t-a.t));if(shot.camera.interpolation==='smooth')u=smooth(u)}
  }else{a=shot.camera.from;b=shot.camera.to;u=smooth((t-shot.start)/(shot.end-shot.start))}
  const o=shot.camera.offset;
  return {position:lerpVector(a.position,b.position,u).map((v,i)=>v+o.position[i]),target:lerpVector(a.target,b.target,u).map((v,i)=>v+o.target[i]),fov:lerp(a.fov,b.fov,u)+o.fov};
}
