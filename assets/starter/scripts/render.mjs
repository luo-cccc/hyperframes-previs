import { spawnSync } from 'node:child_process';
import { readFile,mkdir,stat,open,rename,unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256,checkUpstream } from './check-upstream.mjs';
import { sourceFingerprint } from './source-fingerprint.mjs';
import { writeJsonAtomic } from './atomic-file.mjs';
import { sourceContext } from './source-context.mjs';
import {renderSceneText} from '../src/render-identity.js';
import {ADAPTER_VERSION} from './adapter-version.mjs';
import {sourceLineage} from './source-lineage.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const options=process.argv.slice(2),extra=[];
for(let i=0;i<options.length;i++){
  if(['--no-browser-gpu','--browser-gpu'].includes(options[i]))extra.push(options[i]);
  else if(options[i]==='--quality'&&['draft','looks','delivery','standard','high'].includes(options[i+1]))extra.push(options[i],options[++i]);
  else throw new Error('Supported export options: --no-browser-gpu, --browser-gpu, --quality draft|looks|delivery|standard|high.');
}
const run=(args)=>{const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error(`Command failed: ${result.status}`)};
const id=randomUUID(),directory=path.join(root,'renders'),video=path.join(directory,'previs.mp4');
const staged=path.join(directory,`.previs-${id}.mp4`),previous=path.join(directory,`.previous-${id}.mp4`);
const lockFile=path.join(root,'.previs-render.lock'),attemptFile=path.join(directory,'render-attempt.json');
let lock,oldMoved=false,published=false;
try{lock=await open(lockFile,'wx')}
catch(error){if(error.code==='EEXIST')throw new Error('Another export is active for this project. Wait for it to finish; no existing video was replaced.');throw error}
const attempt={schema_version:'PREVIS_RENDER_ATTEMPT_V1',attempt_id:id,status:'RUNNING',started_at:new Date().toISOString()};
try{
  await mkdir(directory,{recursive:true});await writeJsonAtomic(attemptFile,attempt);
  run([path.join(root,'scripts/validate.mjs')]);
  const sceneBytes=await readFile(path.join(root,'scene.json')),scene=JSON.parse(sceneBytes.toString('utf8'));
  const upstream=await checkUpstream(root,scene),fingerprint=await sourceFingerprint(root);
  const context=await sourceContext(root,upstream);
  run([path.join(root,'node_modules/hyperframes/bin/hyperframes.mjs'),'render','.', '--workers','1',...extra,'-o',staged]);
  const currentScene=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8'));
  if(renderSceneText(currentScene)!==renderSceneText(scene))throw new Error('Rendered scene content changed during export. The previous successful video was retained.');
  if((await sourceFingerprint(root)).sha256!==fingerprint.sha256)throw new Error('Rendering code/assets changed during export. The previous successful video was retained.');
  await checkUpstream(root,currentScene);
  if((await stat(staged)).size===0)throw new Error('Rendered video is empty.');
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames:format=duration','-of','json',staged],{encoding:'utf8'});
  const metrics=probe.status===0?JSON.parse(probe.stdout):null;
  if(probe.error&&probe.error.code!=='ENOENT')throw probe.error;
  if(metrics){
    const streams=metrics.streams.filter(stream=>stream.codec_type==='video');
    if(streams.length!==1)throw new Error('Media probe did not find exactly one video stream.');
    const stream=streams[0],[n,d]=String(stream.r_frame_rate).split('/').map(Number),fps=n/d;
    if(stream.width!==scene.width||stream.height!==scene.height||Math.abs(fps-scene.fps)>.0001||Number(stream.nb_frames)!==Math.round(scene.duration*scene.fps)||Math.abs(Number(metrics.format.duration)-scene.duration)>.5/scene.fps)throw new Error('Exported duration, dimensions, fps or frame count differs from the declared scene.');
  }else if(!probe.error&&probe.status!==0)throw new Error('ffprobe failed to inspect the exported media: '+probe.stderr);
  const receipt={type:'PREVIS_RENDER',render_identity:'PREVIS_RENDER_CONTENT_V2',scope:'PREVIS_CAMERA_BLOCKING',adapter_version:ADAPTER_VERSION,attempt_id:id,render_status:'COMPLETED',source_time_basis:'SEGMENT',source_lineage:sourceLineage(upstream,scene),sourceContext:context,rendered_at:new Date().toISOString(),scene_sha256:sha256(renderSceneText(scene)),scene_file_sha256:sha256(sceneBytes),render_inputs_sha256:fingerprint.sha256,render_inputs:fingerprint.files,intake_sha256:upstream?.intakeSha256||null,formal_id:upstream?.packet.formal_id||null,base_prompt_version:upstream?.packet.prompt_version||null,budget_version:upstream?.packet.budget_version||null,video:'previs.mp4',video_sha256:sha256(await readFile(staged)),metrics,media_metrics_status:metrics?'CHECKED':'NOT_RUN',source_duration_s:scene.duration,semantic_review:'NOT_RUN',final_model_media_review:'NOT_RUN',upstream_writes:false};
  try{await rename(video,previous);oldMoved=true}catch(error){if(error.code!=='ENOENT')throw error}
  try{await rename(staged,video);await writeJsonAtomic(path.join(directory,'render-receipt.json'),receipt);published=true}
  catch(error){
    if(oldMoved){try{await unlink(video)}catch(cleanup){if(cleanup.code!=='ENOENT')console.warn(cleanup.message)}await rename(previous,video);oldMoved=false}
    throw error;
  }
  attempt.status='COMPLETED';attempt.completed_at=new Date().toISOString();
  try{await writeJsonAtomic(attemptFile,attempt)}catch(error){console.warn('Video and receipt were published, but the attempt log could not be updated: '+error.message)}
  console.log(`Render and receipt published. Media format: ${receipt.media_metrics_status}; semantic/final-model review remains separate.`);
}catch(error){
  attempt.status='FAILED';attempt.failed_at=new Date().toISOString();attempt.error=error.message;
  try{await writeJsonAtomic(attemptFile,attempt)}catch(logError){console.warn(logError.message)}
  throw error;
}finally{
  for(const file of [staged,...(published?[previous]:[])])try{await unlink(file)}catch(error){if(error.code!=='ENOENT')console.warn(error.message)}
  try{await lock.close();await unlink(lockFile)}catch(error){console.warn('Export lock cleanup failed: '+error.message)}
}
