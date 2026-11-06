import {readFile,writeFile,mkdir,rename,rm,open,unlink,realpath,copyFile,rmdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {checkUpstream} from './check-upstream.mjs';
import {sourceLineage} from './source-lineage.mjs';
import {sourceFingerprint} from './source-fingerprint.mjs';
import {writeJsonAtomic} from './atomic-file.mjs';
import {renderSceneText} from '../src/render-identity.js';
import {validateScene} from '../src/scene-data.js';
import {BoundaryError,requireBoundary as need,finite,hex,jsonText,digest,hashFile,relativeLink,readJson,exists,frameIndex,safePackagePath,listPackageFiles,assertRegularFile,runMedia,probeVideo,sampleClocks,sampleProxy,transitionScope} from './boundary-utils.mjs';

const DEFAULT_PROJECT=fileURLToPath(new URL('../',import.meta.url));
const PLAN_SCHEMA='PREVIS_BOUNDARY_PLAN_V1',REPORT_SCHEMA='PREVIS_BOUNDARY_REPORT_V1',PACKAGE_SCHEMA='PREVIS_BOUNDARY_PACKAGE_V1';
const DEFAULT_WINDOW_TARGET_S=.2;
const NOT_RUN=scope=>({status:'NOT_RUN',scope,evidence:[]});
const jsonBytes=value=>Buffer.from(jsonText(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>jsonText(a)===jsonText(b);

async function loadSource(project,{planOnly=false,probe=true}={}){
  const root=await realpath(project),sceneBytes=await readFile(path.join(root,'scene.json'));
  let scene;try{scene=JSON.parse(sceneBytes.toString('utf8').replace(/^\uFEFF/,''))}catch{throw new BoundaryError('INVALID_SCENE',`Invalid scene.json in ${root}`)}
  const errors=validateScene(scene);need(!errors.length,'INVALID_SCENE',errors.join('\n'));
  const fingerprint=await sourceFingerprint(root),sceneHash=digest(renderSceneText(scene));
  let upstream=null,upstreamError=null,intakeBytes=null,intake=null;
  if(scene.upstream?.intake){try{intakeBytes=await readFile(path.resolve(root,scene.upstream.intake));intake=JSON.parse(intakeBytes.toString('utf8').replace(/^\uFEFF/,''))}catch(error){upstreamError=error.message}}
  try{upstream=await checkUpstream(root,scene)}catch(error){upstreamError=error.message}
  if(upstreamError&&!planOnly)throw new BoundaryError('STALE_SOURCE',`Upstream source could not be verified for ${root}: ${upstreamError}`);
  const intakeHash=upstream?.intakeSha256||(intakeBytes?digest(intakeBytes):null);
  const receiptFile=path.join(root,'renders/render-receipt.json'),videoFile=path.join(root,'renders/previs.mp4');
  let receipt=null,receiptBytes=null,receiptError=null;
  if(await exists(receiptFile)){receiptBytes=await readFile(receiptFile);try{receipt=JSON.parse(receiptBytes.toString('utf8'))}catch{receiptError='Render receipt is not valid JSON.'}}
  const videoHash=await exists(videoFile)?await hashFile(videoFile):null;
  const source={scene_sha256:sceneHash,render_inputs_sha256:fingerprint.sha256,intake_sha256:intakeHash,video_sha256:videoHash,render_receipt_sha256:receiptBytes?digest(receiptBytes):null};
  const current=Boolean(!upstreamError&&videoHash&&receipt?.type==='PREVIS_RENDER'&&receipt.render_status==='COMPLETED'&&receipt.render_identity==='PREVIS_RENDER_CONTENT_V2'&&receipt.video==='previs.mp4'&&receipt.scene_sha256===sceneHash&&receipt.render_inputs_sha256===fingerprint.sha256&&receipt.intake_sha256===intakeHash&&receipt.video_sha256===videoHash);
  const sourceStatus=upstreamError?'STALE_SOURCE':!videoHash?'MISSING_MEDIA':!receiptBytes?'MISSING_RECEIPT':!current?'STALE_RENDER':'CURRENT';
  if(!planOnly)need(current,sourceStatus,`Boundary extraction blocked for ${root}: ${receiptError||sourceStatus}. Render a current video and matching provenance receipt first; this command never renders a replacement.`);
  const metrics=current&&!planOnly&&probe?await probeVideo(videoFile,{fps:scene.fps,width:scene.width,height:scene.height,frames:frameIndex(scene.duration,scene.fps,'scene.duration')}):null;
  let proxySampler=null,proxySamplerSource=null;
  const samplerFile=path.join(root,'src/action-data.js');
  if(await exists(samplerFile)){
    const samplerHash=await hashFile(samplerFile);
    try{const module=await import(pathToFileURL(samplerFile).href+'?sha256='+samplerHash);if(typeof module.sampleActions==='function'){proxySampler=module.sampleActions;proxySamplerSource={path:'src/action-data.js',sha256:samplerHash}}}catch{/* Proxy observation remains NOT_RUN if the selected project cannot supply a pure sampler. */}
  }
  return {root,scene,sceneBytes,fingerprint,upstream,proxySampler,proxySamplerSource,intake:intake||upstream?.packet,intakeBytes,receipt,receiptBytes,videoFile,source,status:sourceStatus,upstreamError,metrics};
}

async function preparePlan(project,argument){
  if(argument!==undefined){
    const file=typeof argument==='string'?path.resolve(argument):null;
    const bytes=file?await readFile(file):null,plan=file?JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')):structuredClone(argument);
    need(object(plan)&&plan.schema_version===PLAN_SCHEMA&&Array.isArray(plan.connections)&&plan.connections.length>0,'INVALID_PLAN','A boundary plan needs PREVIS_BOUNDARY_PLAN_V1 and a nonempty connections array.');
    return {plan,base:file?path.dirname(file):project,file,bytes,mode:'EXPLICIT_PLAN'};
  }
  const scene=await readJson(path.join(project,'scene.json'));
  need(Array.isArray(scene.shots)&&scene.shots.length>1,'NO_BOUNDARIES','No internal cuts exist. Supply an explicit plan for a material entry/exit point or a cross-project connection.');
  return {base:project,file:null,bytes:null,mode:'INTERNAL_CUTS_ONLY',plan:{schema_version:PLAN_SCHEMA,connections:scene.shots.slice(1).map((to,index)=>{
    const from=scene.shots[index];
    return {id:`${from.id}--${to.id}`,kind:'INTERNAL_CUT',from:{project:'.',shot_id:from.id,time_s:(frameIndex(from.end,scene.fps,`${from.id}.end`)-1)/scene.fps},to:{project:'.',shot_id:to.id,time_s:to.start}};
  })}};
}

function validatePlan(plan){
  const ids=new Set();
  for(const connection of plan.connections){
    need(object(connection)&&typeof connection.id==='string'&&connection.id.trim()&&!ids.has(connection.id),'INVALID_PLAN','Connection IDs must be nonempty and unique.');ids.add(connection.id);
    need(typeof connection.kind==='string'&&connection.kind.trim(),'INVALID_PLAN',`${connection.id}: kind must be explicit.`);
    if(connection.transition_id!==undefined)need(typeof connection.transition_id==='string'&&connection.transition_id.trim(),'INVALID_PLAN',`${connection.id}: transition_id must be a nonempty string.`);
    for(const side of ['from','to']){
      const endpoint=connection[side];
      need(object(endpoint)&&typeof endpoint.project==='string'&&endpoint.project.trim()&&!path.isAbsolute(endpoint.project)&&!path.win32.isAbsolute(endpoint.project)&&!/^[a-z][a-z0-9+.-]*:/i.test(endpoint.project),'INVALID_PLAN',`${connection.id}.${side}.project must be . or a local path relative to the plan directory.`);
      need(typeof endpoint.shot_id==='string'&&endpoint.shot_id&&finite(endpoint.time_s)&&endpoint.time_s>=0,'INVALID_PLAN',`${connection.id}.${side} needs a shot_id and finite nonnegative time_s.`);
    }
    for(const field of ['window_before_s','window_after_s'])if(connection[field]!==undefined)need(finite(connection[field])&&connection[field]>0,'INVALID_WINDOW',`${connection.id}.${field} must be positive seconds.`);
  }
}

function endpointSelection(source,endpoint,side,seconds){
  const {scene}=source,shot=scene.shots.find(item=>item.id===endpoint.shot_id);
  need(shot,'UNKNOWN_SHOT',`Unknown shot ${endpoint.shot_id} in ${source.root}`);
  const explicitWindow=seconds!==undefined;
  // Only an omitted setting selects a technical default. Explicit seconds must
  // already lie on the source frame grid and are never rounded or truncated.
  const index=frameIndex(endpoint.time_s,scene.fps,`${side}.time_s`);
  const count=explicitWindow?frameIndex(seconds,scene.fps,`${side}.window_s`):Math.max(1,Math.round(DEFAULT_WINDOW_TARGET_S*scene.fps));
  const windowSelection=explicitWindow?{selection_mode:'EXPLICIT_SECONDS',requested_s:seconds,technical_default:null}:{selection_mode:'TECHNICAL_DEFAULT',requested_s:null,technical_default:{target_s:DEFAULT_WINDOW_TARGET_S,frame_selection:'NEAREST_WHOLE_FRAME_MIN_1',frame_count:count,actual_s:count/scene.fps}};
  need(count>0,'INVALID_WINDOW','A motion window must contain at least one frame.');
  const shotFirst=frameIndex(shot.start,scene.fps,`${shot.id}.start`),shotEnd=frameIndex(shot.end,scene.fps,`${shot.id}.end`),total=frameIndex(scene.duration,scene.fps,'scene.duration');
  need(index>=0&&index<total&&index>=shotFirst&&index<shotEnd,'TIME_OUT_OF_RANGE',`${side}.time_s must select an actual frame within ${shot.id}; shot end/duration are exclusive.`);
  const first=side==='from'?index-count+1:index,last=side==='from'?index:index+count-1;
  need(first>=shotFirst&&last<shotEnd,'WINDOW_OUT_OF_RANGE',`${side} window would leave the selected shot. Choose a shorter explicit frame-aligned window; no truncation was applied.`);
  const clocks=frame=>{const result=sampleClocks(scene,source.receipt,frame/scene.fps);if(source.status!=='CURRENT')result.video={status:'PLANNED',time_s:frame/scene.fps,authority:'SCENE_FRAME_GRID_NOT_OBSERVED_MEDIA'};return result};
  const packet=source.intake;
  return {project:endpoint.project,project_root:source.root,shot_id:shot.id,time_s:index/scene.fps,frame_index:index,frame_index_basis:source.status==='CURRENT'?'CURRENT_SOURCE_VIDEO':'PLANNED_SCENE_FRAME_GRID',frame_number_base:0,selection:side==='from'?'LAST_RETAINED_FRAME':'FIRST_RETAINED_FRAME',source_lineage:sourceLineage(source.upstream||source.intake,scene),unit_id:source.intake?.unit?.id||source.receipt?.source_lineage?.unit_id||null,formal_id:packet?.formal_id||source.receipt?.formal_id||null,prompt_version:packet?.prompt_version||source.receipt?.base_prompt_version||null,budget_version:packet?.budget_version||source.receipt?.budget_version||null,source:source.source,source_status:source.status,clocks:clocks(index),shot:structuredClone(shot),window:{...windowSelection,first_frame_index:first,last_frame_index:last,frame_count:count,duration_s:count/scene.fps,fps:scene.fps,first_clocks:clocks(first),last_clocks:clocks(last)}};
}

const escapeHtml=value=>String(value??'UNKNOWN').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function packageViewer(connections,status){
  const clock=value=>value?.status==='KNOWN'?Number(value.time_s).toFixed(6)+' s':'UNKNOWN';
  const cards=connections.map(connection=>{
    const frames=connection.frames.map(frame=>'<figure>'+(frame.path?'<img src="'+escapeHtml(frame.path)+'" alt="'+escapeHtml(frame.role)+'">':'<p>PLANNED — no captured frame</p>')+'<figcaption>'+escapeHtml(frame.role)+' · '+escapeHtml(frame.shot_id)+' · frame '+escapeHtml(frame.frame_index)+'<br>segment '+escapeHtml(clock(frame.clocks.segment))+' · source '+escapeHtml(clock(frame.clocks.source))+' · edit '+escapeHtml(clock(frame.clocks.timeline))+'</figcaption></figure>').join('');
    const clips=connection.clips.map(clip=>'<figure>'+(clip.path?'<video controls muted playsinline preload="metadata" src="'+escapeHtml(clip.path)+'"></video>':'<p>PLANNED — no motion clip</p>')+'<figcaption>'+escapeHtml(clip.role)+' · '+escapeHtml(clip.frame_count)+' frames · '+escapeHtml(clip.fps)+' fps · audio NOT_RUN</figcaption></figure>').join('');
    return '<section><h2>'+escapeHtml(connection.id)+' · '+escapeHtml(connection.kind)+'</h2><p>A '+escapeHtml(connection.from.source_lineage?.unit_id||connection.from.formal_id)+' / '+escapeHtml(connection.from.shot_id)+' → B '+escapeHtml(connection.to.source_lineage?.unit_id||connection.to.formal_id)+' / '+escapeHtml(connection.to.shot_id)+'</p><div class="grid">'+frames+'</div><div class="grid clips">'+clips+'</div><p><a href="'+escapeHtml(connection.metadata_path)+'">Connection metadata and proxy observations</a></p></section>';
  }).join('');
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Boundary evidence</title><style>body{background:#111b25;color:#e6edf3;font:15px system-ui;margin:24px;line-height:1.6}section{border-top:1px solid #3d5264;margin-top:24px;padding-top:16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0;background:#1c2b38;padding:10px}img,video{width:100%;display:block}figcaption{padding-top:8px}a{color:#8ee4d5}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><h1>Selected boundary evidence · '+escapeHtml(status)+'</h1><p>Frames and motion windows were extracted from the selected files. Playback, image review, motion continuity and audio acceptance retain their separate recorded scope. Clips contain no audio.</p>'+cards;
}
function connectionRecord(connection,index,fromSource,toSource,status){
  const directory=`connections/${String(index+1).padStart(3,'0')}-${digest(connection.id).slice(0,12)}`;
  const from=endpointSelection(fromSource,connection.from,'from',connection.window_before_s),to=endpointSelection(toSource,connection.to,'to',connection.window_after_s);
  const reference=name=>status==='EXTRACTED'?{status:'EXTRACTED',path:`${directory}/${name}`}:{status:'PLANNED',planned_path:`${directory}/${name}`};
  const clips=['from','to'].map(side=>({role:side==='from'?'A_BEFORE':'B_AFTER',...reference(`${side}-window.mp4`),project_root:(side==='from'?from:to).project_root,...(side==='from'?from:to).window,audio_included:false}));
  const frames=['from','to'].flatMap(side=>['first','last'].map(edge=>{const endpoint=side==='from'?from:to,frame=endpoint.window[`${edge}_frame_index`];return {role:`${side.toUpperCase()}_${edge.toUpperCase()}`,...reference(`${side}-${edge}.png`),project_root:endpoint.project_root,shot_id:endpoint.shot_id,frame_index:frame,clocks:{...sampleClocks((side==='from'?fromSource:toSource).scene,(side==='from'?fromSource:toSource).receipt,frame/(side==='from'?fromSource:toSource).scene.fps),...((side==='from'?fromSource:toSource).status!=='CURRENT'?{video:{status:'PLANNED',time_s:frame/(side==='from'?fromSource:toSource).scene.fps,authority:'SCENE_FRAME_GRID_NOT_OBSERVED_MEDIA'}}:{})}}}));
  const proxySamples=frames.map(frame=>({role:frame.role,project_root:frame.project_root,frame_index:frame.frame_index,...sampleProxy((frame.role.startsWith('FROM_')?fromSource:toSource).scene,frame.frame_index/(frame.role.startsWith('FROM_')?fromSource:toSource).scene.fps,(frame.role.startsWith('FROM_')?fromSource:toSource).proxySampler),sampler_source:(frame.role.startsWith('FROM_')?fromSource:toSource).proxySamplerSource}));
  return {id:connection.id,kind:connection.kind,...(connection.transition_id?{transition_id:connection.transition_id}:{}),status,from,to,transition_scope:{from:transitionScope(fromSource.upstream,connection.transition_id),to:transitionScope(toSource.upstream,connection.transition_id)},clips,frames,contact_sheet:{...reference('contact-sheet.png'),layout:[['FROM_FIRST','FROM_LAST'],['TO_FIRST','TO_LAST']]},metadata_path:`${directory}/connection.json`,proxy_observation:{status:proxySamples.every(sample=>sample.status==='PROXY_SAMPLED')?'PROXY_SAMPLED':'NOT_RUN',scope:'PROXY_STATE_NOT_PIXEL_ACCEPTANCE',samples:proxySamples}};
}

async function extractConnection(record,sourceMap,staging){
  const directory=path.join(staging,path.dirname(record.metadata_path));await mkdir(directory,{recursive:true});
  for(const [i,side] of ['from','to'].entries()){
    const endpoint=record[side],source=sourceMap.get(endpoint.project_root),window=endpoint.window,clip=record.clips[i];
    await runMedia('ffmpeg',['-v','error','-nostdin','-i',source.videoFile,'-map','0:v:0','-an','-vf',`trim=start_frame=${window.first_frame_index}:end_frame=${window.last_frame_index+1},setpts=PTS-STARTPTS`,'-frames:v',String(window.frame_count),'-fps_mode','passthrough','-c:v','libx264','-preset','veryfast','-crf','12','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart','-y',path.join(staging,clip.path)]);
    await probeVideo(path.join(staging,clip.path),{fps:source.scene.fps,width:source.scene.width,height:source.scene.height,frames:window.frame_count});
    for(const frame of record.frames.filter(item=>item.project_root===endpoint.project_root&&item.role.startsWith(side.toUpperCase()+'_'))){
      await runMedia('ffmpeg',['-v','error','-nostdin','-i',source.videoFile,'-map','0:v:0','-an','-vf',`select=eq(n\\,${frame.frame_index})`,'-frames:v','1','-fps_mode','passthrough','-y',path.join(staging,frame.path)]);
    }
  }
  const inputArgs=record.frames.flatMap(frame=>['-i',path.join(staging,frame.path)]);
  const scale=record.frames.map((_,i)=>`[${i}:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`).join(';');
  await runMedia('ffmpeg',['-v','error','-nostdin',...inputArgs,'-filter_complex',scale+';[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|640_0|0_360|640_360[out]','-map','[out]','-frames:v','1','-y',path.join(staging,record.contact_sheet.path)]);
}

function expectedMedia(connections){return connections.flatMap(connection=>[...connection.clips,...connection.frames,connection.contact_sheet].map(item=>item.path).filter(Boolean)).sort()}
function manifestConnections(connections){return connections.map(connection=>({id:connection.id,clips:connection.clips.map(item=>item.path).filter(Boolean),frames:connection.frames.map(item=>item.path).filter(Boolean),contact_sheet:connection.contact_sheet.path||null,metadata:connection.metadata_path}))}

async function verifyPackage(directory,{identity,status,expected,documents,connections,priorManifestHash}){
  const changed=message=>new BoundaryError('PACKAGE_CHANGED',`${message} Preserve the existing package and choose a new --out directory after reviewing the damage.`);
  let manifestBytes,manifest;
  try{manifestBytes=await readFile(await assertRegularFile(directory,'package-manifest.json'));manifest=JSON.parse(manifestBytes.toString('utf8'))}catch(error){if(error instanceof BoundaryError)throw error;throw changed('The existing package manifest is missing or invalid.')}
  if(priorManifestHash&&digest(manifestBytes)!==priorManifestHash)throw changed('The package manifest differs from the last published report.');
  need(manifest.schema_version===PACKAGE_SCHEMA&&manifest.identity===identity&&manifest.status===status,'PACKAGE_CHANGED','The existing package identity/status does not match the selected source and plan.');
  need(Array.isArray(manifest.expected_files)&&same(manifest.expected_files,expected)&&same(manifest.connections,manifestConnections(connections)),'PACKAGE_CHANGED','The manifest does not cover the complete independently expected package.');
  need(Array.isArray(manifest.files)&&manifest.files.length===expected.length,'PACKAGE_CHANGED','The manifest file list is incomplete.');
  const names=new Set();
  for(const entry of manifest.files){safePackagePath(entry.path);need(!names.has(entry.path)&&expected.includes(entry.path)&&hex(entry.sha256),'PACKAGE_CHANGED','Duplicate, unexpected or invalid file/hash in the package manifest.');names.add(entry.path)}
  need(same([...names].sort(),expected)&&same(await listPackageFiles(directory),[...expected,'package-manifest.json'].sort()),'PACKAGE_CHANGED','Package files differ from the complete expected file set.');
  for(const entry of manifest.files){
    const file=await assertRegularFile(directory,entry.path),bytes=await readFile(file);
    need(digest(bytes)===entry.sha256,'PACKAGE_CHANGED',`Package file hash mismatch: ${entry.path}`);
    if(documents.has(entry.path))need(bytes.equals(documents.get(entry.path)),'PACKAGE_CHANGED',`Frozen metadata/source mismatch: ${entry.path}`);
  }
  return {manifest,manifestHash:digest(manifestBytes)};
}

async function assertSourcesStable(sourceMap,plan,planOnly){
  for(const source of sourceMap.values()){
    const after=await loadSource(source.root,{planOnly,probe:false});
    need(same(source.source,after.source)&&same(source.upstream?.transitions||null,after.upstream?.transitions||null)&&source.status===after.status,'SOURCE_CHANGED','Scene, rendering inputs, intake, transition dependencies, video or receipt changed during boundary extraction. The last report was retained.');
  }
  if(plan.file)need((await readFile(plan.file)).equals(plan.bytes),'PLAN_CHANGED','The boundary plan changed during extraction. The last report was retained.');
}

async function buildSelection(root,argument,planOnly){
    const prepared=await preparePlan(root,argument);validatePlan(prepared.plan);
    const sourceMap=new Map(),resolved=[];
    for(const connection of prepared.plan.connections){
      const endpoints={};
      for(const side of ['from','to']){
        const sourceRoot=await realpath(path.resolve(prepared.base,connection[side].project));
        if(!sourceMap.has(sourceRoot))sourceMap.set(sourceRoot,await loadSource(sourceRoot,{planOnly}));
        endpoints[side]=sourceMap.get(sourceRoot);
      }
      resolved.push(endpoints);
    }
    const status=planOnly?'PLANNED':'EXTRACTED';
    const planSource={mode:prepared.file?'PLAN_FILE':prepared.mode==='EXPLICIT_PLAN'?'INLINE_PLAN':'INTERNAL_CUTS_ONLY',path:prepared.file?relativeLink(root,prepared.file):null,sha256:prepared.bytes?digest(prepared.bytes):digest(jsonText(prepared.plan)),base_directory:prepared.base,...(!prepared.file&&prepared.mode==='EXPLICIT_PLAN'?{inline:prepared.plan}:{})};
    const connections=prepared.plan.connections.map((connection,index)=>connectionRecord(connection,index,resolved[index].from,resolved[index].to,status));
    for(const connection of connections)for(const side of ['from','to']){connection[side].plan_project_ref=connection[side].project;connection[side].project=relativeLink(root,connection[side].project_root)}
    for(const connection of connections)for(const side of ['from','to'])if(connection.transition_scope[side].status==='STALE_SOURCE'){
      if(!planOnly)throw new BoundaryError('STALE_SOURCE',`${connection.id}: upstream transition ${connection.transition_id} is stale for ${side}. Refresh that selected dependency before extracting media.`);
      connection.source_status='STALE_SOURCE';connection[side].source_status='STALE_SOURCE';
    }
    for(const connection of connections)if(connection.transition_id)for(const side of ['from','to'])if(!['CURRENT','STALE_SOURCE'].includes(connection.transition_scope[side].status)){
      if(!planOnly)throw new BoundaryError('UNVERIFIED_TRANSITION',`${connection.id}: explicit transition ${connection.transition_id} cannot be proven current for ${side}; choose an actual versioned record or omit the ID for a technical cut-only inspection.`);
      connection.source_status='UNVERIFIED_TRANSITION';connection[side].source_status='UNVERIFIED_TRANSITION';
    }
    const sources=[...sourceMap.values()].sort((a,b)=>a.root.localeCompare(b.root));
    const identity=digest(jsonText({schema_version:PACKAGE_SCHEMA,status,plan:prepared.plan,plan_source:planSource,effective_windows:connections.map(item=>({id:item.id,from:item.from.window,to:item.to.window})),selected_transitions:connections.map(item=>({id:item.id,scope:item.transition_scope})),selected_sources:sources.map(source=>({project_root:source.root,source:source.source,source_status:source.status}))}));
    const sourceLinks=sources.map((source,index)=>{
      const directory=`sources/${String(index+1).padStart(3,'0')}`;
      const packet=source.intake;
      return {project_root:source.root,source:source.source,status:source.status,scene_path:`${directory}/scene.json`,render_receipt_path:source.receiptBytes?`${directory}/render-receipt.json`:null,intake_path:source.intakeBytes?`${directory}/upstream-intake.json`:null,lineage:{...sourceLineage(source.upstream||packet,source.scene),formal_id:packet?.formal_id||source.receipt?.formal_id||null,prompt_version:packet?.prompt_version||source.receipt?.base_prompt_version||null,budget_version:packet?.budget_version||source.receipt?.budget_version||null,budget:packet?.budget||null},media:source.metrics,source_links:{scene:path.join(source.root,'scene.json'),video:source.videoFile,render_receipt:path.join(source.root,'renders/render-receipt.json'),intake:source.scene.upstream?.intake?path.resolve(source.root,source.scene.upstream.intake):null},...(source.upstreamError?{error:source.upstreamError}:{})};
    });
    const documents=new Map([['boundary-plan.json',jsonBytes(prepared.plan)],['boundary-metadata.json',jsonBytes({schema_version:REPORT_SCHEMA,identity,status,selection_mode:prepared.mode,plan_source:planSource,connections,source_links:sourceLinks,notice:'Extraction supplies source windows and proxy references only. Frame continuity, motion continuity, audio and final generation remain NOT_RUN. Default windows are configurable sampling choices, not acceptance criteria.',upstream_writes:false})]]);
    documents.set('index.html',Buffer.from(packageViewer(connections,status),'utf8'));
    connections.forEach(connection=>documents.set(connection.metadata_path,jsonBytes(connection)));
    sourceLinks.forEach((link,index)=>{const source=sources[index];documents.set(link.scene_path,Buffer.from(renderSceneText(source.scene)+'\n','utf8'));if(link.render_receipt_path)documents.set(link.render_receipt_path,source.receiptBytes);if(link.intake_path)documents.set(link.intake_path,source.intakeBytes)});
    const expected=[...documents.keys(),...expectedMedia(connections)].sort();need(new Set(expected).size===expected.length,'INVALID_PLAN','Generated package paths are not unique.');
    return {prepared,planSource,sourceMap,status,connections,sources,identity,sourceLinks,documents,expected};
}

/** Extract evidence from current rendered media. Does not render, edit, assemble or approve content. */
export async function exportBoundaryPack({project=DEFAULT_PROJECT,plan:argument,out,planOnly=false}={}){
  const root=await realpath(path.resolve(project)),lockPath=path.join(root,'.previs-boundary.lock');let lock,staging=null,stagingParent=null;
  try{lock=await open(lockPath,'wx')}catch(error){if(error.code==='EEXIST')throw new BoundaryError('BOUNDARY_BUSY','Another boundary operation is active. No previous report or package was changed.');throw error}
  try{
    const {prepared,planSource,sourceMap,status,connections,identity,sourceLinks,documents,expected}=await buildSelection(root,argument,planOnly);
    const destination=out?path.resolve(out):path.join(root,'review','boundary-packages',identity);
    const reportFile=path.join(root,'review','boundary-report.json');
    let priorManifestHash=null;
    if(await exists(reportFile))try{const previous=await readJson(reportFile);if(previous.identity===identity&&path.resolve(root,previous.package_directory)===destination)priorManifestHash=previous.package_manifest_sha256}catch{/* A damaged prior report is not reused as proof. */}
    let verified,reused=false;
    if(await exists(destination)){verified=await verifyPackage(destination,{identity,status,expected,documents,connections,priorManifestHash});reused=true}
    else{
      stagingParent=path.dirname(destination);await mkdir(stagingParent,{recursive:true});staging=path.join(stagingParent,`.boundary-${randomUUID()}`);await mkdir(staging);
      for(const [name,bytes] of documents){await mkdir(path.dirname(path.join(staging,name)),{recursive:true});await writeFile(path.join(staging,name),bytes,{flag:'wx'})}
      if(!planOnly){
        // Freeze bytes before FFmpeg reads them; an external writer cannot alter
        // a selected video halfway through extraction and restore it unnoticed.
        const frozen=new Map(),snapshotDirectory=path.join(staging,'.source-videos');await mkdir(snapshotDirectory);
        let sourceIndex=0;
        for(const [sourceRoot,source] of sourceMap){
          const snapshot=path.join(snapshotDirectory,`${++sourceIndex}.mp4`);await copyFile(source.videoFile,snapshot);
          need(await hashFile(snapshot)===source.source.video_sha256,'SOURCE_CHANGED','Source video changed while freezing extraction input. The last report was retained.');
          frozen.set(sourceRoot,{...source,videoFile:snapshot});
        }
        for(const connection of connections)await extractConnection(connection,frozen,staging);
        for(const source of frozen.values())await unlink(source.videoFile);await rmdir(snapshotDirectory);
      }
      const files=[];for(const name of expected)files.push({path:name,sha256:await hashFile(path.join(staging,name))});
      await writeFile(path.join(staging,'package-manifest.json'),jsonText({schema_version:PACKAGE_SCHEMA,identity,status,expected_files:expected,files,connections:manifestConnections(connections),upstream_writes:false}),{flag:'wx'});
      verified=await verifyPackage(staging,{identity,status,expected,documents,connections});
      await assertSourcesStable(sourceMap,prepared,planOnly);
      // rename never replaces an existing destination: packages are immutable evidence.
      need(!(await exists(destination)),'PACKAGE_EXISTS','The destination appeared during extraction; no existing package was overwritten.');
      await rename(staging,destination);staging=null;
    }
    await assertSourcesStable(sourceMap,prepared,planOnly);
    const evidence=planOnly?[]:[...verified.manifest.files.map(entry=>({path:relativeLink(root,path.join(destination,entry.path)),sha256:entry.sha256})),{path:relativeLink(root,path.join(destination,'package-manifest.json')),sha256:verified.manifestHash}];
    const report={schema_version:REPORT_SCHEMA,identity,status,selection_mode:prepared.mode,plan_source:planSource,package_directory:relativeLink(root,destination),package_manifest_sha256:verified.manifestHash,expected_files:expected,connections,source_links:sourceLinks,checks:{extraction:planOnly?NOT_RUN('PLAN_ONLY_NO_MEDIA_EXTRACTION'):{status:'PASS',scope:'SOURCE_MEDIA_WINDOW_EXTRACTION_ONLY',evidence},boundary_frame:NOT_RUN('SCOPED_BOUNDARY_FRAME_REVIEW'),boundary_motion:NOT_RUN('NORMAL_SPEED_NEIGHBORING_MOTION_REVIEW'),audio:NOT_RUN('SOURCE_AUDIO_AND_AUDIO_CONTINUITY')},notice:'from selects the last retained source frame; to selects the first retained source frame. Source windows are separate samples, never a new cut, formal segment, budget or assembled film. No semantic acceptance is implied.',upstream_writes:false};
    await writeJsonAtomic(reportFile,report);
    return {...report,report_path:reportFile,reused};
  }finally{
    try{if(staging){const resolvedStage=path.resolve(staging),resolvedParent=path.resolve(stagingParent);need(path.dirname(resolvedStage)===resolvedParent&&/^\.boundary-[a-f0-9-]+$/.test(path.basename(resolvedStage)),'UNSAFE_CLEANUP','Refusing to remove an unverified staging directory.');await rm(resolvedStage,{recursive:true,force:true})}}
    finally{if(lock){await lock.close();await unlink(lockPath)}}
  }
}

/** Read-only consumer validation. Throws BoundaryError on stale or damaged evidence. */
export async function validateBoundaryReport(project,report){
  const root=await realpath(path.resolve(project));
  need(object(report)&&report.schema_version===REPORT_SCHEMA&&['EXTRACTED','PLANNED'].includes(report.status),'INVALID_BOUNDARY_REPORT','Unsupported boundary report.');
  const selection=report.plan_source;
  need(object(selection)&&['PLAN_FILE','INLINE_PLAN','INTERNAL_CUTS_ONLY'].includes(selection.mode),'INVALID_BOUNDARY_REPORT','Boundary report has no independently reproducible plan selection.');
  let argument;
  if(selection.mode==='PLAN_FILE'){
    need(typeof selection.path==='string'&&selection.path&&hex(selection.sha256),'INVALID_BOUNDARY_REPORT','Missing selected plan path/hash.');
    argument=path.resolve(root,selection.path);
    need(await exists(argument),'PLAN_CHANGED','The selected boundary plan no longer exists.');
    need(await hashFile(argument)===selection.sha256,'PLAN_CHANGED','The selected boundary plan bytes changed; the old package and reviews are stale.');
  }else if(selection.mode==='INLINE_PLAN')argument=selection.inline;
  const selected=await buildSelection(root,argument,report.status==='PLANNED');
  need(selected.identity===report.identity&&same(selected.planSource,selection)&&same(selected.connections,report.connections)&&same(selected.sourceLinks,report.source_links),'STALE_BOUNDARY_REPORT','A selected project, source video, receipt, scene, render input, intake, transition dependency or plan changed.');
  need(same(report.expected_files,selected.expected)&&typeof report.package_directory==='string'&&report.package_directory&&hex(report.package_manifest_sha256),'INVALID_BOUNDARY_REPORT','The report has incomplete package coverage or a missing manifest hash.');
  const directory=path.resolve(root,report.package_directory);
  const verified=await verifyPackage(directory,{identity:selected.identity,status:selected.status,expected:selected.expected,documents:selected.documents,connections:selected.connections,priorManifestHash:report.package_manifest_sha256});
  for(const name of ['boundary_frame','boundary_motion','audio'])need(report.checks?.[name]?.status==='NOT_RUN'&&same(report.checks[name].evidence,[]),'INVALID_BOUNDARY_REPORT','An extraction report cannot claim perceptual, motion or audio acceptance. Record scoped human review separately.');
  const evidence=report.status==='PLANNED'?[]:[...verified.manifest.files.map(entry=>({path:relativeLink(root,path.join(directory,entry.path)),sha256:entry.sha256})),{path:relativeLink(root,path.join(directory,'package-manifest.json')),sha256:verified.manifestHash}];
  need(report.checks?.extraction?.status===(report.status==='EXTRACTED'?'PASS':'NOT_RUN')&&same(report.checks.extraction.evidence,evidence),'INVALID_BOUNDARY_REPORT','Extraction evidence coverage/status was altered.');
  await assertSourcesStable(selected.sourceMap,selected.prepared,report.status==='PLANNED');
  return {valid:true,status:report.status==='PLANNED'?'PLANNED':'CURRENT',identity:report.identity,package_directory:directory,package_manifest_sha256:verified.manifestHash,expected_files:selected.expected,scope:'ALL_SELECTED_PROJECTS_PLAN_AND_COMPLETE_PACKAGE',report};
}

async function cli(){
  const options={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i++){
    if(args[i]==='--plan-only')options.planOnly=true;
    else if(['--project','--plan','--out'].includes(args[i])){const key=args[i].slice(2);need(args[i+1]&&!args[i+1].startsWith('--'),'INVALID_ARGUMENT',`${args[i]} needs a value.`);options[key]=args[++i]}
    else if(args[i]==='--help'){console.log('node scripts/boundary-pack.mjs [--project DIR] [--plan PLAN.json] [--out NEW_DIR] [--plan-only]\nDefault: internal cuts only; omitted windows select whole frames nearest 0.2 seconds per source fps (minimum one frame). Explicit seconds must be frame-aligned. Explicit plan: PREVIS_BOUNDARY_PLAN_V1. No new render, edit, concatenation or semantic approval.');return}
    else throw new BoundaryError('INVALID_ARGUMENT',`Unsupported option: ${args[i]}`);
  }
  const result=await exportBoundaryPack(options);console.log(`${result.status}: ${result.package_directory}\nReport: ${result.report_path}\nViewer: ${result.package_directory}/index.html`);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)cli().catch(error=>{console.error(`${error.code||'BOUNDARY_FAILED'}: ${error.message}`);process.exitCode=1});