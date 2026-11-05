import {mkdir,readFile,open,unlink,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {readProject,projectError} from './project-store.mjs';
import {checkUpstream,sha256} from './check-upstream.mjs';
import {sourceFingerprint} from './source-fingerprint.mjs';
import {writeJsonAtomic,writeAtomic} from './atomic-file.mjs';
import {validateScene} from '../src/scene-data.js';

const STORE_SCHEMA='PREVIS_ANNOTATIONS_V1';
const MAX_PNG_BYTES=5*1024*1024,MAX_PIXELS=16_777_216;
const STATUSES=new Set(['OPEN','RESOLVED','VERIFIED']);
const EMPTY_STORE=JSON.stringify({schema_version:STORE_SCHEMA,annotations:[]},null,2)+'\n';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(status,code,message,details)=>{throw projectError(status,code,message,details)};
const need=(condition,code,message)=>{if(!condition)fail(400,code,message)};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const location=root=>path.join(root,'review','annotations.json');

async function readStore(root){
  let bytes;
  try{bytes=await readFile(location(root))}catch(error){if(error.code!=='ENOENT')throw error;bytes=Buffer.from(EMPTY_STORE)}
  let value;try{value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))}catch{fail(409,'INVALID_ANNOTATION_STORE','The annotation file is not valid JSON; preserve it and recover the last valid version before writing.')}
  need(value?.schema_version===STORE_SCHEMA&&Array.isArray(value.annotations),'INVALID_ANNOTATION_STORE','Unsupported annotation store format.');
  const ids=new Set();
  for(const item of value.annotations){
    need(item&&typeof item==='object'&&typeof item.id==='string'&&!ids.has(item.id)&&STATUSES.has(item.status),'INVALID_ANNOTATION_STORE','Annotation IDs/statuses are missing or inconsistent.');
    need(typeof item.text==='string'&&item.text.trim()&&Array.isArray(item.history)&&item.source&&hex(item.source.scene_revision)&&hex(item.source.render_inputs_sha256)&&(item.source.intake_sha256===null||hex(item.source.intake_sha256)),'INVALID_ANNOTATION_STORE','Annotation history or source provenance is missing; recover the original evidence file before writing.');
    need(finite(item.time)&&Number.isInteger(item.frame_index)&&typeof item.shotId==='string'&&item.point&&finite(item.point.x)&&finite(item.point.y),'INVALID_ANNOTATION_STORE','Annotation capture coordinates or timeline references are invalid.');
    if(item.status==='VERIFIED')need(typeof item.verificationEvidence==='string'&&item.verificationEvidence.trim(),'INVALID_ANNOTATION_STORE','A VERIFIED annotation must retain its explicit verification evidence.');
    ids.add(item.id);
  }
  return {store:value,revision:sha256(bytes)};
}

async function withStoreLock(root,operation){
  const lockFile=path.join(root,'.previs-review.lock');let lock;
  try{lock=await open(lockFile,'wx')}
  catch(error){if(error.code==='EEXIST')fail(409,'REVIEW_BUSY','Another annotation operation is running. No feedback was overwritten; retry after it finishes.');throw error}
  try{return await operation()}
  finally{
    try{await lock.close();await unlink(lockFile)}catch(error){console.warn('Annotation lock cleanup failed: '+error.message)}
  }
}

function checkRevision(actual,expected,code,label,required=true){
  if(expected===undefined&&!required)return;
  need(hex(expected),'REVISION_REQUIRED',`${label} revision is required; refresh the page first.`);
  if(actual!==expected)fail(409,code,`${label} changed in another page. Read the latest data and review it before retrying.`);
}

async function currentSource(root,{strict=false}={}){
  const current=await readProject(root);
  const source={scene_revision:current.revision,render_inputs_sha256:null,intake_sha256:null,valid:true,error:null};
  try{
    const errors=validateScene(current.scene);if(errors.length)fail(400,'INVALID_SCENE',errors.join('\n'));
    const upstream=await checkUpstream(root,current.scene);
    source.intake_sha256=upstream?.intakeSha256||null;
    source.render_inputs_sha256=(await sourceFingerprint(root)).sha256;
  }catch(error){source.valid=false;source.error=error.message;if(strict)throw error}
  return {...current,source};
}

async function assertSourceStable(root,snapshot){
  const after=await currentSource(root,{strict:true});
  if(after.revision!==snapshot.revision||after.source.render_inputs_sha256!==snapshot.source.render_inputs_sha256||after.source.intake_sha256!==snapshot.source.intake_sha256)
    fail(409,'CAPTURE_SOURCE_CHANGED','Scene, code, assets or upstream input changed during the annotation operation. Capture the current frame again.');
}

const CRC_TABLE=Array.from({length:256},(_,index)=>{
  let c=index;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}

function decodePng(base64,expectedWidth,expectedHeight){
  need(typeof base64==='string'&&base64.length,'PNG_REQUIRED','A canvas PNG capture is required.');
  const encoded=base64.startsWith('data:image/png;base64,')?base64.slice('data:image/png;base64,'.length):base64;
  need(encoded.length<=Math.ceil(MAX_PNG_BYTES/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),'INVALID_PNG','Capture must be a base64 PNG no larger than 5 MiB.');
  const bytes=Buffer.from(encoded,'base64');
  need(bytes.length>=57&&bytes.length<=MAX_PNG_BYTES&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'INVALID_PNG','Capture has no valid PNG signature or exceeds 5 MiB.');
  let offset=8,width,height,channels,seenHeader=false,seenData=false,endedData=false,ended=false;
  const compressed=[];
  while(offset<bytes.length){
    need(offset+12<=bytes.length,'INVALID_PNG','Capture contains a truncated PNG chunk.');
    const length=bytes.readUInt32BE(offset),end=offset+12+length;
    need(end<=bytes.length,'INVALID_PNG','Capture contains a truncated PNG chunk.');
    const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);
    need(/^[A-Za-z]{4}$/.test(type)&&crc32(bytes.subarray(offset+4,offset+8+length))===bytes.readUInt32BE(offset+8+length),'INVALID_PNG','Capture has an invalid PNG chunk or checksum.');
    if(!seenHeader){
      need(type==='IHDR'&&length===13,'INVALID_PNG','PNG must begin with one IHDR chunk.');
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      need(width===expectedWidth&&height===expectedHeight,'CAPTURE_SIZE_MISMATCH','PNG dimensions do not match the current clean video canvas.');
      need(width>0&&height>0&&width*height<=MAX_PIXELS,'INVALID_PNG','Capture pixel count exceeds the supported limit.');
      need(data[8]===8&&[2,6].includes(data[9])&&data[10]===0&&data[11]===0&&data[12]===0,'UNSUPPORTED_PNG','Capture must be a non-interlaced 8-bit RGB/RGBA canvas PNG.');
      channels=data[9]===6?4:3;seenHeader=true;
    }else if(type==='IHDR')fail(400,'INVALID_PNG','PNG has duplicate IHDR chunks.');
    else if(type==='IDAT'){need(!ended&&!endedData,'INVALID_PNG','PNG image-data chunks must be consecutive.');compressed.push(data);seenData=true}
    else if(type==='IEND'){need(length===0&&seenData&&end===bytes.length,'INVALID_PNG','PNG end chunk is invalid or has trailing bytes.');ended=true;offset=end;break}
    else{
      need(!['APNG','acTL','fcTL','fdAT'].includes(type),'UNSUPPORTED_PNG','Animated PNG is not a single-frame capture.');
      need(type==='PLTE'||type[0]===type[0].toLowerCase(),'UNSUPPORTED_PNG','PNG contains an unsupported critical chunk.');
      if(type==='PLTE')need(!seenData&&length>0&&length<=768&&length%3===0,'INVALID_PNG','PNG palette is malformed or occurs after image data.');
      if(seenData)endedData=true;
    }
    offset=end;
  }
  need(ended&&seenData,'INVALID_PNG','PNG is missing image data or its end chunk.');
  const expectedLength=(width*channels+1)*height;let decoded;
  try{decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expectedLength})}catch{fail(400,'INVALID_PNG','PNG compressed pixels cannot be decoded within its declared dimensions.')}
  need(decoded.length===expectedLength,'INVALID_PNG','PNG pixel data does not match its declared dimensions.');
  for(let row=0;row<height;row++)need(decoded[row*(width*channels+1)]<=4,'INVALID_PNG','PNG has an unsupported scanline filter.');
  return {bytes,width,height,sha256:sha256(bytes)};
}

function captureTarget(scene,frame){
  need(frame&&typeof frame==='object','FRAME_REQUIRED','A clean camera frame and a normalized point are required.');
  need(frame.view==='camera','CAMERA_VIEW_REQUIRED','Capture feedback from the formal camera view; free/top inspection views are not submission frames.');
  need(Number.isInteger(frame.width)&&Number.isInteger(frame.height)&&frame.width===scene.width&&frame.height===scene.height,'CAPTURE_SIZE_MISMATCH','Capture dimensions must match the clean video canvas.');
  need(finite(frame.time)&&frame.time>=0&&frame.time<scene.duration,'FRAME_OUTSIDE_TIMELINE','Capture time must be within the segment, before its exclusive end.');
  const index=Math.round(frame.time*scene.fps);
  need(Math.abs(frame.time*scene.fps-index)<1e-5,'OFF_FRAME_CAPTURE','Capture time must lie on the declared frame grid.');
  const time=index/scene.fps,shot=scene.shots.find(item=>time>=item.start&&time<item.end);
  need(shot&&frame.shotId===shot.id,'CAPTURE_SHOT_MISMATCH','The capture shot does not match the segment time.');
  need(frame.point&&finite(frame.point.x)&&finite(frame.point.y)&&frame.point.x>=0&&frame.point.x<=1&&frame.point.y>=0&&frame.point.y<=1,'INVALID_CAPTURE_POINT','Capture point must use normalized canvas coordinates between 0 and 1.');
  const objectId=frame.objectId??null;
  need(objectId===null||typeof objectId==='string','INVALID_OBJECT_ID','Object ID must be null or a known stable scene ID.');
  if(objectId!==null){
    const known=[...scene.actors.map(actor=>actor.id),...(scene.door?['door']:[]),...(scene.spatial?.obstacles||[]).map(item=>item.id)];
    need(known.includes(objectId),'UNKNOWN_CAPTURE_OBJECT','The selected object ID does not exist in this scene.');
  }
  return {time,frame_index:index,shotId:shot.id,objectId,view:'camera',point:{x:frame.point.x,y:frame.point.y}};
}

function checkText(value,label,max){need(typeof value==='string'&&value.trim().length&&value.length<=max,'INVALID_TEXT',`${label} must contain between 1 and ${max} characters.`);return value}

async function saveCapture(root,png){
  const relative=`review/frames/${png.sha256}.png`,file=path.join(root,relative);
  await mkdir(path.dirname(file),{recursive:true});
  try{const handle=await open(file,'wx');try{await handle.writeFile(png.bytes);await handle.sync()}finally{await handle.close()}}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    if(!(await readFile(file)).equals(png.bytes))fail(409,'CAPTURE_INTEGRITY_MISMATCH','An existing capture file was altered. Preserve the evidence and recover it before adding this image.');
  }
  return relative;
}

async function captureIntegrity(root,item){
  if(typeof item.png_ref!=='string'||!/^review\/frames\/[a-f0-9]{64}\.png$/.test(item.png_ref)||!hex(item.png_sha256))return 'INVALID_REFERENCE';
  try{return sha256(await readFile(path.join(root,item.png_ref)))===item.png_sha256?'AVAILABLE':'HASH_MISMATCH'}
  catch(error){if(error.code==='ENOENT')return 'MISSING';throw error}
}

async function decorate(root,item,current){
  const reasons=[];
  if(!current.source.valid)reasons.push('SOURCE_INVALID');
  if(item.source?.render_inputs_sha256!==current.source.render_inputs_sha256)reasons.push('RENDER_INPUTS_CHANGED');
  if(item.source?.intake_sha256!==current.source.intake_sha256)reasons.push('INTAKE_CHANGED');
  const integrity=await captureIntegrity(root,item);if(integrity!=='AVAILABLE')reasons.push('CAPTURE_'+integrity);
  return {...structuredClone(item),stale:reasons.length>0,stale_reasons:reasons,capture_integrity:integrity};
}

export async function createAnnotation(root,request){
  return withStoreLock(root,async()=>{
    const saved=await readStore(root);checkRevision(saved.revision,request?.expectedAnnotationsRevision,'ANNOTATIONS_REVISION_CONFLICT','Annotations',false);
    const current=await currentSource(root,{strict:true});checkRevision(current.revision,request?.expectedRevision,'REVISION_CONFLICT','Scene');
    checkRevision(current.source.render_inputs_sha256,request?.expectedRenderInputsSha256,'CAPTURE_SOURCE_CHANGED','Captured render inputs');
    need(request?.expectedIntakeSha256===null||hex(request?.expectedIntakeSha256),'CAPTURE_INTAKE_REQUIRED','Capture must identify its upstream intake, or explicit null for demonstration. Refresh and capture again.');
    if(request.expectedIntakeSha256!==current.source.intake_sha256)fail(409,'CAPTURE_SOURCE_CHANGED','Upstream intake changed after capture. Refresh and capture the current frame.');
    const target=captureTarget(current.scene,request.frame),png=decodePng(request.frame.pngBase64,current.scene.width,current.scene.height),text=checkText(request.text,'Annotation text',8000);
    const created=new Date().toISOString(),pngRef=await saveCapture(root,png);
    const item={id:randomUUID(),text,...target,width:png.width,height:png.height,png_ref:pngRef,png_sha256:png.sha256,source:{scene_revision:current.revision,render_inputs_sha256:current.source.render_inputs_sha256,intake_sha256:current.source.intake_sha256},capture_provenance:'USER_CAPTURE_UNVERIFIED',pixel_verification:'NOT_RUN',status:'OPEN',created_at:created,updated_at:created,verificationEvidence:null,history:[{at:created,from:null,to:'OPEN',note:'User-captured frame; server validated file integrity and timeline references, not rendered pixel equivalence.'}]};
    await assertSourceStable(root,current);
    saved.store.annotations.push(item);await mkdir(path.dirname(location(root)),{recursive:true});await writeJsonAtomic(location(root),saved.store);
    const revision=(await readStore(root)).revision;
    return {saved:true,revision,annotation:await decorate(root,item,current)};
  });
}

export async function listAnnotations(root){
  const saved=await readStore(root),current=await currentSource(root);
  const annotations=[];for(const item of saved.store.annotations)annotations.push(await decorate(root,item,current));
  return {schema_version:STORE_SCHEMA,revision:saved.revision,scene_revision:current.revision,current_source:current.source,annotations};
}

export async function updateAnnotation(root,request){
  return withStoreLock(root,async()=>{
    const saved=await readStore(root);checkRevision(saved.revision,request?.expectedAnnotationsRevision,'ANNOTATIONS_REVISION_CONFLICT','Annotations');
    const current=await currentSource(root);checkRevision(current.revision,request?.expectedRevision,'REVISION_CONFLICT','Scene');
    need(typeof request?.id==='string','ANNOTATION_ID_REQUIRED','Select the annotation to update.');
    const item=saved.store.annotations.find(row=>row.id===request.id);if(!item)fail(404,'ANNOTATION_NOT_FOUND','The annotation no longer exists.');
    for(const key of ['text','source','frame','png_ref','png_sha256','objectId','time','shotId','point'])need(!Object.hasOwn(request,key),'IMMUTABLE_CAPTURE','Captured text, image, target and source are immutable. Add a note or create a new annotation instead.');
    const next=request.status??item.status;need(STATUSES.has(next),'INVALID_ANNOTATION_STATUS','Status must be OPEN, RESOLVED or VERIFIED.');
    const note=request.note===undefined?null:checkText(request.note,'History note',4000);
    need(request.status!==undefined||note!==null,'EMPTY_ANNOTATION_UPDATE','Choose a status change or add a history note.');
    const decorated=await decorate(root,item,current);
    if(decorated.stale&&request.status!==undefined&&next!=='OPEN')fail(409,'STALE_ANNOTATION','This capture is from an older or invalid source. Add a historical note or create a fresh capture; it cannot be resolved or verified as current.');
    let evidence=item.verificationEvidence;
    if(request.status==='VERIFIED')evidence=checkText(request.verificationEvidence,'Verification evidence',4000);
    else if(request.verificationEvidence!==undefined)fail(400,'VERIFICATION_STATUS_REQUIRED','Verification evidence must accompany an explicit VERIFIED action.');
    const at=new Date().toISOString(),previous=item.status;
    item.status=next;item.updated_at=at;item.verificationEvidence=next==='VERIFIED'?evidence:null;
    item.history.push({at,from:previous,to:next,...(note?{note}:{}),...(request.status==='VERIFIED'?{verificationEvidence:evidence}:{}),source_stale_at_action:decorated.stale});
    if(current.source.valid)await assertSourceStable(root,current);
    else{const after=await readProject(root);if(after.revision!==current.revision)fail(409,'REVISION_CONFLICT','Scene changed while appending the historical note. Retry with the latest source.')}
    await writeJsonAtomic(location(root),saved.store);
    return {saved:true,revision:(await readStore(root)).revision,annotation:await decorate(root,item,current)};
  });
}

function quoteText(value){return String(value).replace(/\r\n?/g,'\n').split('\n').map(line=>'> '+line).join('\n')}
const code=value=>'`'+String(value).replaceAll('`','\\`').replace(/[\r\n]/g,' ')+'`';

const packageChanged=message=>fail(409,'FEEDBACK_PACKAGE_CHANGED',message);

async function readFeedbackManifest(directory){
  let bytes;
  try{bytes=await readFile(path.join(directory,'package-manifest.json'))}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    try{await stat(directory)}catch(missing){if(missing.code==='ENOENT')return null;throw missing}
    packageChanged('The previous feedback package manifest is missing. Preserve the package and restore/review it before exporting again.');
  }
  let prior;try{prior=JSON.parse(bytes.toString('utf8'))}catch{packageChanged('The previous feedback package manifest is not valid JSON. Preserve it and review before exporting again.')}
  const created=typeof prior?.created_at==='string'?Date.parse(prior.created_at):NaN;
  if(!prior||Array.isArray(prior)||!Number.isFinite(created)||new Date(created).toISOString()!==prior.created_at)
    packageChanged('The previous feedback package manifest has no valid frozen export timestamp. Preserve it and review before exporting again.');
  return prior;
}

async function prepareFeedbackPackage(root,data,markdown,createdAt){
  const portable=structuredClone(data),files=new Map(),missing=[];
  portable.generated_at=createdAt;
  const frozenMarkdown=markdown.replace('导出时间：'+data.generated_at,'导出时间：'+createdAt);
  for(const item of portable.annotations){
    item.original_png_ref=item.png_ref;
    if(item.capture_integrity==='AVAILABLE'){
      const bytes=await readFile(path.join(root,item.png_ref));
      if(sha256(bytes)!==item.png_sha256)fail(409,'CAPTURE_INTEGRITY_MISMATCH','Capture changed while building the portable feedback package. Retry.');
      item.png_ref='frames/'+item.png_sha256+'.png';files.set(item.png_ref,bytes);
    }else{missing.push({annotationId:item.id,original_png_ref:item.png_ref,status:item.capture_integrity});item.png_ref=null}
  }
  const packageMarkdown=frozenMarkdown.replaceAll('../review/frames/','frames/')+'\n交付说明：本目录包含可用的原始PNG与反馈数据；原始引用保留在feedback.json。损坏或缺失图像明确列在manifest，不冒充已携带。\n\n'+portable.annotations.filter(item=>item.png_ref).map(item=>'### 捕获 '+item.id+'\n\n![批注对应原始画面]('+item.png_ref+')\n').join('\n');
  portable.markdown_sha256=sha256(packageMarkdown);portable.package_role='FROZEN_FEEDBACK_EVIDENCE';
  files.set('feedback.md',Buffer.from(packageMarkdown,'utf8'));
  files.set('feedback.json',Buffer.from(JSON.stringify(portable,null,2)+'\n','utf8'));
  return {files,missing};
}

function validateFeedbackManifest(prior,identity,source,prepared){
  if(prior.schema_version!=='PREVIS_FEEDBACK_PACKAGE_V1'||prior.identity!==identity||prior.snapshot_role!=='FROZEN_FEEDBACK_EVIDENCE'||prior.media_pixel_verification!=='NOT_RUN'||prior.upstream_writes!==false||!isDeepStrictEqual(prior.source,source)||!isDeepStrictEqual(prior.missing_captures,prepared.missing)||!Array.isArray(prior.files)||prior.files.length!==prepared.files.size)
    packageChanged('The previous feedback package manifest does not match the complete expected snapshot. Preserve it and review before exporting again.');
  const seen=new Set();
  for(const file of prior.files){
    if(!file||typeof file.path!=='string'||seen.has(file.path)||!prepared.files.has(file.path)||!hex(file.sha256)||file.sha256!==sha256(prepared.files.get(file.path)))
      packageChanged('The previous feedback package file list contains a missing, duplicate, unexpected path or incorrect hash. Preserve it and review before exporting again.');
    seen.add(file.path);
  }
}

export async function exportFeedback(root){
  return withStoreLock(root,async()=>{
    const packet=await listAnnotations(root),at=new Date().toISOString();
    const counts={open:0,resolved:0,verified:0,stale:0};
    for(const item of packet.annotations){if(item.stale)counts.stale++;else counts[item.status.toLowerCase()]++}
    const lines=['# 预演画面反馈','',`导出时间：${at}`,'',`当前未解决 ${counts.open}；已处理 ${counts.resolved}；已验收 ${counts.verified}；过期/损坏证据 ${counts.stale}。`,'','用户捕获 PNG 的文件完整性、尺寸和时码已经检查；服务端没有验证其像素等同于正式逐帧渲染。RESOLVED 表示处理记录，VERIFIED 需要单独的验收证据，二者不等同。',''];
    for(const item of packet.annotations){
      const state=item.stale?'STALE / '+item.status:item.status;
      lines.push(`## ${code(item.id)} · ${state}`,'',`镜头 ${code(item.shotId)}，段内 ${item.time.toFixed(6)} 秒（帧 ${item.frame_index}），对象 ${code(item.objectId??'未指定')}，坐标 (${item.point.x.toFixed(4)}, ${item.point.y.toFixed(4)})。`,'',`捕获：${code('../'+item.png_ref)}；SHA-256 ${code(item.png_sha256)}。`,'',`来源：scene revision ${code(item.source.scene_revision)}；render inputs ${code(item.source.render_inputs_sha256)}；intake ${code(item.source.intake_sha256??'演示')}。`,'','用户批注原文（数据）：','',quoteText(item.text),'');
      if(item.stale)lines.push('过期原因：'+item.stale_reasons.join(', '),'');
      if(item.verificationEvidence)lines.push('验收证据（用户记录）：','',quoteText(item.verificationEvidence),'');
      for(const action of item.history.filter(row=>row.note))lines.push(`历史 ${code(action.at)}：`,'',quoteText(action.note),'');
    }
    const markdown=lines.join('\n')+'\n';
    const data={schema_version:'PREVIS_FEEDBACK_EXPORT_V1',generated_at:at,annotations_revision:packet.revision,scene_revision:packet.scene_revision,current_source:packet.current_source,counts,scope:'USER_CAPTURE_FEEDBACK',pixel_verification:'NOT_RUN',markdown_sha256:sha256(markdown),annotations:packet.annotations};
    // Derive expected paths and bytes from the current snapshot, never from a stored manifest.
    const identity=sha256(JSON.stringify({revision:packet.revision,scene:packet.scene_revision,source:packet.current_source,states:packet.annotations.map(item=>[item.id,item.stale,item.capture_integrity])}));
    const packageRelative='handoff/feedback-packages/'+identity,packageDirectory=path.join(root,packageRelative);
    const prior=await readFeedbackManifest(packageDirectory);
    const prepared=await prepareFeedbackPackage(root,data,markdown,prior?.created_at??at);
    if(prior){
      validateFeedbackManifest(prior,identity,packet.current_source,prepared);
      // Only trusted expected paths reach the filesystem, even when a manifest is damaged.
      for(const [file,expected] of prepared.files){
        let bytes;try{bytes=await readFile(path.join(packageDirectory,file))}catch(error){if(error.code==='ENOENT')packageChanged('A previous feedback package file is missing. Preserve the package and restore/review it before exporting again.');throw error}
        if(sha256(bytes)!==sha256(expected))packageChanged('A previous feedback package was altered. Preserve it and export into a reviewed new revision.');
      }
    }
    const evidence=await readStore(root);if(evidence.revision!==packet.revision)fail(409,'ANNOTATIONS_REVISION_CONFLICT','Feedback changed during packaging. Retry.');
    const scene=await readProject(root);if(scene.revision!==packet.scene_revision)fail(409,'REVISION_CONFLICT','Scene changed during feedback export. Retry.');
    if(packet.current_source.valid)await assertSourceStable(root,{revision:packet.scene_revision,source:packet.current_source});
    if(!prior){
      const staging=path.join(root,'handoff','.feedback-'+randomUUID()+'.tmp');await mkdir(path.join(staging,'frames'),{recursive:true});
      for(const [file,bytes] of prepared.files)await writeFile(path.join(staging,file),bytes);
      const files=[...prepared.files].map(([file,bytes])=>({path:file,sha256:sha256(bytes)}));
      await writeFile(path.join(staging,'package-manifest.json'),JSON.stringify({schema_version:'PREVIS_FEEDBACK_PACKAGE_V1',identity,snapshot_role:'FROZEN_FEEDBACK_EVIDENCE',created_at:at,source:packet.current_source,files,missing_captures:prepared.missing,media_pixel_verification:'NOT_RUN',upstream_writes:false},null,2)+'\n','utf8');
      await mkdir(path.dirname(packageDirectory),{recursive:true});await rename(staging,packageDirectory);
    }
    // Rejected packages do not replace the prior successful top-level feedback.
    await mkdir(path.join(root,'handoff'),{recursive:true});
    await writeAtomic(path.join(root,'handoff','feedback.md'),markdown);
    await writeJsonAtomic(path.join(root,'handoff','feedback.json'),data);
    return {saved:true,revision:packet.revision,json:'handoff/feedback.json',markdown:'handoff/feedback.md',packageDirectory:packageRelative,counts};
  });
}
