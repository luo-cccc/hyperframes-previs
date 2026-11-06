import {sampleActions} from './action-data.js';
import {actorDimensions,combatPointToWorld} from './combat-data.js';
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
  const combatIds=new Set((scene.combat?.objects??[]).map(item=>item.id));
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
    expect((framing.requiredActors===undefined&&Array.isArray(framing.requiredObjects))||Array.isArray(framing.requiredActors)&&framing.requiredActors.every(id=>typeof id==='string'&&ids.has(id))&&new Set(framing.requiredActors).size===framing.requiredActors.length,`${shot.id}: requiredActors must contain unique existing actor IDs.`);
    if(framing.requiredObjects!==undefined)expect(Array.isArray(framing.requiredObjects)&&framing.requiredObjects.every(id=>combatIds.has(id))&&new Set(framing.requiredObjects).size===framing.requiredObjects.length,`${shot.id}: requiredObjects must contain unique existing combat object IDs.`);
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
        const key=JSON.stringify([code,shot.id,actorIds,extra.obstacleId??null,extra.blockerId??null,evidence.blockerKind??null,evidence.hand??null]);
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
    const states=scene.actors.map(actor=>({id:actor.id,...actorDimensions(actor),position:samplePath(actor.path,time).position}));
    const pose=sampleCamera(shot,time),basis=cameraBasis(pose);
    if(!scene.combat){const sampled=sampleActions(scene,time);for(const [actorId,actor]of Object.entries(sampled.actors))for(const [side,hand]of Object.entries(actor.hands))if(!hand.ik.reachable&&hand.ik.reach_error_m>config.tolerance)events.add('ARM_TARGET_UNREACHABLE',[actorId],{hand:side,target_position:hand.target_position,actual_position:hand.position,reach_error_m:hand.ik.reach_error_m,max_reach_m:hand.ik.max_reach_m});}
    for(const actor of states){
      const [x,y,z]=actor.position;
      if(y<(bounds.groundY??bounds.min[1])-config.tolerance)events.add('ACTOR_BELOW_FLOOR',[actor.id],{position:actor.position,floorY:bounds.groundY??bounds.min[1],tolerance_m:config.tolerance});
      if(y+actor.height>bounds.max[1]+config.tolerance)events.add(bounds.openAir?'ACTOR_ABOVE_DECLARED_AIRSPACE':'ACTOR_ABOVE_CEILING',[actor.id],{topY:y+actor.height,ceilingY:bounds.max[1]});
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
    if(framing)for(const actorId of framing.requiredActors??[]){
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
  const combatAudit=scene.combat?auditCombat(scene,options):null;
  const combatIssues=(combatAudit?.issues??[]).map(issue=>({...issue,actorIds:issue.objectIds.filter(id=>scene.actors.some(actor=>actor.id===id)),origin:'COMBAT_PROXY'}));
  const combinedIssues=[...issues,...combatIssues],combinedByCode={...byCode};
  for(const issue of combatIssues)combinedByCode[issue.code]=(combinedByCode[issue.code]??0)+issue.observations;
  const issueFrames=new Set();for(const issue of combinedIssues)for(const f of frames)if(f>=issue.firstFrame&&f<=issue.lastFrame)issueFrames.add(f);
  const combatIssueCount=combatIssues.length;
  return {
    schema_version:'PREVIS_SPATIAL_V1',scope:'SAMPLED_PROXY_GEOMETRY',status:issues.length+combatIssueCount?'ISSUES_FOUND':'NO_ISSUES_OBSERVED',
    sampling:{basis:'EXPORT_FRAME_TIMES',fps:scene.fps,frameCount,everyFrames:config.everyFrames,sampleCount:frames.length,sampleFrames:frames,sampleTimes_s:sampleTimes,first_s:sampleTimes[0],last_s:sampleTimes.at(-1),maxSamples:config.maxSamples},
    checks:{actorOverlap:true,stageBounds:bounds.basis,dynamicDoorContacts:'NOT_CHECKED',floorAndCeiling:true,explicitObstacleCollision:true,requiredFramingOnly:true,proxyOcclusion:config.checkOcclusion,verticalProjectionFallback},
    ...(combatAudit?{combat:combatAudit}:{}),
    thresholds:{defaultActorRadius_m:.22,collisionTolerance_m:config.tolerance,cameraNear_m:config.near},
    counts:{issueGroups:issues.length+combatIssueCount,spatialIssueGroups:issues.length,combatIssueGroups:combatIssueCount,issueObservations:combinedIssues.reduce((n,i)=>n+i.observations,0),samplesWithIssues:issueFrames.size,byCode:combinedByCode,severity:{warning:issues.length+combatIssueCount}},issues:combinedIssues,
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


function objectBox(state){
  const points=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])points.push(combatPointToWorld(state,[x*state.size[0]/2,y*state.size[1]/2,z*state.size[2]/2]));
  return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
function boxesOverlap(a,b,tolerance){return a.min.every((v,i)=>a.max[i]>b.min[i]+tolerance&&v<b.max[i]-tolerance)}

/** Attack/response remains a human review. Only declared proxy contacts and bounds
 * are tested. No target, force, damage or camera visibility is guessed from prose. */
export function auditCombat(scene,options={}){
  if(!object(options))invalid(['options must be an object.']);
  const config=validateAuditInput(scene,options),frameCount=Math.round(scene.duration*scene.fps),frames=[];
  if(!Number.isSafeInteger(frameCount)||frameCount<1)invalid(['Combat export frame count is outside the safe integer range.']);
  const count=Math.ceil(frameCount/config.everyFrames)+((frameCount-1)%config.everyFrames===0?0:1);
  if(count>config.maxSamples)invalid(['Combat sample budget exceeded; choose an explicit everyFrames or maxSamples.'],'SPATIAL_SAMPLE_BUDGET_EXCEEDED');
  for(let f=0;f<frameCount;f+=config.everyFrames)frames.push(f);if(frames.at(-1)!==frameCount-1)frames.push(frameCount-1);
  const issues=[],groups=new Map(),planned=new Map(),bounds=stageBounds(scene);let previous=null;
  const warn=(code,ids,frame,details)=>{
    const shot=scene.shots.find(s=>frame/scene.fps>=s.start&&frame/scene.fps<s.end)||scene.shots.at(-1),key=JSON.stringify([code,ids,shot.id,details.hand??null]);
    const prior=groups.get(key);
    if(prior&&prior._sample===frame-config.everyFrames){prior.lastFrame=frame;prior.end_s=round(frame/scene.fps);prior.observations++;prior._sample=frame;return}
    const item={code,severity:'warning',objectIds:ids,shotId:shot.id,firstFrame:frame,lastFrame:frame,start_s:round(frame/scene.fps),end_s:round(frame/scene.fps),observations:1,evidence:details,_sample:frame};issues.push(item);groups.set(key,item);
  };
  for(const frame of frames){
    const t=frame/scene.fps,combat=sampleActions(scene,t).combat,values=Object.values(combat.objects);
    for(const [actorId,actor]of Object.entries(combat.actors))for(const [side,hand]of Object.entries(actor.hands))if(hand.ik&&!hand.ik.reachable&&hand.ik.reach_error_m>config.tolerance)warn('ARM_TARGET_UNREACHABLE',[actorId],frame,{actor_id:actorId,hand:side,target_position:hand.target_position,actual_position:hand.position,reach_error_m:hand.ik.reach_error_m,max_reach_m:hand.ik.max_reach_m,contact_id:hand.contact?.id??null});
    const active=combat.contacts.filter(c=>c.expected),boxes=new Map(values.map(o=>[o.id,objectBox(o)]));
    for(const c of combat.contacts){
      if(c.expected){const p=planned.get(c.id)??{id:c.id,actor_id:c.actor_id??null,object_id:c.object_id??null,target_id:c.target_id,observations:0,max_gap_m:0,basis:'DECLARED_PROXY_CONTACT'};p.observations++;p.max_gap_m=Math.max(p.max_gap_m,c.gap_m);planned.set(c.id,p);
        if(c.gap_m>config.tolerance)warn('EXPECTED_CONTACT_GAP',[c.object_id??c.actor_id,c.target_id],frame,c);
        if(!c.target_visible)warn('EXPECTED_CONTACT_TARGET_INVISIBLE',[c.target_id],frame,c);
      }else if(c.gap_m<=config.tolerance)warn('UNPLANNED_CONTACT_OBSERVED',[c.object_id??c.actor_id,c.target_id],frame,c);
    }
    for(const value of values){
      if(!value.visible)continue;const box=boxes.get(value.id);
      if(box.min.some((v,i)=>v<bounds.min[i]-config.tolerance)||box.max.some((v,i)=>v>bounds.max[i]+config.tolerance))warn('COMBAT_OBJECT_OUTSIDE_BOUNDS',[value.id],frame,{box,bounds,kind:value.kind});
      if(['sword','staff','projectile'].includes(value.kind)){
        for(const obstacle of config.obstacles){
          const before=previous?.objects[value.id],expanded={min:obstacle.min.map((v,i)=>v-(box.max[i]-box.min[i])/2),max:obstacle.max.map((v,i)=>v+(box.max[i]-box.min[i])/2)};
          const swept=before?.visible&&rayBoxFraction(before.position,value.position,expanded)!==null;
          if(boxesOverlap(box,obstacle,config.tolerance)||swept)warn('WEAPON_INTERSECTS_DECLARED_OBSTACLE',[value.id,obstacle.id],frame,{box,obstacle,swept:!!swept,from:before?.position??null,to:value.position});
        }
        for(const target of values){
          if(!target.visible||target.id===value.id||!(target.solid===true||target.solid!==false&&['barrier','shield'].includes(target.kind)))continue;
          const plannedContact=active.some(c=>c.object_id===value.id&&c.target_id===target.id||c.object_id===target.id&&c.target_id===value.id);
          const before=previous?.objects[value.id],targetBox=boxes.get(target.id),expanded={min:targetBox.min.map((v,i)=>v-(box.max[i]-box.min[i])/2),max:targetBox.max.map((v,i)=>v+(box.max[i]-box.min[i])/2)};
          const swept=before?.visible&&rayBoxFraction(before.position,value.position,expanded)!==null;
          if(!plannedContact&&(boxesOverlap(box,targetBox,config.tolerance)||swept))warn('UNPLANNED_COMBAT_PROXY_INTERSECTION',[value.id,target.id],frame,{sourceBox:box,targetBox:boxes.get(target.id)});
        }
      }
    }
    const shot=scene.shots.find(s=>t>=s.start&&t<s.end)||scene.shots.at(-1),pose=sampleCamera(shot,t),basis=cameraBasis(pose);
    for(const id of shot.framing?.requiredObjects??[]){const value=combat.objects[id];
      if(!value.visible){warn('REQUIRED_COMBAT_OBJECT_NOT_VISIBLE',[id],frame,{visible:false});continue}
      if(!basis){warn('CAMERA_DIRECTION_UNDEFINED',[],frame,pose);continue}
      const mode=shot.framing.mode??'center',box=boxes.get(id),points=mode==='center'?[value.position]:[];
      if(mode==='full')for(const x of [box.min[0],box.max[0]])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])points.push([x,y,z]);
      const margin=shot.framing.margin??.02,projected=points.map(point=>project(point,pose,basis,scene.width/scene.height,config.near));
      if(projected.some(v=>!v.inFront||v.screen.some(n=>n<margin||n>1-margin)))warn('REQUIRED_COMBAT_OBJECT_OUT_OF_FRAME',[id],frame,{camera:pose,mode,projected});
    }
    previous=combat;
  }
  for(const issue of issues)delete issue._sample;
  return {schema_version:'PREVIS_COMBAT_AUDIT_V1',scope:'SAMPLED_PROXY',status:issues.length?'ISSUES_FOUND':'NO_ISSUES_OBSERVED',sampling:{basis:'EXPORT_FRAME_TIMES',fps:scene.fps,frameCount,everyFrames:config.everyFrames,sampleCount:frames.length,sampleFrames:frames},plannedContacts:[...planned.values()],issues,counts:{issueGroups:issues.length,plannedContactGroups:planned.size},checks:{absoluteTracks:true,uniqueOwnership:'STRUCTURAL_VALIDATION',irreversibility:'STRUCTURAL_VALIDATION',expectedContactGaps:true,weaponExplicitObstacles:true,requiredObjectsOnly:true},limitations:['Fixed-length proxy arm IK reports reach gaps; it does not prove anatomical limits, support, forces or tactical PASS.','Collision uses transformed object AABBs and sampled/swept proxy centres, not exact mesh collision.','Only declared requiredObjects and explicit obstacles are checked; undeclared attack targets are not inferred.','Visibility/knowledge/light event records are preserved; drawing visibility comes only from the explicit object keys.','Open air uses declared world bounds and ground height, never an indoor ceiling.']};
}
