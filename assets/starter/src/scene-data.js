export function validateScene(s) {
  const errors=[];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
  const expect=(ok,message)=>{if(!ok)errors.push(message)};
  const onFrame=t=>finite(t)&&finite(s.fps)&&Math.abs(t*s.fps-Math.round(t*s.fps))<1e-5;
  if(!object(s))return ['Scene must be a JSON object.'];
  expect(s.schemaVersion===1,'schemaVersion must be 1.');
  expect(typeof s.id==='string'&&/^[a-z0-9-]+$/.test(s.id),'id must be a lowercase slug string.');
  expect(finite(s.duration)&&s.duration>0,'duration must be positive.');
  for(const key of ['width','height'])expect(Number.isInteger(s[key])&&s[key]>0&&s[key]%2===0,`${key} must be a positive even integer for H.264 yuv420p export.`);
  expect(finite(s.fps)&&s.fps>=1&&s.fps<=240,'fps must be between 1 and 240.');
  if(finite(s.duration)&&finite(s.fps))expect(onFrame(s.duration),'duration must contain a whole number of frames; choose an exact fps or explicitly implement a technical time mapping.');
  const env=object(s.environment)?s.environment:{};
  expect(object(s.environment),'environment must be an object.');
  expect(env.type==='corridor','This starter supports environment.type=corridor; implement new geometry for other types.');
  for(const k of ['width','height','length'])expect(finite(env[k])&&env[k]>0,`environment.${k} must be positive.`);
  expect(finite(env.doorZ),'environment.doorZ must be finite.');
  if(s.door!==null&&s.door!==undefined){
    expect(object(s.door),'door must be an object or null.');
    if(object(s.door))expect(finite(s.door.openStart)&&finite(s.door.openEnd)&&s.door.openStart>=0&&s.door.openEnd>s.door.openStart&&s.door.openEnd<=s.duration,'Door event must be ordered and inside the timeline.');
  }
  const actors=Array.isArray(s.actors)?s.actors:[];
  expect(Array.isArray(s.actors),'actors must be an explicit array; an empty array is valid for a no-character shot.');
  const actorIds=new Set();
  actors.forEach((a,index)=>{
    if(!object(a)){errors.push(`actors[${index}] must be an object.`);return}
    const label=typeof a.id==='string'&&a.id?a.id:`actors[${index}]`;
    expect(typeof a.id==='string'&&a.id.length>0&&!actorIds.has(a.id),'Actor IDs must be nonempty and unique.');actorIds.add(a.id);
    expect(typeof a.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(a.color),`${label}: color must be #RRGGBB.`);
    expect(finite(a.height)&&a.height>0,`${label}: height must be positive.`);
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
    if(finite(shot.start)&&finite(s.fps))expect(onFrame(shot.start),`${label}: start ${shot.start}s is not on the ${s.fps}fps frame grid; choose an exact fps or explicitly implement a time mapping.`);
    if(finite(shot.end)&&finite(s.fps))expect(onFrame(shot.end),`${label}: end ${shot.end}s is not on the ${s.fps}fps frame grid; choose an exact fps or explicitly implement a time mapping.`);
    end=shot.end;
    const camera=object(shot.camera)?shot.camera:{};
    expect(object(shot.camera),`${label}: camera must be an object.`);
    for(const name of ['from','to']){
      const c=camera[name];
      expect(object(c)&&vector(c.position)&&vector(c.target)&&finite(c.fov)&&c.fov>1&&c.fov<150,`${label}: invalid ${name} camera.`);
    }
    const offset=camera.offset;
    expect(object(offset)&&vector(offset.position)&&vector(offset.target)&&finite(offset.fov),`${label}: invalid camera offset.`);
    if(object(offset)&&finite(offset.fov))for(const name of ['from','to']){
      const c=camera[name];if(object(c)&&finite(c.fov))expect(c.fov+offset.fov>1&&c.fov+offset.fov<150,`${label}: effective FOV is out of range.`);
    }
  });
  expect(finite(end)&&finite(s.duration)&&Math.abs(end-s.duration)<1e-6,'Shots must cover exactly the declared duration.');
  return errors;
}

export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const smooth=v=>{v=clamp(v);return v*v*(3-2*v)};
export const lerp=(a,b,v)=>a+(b-a)*v;
export const lerpVector=(a,b,v)=>a.map((n,i)=>lerp(n,b[i],v));

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

export function sampleCamera(shot,t){
  const u=smooth((t-shot.start)/(shot.end-shot.start));
  const a=shot.camera.from,b=shot.camera.to,o=shot.camera.offset;
  return {position:lerpVector(a.position,b.position,u).map((v,i)=>v+o.position[i]),target:lerpVector(a.target,b.target,u).map((v,i)=>v+o.target[i]),fov:lerp(a.fov,b.fov,u)+o.fov};
}
