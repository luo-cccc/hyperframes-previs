import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {sourceFingerprint} from '../../../assets/starter/scripts/source-fingerprint.mjs';
import {renderSceneText} from '../../../assets/starter/src/render-identity.js';
import {checkUpstream,currentStateScope} from '../../../assets/starter/scripts/check-upstream.mjs';
import {collectTransitionContext} from '../../../assets/starter/scripts/transition-context.mjs';
import {digest,jsonText,runMedia,hashFile,readJson} from '../../../assets/starter/scripts/boundary-utils.mjs';

export const repo=fileURLToPath(new URL('../../../',import.meta.url));
export const runRoot=path.join(repo,'outputs',`boundary-tests-${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}-${randomUUID().slice(0,8)}`);
let sequence=0,base;
export async function save(file,value){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:jsonText(value))}
export async function init(){
  await mkdir(runRoot,{recursive:true});base=path.join(runRoot,'synthetic-base');await mkdir(base);
  const scene=JSON.parse(await readFile(path.join(repo,'assets/starter/scene.json'),'utf8'));
  Object.assign(scene,{id:'synthetic-boundary-fixture',title:'SYNTHETIC FFMPEG TEST FIXTURE - NOT UPSTREAM AUTHORITY',duration:1.2,width:160,height:96,fps:20,actors:[],door:null});
  scene.shots=scene.shots.slice(0,2).map((shot,index)=>({...shot,start:index*.6,end:(index+1)*.6}));
  delete scene.upstream;delete scene.timeMapping;delete scene.assetBindings;delete scene.transitionMap;
  await save(path.join(base,'scene.json'),scene);await save(path.join(base,'index.html'),'SYNTHETIC TEST FIXTURE ONLY\n');await save(path.join(base,'package.json'),{type:'module',private:true});
  await mkdir(path.join(base,'src'));for(const name of ['action-data.js','time-mapping.js','combat-data.js','limb-ik.js'])await cp(path.join(repo,'assets/starter/src',name),path.join(base,'src',name));
  await mkdir(path.join(base,'renders'));await makeVideo(base);await seal(base);
}
export async function fixture(name){const root=path.join(runRoot,`${String(++sequence).padStart(3,'0')}-${name}`);await cp(base,root,{recursive:true});return root}
export async function makeVideo(root,{fps,duration}={}){
  const scene=await readJson(path.join(root,'scene.json'));
  await runMedia('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i',`testsrc2=size=${scene.width}x${scene.height}:rate=${fps??scene.fps}:duration=${duration??scene.duration}`,'-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-y',path.join(root,'renders/previs.mp4')]);
}
export async function seal(root){
  const scene=await readJson(path.join(root,'scene.json')),upstream=await checkUpstream(root,scene);
  const receipt={type:'PREVIS_RENDER',render_identity:'PREVIS_RENDER_CONTENT_V2',render_status:'COMPLETED',source_time_basis:'SEGMENT',sourceContext:{mode:'SYNTHETIC_FFMPEG_FIXTURE',upstream_authority:false,notice:'Generated test pattern and synthetic source records; not a HyperFrames or real upstream acceptance claim.'},scene_sha256:digest(renderSceneText(scene)),scene_file_sha256:await hashFile(path.join(root,'scene.json')),render_inputs_sha256:(await sourceFingerprint(root)).sha256,intake_sha256:upstream?.intakeSha256||null,formal_id:upstream?.packet.formal_id||null,base_prompt_version:upstream?.packet.prompt_version||null,budget_version:upstream?.packet.budget_version||null,video:'previs.mp4',video_sha256:await hashFile(path.join(root,'renders/previs.mp4'))};
  await save(path.join(root,'renders/render-receipt.json'),receipt);return receipt;
}
export async function bindSynthetic(root,formalId='FORMAL_A',{stateJson=false}={}){
  const scene=await readJson(path.join(root,'scene.json'));
  const lineage={project_id:'SYNTHETIC_PROJECT_ONLY',formal_id:formalId,prompt_version:'P1',budget_version:'B1'};
  const settings=Object.fromEntries(Object.entries({video_aspect_ratio:'5:3',visual_style:'SYNTHETIC_TEST_ONLY',segment_max_s:2}).map(([key,selected])=>[key,{selected,status:'CONFIRMED',decision_ref:'SYNTHETIC_DECISION'}]));
  const state={project_id:lineage.project_id,state_version:'SYNTHETIC_1',workflow_schema:'TEST_ONLY',source_script_ref:{version:'SOURCE_TEST_1'},production_settings:settings,coverage_ledger:[{formal_id:formalId,status:'DONE',prompt_version:'P1',budget_version:'B1',source_script_version:'SOURCE_TEST_1',delivery_ref:'SYNTHETIC_DELIVERY',start_state:'closed',end_state:'half-open',checks:{TEXT:{status:'PASS',scope:'SYNTHETIC TEXT CHECK ONLY',evidence:'SYNTHETIC_TEST_EVIDENCE'}}}],prompt_versions:[{formal_id:formalId,prompt_version:'P1',budget_version:'B1',budget_status:'CHECKED',status:'DONE',delivery_ref:'SYNTHETIC_DELIVERY'}],step_ledger:[{step_id:formalId,status:'DONE',prompt_version:'P1'}],transition_plan:[{id:'T_A',formal_id:formalId,prompt_version:'P1',motion:'left hand keeps contact',status:'PLANNED'},{id:'T_B',formal_id:formalId,prompt_version:'P1',motion:'unchanged other transition',status:'PLANNED'}]};
  const budget={...lineage,time_basis:'SEGMENT',duration_s:scene.duration,target_max_s:2,shots:scene.shots.map(shot=>({id:shot.id,start_s:shot.start,end_s:shot.end}))};
  const master='场《合成测试》\n仅测试来源接口，无真实上游授权或语义验收。';
  const files={state:['state.json',jsonText(state)],budget:['budget.json',jsonText(budget)],master:['master.md',master],source_script:['source.md','SYNTHETIC SOURCE ONLY'],text_evidence:['text.txt','SYNTHETIC EVIDENCE ONLY']};
  const sources=[];for(const [role,[name,text]] of Object.entries(files)){await save(path.join(root,'synthetic-upstream',name),text);sources.push({role,path:'synthetic-upstream/'+name,sha256:digest(text)})}
  const packet={schema_version:'STORYBOARD_PREVIS_ADAPTER_V1',upstream_writes:false,input_mode:stateJson?'STATE_JSON':'MANUAL_TRANSCRIPTION',...lineage,master:{text:master,text_sha256:digest(master)},budget,production_settings:settings,sources,asset_catalog:{characters:[]},upstream_snapshot:{character_profiles:[]}};
  if(stateJson){packet.validation_profile='SCOPED_STATE_V3';packet.state_scope=currentStateScope(state,formalId,'SCOPED_STATE_V3');packet.transition_context=collectTransitionContext(state,formalId,'P1')}
  await save(path.join(root,'upstream-intake.json'),packet);
  scene.upstream={...lineage,intake:'upstream-intake.json',intake_sha256:await hashFile(path.join(root,'upstream-intake.json'))};scene.assetBindings=[];scene.sourceAssetIds={characters:[],scenes:[],props:[]};scene.adaptationMap=scene.shots.map(shot=>({source_shot_id:shot.id,scene_shot_id:shot.id,source_ref:'SYNTHETIC_MASTER',status:'MAPPED'}));
  await save(path.join(root,'scene.json'),scene);await seal(root);return {scene,packet,state};
}
export function planFor({fromProject='.',toProject='.',fromShot='S01',toShot='S02',fromTime=.55,toTime=.6,before=.2,after=.2,transitionId}={}){
  return {schema_version:'PREVIS_BOUNDARY_PLAN_V1',connections:[{id:'selected-connection',kind:fromProject===toProject?'EXPLICIT_SOURCE_POINTS':'CROSS_PROJECT',...(transitionId?{transition_id:transitionId}:{}),from:{project:fromProject,shot_id:fromShot,time_s:fromTime},to:{project:toProject,shot_id:toShot,time_s:toTime},window_before_s:before,window_after_s:after}]};
}