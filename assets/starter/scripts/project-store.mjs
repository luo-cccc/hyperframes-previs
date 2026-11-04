import {readFile,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateScene} from '../src/scene-data.js';
import {checkUpstream,sha256} from './check-upstream.mjs';

const HISTORY_LIMIT=100;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>structuredClone(value);
const present=(object,key)=>Object.hasOwn(object,key);

export function projectError(status,code,message,details={}){
  return Object.assign(new Error(message),{status,code,...details});
}
export async function readProject(root){
  const bytes=await readFile(path.join(root,'scene.json'));
  return {scene:JSON.parse(bytes.toString('utf8')),revision:sha256(bytes)};
}
function target(scene,kind,id){
  if(!['camera','actor'].includes(kind)||typeof id!=='string'||!id)throw projectError(400,'INVALID_TARGET','Select an existing camera or actor target.');
  const value=kind==='camera'?scene.shots.find(item=>item.id===id):scene.actors.find(item=>item.id===id);
  if(!value)throw projectError(400,kind==='camera'?'UNKNOWN_SHOT':'UNKNOWN_ACTOR','The selected target no longer exists. Refresh the page.');
  return value;
}
function lockState(scene,kind,id){
  if(scene.editLocks===undefined)return null;
  if(!object(scene.editLocks))throw projectError(400,'INVALID_EDIT_LOCKS','editLocks must be an object.');
  const key=kind==='camera'?'shots':'actors',group=scene.editLocks[key];
  if(group===undefined)return null;
  if(!object(group))throw projectError(400,'INVALID_EDIT_LOCKS',`editLocks.${key} must be an object keyed by stable IDs.`);
  if(!present(group,id))return null;
  const lock=group[id];
  if(!object(lock)||typeof lock.locked!=='boolean'||(lock.reason!==undefined&&typeof lock.reason!=='string'))throw projectError(400,'INVALID_EDIT_LOCKS',`Invalid lock record for ${id}.`);
  return lock;
}
function requireUnlocked(scene,kind,id){
  const lock=lockState(scene,kind,id);
  if(lock?.locked)throw projectError(423,'TARGET_LOCKED',`${id} is locked${lock.reason?`: ${lock.reason}`:'.'} Explicitly unlock this target before editing or undoing it.`,{targetKind:kind,targetId:id});
}
function history(scene){
  if(scene.editorHistory===undefined)scene.editorHistory={schemaVersion:1,entries:[]};
  const value=scene.editorHistory;
  if(!object(value)||value.schemaVersion!==1||!Array.isArray(value.entries)||value.entries.length>HISTORY_LIMIT)throw projectError(400,'INVALID_EDITOR_HISTORY','editorHistory must contain schemaVersion=1 and at most 100 entries. Preserve/recover malformed history before editing.');
  const ids=new Set();
  for(const entry of value.entries){
    if(!object(entry)||typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||!['camera','camera-track','path-point'].includes(entry.change_kind)||!['camera','actor'].includes(entry.target_kind)||typeof entry.target_id!=='string'||typeof entry.undone!=='boolean'||typeof entry.time!=='string'||!object(entry.before)||!object(entry.after))throw projectError(400,'INVALID_EDITOR_HISTORY','A stored editor history entry is malformed; no change was saved.');
    if((entry.change_kind!=='path-point')!==(entry.target_kind==='camera'))throw projectError(400,'INVALID_EDITOR_HISTORY','Stored editor history target kind does not match its change kind.');
    if(entry.change_kind==='path-point'){
      const key=value=>Number.isInteger(value.index)&&value.index>=0&&typeof value.t==='number'&&Number.isFinite(value.t)&&Array.isArray(value.position)&&value.position.length===3&&value.position.every(n=>typeof n==='number'&&Number.isFinite(n));
      if(!key(entry.before)||!key(entry.after)||entry.before.index!==entry.after.index||entry.before.t!==entry.after.t)throw projectError(400,'INVALID_EDITOR_HISTORY','Path edit history must retain the same key index/time and finite positions; no undo was applied.');
    }
    ids.add(entry.id);
  }
  return value.entries;
}
function record(scene,{kind,targetKind,targetId,before,after}){
  if(equal(before,after))return null;
  const entries=history(scene);
  const entry={id:randomUUID(),change_kind:kind,target_kind:targetKind,target_id:targetId,before:clone(before),after:clone(after),undone:false,time:new Date().toISOString()};
  entries.push(entry);
  scene.editorHistory.entries=entries.slice(-HISTORY_LIMIT);
  return entry.id;
}
function pathValue(actor,index){
  if(!Number.isInteger(index)||!actor.path[index])throw projectError(400,'UNKNOWN_PATH_KEY','The selected path key no longer exists. Refresh the page.');
  const key=actor.path[index];return {index,t:key.t,position:clone(key.position)};
}
function applyChange(scene,change){
  if(!object(change))throw projectError(400,'INVALID_CHANGE','A scoped camera, path-point, lock or undo change is required.');
  if(change.kind==='camera'){
    const shot=target(scene,'camera',change.shotId);requireUnlocked(scene,'camera',change.shotId);
    const before=clone(shot.camera);shot.camera.offset=clone(change.offset);
    return {entryId:record(scene,{kind:'camera',targetKind:'camera',targetId:change.shotId,before,after:shot.camera})};
  }
  if(change.kind==='camera-track'){
    const shot=target(scene,'camera',change.shotId);requireUnlocked(scene,'camera',change.shotId);
    const before=clone(shot.camera);shot.camera=clone(change.camera);
    return {entryId:record(scene,{kind:'camera-track',targetKind:'camera',targetId:change.shotId,before,after:shot.camera})};
  }
  if(change.kind==='path-point'){
    const actor=target(scene,'actor',change.actorId);requireUnlocked(scene,'actor',change.actorId);
    const before=pathValue(actor,change.index);actor.path[change.index].position=clone(change.position);
    return {entryId:record(scene,{kind:'path-point',targetKind:'actor',targetId:change.actorId,before,after:pathValue(actor,change.index)})};
  }
  if(change.kind==='set-lock'){
    target(scene,change.targetKind,change.targetId);
    if(typeof change.locked!=='boolean'||typeof change.reason!=='string'||change.reason.length>500)throw projectError(400,'INVALID_LOCK','A lock change requires locked=true/false and a reason string of at most 500 characters.');
    // Inspect the current group before replacing it. Only this explicit command unlocks.
    lockState(scene,change.targetKind,change.targetId);
    const group=change.targetKind==='camera'?'shots':'actors';
    scene.editLocks={...(scene.editLocks||{}),[group]:{...(scene.editLocks?.[group]||{}),[change.targetId]:{locked:change.locked,reason:change.reason}}};
    return {lockChanged:{targetKind:change.targetKind,targetId:change.targetId,locked:change.locked}};
  }
  if(change.kind==='undo'){
    const value=target(scene,change.targetKind,change.targetId);requireUnlocked(scene,change.targetKind,change.targetId);
    const entry=[...history(scene)].reverse().find(item=>!item.undone&&item.target_kind===change.targetKind&&item.target_id===change.targetId);
    if(!entry)throw projectError(409,'UNDO_EMPTY','There is no retained edit to undo for this target. Other targets are unchanged.');
    if(entry.target_kind==='camera'){
      if(!equal(value.camera,entry.after))throw projectError(409,'UNDO_CONFLICT','This camera changed outside its retained edit history. No prior value was applied; review the current project.');
      value.camera=clone(entry.before);
    }else{
      const now=pathValue(value,entry.after.index);
      if(!equal(now,entry.after))throw projectError(409,'UNDO_CONFLICT','This path key changed outside its retained edit history. No prior value was applied; review the current project.');
      value.path[entry.before.index].position=clone(entry.before.position);
    }
    entry.undone=true;entry.undoneAt=new Date().toISOString();
    return {undoneEntryId:entry.id};
  }
  throw projectError(400,'INVALID_CHANGE','Only camera, camera-track, path-point, set-lock and target-scoped undo changes can be saved from Studio.');
}

export async function saveProjectChange(root,request){
  if(typeof request?.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(request.expectedRevision))throw projectError(400,'REVISION_REQUIRED','The page is from an older version. Refresh before saving.');
  const lockPath=path.join(root,'.previs-save.lock');let lock;
  try{lock=await open(lockPath,'wx')}
  catch(error){if(error.code==='EEXIST')throw projectError(409,'PROJECT_BUSY','Another save is running. Your change was not saved; retry after it finishes.');throw error}
  const temporary=path.join(root,`.scene-${process.pid}-${randomUUID()}.tmp`);
  let result,error;
  const warnings=[];
  try{
    const current=await readProject(root);
    if(current.revision!==request.expectedRevision)throw projectError(409,'REVISION_CONFLICT','Another page has saved this project. Review the refreshed data before saving again.',current);
    const candidate=clone(current.scene),changeResult=applyChange(candidate,request.change);
    const issues=validateScene(candidate);
    if(issues.length)throw projectError(400,'INVALID_SCENE',issues.join('\n'));
    await checkUpstream(root,candidate);
    const bytes=Buffer.from(JSON.stringify(candidate,null,2)+'\n','utf8');
    const handle=await open(temporary,'wx');
    try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
    const latest=await readProject(root);
    if(latest.revision!==current.revision)throw projectError(409,'REVISION_CONFLICT','The scene changed while saving. Review the refreshed data first.',latest);
    await rename(temporary,path.join(root,'scene.json'));
    result={saved:true,revision:sha256(bytes),scene:candidate,warnings,...changeResult};
  }catch(caught){error=caught}
  finally{
    try{await unlink(temporary)}catch(cleanup){if(cleanup.code!=='ENOENT')warnings.push(`Temporary file cleanup: ${cleanup.message}`)}
    try{await lock.close();await unlink(lockPath)}catch(cleanup){warnings.push(`Save lock cleanup: ${cleanup.message}`)}
  }
  if(error)throw error;
  return result;
}
