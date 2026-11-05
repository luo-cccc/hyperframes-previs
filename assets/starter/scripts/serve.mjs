import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProject,saveProjectChange,projectError } from './project-store.mjs';
import {createAnnotation,listAnnotations,updateAnnotation,exportFeedback} from './review-store.mjs';
import {auditScene} from '../src/spatial-audit.js';
import {checkUpstream,sha256} from './check-upstream.mjs';
import {sourceFingerprint} from './source-fingerprint.mjs';
import {createHandoff} from './handoff.mjs';
import {optionalJson} from './review-receipt.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const port=Number(process.env.PREVIS_PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='POST'&&url.pathname.startsWith('/__previs/')){
      if(req.headers.origin!==`http://127.0.0.1:${port}`&&req.headers.origin!==`http://localhost:${port}`)throw projectError(403,'ORIGIN_MISMATCH','Same-origin project changes only.');
    }
    const bodyJson=async(limit=2_000_000)=>{
      let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>limit)throw projectError(413,'BODY_TOO_LARGE','Request is too large.')}
      try{return JSON.parse(body)}catch{throw projectError(400,'INVALID_JSON','Request is not valid JSON.')}
    };
    const json=value=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
    if(req.method==='GET'&&url.pathname==='/__previs/state'){
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(await readProject(root)));return;
    }
    if(req.method==='POST'&&url.pathname==='/__previs/scene'){
      const request=await bodyJson();
      const result=await saveProjectChange(root,request);
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;
    }
    if(req.method==='GET'&&url.pathname==='/__previs/annotations'){json(await listAnnotations(root));return}
    if(req.method==='GET'&&url.pathname==='/__previs/source'){
      const current=await readProject(root),upstream=await checkUpstream(root,current.scene),fingerprint=await sourceFingerprint(root);
      json({scene_revision:current.revision,render_inputs_sha256:fingerprint.sha256,intake_sha256:upstream?.intakeSha256||null,runtime_sha256:sha256(JSON.stringify(fingerprint.files.filter(file=>file.path!=='scene.json')))});return;
    }
    if(req.method==='POST'&&url.pathname==='/__previs/annotations'){json(await createAnnotation(root,await bodyJson(8*1024*1024)));return}
    if(req.method==='POST'&&url.pathname==='/__previs/annotations/update'){json(await updateAnnotation(root,await bodyJson()));return}
    if(req.method==='POST'&&url.pathname==='/__previs/feedback/export'){json(await exportFeedback(root));return}
    if(req.method==='GET'&&url.pathname==='/__previs/delivery'){
      const published=await optionalJson(path.join(root,'handoff/manifest.json'));
      if(!published){json({available:false});return}
      const live=await createHandoff(root,{publish:false}),manifest=live.manifest;
      const current=published.scene_sha256===manifest.scene_sha256&&published.render_inputs_sha256===manifest.render_inputs_sha256&&published.intake_sha256===manifest.intake_sha256&&published.video_sha256===manifest.video_sha256&&published.delivery_goal_configuration_sha256===manifest.delivery_goal_configuration_sha256&&JSON.stringify(published.checks)===JSON.stringify(manifest.checks)&&JSON.stringify(published.delivery_goal)===JSON.stringify(manifest.delivery_goal);
      json({available:true,current,videoStatus:manifest.videoStatus,goal:manifest.delivery_goal,checks:manifest.checks,boundary:manifest.boundary});return;
    }
    if(req.method==='POST'&&url.pathname==='/__previs/handoff'){
      await bodyJson();const result=await createHandoff(root);json({saved:true,videoStatus:result.videoStatus,goal:result.manifest.delivery_goal});return;
    }
    if(req.method==='POST'&&url.pathname==='/__previs/boundary'){
      await bodyJson();const {exportBoundaryPack}=await import('./boundary-pack.mjs');
      const plan=await optionalJson(path.join(root,'boundary-plan.json'));
      const result=await exportBoundaryPack({project:root,...(plan?{plan:path.join(root,'boundary-plan.json')}:{})});json(result);return;
    }
    if(req.method==='GET'&&url.pathname==='/__previs/spatial'){
      const current=await readProject(root);json({...auditScene(current.scene),scene_revision:current.revision,scope_note:'Saved proxy geometry only. Visual/semantic media review is separate.'});return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
    const relative=decodeURIComponent(url.pathname==='/'?'/studio.html':url.pathname);
    const file=path.resolve(root,'.'+relative);
    if(!file.startsWith(root+path.sep)||relative.includes('/node_modules/')||!(await stat(file)).isFile()){res.writeHead(404);res.end();return}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch(error){
    const status=error.status||(error.code==='ENOENT'?404:500);
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({saved:false,code:error.code||'SAVE_FAILED',message:error.message,...(error.scene?{scene:error.scene,revision:error.revision}:{})}));
  }
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Stop the other project service or set PREVIS_PORT to a free local port, then use the printed project URL.`:error.message);process.exitCode=1});
server.listen(port,'127.0.0.1',()=>console.log(`Previs Studio: http://127.0.0.1:${port}/studio.html\nProject: ${root}\nCtrl+C to stop.`));
