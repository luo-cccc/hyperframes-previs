import {readFile,writeFile,mkdir,lstat,open,unlink,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL}from'node:url';
import {spawn,spawnSync}from'node:child_process';
import {createServer}from'node:net';
import {randomUUID,createHash}from'node:crypto';
import {checkUpstream}from'./check-upstream.mjs';
import {sourceFingerprint}from'./source-fingerprint.mjs';
import {renderSceneText}from'../src/render-identity.js';
import {validateScene}from'../src/scene-data.js';
import {sourceLineage}from'./source-lineage.mjs';
import {writeJsonAtomic}from'./atomic-file.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const text=value=>typeof value==='string'&&value.trim().length;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(ok,message)=>{if(!ok)throw new Error('State capture: '+message)};
export function validateStatePlan(scene,plan){
 need(plan?.schema_version==='PREVIS_SOURCE_KEYFRAMES_V1'&&Array.isArray(plan.keyframes)&&plan.keyframes.length,'an explicit PREVIS_SOURCE_KEYFRAMES_V1 keyframe plan is required.');
 const seen=new Set();
 for(const frame of plan.keyframes){
  need(text(frame.id)&&!seen.has(frame.id),'keyframe IDs must be unique and nonempty.');seen.add(frame.id);
  const shot=scene.shots.find(shot=>shot.id===frame.shot_id);need(shot,'unknown source shot '+frame.shot_id);
  need(typeof frame.time_s==='number'&&Number.isFinite(frame.time_s)&&frame.time_s>=shot.start-1e-8&&frame.time_s<=shot.end+1e-8,'keyframe '+frame.id+' must lie inside its explicitly selected shot closed interval.');
  need(['single','prep','contact','result','handoff'].includes(frame.role),'unsupported keyframe role.');
  if(frame.battle_time_s!==undefined)need(Number.isFinite(frame.battle_time_s)&&frame.battle_time_s>=0,'battle time must be a finite nonnegative number.');
 }
 return plan;
}
export function sourceStateCoverage(scene,upstream,plan){
 const packet=upstream?.packet;if(packet?.schema_version!=='PREVIS_FIGHT_ADAPTER_V1')return {status:'NOT_SOURCE_BOUND',required:[],missing:[],mismatched:[]};
 const shotIds=new Set(scene.shots.map(shot=>shot.id)),offset=packet.unit.battle_start_s;
 const expected=(packet.selection?.keyframes||[]).filter(frame=>shotIds.has(frame.shot_id));
 const byId=new Map(plan.keyframes.map(frame=>[frame.id,frame]));
 const mismatched=[];for(const source of expected){const frame=byId.get(source.id);if(frame&&(frame.shot_id!==source.shot_id||frame.role!==(source.role||'single')||Math.abs(frame.time_s-(source.time_sec-offset))>1e-8||frame.battle_time_s!==undefined&&Math.abs(frame.battle_time_s-source.time_sec)>1e-8))mismatched.push(source.id);}
 const missing=expected.filter(frame=>!byId.has(frame.id)).map(frame=>frame.id);
 return {status:missing.length||mismatched.length?'PARTIAL':'COMPLETE',required:expected.map(frame=>frame.id),missing,mismatched};
}
async function snapshot(root){
 const scene=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8')),issues=validateScene(scene);need(!issues.length,issues.join('\n'));
 const upstream=await checkUpstream(root,scene),fingerprint=await sourceFingerprint(root);
 return {scene,upstream,identity:{scene_sha256:hash(renderSceneText(scene)),render_inputs_sha256:fingerprint.sha256,intake_sha256:upstream?.intakeSha256||null}};
}
export async function validateStateCaptureReport(root,report){
 root=path.resolve(root);need(report?.schema_version==='PREVIS_STATE_CAPTURE_REPORT_V1','unsupported state-capture report.');
 const current=await snapshot(root);need(same(current.identity,report.source),'saved state/source changed; recapture these state images.');
 const planPath=path.resolve(root,report.plan_path),planBytes=await readFile(planPath);need(hash(planBytes)===report.plan_sha256,'selected keyframe plan changed.');
 const plan=validateStatePlan(current.scene,JSON.parse(planBytes.toString('utf8')));
 need(report.captures.length===plan.keyframes.length,'incomplete state capture coverage.');
 const coverage=sourceStateCoverage(current.scene,current.upstream,plan);
 need(same(coverage,report.source_coverage),'source keyframe requirements or capture coverage changed.');
 const directory=path.resolve(root,report.package_directory),manifestBytes=await readFile(path.join(directory,'package-manifest.json'));need(hash(manifestBytes)===report.package_manifest_sha256,'state manifest changed.');
 const manifest=JSON.parse(manifestBytes),expected=plan.keyframes.map((frame,index)=>String(index+1).padStart(3,'0')+'-'+hash(frame.id).slice(0,12)+'.png');
 need(same(manifest.expected_files,expected)&&manifest.files.length===expected.length,'state package file coverage changed.');
 need(same((await readdir(directory)).sort(),[...expected,'package-manifest.json'].sort()),'state package contains missing or unexpected files.');
 for(const [index,name]of expected.entries()){
  const file=manifest.files[index],capture=report.captures[index];need(file.path===name&&capture.png_ref===name&&capture.id===plan.keyframes[index].id&&capture.shot_id===plan.keyframes[index].shot_id&&capture.time_s===plan.keyframes[index].time_s&&capture.role===plan.keyframes[index].role&&capture.provenance==='BOUNDARY_STATE_CAPTURE'&&capture.is_encoded_video_frame===false,'capture metadata or ownership changed.');
  const info=await lstat(path.join(directory,name));need(info.isFile()&&!info.isSymbolicLink(),'state image must be a regular file.');const bytes=await readFile(path.join(directory,name));need(hash(bytes)===file.sha256&&file.sha256===capture.png_sha256,'captured PNG changed.');
 }
 return {status:'CURRENT',source_coverage:coverage,scope:'SOURCE_LINKED_STATE_IMAGES_ONLY; not encoded MP4 frames, motion or sound acceptance.',report};
}
export async function captureStateImages({project,plan='source-keyframes.json',out}={}){
 const root=path.resolve(project||fileURLToPath(new URL('../',import.meta.url))),before=await snapshot(root);
 const planPath=path.resolve(root,plan),planBytes=await readFile(planPath),selected=validateStatePlan(before.scene,JSON.parse(planBytes));
 const coverage=sourceStateCoverage(before.scene,before.upstream,selected);need(!coverage.mismatched.length,'plan changes original source keyframe time, role or camera ownership: '+coverage.mismatched.join(', '));
 const identity=hash(JSON.stringify({source:before.identity,plan:hash(planBytes)}));
 const destination=path.resolve(root,out||'review/state-captures/'+identity);
 try{await lstat(destination);throw new Error('State capture destination already exists; verify the retained package or choose a new --out directory.')}catch(error){if(error.code!=='ENOENT')throw error}
 const lockPath=path.join(root,'.previs-state-capture.lock'),lock=await open(lockPath,'wx');
 let browser,service,staging;const captures=[];
 try{
  const module=process.env.PREVIS_PUPPETEER_MODULE?await import(pathToFileURL(path.resolve(process.env.PREVIS_PUPPETEER_MODULE)).href):await import('puppeteer-core');
  let executablePath=process.env.PREVIS_BROWSER_EXECUTABLE;
  if(!executablePath){const result=spawnSync(process.execPath,[path.join(root,'node_modules/hyperframes/bin/hyperframes.mjs'),'browser','path'],{encoding:'utf8',windowsHide:true});need(result.status===0,'Chrome is unavailable; run hyperframes browser ensure.');executablePath=result.stdout.trim();}
  const port=await new Promise((resolve,reject)=>{const reservation=createServer();reservation.on('error',reject);reservation.listen(0,'127.0.0.1',()=>{const value=reservation.address().port;reservation.close(()=>resolve(value));});});
  service=spawn(process.execPath,[path.join(root,'scripts/serve.mjs')],{cwd:root,env:{...process.env,PREVIS_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error('State capture preview startup timeout.')),20000);service.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Previs Studio:')){clearTimeout(timeout);resolve();}});service.once('error',error=>{clearTimeout(timeout);reject(error)});service.once('exit',code=>{clearTimeout(timeout);reject(new Error('State capture preview exited '+code));});});
  browser=await module.default.launch({executablePath,headless:'shell',windowsHide:true,args:process.platform==='win32'?['--use-gl=angle','--use-angle=d3d11']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:before.scene.width,height:before.scene.height},timeout:30000});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'networkidle0',timeout:30000});await page.waitForFunction(()=>window.PREVIS?.ready,{timeout:30000});
  await mkdir(path.dirname(destination),{recursive:true});staging=path.join(path.dirname(destination),'.state-'+randomUUID());await mkdir(staging);
  for(const [index,frame]of selected.keyframes.entries()){
   const capture=await page.evaluate(frame=>window.PREVIS.captureStateAt({time:frame.time_s,shotId:frame.shot_id}),frame);
   need(capture.shotId===frame.shot_id&&capture.time===frame.time_s&&capture.provenance==='BOUNDARY_STATE_CAPTURE'&&capture.is_encoded_video_frame===false,'runtime did not return the explicitly selected closed-interval state.');
   const bytes=Buffer.from(capture.pngBase64,'base64');need(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'runtime capture is not a PNG.');
   const name=String(index+1).padStart(3,'0')+'-'+hash(frame.id).slice(0,12)+'.png';await writeFile(path.join(staging,name),bytes,{flag:'wx'});
   captures.push({...frame,provenance:'BOUNDARY_STATE_CAPTURE',is_encoded_video_frame:false,png_ref:name,png_sha256:hash(bytes),width:capture.width,height:capture.height});
  }
  need(!errors.length,'preview failed: '+errors.join('; '));
  const after=await snapshot(root);need(same(before.identity,after.identity)&&hash(await readFile(planPath))===hash(planBytes),'saved source changed during capture; previous report retained.');
  const files=captures.map(capture=>({path:capture.png_ref,sha256:capture.png_sha256}));
  const manifest={schema_version:'PREVIS_STATE_CAPTURE_PACKAGE_V1',identity,source:before.identity,source_coverage:coverage,plan_sha256:hash(planBytes),expected_files:files.map(file=>file.path),files,captures,scope:'DIRECT_SAVED_STATE_RENDER; not frames extracted from an MP4.',upstream_writes:false};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(path.join(staging,'package-manifest.json'),manifestBytes);
  const report={schema_version:'PREVIS_STATE_CAPTURE_REPORT_V1',status:'CAPTURED',identity,source:before.identity,source_coverage:coverage,lineage:sourceLineage(before.upstream,before.scene),plan_path:path.relative(root,planPath).replaceAll(path.sep,'/'),plan_sha256:hash(planBytes),package_directory:path.relative(root,destination).replaceAll(path.sep,'/'),package_manifest_sha256:hash(manifestBytes),captures,media_frame_equivalence:'NOT_CLAIMED',semantic_review:'NOT_RUN',upstream_writes:false};
  await rename(staging,destination);staging=null;await writeJsonAtomic(path.join(root,'review/state-capture-report.json'),report);return report;
 }finally{
  if(browser)await browser.close();if(service&&service.exitCode===null)service.kill();
  // Partial PNGs are retained in the explicitly named staging directory for diagnosis.
  await lock.close();await unlink(lockPath);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i+=2){need(['--project','--plan','--out'].includes(process.argv[i])&&process.argv[i+1],'Usage: node keyframe-capture.mjs [--project <dir>] [--plan <json>] [--out <new-dir>]');options[process.argv[i].slice(2)]=process.argv[i+1];}
 const report=await captureStateImages(options);console.log('Captured '+report.captures.length+' independent source states: '+report.package_directory+'; no MP4-frame claim.');
}
