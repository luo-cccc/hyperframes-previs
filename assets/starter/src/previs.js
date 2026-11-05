import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateScene, sampleCamera, clamp, stageBounds } from './scene-data.js';
import {sampleActions} from './action-data.js';
import {mapSegmentTime} from './time-mapping.js';
import {planCameraRig} from './camera-rigs.js';

const stage=document.getElementById('stage');
const sceneText=await fetch('./scene.json').then(r=>{if(!r.ok)throw new Error('scene.json could not be loaded.');return r.text()});
let savedData=JSON.parse(sceneText),data=structuredClone(savedData);
let revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sceneText))),v=>v.toString(16).padStart(2,'0')).join('');
let saveQueue=Promise.resolve(),reloadRequired=false;
const errors=validateScene(data);if(errors.length)throw new Error(errors.join('\n'));
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
renderer.setSize(data.width,data.height);renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
stage.style.width=data.width+'px';stage.style.height=data.height+'px';stage.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#15212d');scene.fog=new THREE.Fog('#15212d',20,48);
const camera=new THREE.PerspectiveCamera(54,data.width/data.height,.05,100);
const observer=new THREE.PerspectiveCamera(55,data.width/data.height,.05,120);
const controls=new OrbitControls(observer,renderer.domElement);controls.enabled=false;controls.enableDamping=false;
let time=0,view='camera',activeShot=data.shots[0];
let selectedObject=null,selectionPoint={x:.5,y:.5};
const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.78,metalness:.1,...extra});
const mats={floor:mat('#344351'),wall:mat('#475360'),trim:mat('#20303e'),door:mat('#65747c'),light:mat('#b9f6ee',{emissive:'#8bc6c4',emissiveIntensity:2}),dark:mat('#18242d')};
function box(w,h,d,x,y,z,material,parent=scene){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh}
function ball(radius,x,y,z,material,parent){const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,16,12),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh}

const env=data.environment,half=env.width/2,bounds=stageBounds(data);
const floorCenter=bounds.min.map((v,i)=>i===1?v:(v+bounds.max[i])/2);
box(env.width,.15,env.length,floorCenter[0],floorCenter[1]-.09,floorCenter[2],mats.floor);
const walls=new THREE.Group();scene.add(walls);
const doors=[];let hingedDoor=null;
if(env.type==='corridor'){
  box(.18,env.height,env.length,-half,env.height/2,-1,mats.wall,walls);
  box(.18,env.height,env.length,half,env.height/2,-1,mats.wall,walls);
  box(env.width,.15,env.length,0,env.height+.05,-1,mats.trim,walls);
  for(let z=-12;z<=10;z+=4){
    for(const side of [-1,1]){
      box(.12,env.height,.15,side*(half-.13),env.height/2,z,mats.trim,walls);
      box(.13,.08,3.5,side*(half-.15),.58,z+1.8,mats.light,walls);
      box(.11,1.1,2.2,side*(half-.12),2,z+1.1,mats.trim,walls);
    }
    box(2.4,.045,.23,0,env.height-.08,z,mats.light,walls);
  }
  box(env.width,env.height,.18,0,env.height/2,-1-env.length/2,mats.wall,walls);
  if(data.door&&data.door.type!=='hinged-door'){
    const doorZ=env.doorZ,opening=3.2;
    for(const sign of [-1,1])box((env.width-opening)/2,env.height,.3,sign*(opening/2+(env.width-opening)/4),env.height/2,doorZ,mats.wall,walls);
    box(opening,.65,.32,0,env.height-.325,doorZ,mats.wall,walls);
    for(const sign of [-1,1])box(.14,3.35,.4,sign*1.68,1.675,doorZ-.02,mats.trim,walls);
    box(3.5,.14,.4,0,3.35,doorZ,mats.trim,walls);
    box(2.7,.08,.15,0,3.1,doorZ+.2,mats.light,walls);
    doors.push(...[-1,1].map(sign=>{
      const g=new THREE.Group();g.userData.sign=sign;g.position.set(sign*.8,0,doorZ);scene.add(g);
      box(1.58,3,.18,0,1.5,0,mats.door,g);
      box(1.31,.025,.04,0,.8,.11,mats.trim,g);box(1.31,.025,.04,0,2.15,.11,mats.trim,g);
      box(.035,.48,.05,-sign*.65,1.5,.12,mats.light,g);return g;
    }));
  }
}else{
  for(const x of [bounds.min[0],bounds.max[0]])box(.18,env.height,env.length,x,floorCenter[1]+env.height/2,floorCenter[2],mats.wall,walls);
  box(env.width,env.height,.18,floorCenter[0],floorCenter[1]+env.height/2,bounds.max[2],mats.wall,walls);
  box(env.width,.15,env.length,floorCenter[0],bounds.max[1]+.05,floorCenter[2],mats.trim,walls);
  // Simple dutyroom landmarks are static proxies. Only explicitly declared
  // spatial.obstacles participate in collision/occlusion checks.
  box(1.1,.08,.7,floorCenter[0]-1.5,floorCenter[1]+.78,floorCenter[2]+2.6,mats.door);
  for(const x of [-1.95,-1.05])for(const z of [2.35,2.85])box(.06,.74,.06,floorCenter[0]+x,floorCenter[1]+.37,floorCenter[2]+z,mats.trim);
  box(1.2,.04,.3,floorCenter[0],bounds.max[1]-.1,floorCenter[2]-1.7,mats.light,walls);
}
if(data.door?.type==='hinged-door'){
  const door=data.door,[width,height,depth]=door.size;
  const frame=new THREE.Group();frame.position.fromArray(door.hinge);frame.rotation.y=door.closedYaw??0;walls.add(frame);
  for(const x of [-.06,width+.06])box(.1,height+.1,.16,x,height/2,0,mats.trim,frame);
  box(width+.22,.1,.16,width/2,height+.05,0,mats.trim,frame);
  if(env.type==='dutyroom'){
    // Intersect the closed partition line with the rectangular floor, so the
    // wall opening follows the same explicit hinge/yaw as the rendered leaf.
    const axis=[Math.cos(frame.rotation.y),0,-Math.sin(frame.rotation.y)];let lo=-Infinity,hi=Infinity;
    for(const i of [0,2])if(Math.abs(axis[i])>1e-9){const values=[(bounds.min[i]-door.hinge[i])/axis[i],(bounds.max[i]-door.hinge[i])/axis[i]].sort((a,b)=>a-b);lo=Math.max(lo,values[0]);hi=Math.min(hi,values[1])}
    const floorY=bounds.min[1]-door.hinge[1],wallY=floorY+env.height/2;
    if(Number.isFinite(lo)&&lo<0)box(-lo,env.height,.14,lo/2,wallY,0,mats.wall,frame);
    if(Number.isFinite(hi)&&hi>width)box(hi-width,env.height,.14,(hi+width)/2,wallY,0,mats.wall,frame);
    const top=bounds.max[1]-door.hinge[1]-height;
    if(top>0)box(width,top,.14,width/2,height+top/2,0,mats.wall,frame);
  }
  hingedDoor=new THREE.Group();scene.add(hingedDoor);
  box(width,height,depth,width/2,height/2,0,mats.door,hingedDoor);
  box(width*.8,.035,depth+.012,width/2,height*.28,0,mats.trim,hingedDoor);
  box(.035,.22,.05,width*.85,height*.5,depth/2+.025,mats.light,hingedDoor);
}
const gridSize=Math.max(env.width,env.length),grid=new THREE.GridHelper(gridSize,Math.ceil(gridSize),0x7fbbc5,0x7fbbc5);grid.position.set(floorCenter[0],floorCenter[1]+.005,floorCenter[2]);grid.material.transparent=true;grid.material.opacity=.13;scene.add(grid);
scene.add(new THREE.HemisphereLight('#cce5ef','#526274',2.1));
const key=new THREE.DirectionalLight('#e4f3ff',2.5);key.position.set(-2,7,4);scene.add(key);
const fill=new THREE.PointLight('#83ece3',36,19,2);fill.position.set(floorCenter[0],floorCenter[1]+2.9,env.type==='corridor'?-8.1:floorCenter[2]-1.5);scene.add(fill);
const rear=new THREE.PointLight('#e7d0a7',25,12,2);rear.position.set(floorCenter[0]+(env.type==='corridor'?0:1.5),floorCenter[1]+2.9,env.type==='corridor'?-12:floorCenter[2]-3.2);scene.add(rear);

function mannequin(actor){
  const g=new THREE.Group();g.userData.previsActorId=actor.id;scene.add(g);g.scale.setScalar(actor.height/1.8);
  const colored=mat(actor.color),joint=mat('#293745'),visor=mat('#101c26',{roughness:.4});
  box(.4,.5,.25,0,1.22,0,colored,g);box(.35,.18,.23,0,.89,0,joint,g);
  const head=new THREE.Group();head.position.set(0,1.64,0);g.add(head);
  ball(.16,0,0,0,colored,head);box(.25,.08,.06,0,.02,-.14,visor,head);ball(.07,0,1.48,0,joint,g);
  const legs=[],arms={},hands={};
  for(const sign of [-1,1]){
    const hip=new THREE.Group();hip.position.set(sign*.105,.87,0);g.add(hip);
    box(.14,.34,.15,0,-.18,0,colored,hip);
    const knee=new THREE.Group();knee.position.y=-.37;hip.add(knee);ball(.075,0,0,0,joint,knee);
    box(.125,.34,.13,0,-.18,0,colored,knee);box(.16,.1,.29,0,-.39,-.065,joint,knee);
    legs.push({hip,knee,sign});
    const arm=new THREE.Group();arm.position.set(sign*.285,1.41,0);g.add(arm);
    ball(.085,0,0,0,joint,arm);box(.12,.29,.12,0,-.16,0,colored,arm);
    const elbow=new THREE.Group();elbow.position.set(0,-.32,0);arm.add(elbow);elbow.rotation.x=.75;
    box(.11,.28,.11,0,-.15,0,colored,elbow);arm.rotation.x=actor.pose==='aim'?.83:.1;
    const hand=sign<0?'left':'right',contactArm=new THREE.Group();g.add(contactArm);contactArm.visible=false;
    const upper=box(.1,1,.1,0,0,0,colored,contactArm),lower=box(.09,1,.09,0,0,0,colored,contactArm);
    const elbowMarker=ball(.065,0,0,0,joint,contactArm);
    arms[hand]={legacy:arm,contactArm,upper,lower,elbowMarker,shoulder:new THREE.Vector3(sign*.285,1.41,0),sign};
    if(actor.contacts!==undefined||actor.prop?.type==='key')hands[hand]=ball(.065,0,0,0,colored,g);
  }
  if(actor.prop?.type==='block-rifle'){
    box(.18,.13,.6,.06,1.08,-.42,joint,g);box(.05,.05,.38,.06,1.1,-.84,joint,g);
  }
  let keyProp=null;
  if(actor.prop?.type==='key'){
    keyProp=new THREE.Group();g.add(keyProp);const brass=mat('#dfb75e',{metalness:.65,roughness:.4});
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.04,.009,8,20),brass);keyProp.add(ring);
    box(.015,.11,.015,0,-.09,0,brass,keyProp);box(.04,.018,.015,.014,-.14,0,brass,keyProp);
  }
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.36,24),new THREE.MeshBasicMaterial({color:'#0b151e',transparent:true,opacity:.35}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.012;scene.add(shadow);
  return {g,legs,shadow,head,arms,hands,keyProp};
}
const models=new Map(data.actors.map(a=>[a.id,mannequin(a)]));
const selectionBox=new THREE.BoxHelper(undefined,0x71e4d7);selectionBox.visible=false;scene.add(selectionBox);
function notifySelection(){window.dispatchEvent(new CustomEvent('previs-select',{detail:{objectId:selectedObject,point:selectionPoint,time,shotId:activeShot.id,view}}))}
function selectActor(id,point=selectionPoint){
  if(id!==null&&!models.has(id))throw new Error('Unknown scene actor ID.');
  selectedObject=id;selectionPoint={...point};selectionBox.visible=Boolean(id);
  if(id)selectionBox.setFromObject(models.get(id).g);draw();notifySelection();
}
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerDown;
renderer.domElement.addEventListener('pointerdown',event=>{pointerDown=[event.clientX,event.clientY]});
renderer.domElement.addEventListener('pointerup',event=>{
  if(!pointerDown||Math.hypot(event.clientX-pointerDown[0],event.clientY-pointerDown[1])>5)return;
  const rect=renderer.domElement.getBoundingClientRect(),point={x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
  pointer.set(point.x*2-1,1-point.y*2);raycaster.setFromCamera(pointer,view==='camera'?camera:observer);
  const visible=node=>{for(let item=node;item;item=item.parent)if(!item.visible)return false;return true};
  const hit=raycaster.intersectObjects(scene.children,true).find(item=>item.object.isMesh&&visible(item.object));let node=hit?.object;
  while(node&&!node.userData.previsActorId)node=node.parent;
  selectActor(node?.userData.previsActorId||null,point);
});
const helpers=new THREE.Group();scene.add(helpers);helpers.visible=false;
const pathLines=new Map();
for(const actor of data.actors){
  const geometry=new THREE.BufferGeometry().setFromPoints(actor.path.map(p=>new THREE.Vector3(p.position[0],.04,p.position[2])));
  const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:actor.color}));helpers.add(line);pathLines.set(actor.id,line);
}
function updatePathHelpers(){for(const actor of data.actors)pathLines.get(actor.id)?.geometry.setFromPoints(actor.path.map(p=>new THREE.Vector3(p.position[0],.04,p.position[2])))}

function draw(){if(selectedObject)selectionBox.setFromObject(models.get(selectedObject).g);renderer.render(scene,view==='camera'?camera:observer)}
const limbUp=new THREE.Vector3(0,1,0);
function setLimb(mesh,a,b){const delta=b.clone().sub(a),length=delta.length();mesh.visible=length>1e-9;if(!mesh.visible)return;mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.y=length;mesh.quaternion.setFromUnitVectors(limbUp,delta.divideScalar(length))}
function renderAt(t){
  time=clamp(Number(t)||0,0,data.duration);
  activeShot=data.shots.find(s=>time>=s.start&&time<s.end)||data.shots.at(-1);
  const actions=sampleActions(data,time);
  if(hingedDoor){hingedDoor.position.fromArray(actions.door.hinge);hingedDoor.rotation.y=actions.door.yaw}
  for(const [index,door] of doors.entries())door.position.fromArray(actions.door.panelPositions[index]);
  for(const a of data.actors){
    const state=actions.actors[a.id],model=models.get(a.id),phase=state.gaitPhase;
    model.g.position.fromArray(state.modelPosition);model.g.rotation.y=state.yaw;
    model.head.rotation.set(state.gaze.headPitch,state.gaze.headYaw,0,'YXZ');
    for(const leg of model.legs){const swing=Math.sin(phase)*leg.sign;leg.hip.rotation.x=swing*.39*state.walking;leg.knee.rotation.x=Math.max(0,-swing)*.48*state.walking}
    model.g.updateMatrixWorld(true);
    for(const hand of ['left','right']){
      const target=model.g.worldToLocal(new THREE.Vector3().fromArray(state.hands[hand].position)),arm=model.arms[hand],active=Boolean(state.hands[hand].contact)||a.prop?.type==='key'&&a.prop.hand===hand;
      arm.legacy.visible=!active;arm.contactArm.visible=active;
      if(model.hands[hand])model.hands[hand].position.copy(target);
      if(active){
        const elbow=arm.shoulder.clone().lerp(target,.5);elbow.x+=arm.sign*.06;elbow.y+=.04;
        setLimb(arm.upper,arm.shoulder,elbow);setLimb(arm.lower,elbow,target);arm.elbowMarker.position.copy(elbow);
      }
    }
    if(model.keyProp)model.keyProp.position.copy(model.g.worldToLocal(new THREE.Vector3().fromArray(state.prop.position)));
    model.shadow.position.set(state.position[0],bounds.min[1]+.012,state.position[2]);
  }
  const pose=sampleCamera(activeShot,time);camera.position.fromArray(pose.position);camera.fov=pose.fov;camera.lookAt(...pose.target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  draw();
}
function setView(mode){
  if(!['camera','free','top'].includes(mode))throw new Error('Unknown view mode.');
  view=mode;controls.enabled=mode!=='camera';helpers.visible=mode!=='camera';walls.visible=mode!=='top';
  if(mode==='free'){observer.position.copy(camera.position);observer.up.set(0,1,0);controls.target.fromArray(sampleCamera(activeShot,time).target)}
  if(mode==='top'){observer.position.set(floorCenter[0],floorCenter[1]+22,floorCenter[2]);observer.up.set(0,0,-1);controls.target.fromArray(floorCenter)}
  if(mode!=='camera')controls.update();draw();
}
controls.addEventListener('change',draw);
function setCameraOffset(id,offset){
  const shot=data.shots.find(s=>s.id===id);if(!shot)throw new Error('Unknown shot ID.');
  if(savedData.editLocks?.shots?.[id]?.locked)throw new Error(`${id} 已锁定，请先明确解锁。`);
  const old=shot.camera.offset;shot.camera.offset=structuredClone(offset);const issues=validateScene(data);
  if(issues.length){shot.camera.offset=old;throw new Error(issues.join('\n'))}renderAt(time);
}
function setCameraTrack(id,track){
  if(savedData.editLocks?.shots?.[id]?.locked)throw new Error(`${id} 已锁定，请先明确解锁。`);
  const shot=data.shots.find(s=>s.id===id);if(!shot)throw new Error('Unknown shot ID.');
  const before=shot.camera;shot.camera=structuredClone(track);const issues=validateScene(data);
  if(issues.length){shot.camera=before;throw new Error(issues.join('\n'))}renderAt(time);
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function dirtyShots(){return data.shots.filter(shot=>!equal(shot.camera,savedData.shots.find(item=>item.id===shot.id)?.camera)).map(shot=>shot.id)}
function buildSignature(value){
  const shape=structuredClone(value);
  delete shape.editorHistory;delete shape.editLocks;
  for(const actor of shape.actors)for(const point of actor.path)delete point.position;
  for(const shot of shape.shots)delete shot.camera;
  return JSON.stringify(shape);
}
function acceptSaved(result,applied){
  if(buildSignature(data)!==buildSignature(result.scene)){reloadRequired=true;throw new Error('人物、场景或镜头基础设置已在其他页面改变，当前画面需要重新构建。请刷新后继续；本次修改未自动覆盖新结构。')}
  const drafts=new Map(data.shots.filter(shot=>!equal(shot.camera,savedData.shots.find(item=>item.id===shot.id)?.camera)).map(shot=>[shot.id,structuredClone(shot.camera)]));
  if(applied?.kind==='camera'){
    const intended=structuredClone(savedData.shots.find(shot=>shot.id===applied.shotId).camera);intended.offset=applied.offset;
    if(equal(drafts.get(applied.shotId),intended))drafts.delete(applied.shotId);
  }
  if(applied?.kind==='camera-track'&&equal(drafts.get(applied.shotId),applied.camera))drafts.delete(applied.shotId);
  if(applied?.kind==='undo'&&applied.targetKind==='camera'&&equal(drafts.get(applied.targetId),applied.localCameraAtRequest))drafts.delete(applied.targetId);
  savedData=structuredClone(result.scene);data=structuredClone(result.scene);revision=result.revision;
  for(const [id,track] of drafts)data.shots.find(shot=>shot.id===id).camera=track;
  updatePathHelpers();renderAt(time);
}
function persist(change){
  const operation=structuredClone(change);
  if(operation.kind==='undo'&&operation.targetKind==='camera')operation.localCameraAtRequest=structuredClone(data.shots.find(shot=>shot.id===operation.targetId)?.camera);
  const task=saveQueue.then(async()=>{
    if(reloadRequired)throw new Error('请刷新页面，读取当前项目后再保存。');
    const response=await fetch('./__previs/scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision,change:operation})});
    const text=await response.text();let result;try{result=JSON.parse(text)}catch{throw new Error(text||'保存服务不可用，请用项目本地服务打开审片页。')}
    if(!response.ok){
      if(result.code==='REVISION_CONFLICT'&&result.scene){acceptSaved(result,null);throw new Error('其他页面已保存新版本，画面已读取最新数据；你的未保存机位预览仍保留，请核对后再保存。')}
      throw new Error(result.message||'保存失败，本次修改尚未写入项目。');
    }
    acceptSaved(result,operation);return result;
  });
  saveQueue=task.catch(()=>{});return task;
}
window.PREVIS={
  ready:true,get data(){return structuredClone(data)},get savedData(){return structuredClone(savedData)},get revision(){return revision},get dirtyShots(){return dirtyShots()},seek:renderAt,setView,setCameraOffset,setCameraTrack,selectActor,
  previewRig(id,kind,amount){const shot=data.shots.find(s=>s.id===id);if(!shot)throw new Error('Unknown shot ID.');setCameraTrack(id,planCameraRig(shot,kind,amount))},
  async saveCameraOffset(id,offset){setCameraOffset(id,offset);return persist({kind:'camera',shotId:id,offset})},
  async saveCameraTrack(id,track){setCameraTrack(id,track);return persist({kind:'camera-track',shotId:id,camera:track})},
  async setEditLock(targetKind,targetId,locked,reason='用户在审片页确认'){if(locked&&targetKind==='camera'&&dirtyShots().includes(targetId))throw new Error('请先保存或撤销该镜头预览，再锁定已确认机位。');return persist({kind:'set-lock',targetKind,targetId,locked,reason})},
  async undoTarget(targetKind,targetId){return persist({kind:'undo',targetKind,targetId})},
  async resetCameraOffset(id){const offset={position:[0,0,0],target:[0,0,0],fov:0};setCameraOffset(id,offset);return persist({kind:'camera',shotId:id,offset})},
  discardCameraPreview(id){const saved=savedData.shots.find(shot=>shot.id===id),shot=data.shots.find(shot=>shot.id===id);if(!saved||!shot)throw new Error('Unknown shot ID.');shot.camera=structuredClone(saved.camera);renderAt(time)},
  async savePathPoint(actorId,index,position){
    const candidate=structuredClone(savedData),actor=candidate.actors.find(a=>a.id===actorId);if(!actor?.path[index])throw new Error('Unknown path key.');
    actor.path[index].position=structuredClone(position);const issues=validateScene(candidate);
    if(issues.length)throw new Error(issues.join('\n'));
    return persist({kind:'path-point',actorId,index,position});
  },
  captureFrame(){
    if(view!=='camera')throw new Error('请切回正式机位再记录画面批注。');
    if(dirtyShots().length)throw new Error('请先保存或撤销未保存的机位，再记录来源明确的画面批注。');
    renderAt(Math.min(data.duration-1/data.fps,Math.round(time*data.fps)/data.fps));
    notifySelection();
    const visible=selectionBox.visible;selectionBox.visible=false;draw();
    const pngBase64=renderer.domElement.toDataURL('image/png').split(',')[1];selectionBox.visible=visible;draw();
    return {expectedRevision:revision,frame:{pngBase64,width:data.width,height:data.height,time,shotId:activeShot.id,view:'camera',objectId:selectedObject,point:{...selectionPoint}}};
  },
  inspect(){
    const actions=sampleActions(data,time);
    const actors=Object.fromEntries(data.actors.map(a=>{
      const model=models.get(a.id),world=mesh=>mesh.getWorldPosition(new THREE.Vector3()).toArray();
      return [a.id,{...actions.actors[a.id],renderedHands:Object.fromEntries(Object.entries(model.hands).map(([hand,mesh])=>[hand,world(mesh)])),renderedProp:model.keyProp?world(model.keyProp):null}];
    }));
    return {time,shotId:activeShot.id,camera:sampleCamera(activeShot,time),doorOpen:actions.door?.open??null,door:actions.door,actions,clocks:mapSegmentTime(data,time),actors,pathHelpers:Object.fromEntries([...pathLines].map(([id,line])=>[id,Array.from(line.geometry.attributes.position.array)])),selectedObject,selectionPoint,view};
  }
};
window.addEventListener('hf-seek',event=>{selectedObject=null;selectionBox.visible=false;setView('camera');renderAt(event.detail.time)});
renderAt(0);window.__previsResolve();
window.addEventListener('error',event=>{window.__previsReject?.(new Error(event.message))});
