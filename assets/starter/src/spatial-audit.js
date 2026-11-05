import {validateScene,samplePath,sampleCamera,stageBounds} from './scene-data.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(finite);
const sub=(a,b)=>a.map((value,i)=>value-b[i]);
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=value=>Math.hypot(...value);
const normalize=value=>{const magnitude=length(value);return magnitude>1e-9?value.map(v=>v/magnitude):null};
const round=value=>Math.round(value*1e6)/1e6;

function invalid(problems,code='SPATIAL_INPUT_INVALID'){
  const error=new Error(`Spatial audit input is invalid:\n${problems.join('\n')}`);
  error.code=code;error.problems=problems;throw error;
}

function validateAuditInput(scene,options){
  const issues=validateScene(scene);if(issues.length)invalid(issues);
  const spatial=scene.spatial===undefined?{}:scene.spatial;
  if(!object(spatial))invalid(['scene.spatial must be an object when provided.']);
  const errors=[],expect=(ok,message)=>{if(!ok)errors.push(message)};
  const ids=new Set(scene.actors.map(actor=>actor.id));
  for(const actor of scene.actors)if(actor.radius!==undefined)expect(finite(actor.radius)&&actor.radius>0,`${actor.id}: radius must be positive metres.`);
  if(spatial.checkOcclusion!==undefined)expect(typeof spatial.checkOcclusion==='boolean','spatial.checkOcclusion must be a boolean.');
  if(options.checkOcclusion!==undefined)expect(typeof options.checkOcclusion==='boolean','options.checkOcclusion must be a boolean.');
  const obstacles=spatial.obstacles===undefined?[]:spatial.obstacles;
  expect(Array.isArray(obstacles),'spatial.obstacles must be an explicit array.');
  const obstacleIds=new Set();
  if(Array.isArray(obstacles))obstacles.forEach((obstacle,index)=>{
    if(!object(obstacle)){errors.push(`obstacles[${index}] must be an object.`);return}
    expect(typeof obstacle.id==='string'&&obstacle.id.trim()&&!obstacleIds.has(obstacle.id),`obstacles[${index}] needs a unique nonempty ID.`);obstacleIds.add(obstacle.id);
    expect(vector(obstacle.min)&&vector(obstacle.max)&&obstacle.min.every((value,i)=>value<obstacle.max[i]),`${obstacle.id||index}: min/max must describe a nonempty finite AABB.`);
  });
  for(const shot of scene.shots){
    if(shot.framing===undefined)continue;
    if(!object(shot.framing)){errors.push(`${shot.id}: framing must be an object.`);continue}
    const framing=shot.framing;
    expect(Array.isArray(framing.requiredActors)&&framing.requiredActors.every(id=>typeof id==='string'&&ids.has(id))&&new Set(framing.requiredActors).size===framing.requiredActors.length,`${shot.id}: requiredActors must contain unique existing actor IDs.`);
    if(framing.mode!==undefined)expect(['center','full'].includes(framing.mode),`${shot.id}: framing.mode must be center or full.`);
    if(framing.margin!==undefined)expect(finite(framing.margin)&&framing.margin>=0&&framing.margin<.5,`${shot.id}: framing.margin must be in [0,0.5).`);
  }
  const everyFrames=options.everyFrames??1,maxSamples=options.maxSamples??20000;
  expect(Number.isInteger(everyFrames)&&everyFrames>=1,'everyFrames must be a positive integer; sampling is never silently reduced.');
  expect(Number.isInteger(maxSamples)&&maxSamples>=1&&maxSamples<=1000000,'maxSamples must be an integer from 1 to 1000000.');
  const tolerance=options.tolerance??.02;
  expect(finite(tolerance)&&tolerance>=0&&tolerance<=1,'tolerance must be finite metres in [0,1].');
  const near=options.near??.05;
  expect(finite(near)&&near>0,'near must be positive metres.');
  if(errors.length)invalid(errors);
  return {spatial,obstacles,everyFrames,maxSamples,tolerance,near,checkOcclusion:options.checkOcclusion??spatial.checkOcclusion??true};
}

function inside(point,obstacle,tolerance=0){return point.every((value,i)=>value>=obstacle.min[i]-tolerance&&value<=obstacle.max[i]+tolerance)}
function cylinderIntersectsBox(state,obstacle,tolerance){
  const [x,y,z]=state.position;
  if(y+state.height<=obstacle.min[1]+tolerance||y>=obstacle.max[1]-tolerance)return false;
  const closestX=Math.max(obstacle.min[0],Math.min(obstacle.max[0],x)),closestZ=Math.max(obstacle.min[2],Math.min(obstacle.max[2],z));
  return Math.hypot(x-closestX,z-closestZ)<Math.max(0,state.radius-tolerance);
}
function rayBoxFraction(start,end,box){
  const delta=sub(end,start);let minimum=0,maximum=1;
  for(let axis=0;axis<3;axis++){
    if(Math.abs(delta[axis])<1e-9){if(start[axis]<box.min[axis]||start[axis]>box.max[axis])return null;continue}
    let a=(box.min[axis]-start[axis])/delta[axis],b=(box.max[axis]-start[axis])/delta[axis];if(a>b)[a,b]=[b,a];
    minimum=Math.max(minimum,a);maximum=Math.min(maximum,b);if(maximum<minimum)return null;
  }
  return minimum>=0&&minimum<1-1e-5?minimum:null;
}
function cameraBasis(pose){
  const forward=normalize(sub(pose.target,pose.position));if(!forward)return null;
  // A vertical look direction cannot define roll from world Y alone. This is a
  // declared projection fallback, not a claim to reproduce an arbitrary rig.
  let right=normalize(cross(forward,[0,1,0])),verticalFallback=false;
  if(!right){right=normalize(cross(forward,[0,0,-1]));verticalFallback=true}
  return {forward,right,up:normalize(cross(right,forward)),verticalFallback};
}
function project(point,pose,basis,aspect,near){
  const relative=sub(point,pose.position),depth=dot(relative,basis.forward),tan=Math.tan(pose.fov*Math.PI/360);
  if(depth<=near)return {depth:round(depth),screen:null,inFront:false};
  const nx=dot(relative,basis.right)/(depth*tan*aspect),ny=dot(relative,basis.up)/(depth*tan);
  return {depth:round(depth),screen:[round((nx+1)/2),round((1-ny)/2)],inFront:true};
}
function framingPoints(state,mode){
  const [x,y,z]=state.position,center=[x,y+state.height/2,z];if(mode==='center')return [center];
  const points=[];for(const sx of [-1,1])for(const sy of [0,1])for(const sz of [-1,1])points.push([x+sx*state.radius,y+sy*state.height,z+sz*state.radius]);return points;
}

/** Deterministic, sampled proxy geometry checks. This is not a pixel/physics/semantic approval. */
export function auditScene(scene,options={}){
  if(!object(options))invalid(['options must be an object.']);
  const config=validateAuditInput(scene,options),frameCount=Math.round(scene.duration*scene.fps),bounds=stageBounds(scene);
  if(!Number.isSafeInteger(frameCount)||frameCount<1)invalid(['Export frame count is outside the safe integer range.'],'SPATIAL_SAMPLE_BUDGET_EXCEEDED');
  const plannedSamples=Math.ceil(frameCount/config.everyFrames)+((frameCount-1)%config.everyFrames===0?0:1);
  if(plannedSamples>config.maxSamples)invalid([`${plannedSamples} sample frames exceed the explicit maxSamples budget of ${config.maxSamples}; choose an explicit everyFrames value or raise maxSamples. No automatic decimation was performed.`],'SPATIAL_SAMPLE_BUDGET_EXCEEDED');
  const frames=[];for(let frame=0;frame<frameCount;frame+=config.everyFrames)frames.push(frame);
  if(frames.at(-1)!==frameCount-1)frames.push(frameCount-1);
  const issues=[],lastIssue=new Map(),byCode={},sampleTimes=frames.map(frame=>round(frame/scene.fps));
  let issueObservations=0,samplesWithIssues=0,verticalProjectionFallback=false;
  const checkStart=(frame,sampleIndex,shot)=>{
    let thisSample=0;
    return {
      add(code,actorIds,evidence,extra={}){
        thisSample++;issueObservations++;byCode[code]=(byCode[code]||0)+1;
        const key=JSON.stringify([code,shot.id,actorIds,extra.obstacleId??null,extra.blockerId??null,evidence.blockerKind??null]);
        const previous=lastIssue.get(key),time=round(frame/scene.fps);
        if(previous&&previous.lastSampleIndex===sampleIndex-1){previous.issue.end_s=time;previous.issue.lastFrame=frame;previous.issue.observations++;previous.lastSampleIndex=sampleIndex;return}
        const issue={code,severity:'warning',shotId:shot.id,actorIds,start_s:time,end_s:time,firstFrame:frame,lastFrame:frame,observations:1,interval_basis:'FIRST_AND_LAST_OBSERVED_SAMPLE',evidence,...extra};
        issues.push(issue);lastIssue.set(key,{issue,lastSampleIndex:sampleIndex});
      },
      finish(){if(thisSample)samplesWithIssues++}
    };
  };
  for(let sampleIndex=0;sampleIndex<frames.length;sampleIndex++){
    const frame=frames[sampleIndex],time=frame/scene.fps,shot=scene.shots.find(item=>time>=item.start&&time<item.end)||scene.shots.at(-1),events=checkStart(frame,sampleIndex,shot);
    const states=scene.actors.map(actor=>({id:actor.id,height:actor.height,radius:actor.radius??.22,position:samplePath(actor.path,time).position}));
    const pose=sampleCamera(shot,time),basis=cameraBasis(pose);
    for(const actor of states){
      const [x,y,z]=actor.position;
      if(y<bounds.min[1]-config.tolerance)events.add('ACTOR_BELOW_FLOOR',[actor.id],{position:actor.position,floorY:bounds.min[1],tolerance_m:config.tolerance});
      if(y+actor.height>bounds.max[1]+config.tolerance)events.add('ACTOR_ABOVE_CEILING',[actor.id],{topY:y+actor.height,ceilingY:bounds.max[1]});
      if(x-actor.radius<bounds.min[0]-config.tolerance||x+actor.radius>bounds.max[0]+config.tolerance||z-actor.radius<bounds.min[2]-config.tolerance||z+actor.radius>bounds.max[2]+config.tolerance)events.add('ACTOR_OUTSIDE_STAGE',[actor.id],{position:actor.position,radius_m:actor.radius,bounds:{min:bounds.min,max:bounds.max}});
      for(const obstacle of config.obstacles)if(cylinderIntersectsBox(actor,obstacle,config.tolerance))events.add('ACTOR_INTERSECTS_OBSTACLE',[actor.id],{position:actor.position,proxyRadius_m:actor.radius,obstacle:{min:obstacle.min,max:obstacle.max}},{obstacleId:obstacle.id});
    }
    for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){
      const a=states[i],b=states[j],verticalOverlap=Math.min(a.position[1]+a.height,b.position[1]+b.height)-Math.max(a.position[1],b.position[1]),distance=Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2]);
      if(verticalOverlap>config.tolerance&&distance<a.radius+b.radius-config.tolerance)events.add('ACTOR_PROXY_OVERLAP',[a.id,b.id],{positions:[a.position,b.position],horizontalDistance_m:round(distance),combinedRadius_m:a.radius+b.radius});
    }
    for(const obstacle of config.obstacles)if(inside(pose.position,obstacle))events.add('CAMERA_INSIDE_OBSTACLE',[],{cameraPosition:pose.position,obstacle:{min:obstacle.min,max:obstacle.max}},{obstacleId:obstacle.id});
    if(!basis){events.add('CAMERA_DIRECTION_UNDEFINED',[],{position:pose.position,target:pose.target});events.finish();continue}
    if(basis.verticalFallback)verticalProjectionFallback=true;
    const framing=shot.framing;
    if(framing)for(const actorId of framing.requiredActors){
      const actor=states.find(item=>item.id===actorId),mode=framing.mode??'center',margin=framing.margin??.02;
      const points=framingPoints(actor,mode),projected=points.map(point=>project(point,pose,basis,scene.width/scene.height,config.near));
      const failed=projected.filter(point=>!point.inFront||point.screen.some(value=>value<margin||value>1-margin));
      if(failed.length){events.add('REQUIRED_ACTOR_OUT_OF_FRAME',[actorId],{mode,margin,failedProxyPoints:failed,totalProxyPoints:points.length,camera:pose});continue}
      if(!config.checkOcclusion)continue;
      const center=[actor.position[0],actor.position[1]+actor.height/2,actor.position[2]];
      for(const obstacle of config.obstacles){const fraction=rayBoxFraction(pose.position,center,obstacle);if(fraction!==null)events.add('REQUIRED_ACTOR_PROXY_OCCLUDED',[actorId],{rayTarget:center,intersectionFraction:round(fraction),blockerKind:'explicit-obstacle'},{blockerId:obstacle.id})}
      for(const other of states){
        if(other.id===actorId)continue;
        const p=other.position,box={min:[p[0]-other.radius,p[1],p[2]-other.radius],max:[p[0]+other.radius,p[1]+other.height,p[2]+other.radius]},fraction=rayBoxFraction(pose.position,center,box);
        if(fraction!==null)events.add('REQUIRED_ACTOR_PROXY_OCCLUDED',[actorId],{rayTarget:center,intersectionFraction:round(fraction),blockerKind:'actor-aabb',blockingActorId:other.id},{blockerId:other.id});
      }
    }
    events.finish();
  }
  return {
    schema_version:'PREVIS_SPATIAL_V1',scope:'SAMPLED_PROXY_GEOMETRY',status:issues.length?'ISSUES_FOUND':'NO_ISSUES_OBSERVED',
    sampling:{basis:'EXPORT_FRAME_TIMES',fps:scene.fps,frameCount,everyFrames:config.everyFrames,sampleCount:frames.length,sampleFrames:frames,sampleTimes_s:sampleTimes,first_s:sampleTimes[0],last_s:sampleTimes.at(-1),maxSamples:config.maxSamples},
    checks:{actorOverlap:true,stageBounds:bounds.basis,dynamicDoorContacts:'NOT_CHECKED',floorAndCeiling:true,explicitObstacleCollision:true,requiredFramingOnly:true,proxyOcclusion:config.checkOcclusion,verticalProjectionFallback},
    thresholds:{defaultActorRadius_m:.22,collisionTolerance_m:config.tolerance,cameraNear_m:config.near},
    counts:{issueGroups:issues.length,issueObservations,samplesWithIssues,byCode,severity:{warning:issues.length}},issues,
    limitations:[
      'Warnings use cylindrical actor proxies and static explicit AABBs, not mesh contacts, skeletal pose, limbs, pixel masks or a physics simulation.',
      'Only declared framing.requiredActors are checked for image visibility. Other actors may intentionally be cropped or off screen.',
      'Occlusion checks the ray to the required proxy centre, not the full visible silhouette; a warning needs visual review.',
      'Undeclared scenery, dynamic doors, props and animated blockers are not inferred from the renderer. Declare an appropriate proxy or inspect the actual frames.',
      `Stage bounds match ${bounds.basis}: min=${JSON.stringify(bounds.min)}, max=${JSON.stringify(bounds.max)}. Dynamic door-to-hand targets are not a general collision or reach proof.`,
      'Exactly vertical camera directions use world -Z to resolve the projection roll. A custom camera-up/roll rig requires matching projection logic and visual verification.',
      'Observed time ranges span consecutive samples only. Intermediate unsampled times, detailed performance, speech and narrative correctness are not approved.',
      'No issues observed is limited to these sampled proxy checks; it is not full media or semantic PASS.'
    ]
  };
}
