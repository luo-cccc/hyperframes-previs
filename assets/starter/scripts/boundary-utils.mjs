import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';

let mapSegmentTime,sampleActions;
if(await exists(new URL('../src/time-mapping.js',import.meta.url)))({mapSegmentTime}=await import('../src/time-mapping.js'));
if(await exists(new URL('../src/action-data.js',import.meta.url)))({sampleActions}=await import('../src/action-data.js'));

export class BoundaryError extends Error {
  constructor(code,message,details){super(message);this.name='BoundaryError';this.code=code;if(details!==undefined)this.details=details}
}
export function requireBoundary(condition,code,message,details){if(!condition)throw new BoundaryError(code,message,details)}
export const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const jsonText=value=>JSON.stringify(canonical(value),null,2)+'\n';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
export const slash=value=>value.split(path.sep).join('/');
export const relativeLink=(root,file)=>slash(path.relative(root,file))||'.';
export async function readJson(file){return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''))}
export async function exists(file){try{await lstat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
export function frameIndex(seconds,fps,label='time_s'){
  requireBoundary(finite(seconds)&&seconds>=0&&finite(fps)&&fps>0,'INVALID_TIME',`${label} must be a finite nonnegative number.`);
  const frames=seconds*fps,integer=Math.round(frames);
  requireBoundary(Number.isSafeInteger(integer)&&Math.abs(frames-integer)<1e-5,'OFF_FRAME_GRID',`${label}=${seconds} is not on the ${fps} fps frame grid. Choose an exact frame time; no rounding was applied.`);
  return integer;
}
export function safePackagePath(name){
  requireBoundary(typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!name.includes(':')&&!path.posix.isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'PACKAGE_CHANGED','Package paths must be unique, relative, forward-slash paths without traversal.');
  return name;
}
export async function listPackageFiles(directory){
  const files=[];
  async function walk(folder,prefix=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const name=prefix+entry.name;
      requireBoundary(!entry.isSymbolicLink(),'PACKAGE_CHANGED','Package symlinks are not supported.');
      if(entry.isDirectory())await walk(path.join(folder,entry.name),name+'/');
      else {requireBoundary(entry.isFile(),'PACKAGE_CHANGED','Package contains a non-file entry.');files.push(safePackagePath(name))}
    }
  }
  const info=await lstat(directory);requireBoundary(info.isDirectory()&&!info.isSymbolicLink(),'PACKAGE_CHANGED','The package must be a regular directory.');
  await walk(directory);return files.sort();
}
export async function assertRegularFile(directory,name){
  safePackagePath(name);let current=directory;
  for(const part of name.split('/')){current=path.join(current,part);const info=await lstat(current);requireBoundary(!info.isSymbolicLink(),'PACKAGE_CHANGED','Package paths may not pass through symlinks.')}
  const parent=await realpath(directory),absolute=await realpath(current),relative=path.relative(parent,absolute);
  requireBoundary(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)&&(await lstat(current)).isFile(),'PACKAGE_CHANGED','Package file escaped the package directory.');
  return current;
}
export function runMedia(command,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',settled=false;
    const timer=setTimeout(()=>{child.kill();finish(new BoundaryError('MEDIA_COMMAND_FAILED',`${command} exceeded the extraction time limit.`))},120_000);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)}
    child.stdout.on('data',data=>{stdout+=data;if(stdout.length>64*1024*1024){child.kill();finish(new BoundaryError('MEDIA_COMMAND_FAILED',`${command} output exceeded the supported limit.`))}});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-16_384)});
    child.on('error',error=>finish(new BoundaryError('MEDIA_TOOL_UNAVAILABLE',`${command}: ${error.message}`)));
    child.on('close',code=>finish(code===0?null:new BoundaryError('MEDIA_COMMAND_FAILED',`${command} exited ${code}: ${stderr.trim()}`),stdout));
  });
}
const rate=value=>{const [n,d=1]=String(value).split('/').map(Number);return n/d};
export async function probeVideo(file,{fps,width,height,frames}={}){
  const text=await runMedia('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_frames','-show_entries','stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,nb_frames,start_time,duration:frame=best_effort_timestamp_time:format=duration','-of','json',file]);
  let data;try{data=JSON.parse(text)}catch{throw new BoundaryError('INVALID_MEDIA','ffprobe did not return valid JSON.')}
  const stream=data.streams?.[0],samples=data.frames||[];
  requireBoundary(data.streams?.length===1&&stream&&samples.length>0,'INVALID_MEDIA','The source must contain an actual decodable video stream.');
  const actualFps=rate(stream.r_frame_rate),average=rate(stream.avg_frame_rate),count=Number(stream.nb_read_frames),first=Number(samples[0].best_effort_timestamp_time);
  requireBoundary(finite(actualFps)&&actualFps>0&&finite(average)&&Math.abs(actualFps-average)<1e-5&&count===samples.length&&finite(first),'INVALID_MEDIA','A constant frame rate and complete decodable frame count are required.');
  for(let i=0;i<samples.length;i++)requireBoundary(Math.abs((Number(samples[i].best_effort_timestamp_time)-first)*actualFps-i)<.005,'INVALID_MEDIA','Video timestamps are not on a constant frame grid.');
  requireBoundary((fps===undefined||Math.abs(actualFps-fps)<1e-5)&&(frames===undefined||count===frames)&&(width===undefined||stream.width===width)&&(height===undefined||stream.height===height),'MEDIA_SPEC_MISMATCH','Video fps, frame count or dimensions differ from the declared scene/window.');
  return {fps:actualFps,frame_rate:stream.r_frame_rate,frame_count:count,width:stream.width,height:stream.height,first_pts_s:first,duration_s:count/actualFps};
}
export function sampleClocks(scene,receipt,time_s){
  const unknown=reason=>({status:'UNKNOWN',time_s:null,reason});
  const known=(value,authority)=>({status:'KNOWN',time_s:value,authority});
  const video=known(time_s,'SELECTED_SOURCE_VIDEO_FRAME_INDEX');
  const segment=known(time_s,'SCENE_SEGMENT_CLOCK');
  let source=unknown('No explicit external material clock mapping.'),timeline=unknown('No explicit assembled timeline mapping; this tool does not assemble a film.');
  if(typeof mapSegmentTime==='function'){
    const mapped=mapSegmentTime(scene,time_s);
    if(finite(mapped.source_time_s))source={...known(mapped.source_time_s,'PREVIS_TIME_MAPPING_V1'),input_id:mapped.input_id,formal_id:mapped.formal_id,source_version:mapped.source_version};
    if(finite(mapped.edit_time_s))timeline=known(mapped.edit_time_s,'PREVIS_TIME_MAPPING_V1');
  }
  // An optional frozen render-receipt mapping can also establish external clocks.
  const mapping=receipt?.boundary_time_mapping;
  if(mapping?.schema_version==='PREVIS_BOUNDARY_CLOCKS_V1'){
    if(finite(mapping.source_offset_s)&&source.status==='UNKNOWN')source=known(time_s+mapping.source_offset_s,'render-receipt.boundary_time_mapping.source_offset_s');
    if(finite(mapping.timeline_offset_s)&&timeline.status==='UNKNOWN')timeline=known(time_s+mapping.timeline_offset_s,'render-receipt.boundary_time_mapping.timeline_offset_s');
  }
  return {video,source,segment,timeline};
}
export function sampleProxy(scene,time_s,sampler=sampleActions){
  if(typeof sampler!=='function')return {status:'NOT_RUN',scope:'PROXY_ACTION_AND_HAND_STATE',notice:'No pure action sampler is available.'};
  return {status:'PROXY_SAMPLED',scope:'PROXY_GEOMETRY_HAND_PHASE_ONLY',notice:'Pure mannequin targets describe proxy state only. Rendered pixel semantics, reach, contact and continuity acceptance remain NOT_RUN.',sample:sampler(scene,time_s)};
}
export function transitionScope(upstream,id){
  const state=upstream?.transitions;
  if(!id)return {status:'NOT_CHECKED',scope:'NO_EXPLICIT_TRANSITION_ID',notice:'Internal cut extraction does not establish the validity of unspecified upstream transitions.'};
  if(!state)return {status:'NOT_AVAILABLE',scope:'EXPLICIT_TRANSITION_ID',transition_id:id,notice:'No transition dependency status was supplied; extraction is technical evidence only.'};
  const records=Array.isArray(state.connections)?state.connections:Array.isArray(state.items)?state.items:Array.isArray(state.transitions)?state.transitions:[];
  const selected=records.find(item=>(item.transition_id||item.id)===id);
  const scopedRecords=context=>{
    if(!context)return [];
    const result=[];
    for(const collection of ['plans','reviews'])for(const [index,record] of (context[collection]||[]).entries())if((record.transition_id||record.id)===id){
      const dependencies=(context.endpoint_dependencies||[]).filter(item=>item.collection===collection&&item.record_index===index).map(item=>item.endpoints);
      result.push({collection,record,dependencies});
    }
    return result;
  };
  const expected=scopedRecords(upstream.packet?.transition_context),current=scopedRecords(state.context);
  if(expected.length||current.length){
    const unchanged=jsonText(expected)===jsonText(current);
    return {status:unchanged?'CURRENT':'STALE_SOURCE',scope:'SELECTED_TRANSITION_RECORDS_AND_ENDPOINTS',transition_id:id,expected_sha256:digest(jsonText(expected)),current_sha256:digest(jsonText(current))};
  }
  const staleIds=state.stale_ids||state.stale_transition_ids;
  const relevantStale=selected?.status==='STALE'||(Array.isArray(staleIds)&&staleIds.includes(id));
  const scopedCurrent=selected&&['CURRENT','PASS','VALID'].includes(selected.status);
  const stale=relevantStale||(state.status==='STALE'&&!scopedCurrent&&(!Array.isArray(staleIds)||staleIds.includes(id)));
  return {status:stale?'STALE_SOURCE':scopedCurrent?'CURRENT':'NOT_DECLARED',scope:stale&&!selected?'AGGREGATE_STALE_DEPENDENCIES_NO_PER_ID_PROOF':'EXPLICIT_TRANSITION_ID',transition_id:id,...(selected?{dependency:selected}:{}),...(!selected?{notice:'No per-ID dependency record could be proven; an aggregate stale status is conservatively blocking for an explicit transition.'}:{})};
}

/** Stable consumer entry point; late import avoids a static utility/extractor cycle. */
export async function validateBoundaryReport(project,report){
  const module=await import('./boundary-pack.mjs');
  return module.validateBoundaryReport(project,report);
}
