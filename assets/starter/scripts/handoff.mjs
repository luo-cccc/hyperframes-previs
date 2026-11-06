import {mkdir,readFile,stat,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScene} from '../src/scene-data.js';
import {checkUpstream,sha256} from './check-upstream.mjs';
import {sourceFingerprint} from './source-fingerprint.mjs';
import {sourceContext} from './source-context.mjs';
import {renderSceneText} from '../src/render-identity.js';
import {writeAtomic} from './atomic-file.mjs';
import {ADAPTER_VERSION} from './adapter-version.mjs';
import {sourceLineage,isFightPacket,fightReceiptMap} from './source-lineage.mjs';
import {validateStateCaptureReport} from './keyframe-capture.mjs';
import {optionalJson,checkResult,scopedReview,boundaryEvidence,evaluateDeliveryGoal,revisionRequests} from './review-receipt.mjs';

export async function createHandoff(root,{publish=true}={}){
  root=path.resolve(root);
  const destination=path.join(root,'handoff');
  const sceneBytes=await readFile(path.join(root,'scene.json')),scene=JSON.parse(sceneBytes.toString('utf8'));
  const problems=validateScene(scene);if(problems.length)throw new Error(problems.join('\n'));
  const upstream=await checkUpstream(root,scene),context=await sourceContext(root,upstream),fight=isFightPacket(upstream?.packet),sourceInfo=sourceLineage(upstream,scene);
  let videoExists=false;
  try{videoExists=(await stat(path.join(root,'renders/previs.mp4'))).isFile()}catch(error){if(error.code!=='ENOENT')throw error}
  const [receipt,review,spatialReport,boundaryReport,goalInput]=await Promise.all([
    'renders/render-receipt.json','adapter-review.json','review/spatial-report.json','review/boundary-report.json','delivery-goal.json'
  ].map(file=>optionalJson(path.join(root,file))));
  const sceneHash=sha256(renderSceneText(scene)),fingerprint=await sourceFingerprint(root);
  const videoHash=videoExists?sha256(await readFile(path.join(root,'renders/previs.mp4'))):null;
  const identity={scene_sha256:sceneHash,intake_sha256:upstream?.intakeSha256||null,render_inputs_sha256:fingerprint.sha256,video_sha256:videoHash};
  const fresh=Boolean(videoExists&&receipt?.render_status==='COMPLETED'&&receipt.render_identity==='PREVIS_RENDER_CONTENT_V2'&&Object.entries(identity).every(([key,value])=>receipt[key]===value));
  const videoStatus=fresh?'verified-render-current-inputs':videoExists?'unverified-or-stale':'not-rendered';
  const spatialCurrent=Boolean(spatialReport?.render_identity==='PREVIS_RENDER_CONTENT_V2'&&['scene_sha256','render_inputs_sha256','intake_sha256'].every(key=>spatialReport[key]===identity[key]));
  const spatial={status:spatialCurrent?spatialReport.status:'NOT_RUN_OR_STALE',scope:'SAMPLED_PROXY_GEOMETRY',report:spatialCurrent?'../review/spatial-report.json':null,...(spatialCurrent?{counts:spatialReport.counts,sampling:spatialReport.sampling}:{})};
  const transitions=upstream?.transitions||{status:'NOT_DECLARED',reasons:[]};
  const transitionsCurrent=transitions.status!=='STALE';
  const boundary=await boundaryEvidence(root,boundaryReport,identity,{transitionsCurrent});
  const reviewed=await scopedReview(root,review,identity,{fresh,transitionsCurrent:boundary.status==='CURRENT',boundaryCurrent:boundary.status==='CURRENT',boundaryIdentity:boundaryReport?.identity||null,goal:goalInput||scene.deliveryGoal||null});
  const fileEvidence=async file=>({path:file,sha256:sha256(await readFile(path.join(root,file))),kind:'FILE'});
  const fightImplementation=fight?await optionalJson(path.join(root,'fight-implementation.json')):null;
  const fightReport=await optionalJson(path.join(root,'review/fight-report.json'));
  const fightCurrent=Boolean(scene.combat&&fightReport?.schema_version==='PREVIS_FIGHT_REPORT_V1'&&['scene_sha256','intake_sha256','render_inputs_sha256'].every(key=>fightReport[key]===identity[key]));
  const stateReport=await optionalJson(path.join(root,'review/state-capture-report.json'));
  let states={status:'NOT_RUN',reason:'No independently rendered source-keyframe states.'};
  if(stateReport)try{states=await validateStateCaptureReport(root,stateReport)}catch(error){states={status:'STALE',reason:error.message}}

  const checks={
    source_structure:checkResult('PASS',upstream?'Selected provider source, original unit lineage, scene timing and actor/asset structure; no narrative acceptance.':'Explicit standalone demonstration scene structure; no upstream production authority.',[await fileEvidence('scene.json'),...(upstream?[await fileEvidence(path.relative(root,upstream.file))]:[])]),
    text_alignment:checkResult('NOT_RUN','Narrative, exact dialogue and intended photography need actual scoped review.'),
    render_specs:fresh?checkResult(receipt.media_metrics_status==='CHECKED'?'PASS':'NOT_RUN','Successful current MP4 dimensions, fps, duration and frame count; exact media metrics require ffprobe.',[await fileEvidence('renders/render-receipt.json')]):checkResult(videoExists?'STALE':'NOT_RUN','No current successful video is linked to these saved inputs.'),
    spatial_proxy:checkResult(spatialCurrent?(spatialReport.status==='NO_ISSUES_OBSERVED'?'PASS':'CHECKED'):'NOT_RUN','Sampled proxy geometry only; no skeletal/pixel visibility or complete narrative acceptance.',spatialCurrent?[await fileEvidence('review/spatial-report.json')]:[],spatialCurrent?{warnings:spatialReport.counts?.issueGroups||0}:{}),
    boundary_source:checkResult(boundary.status==='CURRENT'?'PASS':transitionsCurrent?(transitions.status==='CURRENT'?'PASS':'NOT_RUN'):'STALE',boundary.status==='CURRENT'?'All selected endpoint and transition dependencies were independently revalidated; unrelated connections do not affect this package.':transitionsCurrent?'Selected transition source freshness; no media acceptance.':'Transition context changed and no current selected endpoint package supersedes it.',[],{...(boundary.status!=='CURRENT'&&transitions.reasons?.length?{reason:transitions.reasons.join('; ')}:{})}),
    boundary_extraction:boundary.checks.boundary_extraction||checkResult(boundary.status==='STALE'?'STALE':'NOT_RUN',boundary.reason||'No current actual boundary extraction. A conditional plan is not extracted media.'),
    boundary_frame:checkResult('NOT_RUN','Selected retained in/out images need actual visual review.'),
    boundary_motion:checkResult('NOT_RUN','Neighboring action phase, trajectory and speed need actual motion review.'),
    audio:checkResult('NOT_RUN','No listening or audio continuity acceptance was performed by this exporter.'),
    capability:checkResult('UNKNOWN','The target platform/mode capabilities require their own dated evidence.'),
    inputs:checkResult('NOT_RUN','Actual platform inputs and their binding roles require scoped verification.'),
    platform_submission:checkResult('NOT_RUN','No actual provider submission was performed by the local previs tool.'),
    final_model:checkResult('NOT_RUN','Local proxy rendering does not establish final-model media quality.'),
    fight_proxy:checkResult(fightImplementation?.status==='PARTIAL_LAYOUT_ONLY'?'NOT_IMPLEMENTED':fightCurrent?(fightReport.status==='NO_ISSUES_OBSERVED'?'PASS':'FAIL'):'NOT_RUN','Declared combat object identity, ownership and contact-gap samples; not attack causality, anatomical reach or final video acceptance.',fightCurrent?[await fileEvidence('review/fight-report.json')]:[],fightCurrent?{warnings:fightReport.counts.issueGroups}:{}),
    state_keyframes:checkResult(states.status==='CURRENT'&&(!fight||states.source_coverage?.status==='COMPLETE')?'PASS':states.status==='STALE'?'STALE':'NOT_RUN','Explicit source keyframe states rendered with the original selected camera, including closed-interval endpoints; no encoded-MP4-frame claim.',states.status==='CURRENT'?[await fileEvidence('review/state-capture-report.json')]:[],states.reason?{reason:states.reason}:{}),
    attack_response:checkResult('NOT_RUN','Authored attack, response and result need actual scoped narrative/motion observation.'),
    contact_phase:checkResult('NOT_RUN','Preparation, impact and result timing and body support need actual visual/motion review; proxy coincidence is not force verification.'),
    prop_ownership:checkResult('NOT_RUN','Visible unique prop identity, ownership, hand changes and recovery need observed media evidence.'),
    persistent_effect:checkResult('NOT_RUN','Persistent spells, trajectories, nodes and light must be reviewed within their actual implementation scope.'),
    attrition_cost:checkResult('NOT_RUN','Authored irreversible costs, injuries and accumulating terrain constraints need semantic and visual review.'),
    knowledge_reveal:checkResult('NOT_RUN','Actual truth, character belief and spectator reveal order need source-scoped review.'),
    ...reviewed.checks
  };
  const goal=evaluateDeliveryGoal(goalInput||scene.deliveryGoal||(fight?{id:'fight-previs-'+sourceInfo.unit_id,target:'FIGHT_PREVIS'}:undefined),checks);
  const lineage={...sourceInfo,project_id:upstream?.packet.project_id||scene.id,formal_id:upstream?.packet.formal_id||null,prompt_version:upstream?.packet.prompt_version||null,budget_version:upstream?.packet.budget_version||null,...identity};
  const revisions=revisionRequests(reviewed.findings,goal,lineage);
  const legacyEvidence=typeof review?.evidence==='string'?review.evidence.trim():Array.isArray(review?.evidence)&&review.evidence.some(value=>typeof value==='string'&&value.trim());
  const legacyCurrent=Boolean(fresh&&review?.schema_version==='PREVIS_REVIEW_V1'&&['CHECKED','PASS','FAIL'].includes(review.status)&&legacyEvidence&&Object.entries(identity).every(([key,value])=>review[key]===value));
  const manifest={
    schemaVersion:1,adapter_version:ADAPTER_VERSION,render_identity:'PREVIS_RENDER_CONTENT_V2',...identity,delivery_goal_configuration_sha256:sha256(JSON.stringify(goalInput||scene.deliveryGoal||null)),title:scene.title,referenceVideo:fresh?'../renders/previs.mp4':null,videoStatus,
    spec:{duration:scene.duration,width:scene.width,height:scene.height,fps:scene.fps},coordinates:'metres, Y up, -Z forward',timeBasis:'SEGMENT',
    actors:scene.actors.map(actor=>({id:actor.id,role:actor.role,previsColor:actor.color,...(scene.assetBindings?.find(binding=>binding.actorId===actor.id)||{appearanceReference:null,referenceStatus:'unbound'})})),
    sceneReference:null,shots:scene.shots,upstream:scene.upstream||null,sourceContext:context,spatial,
    sourceReferenceBase:upstream?path.relative(destination,upstream.file).replaceAll(path.sep,'/'):null,
    source_lineage:sourceInfo,fightClock:scene.fightClock||null,adaptationMap:scene.adaptationMap||null,upstream_provenance:upstream?.packet.upstream_provenance||null,
    transitions,boundary:{status:boundary.status,reason:boundary.reason,report:boundary.report?'../review/boundary-report.json':null,viewer:boundary.report?'../'+boundary.report.package_directory+'/index.html':null},
    timeMapping:scene.timeMapping||null,checks,delivery_goal:goal,revision_requests:'revision-requests.json',
    scope:'Camera, proxy action, relative space, timing and selected boundary reference. Appearance, sound and platform control retain their separate checks.'
  };
  const result={
    ...(fresh?receipt:{render_status:videoStatus}),scope:'PREVIS_CAMERA_BLOCKING',adapter_version:ADAPTER_VERSION,
    formal_id:lineage.formal_id,base_prompt_version:lineage.prompt_version,budget_version:lineage.budget_version,
    source_time_basis:'SEGMENT',source_lineage:sourceInfo,unit:upstream?.packet.unit||null,sources:upstream?.packet.sources||[],sourceContext:context,structural_checks:'PASS',...identity,
    semantic_review:legacyCurrent?review:reviewed.checks.text_alignment||'NOT_RUN',review_reuse_status:legacyCurrent?'CURRENT':reviewed.status,
    scoped_review:reviewed,checks,delivery_goal:goal,transitions,boundary:manifest.boundary,fight_proxy:{status:fightCurrent?fightReport.status:'NOT_RUN_OR_STALE',report:fightCurrent?'../review/fight-report.json':null},state_captures:{status:states.status,report:states.status==='CURRENT'?'../review/state-capture-report.json':null},timeMapping:scene.timeMapping||null,
    unimplemented:fightImplementation?[...(fightImplementation.not_implemented||[]),{capability:'Source implementation assumptions and visual acceptance remain separately reviewed.',status:'NOT_RUN'}]:reviewed.status==='CURRENT'&&Array.isArray(review?.unimplemented)?review.unimplemented:legacyCurrent?review.unimplemented||[]:['Detailed action, original speech/audio and final-model performance retain their actual separate check status.'],
    upstream_revision_required:revisions.requests.some(item=>item.route==='UPSTREAM_REVISION')?true:legacyCurrent&&typeof review.upstream_revision_required==='boolean'?review.upstream_revision_required:null,
    revision_requests:revisions,spatial,final_model_media_review:checks.final_model.status,upstream_writes:false
  };
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const csv='\uFEFF'+[['id','start_s','end_s','duration_s','beat'],...scene.shots.map(shot=>[shot.id,shot.start,shot.end,shot.end-shot.start,shot.beat])].map(row=>row.map(quote).join(',')).join('\r\n');
  const outputs=new Map([['shots.csv',csv],['checks.json',JSON.stringify({schema_version:'PREVIS_CHECKS_V1',...identity,checks,delivery_goal:goal},null,2)+'\n'],['revision-requests.json',JSON.stringify(revisions,null,2)+'\n'],['previs-receipt.json',JSON.stringify(result,null,2)+'\n']]);
  const binding=scene.actors.map(actor=>'- '+actor.id+'（'+actor.role+'）：预演色标 '+actor.color+'；上游资产 '+(scene.assetBindings?.find(item=>item.actorId===actor.id)?.assetId||'未绑定')+'。').join('\n');
  if(fight){
    outputs.set('source-execution.md',upstream.packet.master.text);
    outputs.set('fight-map.json',JSON.stringify(fightReceiptMap(upstream.packet,scene),null,2)+'\n');
    outputs.set('source-keyframes.json',JSON.stringify(upstream.packet.keyframes||upstream.packet.selection?.keyframes||[],null,2)+'\n');
    outputs.set('reference-attachments.md','# 仙侠战斗预演参考\n\n来源：'+sourceInfo.provider+'；制作段：'+sourceInfo.unit_id+'。\n\n'+binding+'\n\nsource-execution.md 是来源接收包的执行文本视图；其原文/整理方式和证据来源保留在intake，不把它提升为已生成或已验收媒体。fight-map.json 保留全场到段内时钟与原镜号。原关键帧提示词、独立状态图和MP4抽帧分别记录。\n\n用户目标：'+goal.status+'。代理接触、器物和效果不证明真实骨骼、受力、语义或声音通过。\n');
  }else if(upstream){
    outputs.set('prompts.md',upstream.packet.master.text);
    outputs.set('reference-attachments.md','# 三维预演参考附件\n\n正式段：'+lineage.formal_id+'；母稿：'+lineage.prompt_version+'；预算：'+lineage.budget_version+'。\n\n'+binding+'\n\n预演承载已实现的机位、代理动作与空间，不继承占位外观或审片控件。prompts.md 保留上游母稿原文；素材、能力、声音及最终模型检查见 checks.json。\n\n视频状态：'+videoStatus+'。用户目标：'+goal.status+'。条件计划、参考包与真实提交分别记录；本工具没有推进上游覆盖。\n');
    outputs.set('adaptation-map.json',JSON.stringify(scene.adaptationMap,null,2)+'\n');
    outputs.set('transition-map.json',JSON.stringify({schema_version:'PREVIS_TRANSITION_MAP_V1',source:upstream.packet.transition_context||null,freshness:transitions,implementation:scene.transitionMap||[],upstream_writes:false},null,2)+'\n');
  }else outputs.set('demo-notes.md','# '+scene.title+' · 运行时演示\n\n此工程没有绑定真实上游正式段，不能作为正式母稿或平台提交稿。\n\n'+binding+'\n\n'+scene.shots.map(shot=>'- '+shot.id+': '+shot.start+'–'+shot.end+' 秒；'+shot.beat).join('\n')+'\n');
  goal.delivered_artifacts=[...outputs.keys(),'manifest.json'];
  // Refresh serialized goal-bearing outputs after the actual file list is known.
  outputs.set('checks.json',JSON.stringify({schema_version:'PREVIS_CHECKS_V1',...identity,checks,delivery_goal:goal},null,2)+'\n');
  outputs.set('previs-receipt.json',JSON.stringify(result,null,2)+'\n');
  outputs.set('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  const now=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8'));
  if(renderSceneText(now)!==renderSceneText(scene)||(await sourceFingerprint(root)).sha256!==fingerprint.sha256)throw new Error('Saved inputs changed during handoff; no previous handoff was replaced.');
  await checkUpstream(root,now);
  if(!publish)return {destination,videoStatus,goal:goal.status,checks,result,manifest};
  await mkdir(destination,{recursive:true});
  const lockPath=path.join(root,'.previs-handoff.lock'),lock=await open(lockPath,'wx'),previous=new Map(),published=[];
  try{
    for(const [name,contents] of outputs){const file=path.join(destination,name);try{previous.set(name,await readFile(file))}catch(error){if(error.code!=='ENOENT')throw error;previous.set(name,null)}await writeAtomic(file,contents);published.push(name)}
  }catch(error){
    for(const name of published.reverse()){const file=path.join(destination,name),before=previous.get(name);if(before===null){try{await unlink(file)}catch(cleanup){if(cleanup.code!=='ENOENT')throw cleanup}}else await writeAtomic(file,before)}
    throw error;
  }finally{await lock.close();await unlink(lockPath)}
  return {destination,videoStatus,goal:goal.status,checks,result,manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
  const result=await createHandoff(root);
  console.log('Handoff written to '+result.destination+'; video '+result.videoStatus+'; goal '+result.goal+'; upstream writes false.');
}
