import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScene } from '../src/scene-data.js';
import { checkUpstream,sha256 } from './check-upstream.mjs';
import { sourceFingerprint } from './source-fingerprint.mjs';
import { sourceContext } from './source-context.mjs';
import {renderSceneText} from '../src/render-identity.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const destination=path.join(root,'handoff');
async function optionalJson(file){
  try{return JSON.parse(await readFile(file,'utf8'))}
  catch(error){if(error.code==='ENOENT')return null;throw error}
}
const sceneBytes=await readFile(path.join(root,'scene.json'));
const scene=JSON.parse(sceneBytes.toString('utf8'));
const problems=validateScene(scene);if(problems.length)throw new Error(problems.join('\n'));
const upstream=await checkUpstream(root,scene);
const context=await sourceContext(root,upstream);
let videoExists=false;
try{videoExists=(await stat(path.join(root,'renders/previs.mp4'))).isFile()}
catch(error){if(error.code!=='ENOENT')throw error}
const receipt=await optionalJson(path.join(root,'renders/render-receipt.json'));
const review=upstream?await optionalJson(path.join(root,'adapter-review.json')):null;
const spatialReport=await optionalJson(path.join(root,'review/spatial-report.json'));
const sceneHash=sha256(renderSceneText(scene)),fingerprint=await sourceFingerprint(root);
const videoHash=videoExists?sha256(await readFile(path.join(root,'renders/previs.mp4'))):null;
const spatialCurrent=Boolean(spatialReport?.render_identity==='PREVIS_RENDER_CONTENT_V2'&&spatialReport.scene_sha256===sceneHash&&spatialReport.render_inputs_sha256===fingerprint.sha256&&spatialReport.intake_sha256===(upstream?.intakeSha256||null));
const spatial={status:spatialCurrent?spatialReport.status:'NOT_RUN_OR_STALE',scope:'SAMPLED_PROXY_GEOMETRY',report:spatialCurrent?'../review/spatial-report.json':null,...(spatialCurrent?{counts:spatialReport.counts,sampling:spatialReport.sampling}:{})};
const fresh=Boolean(videoExists&&receipt?.render_status==='COMPLETED'&&receipt.render_identity==='PREVIS_RENDER_CONTENT_V2'&&
  receipt.scene_sha256===sceneHash&&receipt.render_inputs_sha256===fingerprint.sha256&&
  receipt.intake_sha256===(upstream?.intakeSha256||null)&&receipt.video_sha256===videoHash);
const manifest={
  schemaVersion:1,title:scene.title,referenceVideo:fresh?'../renders/previs.mp4':null,
  videoStatus:fresh?'verified-render-current-inputs':videoExists?'unverified-or-stale':'not-rendered',
  spec:{duration:scene.duration,width:scene.width,height:scene.height,fps:scene.fps},
  coordinates:'metres, Y up, -Z forward',timeBasis:'SEGMENT',
  actors:scene.actors.map(a=>({id:a.id,role:a.role,previsColor:a.color,...(scene.assetBindings?.find(b=>b.actorId===a.id)||{appearanceReference:null,referenceStatus:'unbound'})})),
  sceneReference:null,shots:scene.shots,upstream:scene.upstream||null,sourceContext:context,spatial,
  sourceReferenceBase:upstream?path.relative(destination,upstream.file).replaceAll(path.sep,'/'):null,
  adaptationMap:scene.adaptationMap||null,
  scope:'Camera, blocking and timing reference. Appearance and detailed performance require separately bound references.'
};
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const csv='\uFEFF'+[['id','start_s','end_s','duration_s','beat'],...scene.shots.map(s=>[s.id,s.start,s.end,s.end-s.start,s.beat])].map(row=>row.map(quote).join(',')).join('\r\n');
const binding=scene.actors.map(a=>`- ${a.id}（${a.role}）：预演色标 ${a.color}；上游资产 ${scene.assetBindings?.find(b=>b.actorId===a.id)?.assetId||'未绑定'}。`).join('\n');
const outputs=new Map([['shots.csv',csv]]);
if(upstream){
  outputs.set('prompts.md',upstream.packet.master.text);
  outputs.set('reference-attachments.md',`# 三维预演参考附件\n\n正式段：${upstream.packet.formal_id}；母稿：${upstream.packet.prompt_version}；预算：${upstream.packet.budget_version}。\n\n${binding}\n\n预演视频只承载镜头、相对空间、动作时序与揭示边界。人物外观与场景质感继续按上游有效资产；不继承简化模型、审片控件或辅助线。prompts.md 是上游母稿的逐字副本，模型提交格式继续由上游对应模型适配处理。\n\n视频状态：${manifest.videoStatus}。素材图片存在、已读取、平台已接收和效果已验证分别登记；本地导出不代表已经提交下游生成模型。\n`);
  outputs.set('adaptation-map.json',JSON.stringify(scene.adaptationMap,null,2)+'\n');
  const evidence=typeof review?.evidence==='string'?review.evidence.trim():Array.isArray(review?.evidence)&&review.evidence.some(value=>typeof value==='string'&&value.trim());
  const reviewCurrent=Boolean(fresh&&review?.schema_version==='PREVIS_REVIEW_V1'&&
    ['CHECKED','PASS','FAIL'].includes(review.status)&&evidence&&
    review.scene_sha256===sceneHash&&review.intake_sha256===upstream.intakeSha256&&
    review.render_inputs_sha256===fingerprint.sha256&&review.video_sha256===videoHash);
  const result={
    ...(fresh?receipt:{render_status:manifest.videoStatus}),scope:'PREVIS_CAMERA_BLOCKING',adapter_version:'0.4.0',
    formal_id:upstream.packet.formal_id,base_prompt_version:upstream.packet.prompt_version,budget_version:upstream.packet.budget_version,
    source_time_basis:'SEGMENT',sources:upstream.packet.sources,sourceContext:context,structural_checks:'PASS',
    semantic_review:reviewCurrent?review:'NOT_RUN',review_reuse_status:reviewCurrent?'CURRENT':review?'STALE_OR_INCOMPLETE':'NOT_RUN',
    unimplemented:reviewCurrent?review.unimplemented||[]:['Detailed action, speech, audio and narrative semantics require actual scoped review.'],
    upstream_revision_required:reviewCurrent&&typeof review.upstream_revision_required==='boolean'?review.upstream_revision_required:null,
    spatial,final_model_media_review:'NOT_RUN',upstream_writes:false
  };
  outputs.set('previs-receipt.json',JSON.stringify(result,null,2)+'\n');
}else{
  outputs.set('demo-notes.md',`# ${scene.title} · 运行时演示\n\n此工程没有绑定上游正式段，不能作为正式母稿或模型提交稿。\n\n${binding}\n\n`+scene.shots.map(s=>`- ${s.id}: ${s.start}–${s.end} 秒；${s.beat}`).join('\n')+'\n');
}
outputs.set('manifest.json',JSON.stringify(manifest,null,2)+'\n');
// Resolve and validate all inputs before touching a previous handoff bundle.
await mkdir(destination,{recursive:true});
for(const [name,contents] of outputs)await writeFile(path.join(destination,name),contents,'utf8');
console.log(`Handoff written to ${destination}; video ${manifest.videoStatus}; upstream writes false.`);
