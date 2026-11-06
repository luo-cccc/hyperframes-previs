import {selectFightProject} from '../../starter/scripts/fight-source.mjs';
import {swordAndBody} from './sword-body.mjs';
import {formationRescue} from './formation-rescue.mjs';
import {aerialAvatar} from './aerial-avatar.mjs';
import {illusionAndBreath} from './illusion-breath.mjs';
import {actor,object,battlefield,point as P,clone,clean,cutActor,cutCombat} from './track-utils.mjs';
export const BLUEPRINTS=Object.freeze({'01-sword-and-body':swordAndBody,'02-formation-rescue':formationRescue,'03-aerial-avatar':aerialAvatar,'04-illusion-and-breath':illusionAndBreath});
export function selectBlueprint(source){
 const markers={'xf01_scene_sluice':'01-sword-and-body','xf02_scene_court':'02-formation-rescue','xf03_scene_gorge':'03-aerial-avatar','xf04_scene_library':'04-illusion-and-breath'};
 const matches=source.assets.map(asset=>markers[asset.id]).filter(Boolean);
 if(matches.length>1)throw new Error('BLUEPRINT_SOURCE_MISMATCH: multiple example identity markers; choose an explicit local implementation.');
 const blueprint=matches.length?BLUEPRINTS[matches[0]](source):genericBlueprint(source);
 if(blueprint.expectedShots){
  if(blueprint.expectedShots.length!==source.shots.length||source.shots.some((shot,i)=>shot.start!==blueprint.expectedShots[i][0]||shot.end!==blueprint.expectedShots[i][1]))throw new Error('BLUEPRINT_SOURCE_MISMATCH: original example shot schedule changed. Re-author its numeric proxy; no budget or cue is retimed.');
 }
 return blueprint;
}
function genericBlueprint(source){
 const colors=['#6f9cba','#bb8466','#b8b578','#7ca68e'];
 const originals=source.assets.filter(asset=>['character','creature'].includes(asset.kind));
 const actors=originals.map((asset,i)=>actor(asset.id,colors[i%colors.length],[[0,P(i*1.5-.75,0)],[source.duration_sec,P(i*1.5-.75,0)]],source.duration_sec,{geometry:asset.kind==='creature'?'creature':'humanoid'}));
 const manifestations=source.assets.filter(asset=>asset.kind==='manifestation').map((asset,i)=>object(asset.id,'manifestation',[2,3,2],'#c6ced4',[[0,P(i*3,3,1.5),{visible:false,state:'NOT_IMPLEMENTED'}],[source.duration_sec,P(i*3,3,1.5)]],source.duration_sec));
 return {id:'generic-spatial-layout',duration:source.duration_sec,environment:battlefield([[-12,-1,-12],[12,15,12]]),actors,combat:{schema_version:'PREVIS_COMBAT_V1',objects:manifestations,contacts:[],events:[]},cameras:[[[0,3,8],[0,1,0],55]],implemented:['SOURCE_SEGMENT_SHOT_CUE_AND_KEYFRAME_MAPPING'],notImplemented:['SOURCE_COMBAT_ACTIONS_REQUIRE_LOCAL_IMPLEMENTATION','SOURCE_POSITION_AND_CAMERA_VALUES_UNSPECIFIED','CONTACTS_RESOURCES_DAMAGE_EFFECTS_AND_KNOWLEDGE_NOT_IMPLEMENTED','ANATOMICAL_OR_FINAL_MEDIA_ACCEPTANCE','AUDIO_AND_LIP_SYNC']};
}
export function segmentWindows(source){
 const shots=new Map(source.shots.map(shot=>[shot.id,shot]));
 return source.segments.map(segment=>{const selected=segment.shot_ids.map(id=>{if(!shots.has(id))throw new Error('Unknown shot '+id);return shots.get(id)});return {id:segment.id,segment,shots:selected,start:selected[0].start,end:selected.at(-1).end,duration:clean(selected.at(-1).end-selected[0].start)}});
}
export function projectScene(source,blueprint,unit,{fps,sourceSha,width,height}){
 const selected=selectFightProject(source,unit.id),allowedAssets=new Set(selected.assets.map(asset=>asset.id)),allowedActors=new Set(selected.assets.filter(asset=>['character','creature','manifestation'].includes(asset.kind)).map(asset=>asset.id)),sourceAssets=new Set(source.assets.map(asset=>asset.id)),actors=blueprint.actors.filter(actor=>allowedActors.has(actor.id));
 const combat=cutCombat(blueprint.combat,unit.start,unit.end,fps);combat.objects=combat.objects.filter(item=>(!sourceAssets.has(item.id)||allowedAssets.has(item.id))&&item.keys.every(key=>key.owner_id===null||allowedActors.has(key.owner_id)));const objectIds=new Set(combat.objects.map(item=>item.id));combat.contacts=combat.contacts.filter(c=>objectIds.has(c.target_id)&&(c.actor_id?allowedActors.has(c.actor_id):objectIds.has(c.object_id)));combat.events=combat.events.filter(e=>allowedActors.has(e.target_id)||objectIds.has(e.target_id));
 const scene={schemaVersion:1,id:('fight-'+unit.id).toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,''),title:source.title+' / '+unit.id,duration:unit.duration,width,height,fps,environment:clone(blueprint.environment),door:null,actors:actors.map(actor=>({...cutActor(actor,unit.start,unit.end,fps),role:source.assets.find(asset=>asset.id===actor.id)?.name??actor.id})),shots:unit.shots.map(shot=>{
  const camera=blueprint.cameras[source.shots.indexOf(shot)]??blueprint.cameras[0];
  const pose=(position,target)=>({position:clone(position),target:clone(target),fov:camera[2]??52});
  return {id:shot.id,start:clean(shot.start-unit.start),end:clean(shot.end-unit.start),label:shot.id,framing:{requiredActors:[]},camera:{keys:[{t:clean(shot.start-unit.start),...pose(camera[0],camera[1])},{t:clean(shot.end-unit.start),...pose(camera[3]??camera[0],camera[4]??camera[1])}],interpolation:'linear',offset:{position:[0,0,0],target:[0,0,0],fov:0}},source_shot_id:shot.id};
 }),combat,fightClock:{battle_start_s:unit.start,battle_end_s:unit.end,unit_id:unit.id},timeMapping:{schema_version:'PREVIS_TIME_MAPPING_V1',segments:[{input_id:'fight-battle-source',unit_id:unit.id,source_version:'sha256:'+sourceSha,source_duration_s:source.duration_sec,source_start_s:unit.start,source_end_s:unit.end,segment_start_s:0,segment_end_s:unit.duration,edit_start_s:unit.start,edit_end_s:unit.end,playback_rate:1}]},assetBindings:actors.map(actor=>({actorId:actor.id,assetId:actor.id,representation:'proxy',dimensions_basis:'LOCAL_EXECUTION_ASSUMPTION'})),sourceAssetIds:{scenes:selected.assets.filter(asset=>asset.kind==='scene').map(asset=>asset.id),props:selected.assets.filter(asset=>['prop','formation','manifestation'].includes(asset.kind)).map(asset=>asset.id)},adaptationMap:unit.shots.map(shot=>({source_shot_id:shot.id,scene_shot_id:shot.id,source_ref:'../sources/project.json#/shots/'+source.shots.indexOf(shot),status:'MAPPED'}))};
 return scene;
}
