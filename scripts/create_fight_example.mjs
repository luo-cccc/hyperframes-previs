#!/usr/bin/env node
import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseFightJson,validateFightProject} from '../assets/starter/scripts/fight-source.mjs';
import {validateScene} from '../assets/starter/src/scene-data.js';
import {selectBlueprint,segmentWindows,projectScene} from '../assets/examples/fight/blueprints.mjs';
import {clean,clone} from '../assets/examples/fight/track-utils.mjs';

const REPO=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const exists=async file=>stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error});
const safeId=id=>typeof id==='string'&&id.length>0&&!/[\\/:\x00-\x1f]/.test(id)&&!['.','..'].includes(id)&&!/[. ]$/.test(id)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id);
const dependencyFields=['duration_sec','constraints','assets','scene','beats','shots','segments','keyframes','cost','knowledge'];

export function exactFrame(t,fps,label){
 const raw=t*fps,index=Math.round(raw);
 if(!Number.isFinite(t)||Math.abs(raw-index)>1e-6)throw new Error('OFF_FRAME_GRID: '+label+' ('+t+' s) is not exact at '+fps+' fps. Choose --fps that preserves the original budget; no time was rounded.');
 return index;
}
export function resolution(aspect){
 const match=/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(aspect??'');
 if(!match)throw new Error('A numeric source aspect_ratio is required; no template ratio is substituted.');
 const ratio=Number(match[1])/Number(match[2]);
 if(!(ratio>0))throw new Error('Invalid source aspect_ratio.');
 const width=ratio>=1?1280:Math.round(1280*ratio/2)*2,height=ratio>=1?Math.round(1280/ratio/2)*2:1280;
 if(width<=0||height<=0||Math.abs(width/height-ratio)>1e-9)throw new Error('Source ratio needs explicitly selected even render dimensions; it was not approximated.');
 return {width,height};
}
export function sourceKeyframes(source,unit,fps){
 const ids=new Set(unit.shots.map(shot=>shot.id));
 return {schema_version:'PREVIS_SOURCE_KEYFRAMES_V1',provider:'xianxia-fight-director',unit_id:unit.id,keyframes:source.keyframes.filter(frame=>ids.has(frame.shot_id)).map(frame=>{
  const local=clean(frame.time_sec-unit.start),shot=unit.shots.find(s=>s.id===frame.shot_id),atEnd=local===unit.duration||frame.time_sec===shot.end;
  return {id:frame.id,shot_id:frame.shot_id,time_s:local,battle_time_s:frame.time_sec,role:frame.role??'single',source_ref:'../sources/project.json#/keyframes/'+source.keyframes.indexOf(frame),state:frame.state,plan_status:'SOURCE_REQUIREMENT_ONLY',capture_kind:atEnd?'BOUNDARY_STATE_CAPTURE':'STATE_CAPTURE',is_mp4_frame:false,frame_index:null,planned_video_frame_index:atEnd||Math.abs(local*fps-Math.round(local*fps))>1e-6?null:Math.round(local*fps),capture_requirement:Math.abs(local*fps-Math.round(local*fps))>1e-6?'STATE_CAPTURE_ONLY_NON_FRAME_TIME':'STATE_CAPTURE_SOURCE_REQUIREMENT'};
 })};
}
export function sourceMapping(source,unit,sourceSha){
 return {schema_version:'PREVIS_FIGHT_IMPLEMENTATION_MAP_V1',provider:'xianxia-fight-director',unit_id:unit.id,source:{path:'../sources/project.json',sha256:sourceSha,source_schema_version:source.schema_version},clocks:{basis:'BATTLE_EDIT_SECONDS_NOT_WORLD_SECONDS',battle_start_s:unit.start,battle_end_s:unit.end,segment_start_s:0,segment_end_s:unit.duration,conversion:'segment_time_s = battle_time_s - battle_start_s; exactly once'},segment:clone(unit.segment),shots:unit.shots.map(shot=>({id:shot.id,source_ref:'../sources/project.json#/shots/'+source.shots.indexOf(shot),battle_start_s:shot.start,battle_end_s:shot.end,start_s:clean(shot.start-unit.start),end_s:clean(shot.end-unit.start),source_camera:clone(shot.camera),source_opening_state:shot.opening_state,source_end_state:shot.end_state,execution:clone(shot.execution),cues:shot.execution.cues.map((cue,index)=>({source_ref:'../sources/project.json#/shots/'+source.shots.indexOf(shot)+'/execution/cues/'+index,battle_start_s:cue.start,battle_end_s:cue.end,start_s:clean(cue.start-unit.start),end_s:clean(cue.end-unit.start),text:cue.text})),source_reference:{complete_beats:shot.beat_ids.map(id=>clone(source.beats.find(beat=>beat.id===id))),instruction:'Complete beats are reference evidence; animate only the selected shot.execution.cues window.'}})),states:{opening:unit.segment.opening_state,closing:unit.segment.closing_state},sound_status:'NOT_RUN'};
}
export function implementationReport(source,blueprint,unit,scene,sourceSha){
 return {schema_version:'PREVIS_FIGHT_IMPLEMENTATION_V1',provider:'xianxia-fight-director',unit_id:unit.id,source_sha256:sourceSha,blueprint:blueprint.id,status:blueprint.id==='generic-spatial-layout'?'PARTIAL_LAYOUT_ONLY':'PROXY_IMPLEMENTED_NEEDS_REVIEW',source_shot_ids:unit.shots.map(shot=>shot.id),source_beat_ids:[...new Set(unit.shots.flatMap(shot=>shot.beat_ids))],affected_window:{battle_s:[unit.start,unit.end],local_s:[0,unit.duration]},implemented:blueprint.implemented.map(capability=>({capability,status:'IMPLEMENTED_NOT_ACCEPTED',affected_battle_window_s:[unit.start,unit.end],affected_local_window_s:[0,unit.duration]})),execution_assumptions:[...(blueprint.geometryAssumptions??[]),{classification:'EXECUTION_ASSUMPTION',scope:'proxy point light intensity/range/color',value:scene.combat.objects.filter(item=>item.light).map(item=>({id:item.id,light:item.light})),reason:'Only source-declared luminous nodes, blade light, pressure beams, manifestation or fire emit. Numeric light falloff is a local small-range proxy; complex optics and photometric accuracy remain NOT_RUN.'},{classification:'EXECUTION_ASSUMPTION',scope:'coordinate basis',value:'source east x, north y, height z become world [x,z,-y]; two-dimensional source points use source floor height; metre units, Y up'},{classification:'EXECUTION_ASSUMPTION',scope:'proxy heights and geometry',value:scene.actors.map(actor=>({id:actor.id,height_m:actor.height,radius_m:actor.radius??.22,scale:actor.scale??1,geometry:actor.geometry})),reason:'Source supplies no numeric body heights or licensed character rigs; these local proxy dimensions do not prove identity.'},{classification:'EXECUTION_ASSUMPTION',scope:'numeric camera rigs and geometric subparts',value:'Original camera prose remains in source-mapping.json; numeric camera paths, primitive sizes, contact offsets and unnamed intermediate waypoints are editable local execution fills.',affected_battle_window_s:[unit.start,unit.end]},{classification:'EXECUTION_ASSUMPTION',scope:'spatial check requiredActors',value:'Empty explicit list does not certify shot framing; original framing remains a semantic review requirement.'}],source_conflicts:(blueprint.sourceConflicts??[]).filter(item=>item.affected_battle_window_s[0]<unit.end&&item.affected_battle_window_s[1]>unit.start),slow_motion:(blueprint.slowMotion??[]).filter(item=>item.battle_window_s[0]<unit.end&&item.battle_window_s[1]>unit.start).map(item=>({...clone(item),local_window_s:item.battle_window_s.map(t=>clean(t-unit.start)),world_clock_status:'DESCRIPTIVE_ONLY_NOT_NUMERIC_WORLD_CLOCK'})),not_implemented:blueprint.notImplemented.map(capability=>({capability,status:'NOT_IMPLEMENTED',affected_battle_window_s:[unit.start,unit.end],affected_local_window_s:[0,unit.duration]})),checks:{semantic_acceptance:'NOT_RUN',contact_force:'NOT_IMPLEMENTED',identity_consistency:'NOT_RUN',audio:'NOT_RUN',final_model:'NOT_RUN'},upstream_writes:false};
}
export function boundaryPlan(source,units,index,fps){
 const unit=units[index],connections=[],stateCaptureOnly=[];
 if(index<units.length-1){const next=units[index+1];connections.push({id:unit.id+'--'+next.id,kind:'action',from:{project:'.',shot_id:unit.shots.at(-1).id,time_s:(exactFrame(unit.duration,fps,unit.id)-1)/fps},to:{project:'../'+next.id,shot_id:next.shots[0].id,time_s:0},source_boundary:{battle_time_s:unit.end,from_unit_id:unit.id,to_unit_id:next.id,terminal_state_is_not_mp4_frame:true}})}
 for(let n=1;n<unit.shots.length;n++){const previous=unit.shots[n-1],next=unit.shots[n],cut=exactFrame(clean(next.start-unit.start),fps,next.id);connections.push({id:previous.id+'--'+next.id,kind:'INTERNAL_CUT',from:{project:'.',shot_id:previous.id,time_s:(cut-1)/fps},to:{project:'.',shot_id:next.id,time_s:cut/fps},source_battle_time_s:next.start});}
 for(const frame of source.keyframes.filter(frame=>frame.role==='contact'&&unit.shots.some(shot=>shot.id===frame.shot_id))){
  const shot=unit.shots.find(shot=>shot.id===frame.shot_id),time=clean(frame.time_sec-unit.start);if(Math.abs(time*fps-Math.round(time*fps))>1e-6){stateCaptureOnly.push({id:frame.id,shot_id:frame.shot_id,time_s:time,battle_time_s:frame.time_sec,reason:'OFF_VIDEO_FRAME_GRID',handler:'source-keyframes.json / state-capture',original_time_preserved:true});continue;}const n=exactFrame(time,fps,frame.id),start=exactFrame(clean(shot.start-unit.start),fps,shot.id),end=exactFrame(clean(shot.end-unit.start),fps,shot.id);
  // Each callout compares actual neighboring retained frames. State captures at
  // the closed shot endpoint remain in source-keyframes.json instead.
  if(n<=start||n>=end)continue;
  const before=Math.min(Math.max(1,Math.round(.2*fps)),n-start),after=Math.min(Math.max(1,Math.round(.2*fps)),end-n);
  connections.push({id:'contact--'+frame.id,kind:'contact',from:{project:'.',shot_id:shot.id,time_s:(n-1)/fps},to:{project:'.',shot_id:shot.id,time_s:n/fps},window_before_s:before/fps,window_after_s:after/fps,source_keyframe_id:frame.id,source_battle_time_s:frame.time_sec});
 }
 return {schema_version:'PREVIS_BOUNDARY_PLAN_V1',connections,state_capture_only:stateCaptureOnly};
}
function run(file,args,cwd){
 try{return execFileSync(file,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1'}})}
 catch(error){throw new Error('COMMAND_FAILED: '+file+' '+args.join(' ')+'\n'+String(error.stderr||error.stdout||error.message))}
}
export async function planFightExample(bytes,options={}){
 const source=parseFightJson(bytes,'user fight project');validateFightProject(source);
 const fps=options.fps??60;if(!Number.isFinite(fps)||fps<1||fps>240)throw new Error('fps must be a finite number from 1 through 240.');
 const units=segmentWindows(source),dimensions=resolution(source.aspect_ratio),sourceSha=sha(bytes),blueprint=selectBlueprint(source);
 const signatures=JSON.parse(await readFile(path.join(REPO,'assets/examples/fight/source-signatures.json'),'utf8'));
 if(signatures[blueprint.id]){const actual=sha(JSON.stringify(Object.fromEntries(dependencyFields.map(field=>[field,source[field]]))));if(actual!==signatures[blueprint.id].dependency_sha256)throw new Error('BLUEPRINT_SOURCE_MISMATCH: source facts/cues changed from locked example 26f2697. Author and review an updated local proxy instead of silently using the old action.');}
 const ids=new Set();for(const unit of units){if(!safeId(unit.id)||ids.has(unit.id.toLowerCase()))throw new Error('UNSAFE_SEGMENT_DIRECTORY: original segment IDs must be distinct safe directory names.');ids.add(unit.id.toLowerCase());exactFrame(unit.duration,fps,unit.id+' duration');for(const shot of unit.shots){exactFrame(clean(shot.start-unit.start),fps,shot.id+' start');exactFrame(clean(shot.end-unit.start),fps,shot.id+' end');}}
 const scenes=units.map(unit=>projectScene(source,blueprint,unit,{fps,sourceSha,...dimensions}));
 for(let i=0;i<scenes.length;i++){const errors=validateScene(scenes[i]);if(errors.length)throw new Error('INVALID_GENERATED_SCENE '+units[i].id+':\n'+errors.join('\n'));}
 return {source,sourceSha,fps,units,blueprint,scenes,dimensions};
}
export async function createFightExample(destination,options={}){
 if(typeof destination!=='string'||!destination.trim())throw new Error('A new destination directory is required.');
 if(Boolean(options.project)===Boolean(options.sourceDir))throw new Error('Choose exactly one of --project or --source-dir.');
 if(options.sourceDir&&(!safeId(options.example)||!options.example))throw new Error('--source-dir needs a safe --example basename.');
 let input=options.project?path.resolve(options.project):path.join(path.resolve(options.sourceDir),options.example,'project.json');
 if(!(await exists(input))&&options.sourceDir)input=path.join(path.resolve(options.sourceDir),options.example+'.json');
 const bytes=await readFile(input),plan=await planFightExample(bytes,options),target=path.resolve(destination);
 if(await exists(target))throw new Error('Destination already exists; choose a new directory: '+target);
 const withinTemplate=path.relative(path.join(REPO,'assets/starter'),target);if(withinTemplate===''||(!withinTemplate.startsWith('..'+path.sep)&&withinTemplate!=='..'&&!path.isAbsolute(withinTemplate)))throw new Error('UNSAFE_TEMPLATE_DESTINATION: create output outside assets/starter to avoid recursive copying.');
 const intakeTool=path.join(REPO,'scripts/intake_fight.py');if(!(await exists(intakeTool)))throw new Error('Fight intake is unavailable; no synthetic packet or hash was written.');
 await mkdir(path.dirname(target),{recursive:true});await mkdir(target);await mkdir(path.join(target,'sources'));
 await writeFile(path.join(target,'sources/project.json'),bytes);
 const {source,sourceSha,fps,units,blueprint,scenes}=plan;
 await writeFile(path.join(target,'sources/source-origin.json'),json({provider:'xianxia-fight-director',original_project:input,original_sha256:sourceSha,local_copy:'project.json',permission:'USER_PROVIDED_LOCAL_INPUT',source_schema_version:source.schema_version,notice:'Original prose exists only in this user output directory. It is not a distributed asset of this generator.'}));
 const operations=[],projects=[];
 // Capture the current production template once so every unit uses the same
 // runtime and provider files, even while developers edit the shared repository.
 const template=path.join(target,'.template-snapshot');
 await cp(path.join(REPO,'assets/starter'),template,{recursive:true,errorOnExist:true,force:false,filter:entry=>!['node_modules','.hyperframes','renders','review'].includes(path.basename(entry))});
 for(let i=0;i<units.length;i++){
  const unit=units[i],scene=scenes[i],root=path.join(target,unit.id);await cp(template,root,{recursive:true,errorOnExist:true,force:false});
  await writeFile(path.join(root,'scene.json'),json(scene));
  const index=path.join(root,'index.html');let html=await readFile(index,'utf8');for(const [key,value]of Object.entries({'composition-id':scene.id,duration:scene.duration,width:scene.width,height:scene.height,fps:scene.fps}))html=html.replace(new RegExp('data-'+key+'="[^"]*"'),'data-'+key+'="'+value+'"');html=html.replace(/#stage\{width:\d+px;height:\d+px;/,'#stage{width:'+scene.width+'px;height:'+scene.height+'px;');await writeFile(index,html);
  await mkdir(path.join(root,'sources'));
  await writeFile(path.join(root,'sources/keyframes.json'),json(source.keyframes.filter(frame=>unit.shots.some(shot=>shot.id===frame.shot_id))));
  await writeFile(path.join(root,'source-keyframes.json'),json(sourceKeyframes(source,unit,fps)));
  await writeFile(path.join(root,'source-mapping.json'),json(sourceMapping(source,unit,sourceSha)));
  await writeFile(path.join(root,'fight-implementation.json'),json(implementationReport(source,blueprint,unit,scene,sourceSha)));
  await writeFile(path.join(root,'boundary-plan.json'),json(boundaryPlan(source,units,i,fps)));
  await writeFile(path.join(root,'delivery-goal.json'),json({id:'fight-previs-'+unit.id,target:'FIGHT_PREVIS',required_checks:blueprint.id==='generic-spatial-layout'?['attack_response']:[]}));
  await writeFile(path.join(root,'adapter-project.json'),json({mode:'UPSTREAM_ADAPTER',provider:'xianxia-fight-director',template_is_demonstration:false,source_unit_id:unit.id,proxy_semantics_status:'NEEDS_REVIEW',upstream_writes:false}));
  const args=['-B','-X','utf8',intakeTool,'--project',path.join(target,'sources/project.json'),'--segment',unit.id,'--out',path.join(root,'upstream-intake.json')];
  if(options.upstreamSkillDir)args.push('--upstream-skill-dir',path.resolve(options.upstreamSkillDir));
  operations.push({unit_id:unit.id,step:'intake',output:run(options.python??'python',args,REPO)});
  operations.push({unit_id:unit.id,step:'bind',output:run(process.execPath,[path.join(root,'scripts/bind-upstream.mjs')],root)});
  operations.push({unit_id:unit.id,step:'validate',output:run(process.execPath,[path.join(root,'scripts/validate.mjs')],root)});
  projects.push({id:unit.id,directory:root,duration_s:unit.duration,battle_start_s:unit.start,battle_end_s:unit.end,frames:exactFrame(unit.duration,fps,unit.id),fps,source_schema_version:source.schema_version,source_bound:true});
 }
 if(sha(await readFile(input))!==sourceSha||sha(await readFile(path.join(target,'sources/project.json')))!==sourceSha)throw new Error('SOURCE_CHANGED_DURING_GENERATION: source was not modified by this tool; inspect concurrent changes before using these outputs.');
 const result={schema_version:'PREVIS_FIGHT_EXAMPLE_GENERATION_V1',provider:'xianxia-fight-director',directory:target,blueprint:blueprint.id,source_project:input,source_sha256:sourceSha,source_schema_version:source.schema_version,total_duration_s:source.duration_sec,fps,projects,status:'GENERATED_BOUND_VALIDATED_NOT_RENDERED',semantic_acceptance:'NOT_RUN',upstream_writes:false};
 await writeFile(path.join(target,'generation-report.json'),json({...result,operations}));
 const readme=['# Local fight proxy project','',source.title,'','Source JSON was copied byte-for-byte to sources/project.json. Every original segment is an independent editable project; scene and source mapping retain original IDs, budgets and execution windows. Upstream state is not marked FORMAL or DONE.','','For each original unit directory:','','```powershell','npm ci','npm run prepare-libs','npm run validate','npm run studio','npm run fight-check','npm run render','npm run state-capture -- --plan source-keyframes.json','npm run boundary-pack -- --plan boundary-plan.json','npm run handoff','```','','Render all units before extracting cross-project boundary packages. Run boundary-pack only where boundary-plan.json has at least one connection; a final one-shot unit can have no boundary plan work. source-keyframes.json contains source requirements, not generated images. Closed endpoint states belong to their original preceding shot and require state-capture; they are not MP4 frames.','','The default delivery target is FIGHT_PREVIS. Switch to FIGHT_REVIEW only when actually reviewing its required evidence. Geometry is a readable proxy; contact coincidence does not prove force, reach, anatomy or final character identity. Audio and final-model generation are NOT_RUN.','','Numeric positions, body heights, camera rigs and primitive shapes are execution assumptions documented in each fight-implementation.json. Generic layouts explicitly leave battle actions unimplemented. Source conflicts remain listed for human review.','.template-snapshot records the exact template used during this generation. Original source prose remains local to this output.',''].join('\n');
 await writeFile(path.join(target,'README.md'),readme);return result;
}
function cli(argv){
 const [destination,...args]=argv,options={};for(let i=0;i<args.length;i+=2){const key={'--project':'project','--source-dir':'sourceDir','--example':'example','--fps':'fps','--upstream-skill-dir':'upstreamSkillDir','--python':'python'}[args[i]];if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Unknown or incomplete option '+args[i]);options[key]=key==='fps'?Number(args[i+1]):args[i+1];}
 if(!destination)throw new Error('Usage: node scripts/create_fight_example.mjs <new-dir> (--project <project.json> | --source-dir <examples> --example <basename>) [--upstream-skill-dir <root>] [--fps <exact-value>]');return {destination,options};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const {destination,options}=cli(process.argv.slice(2));console.log(json(await createFightExample(destination,options)))}catch(error){console.error(error.message);process.exitCode=1}}
