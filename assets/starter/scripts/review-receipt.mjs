import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const statuses=new Set(['PASS','CHECKED','FAIL','BLOCKED','PENDING','UNKNOWN','NOT_RUN','NOT_IMPLEMENTED','NOT_APPLICABLE','STALE']);
export const CHECK_NAMES=['source_structure','text_alignment','render_specs','spatial_proxy','boundary_source','boundary_extraction','boundary_frame','boundary_motion','audio','capability','inputs','platform_submission','final_model','fight_proxy','state_keyframes','attack_response','contact_phase','prop_ownership','persistent_effect','attrition_cost','knowledge_reveal'];
const reviewedNames=new Set(['text_alignment','boundary_frame','boundary_motion','audio','capability','inputs','platform_submission','final_model','attack_response','contact_phase','prop_ownership','persistent_effect','attrition_cost','knowledge_reveal']);
const routes=new Set(['LOCAL_IMPLEMENTATION','UPSTREAM_REVISION','PLATFORM_INPUT','REVIEW_REQUIRED']);
const need=(ok,message)=>{if(!ok)throw new Error('Review contract: '+message)};
export const checkResult=(status,scope,evidence=[],extra={})=>({status,scope,evidence,...extra});

export async function optionalJson(file){
  try{return JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
}

export async function verifyEvidence(root,evidence,{required=false}={}){
  need(Array.isArray(evidence),'evidence must be an explicit array.');
  need(!required||evidence.length>0,'a positive review requires independently recorded evidence.');
  const verified=[];
  for(const item of evidence){
    need(item&&typeof item==='object'&&!Array.isArray(item)&&text(item.path)&&hex(item.sha256),'evidence needs a relative path and its recorded SHA-256.');
    need(!path.isAbsolute(item.path)&&!/^[a-z][a-z0-9+.-]*:/i.test(item.path),'evidence must be a project-relative local file.');
    const file=path.resolve(root,item.path),relative=path.relative(path.resolve(root),file);
    need(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'evidence must remain inside the project.');
    const info=await lstat(file);
    need(info.isFile()&&!info.isSymbolicLink(),'evidence must be a regular file.');
    need(sha256(await readFile(file))===item.sha256,'evidence changed: '+item.path);
    verified.push({...item,path:relative.replaceAll(path.sep,'/'),integrity:'CHECKED'});
  }
  return verified;
}

export function identityMatches(review,identity){
  return ['scene_sha256','intake_sha256','render_inputs_sha256','video_sha256'].every(key=>Object.hasOwn(review||{},key)&&review[key]===identity[key]);
}

export async function scopedReview(root,review,identity,{fresh=false,transitionsCurrent=true,boundaryCurrent=false,boundaryIdentity=null,goal=null}={}){
  const result={schema_version:'PREVIS_SCOPED_REVIEW_V1',status:'NOT_RUN',checks:{},findings:[],diagnostics:[],provenance:'USER_RECORDED; file integrity and source identity do not prove the recorded judgment.'};
  if(!review)return result;
  if(review.schema_version==='PREVIS_REVIEW_V1'){
    result.status='LEGACY';result.diagnostics.push('Legacy review is retained for its original semantic scope; it does not establish new boundary/audio/platform checks.');return result;
  }
  need(review.schema_version==='PREVIS_REVIEW_V2','unsupported review schema; retain old records and create an explicit revision.');
  need(review.checks&&typeof review.checks==='object'&&!Array.isArray(review.checks),'checks must be an object.');
  need(Array.isArray(review.findings||[]),'findings must be an array.');
  const sourceMatches=['scene_sha256','intake_sha256','render_inputs_sha256'].every(key=>Object.hasOwn(review,key)&&review[key]===identity[key]);
  if(!sourceMatches){result.status='STALE';result.diagnostics.push('Review is not linked to the current saved scene, intake and render inputs.');return result;}
  for(const [name,item] of Object.entries(review.checks)){
    need(reviewedNames.has(name),'this review cannot override automatic check '+name);
    need(item&&statuses.has(item.status)&&text(item.scope),'each check needs a supported status and its actual scope.');
    if(!['text_alignment','capability','inputs'].includes(name)&&(!fresh||!identityMatches(review,identity))){result.checks[name]=checkResult('STALE',item.scope,[],{reason:'Media review does not match the current successful video and all four hashes.'});continue;}
    if(['capability','inputs','platform_submission','final_model'].includes(name)&&['PASS','CHECKED'].includes(item.status)&&goal&&review.goal_id!==goal.id){result.checks[name]=checkResult('STALE',item.scope,[],{reason:'Platform check was not recorded for the current delivery goal.'});continue;}
    let verified;
    try{verified=await verifyEvidence(root,item.evidence||[],{required:['PASS','CHECKED'].includes(item.status)})}
    catch(error){result.checks[name]=checkResult('STALE',item.scope,[],{reason:error.message});continue}
    if(['boundary_frame','boundary_motion'].includes(name)&&!transitionsCurrent){
      result.checks[name]=checkResult('STALE',item.scope,verified,{reason:'Selected upstream transition context changed; other reviews are unaffected.'});continue;
    }
    if(['boundary_frame','boundary_motion'].includes(name)&&['PASS','CHECKED'].includes(item.status)&&(!boundaryCurrent||!boundaryIdentity||item.boundary_identity!==boundaryIdentity)){
      result.checks[name]=checkResult('STALE',item.scope,verified,{reason:'Boundary review is not pinned to the current selected endpoint package.'});continue;
    }
    if(['platform_submission','final_model'].includes(name)&&['PASS','CHECKED'].includes(item.status)){
      need(text(item.task_ref),'platform/media acceptance requires its actual provider task reference.');
      need(verified.some(e=>e.kind==='PROVIDER_RECORD'),'platform/media acceptance requires a pinned provider record.');
      if(name==='final_model')need(verified.some(e=>['VIDEO','AUDIO'].includes(e.kind)),'final-model acceptance requires actual pinned media.');
    }
    result.checks[name]=checkResult(item.status,item.scope,verified,{...(item.task_ref?{task_ref:item.task_ref}:{}),provenance:'USER_RECORDED'});
  }
  for(const finding of review.findings||[]){
    need(finding&&text(finding.id)&&text(finding.summary)&&routes.has(finding.route),'findings need id, summary and an explicit supported route.');
    need(Array.isArray(finding.affected||[]),'finding affected records must be explicit.');
    let evidence;try{evidence=await verifyEvidence(root,finding.evidence||[],{required:true})}catch(error){result.diagnostics.push('Finding '+finding.id+' was not reused: '+error.message);continue}
    result.findings.push({...finding,affected:finding.affected||[],evidence,provenance:'USER_RECORDED'});
  }
  result.status=Object.values(result.checks).some(item=>item.status==='STALE')?'PARTIALLY_STALE':'CURRENT';
  return result;
}

async function pinnedFile(root,file){
  const bytes=await readFile(path.join(root,file));
  return {path:file.replaceAll(path.sep,'/'),sha256:sha256(bytes),kind:'FILE'};
}

export async function boundaryEvidence(root,report,identity,{transitionsCurrent=true}={}){
  const result={status:'NOT_RUN',checks:{},report:null,reason:null};
  if(!report)return result;
  try{
    const {validateBoundaryReport}=await import('./boundary-utils.mjs');
    const verified=await validateBoundaryReport(root,report);
    result.status=verified.status;result.report=report;
    if(verified.status==='CURRENT'){
      const endpoints=report.connections.flatMap(connection=>[connection.from,connection.to]);
      const local=endpoints.filter(endpoint=>endpoint.project_root===path.resolve(root));
      need(local.length>0,'boundary report has no explicitly identified local source endpoint.');
      for(const endpoint of local)need(['scene_sha256','render_inputs_sha256','intake_sha256','video_sha256'].every(key=>(endpoint.source[key]??null)===(identity[key]??null)),'local boundary identity differs from the current video.');
      result.checks.boundary_extraction=checkResult('PASS','All selected project inputs, plan bytes, actual source clips, complete file coverage and hashes were checked. Extraction is not perceptual/audio acceptance.',report.checks.extraction.evidence);
    }
  }catch(error){result.status='STALE';result.reason=error.message;result.report=null;result.checks={}}
  return result;
}

export function evaluateDeliveryGoal(goal,checks){
  const selected=goal||{id:'previs',target:'PREVIS'};
  need(selected&&typeof selected==='object'&&text(selected.id)&&['PREVIS','BOUNDARY_REVIEW','MODEL_SUBMISSION','FINAL_MODEL','FIGHT_PREVIS','FIGHT_REVIEW'].includes(selected.target),'delivery goal needs id and a supported target.');
  const mandatory={FIGHT_PREVIS:['source_structure','render_specs','fight_proxy'],FIGHT_REVIEW:['source_structure','render_specs','fight_proxy','state_keyframes','attack_response','contact_phase','prop_ownership','persistent_effect','attrition_cost'],PREVIS:['source_structure','render_specs'],BOUNDARY_REVIEW:['source_structure','render_specs','boundary_source','boundary_extraction','boundary_frame','boundary_motion'],MODEL_SUBMISSION:['source_structure','capability','inputs','platform_submission'],FINAL_MODEL:['source_structure','capability','inputs','platform_submission','final_model']}[selected.target];
  need(selected.required_checks===undefined||Array.isArray(selected.required_checks),'required_checks must be an array.');
  const required=[...new Set([...mandatory,...(selected.required_checks||[])])];
  need(required.every(name=>CHECK_NAMES.includes(name)),'delivery goal contains an unknown required check.');
  const blockers=required.filter(name=>!['PASS','CHECKED'].includes(checks[name]?.status)).map(name=>({check:name,status:checks[name]?.status||'NOT_RUN',gap:checks[name]?.reason||checks[name]?.scope||'No recorded execution evidence.',route:['capability','inputs','platform_submission','final_model'].includes(name)?'PLATFORM_INPUT':name.startsWith('boundary_')?'REVIEW_REQUIRED':'LOCAL_IMPLEMENTATION'}));
  const blocked=blockers.some(item=>['FAIL','BLOCKED','STALE','UNKNOWN','PENDING','NOT_IMPLEMENTED'].includes(item.status));
  return {id:selected.id,target:selected.target,status:blockers.length?(blocked?'BLOCKED':'IN_PROGRESS'):'COMPLETED',required_checks:required,blockers,delivered_artifacts:[],upstream_writes:false};
}

export function revisionRequests(findings,goal,lineage){
  return {schema_version:'PREVIS_REVISION_REQUESTS_V1',source:lineage,requests:findings.map(finding=>({id:finding.id,route:finding.route,summary:finding.summary,affected:finding.affected,evidence:finding.evidence,authorization:'REQUEST_ONLY; commit through the owning upstream workflow when authorized.'})),goal_blockers:goal.blockers,upstream_writes:false};
}
