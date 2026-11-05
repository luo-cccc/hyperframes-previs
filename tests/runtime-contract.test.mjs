import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {validateScene,sampleCamera,stageBounds} from '../assets/starter/src/scene-data.js';
import {sampleActions,sampleActorAction,sampleDoor,doorPointToWorld} from '../assets/starter/src/action-data.js';
import {validateTimeMapping,mapSegmentTime} from '../assets/starter/src/time-mapping.js';
import {planCameraRig} from '../assets/starter/src/camera-rigs.js';
import {auditScene} from '../assets/starter/src/spatial-audit.js';
import {createDutyroomExample} from '../scripts/create_dutyroom_example.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const legacy=await json(path.join(repo,'assets/starter/scene.json'));
const f1=await json(path.join(repo,'assets/examples/dutyroom/F1.scene.json'));
const f2=await json(path.join(repo,'assets/examples/dutyroom/F2.scene.json'));
const clone=structuredClone;
const close=(a,b,epsilon=1e-10)=>assert(Math.abs(a-b)<=epsilon,`${a} differs from ${b}`);
const vectorClose=(a,b,epsilon)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>close(v,b[i],epsilon))};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
const offset=()=>({position:[0,0,0],target:[0,0,0],fov:0});

for(const [name,scene] of [['corridor',legacy],['dutyroom-F1',f1],['dutyroom-F2',f2]]){
  test(`${name}: saved scene validates and absolute sampling is immutable`,()=>{
    assert.deepEqual(validateScene(scene),[]);
    const frozen=freeze(clone(scene)),before=JSON.stringify(frozen),time=Math.min(8,scene.duration);
    const first=sampleActions(frozen,time),camera=sampleCamera(frozen.shots.at(-1),time);
    for(const t of [0,scene.duration,2,time,1,scene.duration/2])sampleActions(frozen,t);
    assert.deepEqual(sampleActions(frozen,time),first);
    assert.deepEqual(sampleCamera(frozen.shots.at(-1),time),camera);
    assert.equal(JSON.stringify(frozen),before);
  });
}
test('legacy sliding door and block-rifle retain their previous pose contract',()=>{
  assert.equal(legacy.fps,60);assert.equal(legacy.duration,12);
  close(sampleDoor(legacy,0).open,0);close(sampleDoor(legacy,legacy.door.openEnd).open,1);
  vectorClose(sampleDoor(legacy,12).panelPositions[0],[-2.32,0,legacy.environment.doorZ]);
  assert.equal(sampleActions(legacy,8).actors.lead.prop.type,'block-rifle');
  assert.equal(auditScene(legacy).sampling.sampleCount,720);
});
test('logical seam preserves door transform, fixed feet, palm, right key, head target and camera',()=>{
  const a=sampleActions(f1,9),b=sampleActions(f2,0),actor='xu-ning';
  assert.deepEqual(a.door,b.door);close(a.door.angle,Math.PI/4);
  for(const field of ['position','modelPosition'])assert.deepEqual(a.actors[actor][field],b.actors[actor][field]);
  for(const hand of ['left','right'])assert.deepEqual(a.actors[actor].hands[hand].position,b.actors[actor].hands[hand].position);
  assert.deepEqual(a.actors[actor].gaze,b.actors[actor].gaze);
  assert.deepEqual(a.actors[actor].prop,b.actors[actor].prop);
  assert.deepEqual(sampleCamera(f1.shots.at(-1),9),sampleCamera(f2.shots[0],0));
  const dt=.001,leftVelocity=(sampleDoor(f1,9).angle-sampleDoor(f1,9-dt).angle)/dt,rightVelocity=(sampleDoor(f2,dt).angle-sampleDoor(f2,0).angle)/dt;
  close(leftVelocity,rightVelocity);assert(leftVelocity>0);
  assert(sampleDoor(f1,9-1/60).angle<sampleDoor(f2,0).angle,'The physical last frame must not masquerade as a logical extra endpoint frame.');
});
test('all 1260 export samples keep fixed feet, left palm on the leaf and key in the right hand',()=>{
  for(const scene of [f1,f2])for(let frame=0;frame<scene.duration*scene.fps;frame++){
    const t=frame/scene.fps,action=sampleActions(scene,t),actor=action.actors['xu-ning'];
    vectorClose(actor.position,[.6,0,.28]);
    vectorClose(actor.hands.left.position,doorPointToWorld(action.door,scene.actors[0].contacts[0].localPoint));
    assert.equal(actor.hands.left.contact.targetId,'door');assert.equal(actor.prop.hand,'right');
    vectorClose(actor.prop.position,actor.hands.right.position.map((v,i)=>v+[0,-.035,0][i]));
  }
});
test('full opening occurs after 18 seconds, then gaze and original speech are separately planned',()=>{
  close(sampleDoor(f2,9).angle,Math.PI/2);close(sampleDoor(f2,12).angle,Math.PI/2);
  vectorClose(sampleActions(f2,9).actors['xu-ning'].hands.left.position,[.61,1.12,-.32]);
  for(const t of [0,1.5,3,4.5,6,7.5,9]){
    const actor=sampleActions(f2,t).actors['xu-ning'];
    vectorClose(actor.gaze.target,actor.hands.left.position);
  }
  assert.notDeepEqual(sampleActions(f2,10).actors['xu-ning'].gaze.target,sampleActions(f2,9).actors['xu-ning'].gaze.target);
  assert.deepEqual(f1.performancePlan.speech,[]);
  assert.equal(f2.performancePlan.speech[0].text,'灯还亮着。');
  assert.equal(f2.performancePlan.speech[0].start,10);assert.equal(f2.performancePlan.speech[0].end,11);
  assert.equal(f1.audioPlan.status,'NOT_RUN');assert.equal(f2.audioPlan.status,'NOT_RUN');
});
test('contacts can start, stop and resume deterministically; final endpoint stays attached',()=>{
  const s=clone(f2),actor=s.actors[0],base=actor.contacts[0];
  actor.contacts=[{...base,start:0,end:3},{...base,start:5,end:12}];
  assert.deepEqual(validateScene(s),[]);
  assert.equal(sampleActorAction(s,actor,3).hands.left.contact,null);
  assert.equal(sampleActorAction(s,actor,4).hands.left.contact,null);
  assert(sampleActorAction(s,actor,5).hands.left.contact);
  assert(sampleActorAction(s,actor,12).hands.left.contact);
  const target=sampleActorAction(s,actor,8).hands.left.position;sampleActorAction(s,actor,4);
  assert.deepEqual(sampleActorAction(s,actor,8).hands.left.position,target);
});
test('door contact uses world hinge, unwrapped closed yaw and swing sign without hidden state',()=>{
  const s=clone(f1);s.door.hinge=[10,2,20];s.door.closedYaw=0;s.door.swingSign=1;s.door.angleKeys=[{t:0,angle:0},{t:9,angle:Math.PI/2}];
  vectorClose(doorPointToWorld(sampleDoor(s,9),[.3,1,.04]),[10.04,3,19.7]);
  s.actors[0].yawKeys=[{t:0,yaw:0},{t:9,yaw:Math.PI*4}];
  close(sampleActorAction(s,s.actors[0],4.5).yaw,Math.PI*2);
});
test('multi-point camera keys use segment absolute seconds with offsets on every knot',()=>{
  const shot=clone(f1.shots[1]);shot.camera={keys:[{t:3,position:[1,2,3],target:[0,1,0],fov:40},{t:5,position:[3,3,5],target:[1,2,1],fov:50},{t:9,position:[2,1,8],target:[2,1,0],fov:60}],offset:{position:[.2,.1,-.2],target:[1,0,0],fov:2}};
  const s=clone(f1);s.shots[1]=shot;assert.deepEqual(validateScene(s),[]);
  assert.deepEqual(sampleCamera(shot,5),{position:[3.2,3.1,4.8],target:[2,2,1],fov:52});
  assert.deepEqual(sampleCamera(shot,4),{position:[2.2,2.6,3.8],target:[1.5,1.5,.5],fov:47});
  const at8=sampleCamera(shot,8);sampleCamera(shot,3);assert.deepEqual(sampleCamera(shot,8),at8);
});
for(const kind of ['hold','push','truck','arc'])test(`explicit ${kind} rig replaces key trajectory with a valid legacy track`,()=>{
  const s=clone(f1),shot=s.shots[1],start=sampleCamera(shot,shot.start);
  const track=planCameraRig(shot,kind,.2);assert(!('keys' in track));
  shot.camera=track;assert.deepEqual(validateScene(s),[]);assert.deepEqual(sampleCamera(shot,shot.start),start);
});

const invalidActions=[
  ['hinge missing',s=>delete s.door.hinge],['zero door thickness',s=>s.door.size[2]=0],['invalid swing direction',s=>s.door.swingSign=0],
  ['nonfinite door angle',s=>s.door.angleKeys[1].angle=NaN],['door key gap',s=>s.door.angleKeys[0].t=.1],['duplicate door keys',s=>s.door.angleKeys[1].t=0],['incomplete door coverage',s=>s.door.angleKeys.at(-1).t=11],
  ['mixed slide/hinge event',s=>s.door.openStart=1],['unrecognized door type',s=>s.door.type='mystery'],['missing key hand',s=>delete s.actors[0].prop.hand],
  ['invalid gaze vector',s=>s.actors[0].gazeKeys[0].target[0]=Infinity],['gaze uncovered start',s=>s.actors[0].gazeKeys[0].t=1],['invalid yaw',s=>s.actors[0].yawKeys[0].yaw='0'],
  ['wrong contact hand',s=>s.actors[0].contacts[0].hand='other'],['unbound contact target',s=>s.actors[0].contacts[0].targetId='missing-door'],
  ['contact outside door',s=>s.actors[0].contacts[0].localPoint[0]=2],['negative contact time',s=>s.actors[0].contacts[0].start=-1],['empty contact range',s=>s.actors[0].contacts[0].end=0],
  ['overlapping same-hand contacts',s=>s.actors[0].contacts.push({...s.actors[0].contacts[0],start:1})],['malformed contact',s=>s.actors[0].contacts=[null]],
  ['camera mixed representations',s=>s.shots[0].camera.from=s.shots[0].camera.keys[0]],['camera duplicate times',s=>s.shots[0].camera.keys[1].t=0],
  ['camera incomplete shot coverage',s=>s.shots[1].camera.keys[0].t=0],['camera nonfinite pose',s=>s.shots[0].camera.keys[0].position[0]=NaN],
  ['effective camera FOV outside range',s=>s.shots[0].camera.offset.fov=140],['unsupported camera interpolation',s=>s.shots[0].camera.interpolation='spline'],
  ['missing dutyroom floor centre',s=>delete s.environment.floorCenter],['sliding door in dutyroom',s=>s.door={openStart:1,openEnd:2}]
];
for(const [name,mutate] of invalidActions)test(`reject invalid runtime data: ${name}`,()=>{const s=clone(f2);mutate(s);assert(validateScene(s).length>0)});
for(const bad of [null,[],{},42])test(`malformed scene ${JSON.stringify(bad)} reports errors instead of throwing`,()=>assert(validateScene(bad).length>0));
test('nonfinite or out-of-budget action times are rejected',()=>{for(const t of [NaN,Infinity,-.01,12.01,'1',null])assert.throws(()=>sampleActions(f2,t),/Action time/) });

test('missing mapping leaves source/edit clocks unknown',()=>{
  assert.deepEqual(validateTimeMapping(legacy),[]);const mapped=mapSegmentTime(legacy,4);
  assert.equal(mapped.segment_time_s,4);assert.equal(mapped.source_time_s,null);assert.equal(mapped.edit_time_s,null);assert.equal(mapped.basis,'SEGMENT_ONLY');
});
test('declared clipping and cross-project edit overlap preserve distinct source and edit clocks',()=>{
  const a=clone(f1),b=clone(f2),m1=a.timeMapping.segments[0],m2=b.timeMapping.segments[0];
  Object.assign(m1,{source_duration_s:11,source_start_s:.25,source_end_s:9.25});
  Object.assign(m2,{source_duration_s:15,source_start_s:1.25,source_end_s:13.25,edit_start_s:8.5,edit_end_s:20.5});
  assert.deepEqual(validateTimeMapping(a),[]);assert.deepEqual(validateTimeMapping(b),[]);
  close(mapSegmentTime(a,8.5).source_time_s,8.75);close(mapSegmentTime(a,8.5).edit_time_s,8.5);
  close(mapSegmentTime(b,0).source_time_s,1.25);close(mapSegmentTime(b,0).edit_time_s,8.5);
  close(mapSegmentTime(b,12).source_time_s,13.25);close(mapSegmentTime(b,12).edit_time_s,20.5);
  assert.equal(a.duration,9);assert.equal(b.duration,12);
});
const pieces=()=>({schema_version:'PREVIS_TIME_MAPPING_V1',segments:[
  {input_id:'clip-A',formal_id:'FORMAL_2',source_version:'P1',source_duration_s:10,source_start_s:2,source_end_s:6,segment_start_s:0,segment_end_s:4,edit_start_s:5,edit_end_s:9,playback_rate:1},
  {input_id:'clip-B',formal_id:'FORMAL_2',source_version:'P1',source_duration_s:20,source_start_s:7,source_end_s:15,segment_start_s:4,segment_end_s:12,edit_start_s:8.5,edit_end_s:16.5,playback_rate:1}
]});
test('piecewise lookup selects the next half-open interval and keeps declared edit overlap',()=>{
  const s=clone(f2);s.timeMapping=pieces();assert.deepEqual(validateTimeMapping(s),[]);
  const at=mapSegmentTime(s,4);assert.equal(at.input_id,'clip-B');assert.equal(at.source_time_s,7);assert.equal(at.edit_time_s,8.5);
  assert.equal(mapSegmentTime(s,3.5).edit_time_s,8.5);assert.equal(mapSegmentTime(s,12).edit_time_s,16.5);
  const first=mapSegmentTime(s,8);mapSegmentTime(s,2);assert.deepEqual(mapSegmentTime(s,8),first);
});
const invalidMappings=[
  ['wrong schema',m=>m.schema_version='V0'],['empty ranges',m=>m.segments=[]],['nonfinite source range',m=>m.segments[0].source_start_s=NaN],
  ['source bounds',m=>m.segments[0].source_end_s=11],['negative edit',m=>m.segments[0].edit_start_s=-1],['missing input id',m=>m.segments[0].input_id=''],
  ['wrong source span',m=>m.segments[0].source_end_s=5],['wrong edit span',m=>m.segments[0].edit_end_s=8],['speed change',m=>m.segments[0].playback_rate=2],
  ['zero rate',m=>m.segments[0].playback_rate=0],['gap',m=>m.segments[1].segment_start_s=4.1],['overlap in segment clock',m=>m.segments[1].segment_start_s=3.9],
  ['incomplete budget',m=>m.segments[1].segment_end_s=11.9],['out of budget',m=>m.segments[1].segment_end_s=13],['conflicting input identity',m=>m.segments[1].input_id='clip-A'],['malformed range',m=>m.segments[1]=null]
];
for(const [name,mutate] of invalidMappings)test(`reject invalid clock mapping: ${name}`,()=>{const s=clone(f2);s.timeMapping=pieces();mutate(s.timeMapping);assert(validateTimeMapping(s).length>0);assert.throws(()=>mapSegmentTime(s,0),{code:'TIME_MAPPING_INVALID'});assert(validateScene(s).length>0)});
for(const value of [null,[],42])test(`reject malformed timeMapping ${JSON.stringify(value)}`,()=>{const s=clone(f2);s.timeMapping=value;assert(validateTimeMapping(s).length>0)});
test('mapped time never silently clamps or rounds',()=>{
  for(const t of [-.001,12.001,NaN,Infinity,'1',null])assert.throws(()=>mapSegmentTime(f2,t),{code:'TIME_MAPPING_INVALID'});
  const t=1/59;assert.equal(mapSegmentTime(f2,t).source_time_s,t);
  const s=clone(f1);s.duration=9.001;assert(validateScene(s).some(message=>message.includes('whole number of frames')));assert.equal(s.duration,9.001);
});
test('spatial audit shares dutyroom floor bounds, including translated/elevated stages',()=>{
  const s=clone(f2),translation=[10,2,20];s.environment.floorCenter=translation;
  for(const actor of s.actors)for(const key of actor.path)key.position=key.position.map((v,i)=>v+translation[i]);
  assert.deepEqual(stageBounds(s),{min:[7,2,16],max:[13,5.2,24],basis:'DUTYROOM_FLOOR_CENTER'});
  const report=auditScene(s);assert.equal(report.checks.stageBounds,'DUTYROOM_FLOOR_CENTER');assert.equal(report.checks.dynamicDoorContacts,'NOT_CHECKED');
  assert(!report.issues.some(i=>['ACTOR_OUTSIDE_STAGE','ACTOR_BELOW_FLOOR','ACTOR_ABOVE_CEILING'].includes(i.code)));
  for(const key of s.actors[0].path)key.position[1]=1.8;
  assert(auditScene(s).issues.some(i=>i.code==='ACTOR_BELOW_FLOOR'&&i.evidence.floorY===2));
});
test('generator creates independent demo projects, a truthful cross-project plan and refuses overwrite',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'previs-runtime-generator-'));
  try{
    const target=path.join(temp,'new-demo'),result=await createDutyroomExample(target);assert.equal(result.projects.length,2);
    for(const id of ['F1','F2']){const s=await json(path.join(target,id,'scene.json'));assert.deepEqual(validateScene(s),[]);assert.equal(s._demo.classification,'TEST_DEMO_ONLY');assert.equal(s._demo.binding,'NONE');const html=await readFile(path.join(target,id,'index.html'),'utf8');assert(html.includes(`data-duration="${s.duration}"`));assert(html.includes('data-fps="60"'))}
    const plan=await json(path.join(target,'F1/boundary-plan.json')),connection=plan.connections[0];assert.equal(plan.schema_version,'PREVIS_BOUNDARY_PLAN_V1');assert(!('transition_id' in connection));assert.equal(connection.from.shot_id,'F1-SH02');assert.equal(connection.to.shot_id,'F2-SH01');close(connection.from.time_s,9-1/60);assert.equal(connection.to.project,'../F2');
    const before=await readFile(path.join(target,'F1/scene.json'),'utf8');await assert.rejects(createDutyroomExample(target),/already exists/);assert.equal(await readFile(path.join(target,'F1/scene.json'),'utf8'),before);
  }finally{await rm(temp,{recursive:true,force:true})}
});

// Optional real Chromium integration, no new npm dependency:
// PREVIS_BROWSER_TESTS=1, PREVIS_PUPPETEER_MODULE=<existing puppeteer-core entry>,
// PREVIS_BROWSER_EXECUTABLE=<existing Chromium>, PREVIS_RUNTIME_EVIDENCE=<new dir>.
// The headless browser, screenshots and services are actual; all are closed finally.
test('actual Chromium: pixel determinism, seam pose, contact meshes, editor saves and old corridor', {skip:process.env.PREVIS_BROWSER_TESTS!=='1'?'Set PREVIS_BROWSER_TESTS=1 and supply an existing Chromium/puppeteer-core to run actual browser checks.':false,timeout:120000},async t=>{
  assert(process.env.PREVIS_PUPPETEER_MODULE&&process.env.PREVIS_BROWSER_EXECUTABLE,'Supply existing browser and puppeteer-core paths; this test does not install extra dependencies.');
  const puppeteer=(await import(pathToFileURL(process.env.PREVIS_PUPPETEER_MODULE))).default;
  const output=process.env.PREVIS_RUNTIME_EVIDENCE?path.resolve(process.env.PREVIS_RUNTIME_EVIDENCE):await mkdtemp(path.join(tmpdir(),'previs-runtime-browser-'));
  if(process.env.PREVIS_RUNTIME_EVIDENCE)await mkdir(output,{recursive:false});
  const projectResult=await createDutyroomExample(path.join(output,'projects'));
  const oldRoot=path.join(output,'corridor');await cp(path.join(repo,'assets/starter'),oldRoot,{recursive:true,filter:source=>!['node_modules','.hyperframes','renders','review'].includes(path.basename(source))});
  const services=[],browserErrors=[],badResponses=[],observations=[],progress=[];let browser;
  const mark=async name=>{progress.push({name,time:new Date().toISOString()});await writeFile(path.join(output,'harness-progress.json'),JSON.stringify(progress,null,2)+'\n','utf8')};
  t.after(async()=>{if(browser)await Promise.race([browser.close(),new Promise(resolve=>{const timer=setTimeout(()=>{browser.process()?.kill();resolve()},5000);timer.unref()})]);for(const service of services)if(service.exitCode===null){service.kill();await new Promise(resolve=>{service.once('close',resolve);setTimeout(resolve,2000).unref()})}});
  const startServer=async root=>{
    const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const service=spawn(process.execPath,[path.join(root,'scripts/serve.mjs')],{cwd:root,env:{...process.env,PREVIS_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});services.push(service);let log='';service.stderr.on('data',data=>log+=data);service.stdout.on('data',data=>log+=data);
    const origin=`http://127.0.0.1:${port}`;
    for(let i=0;i<100;i++){try{const response=await fetch(origin+'/scene.json');if(response.ok)return origin}catch{}if(service.exitCode!==null)throw new Error(log);await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Service failed to start: '+log);
  };
  browser=await puppeteer.launch({executablePath:process.env.PREVIS_BROWSER_EXECUTABLE,headless:true,windowsHide:true,protocolTimeout:20000,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader'],defaultViewport:{width:1280,height:720}});
  await mark('browser-launched');
  const open=async root=>{
    await mark('opening '+path.basename(root));
    const origin=await startServer(root),page=await browser.newPage();
    page.on('pageerror',error=>browserErrors.push(error.message));page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))badResponses.push({url:response.url(),status:response.status()})});page.on('dialog',dialog=>dialog.accept());
    await page.goto(origin+'/index.html',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.PREVIS?.ready,{timeout:10000});await mark('ready '+path.basename(root));return {page,origin};
  };
  const roots=Object.fromEntries(projectResult.projects.map(p=>[p.id,p.directory]));
  const a=await open(roots.F1),b=await open(roots.F2);
  const snapshot=async(page,time,name)=>{
    await mark('capturing '+name);
    await page.bringToFront();
    const state=await page.evaluate(time=>{window.PREVIS.seek(time);return window.PREVIS.inspect()},time);
    const png=Buffer.from(await page.screenshot({path:path.join(output,name+'.png')}));
    await mark('captured '+name);
    observations.push({name,time,sha256:createHash('sha256').update(png).digest('hex'),state});
    for(const actor of Object.values(state.actors))for(const [hand,position] of Object.entries(actor.renderedHands))vectorClose(position,actor.hands[hand].position,1e-9);
    for(const actor of Object.values(state.actors))if(actor.renderedProp)vectorClose(actor.renderedProp,actor.prop.position,1e-9);
    return {state,png,hash:createHash('sha256').update(png).digest('hex')};
  };
  await snapshot(a.page,0,'F1-first');await snapshot(a.page,9-1/60,'F1-last-physical-frame');
  const end=await snapshot(a.page,9,'F1-logical-end'),start=await snapshot(b.page,0,'F2-first');
  assert.equal(end.hash,start.hash,'The exact logical seam should have identical pixels and camera.');
  const first=await snapshot(b.page,8,'F2-t8-first');await snapshot(b.page,2,'F2-t2');const repeat=await snapshot(b.page,8,'F2-t8-repeat');assert.equal(first.hash,repeat.hash);assert.deepEqual(first.state,repeat.state);
  await snapshot(b.page,9,'F2-full-open');await snapshot(b.page,10.5,'F2-original-speech-plan');
  const saved=await b.page.evaluate(async()=>{
    const api=window.PREVIS,id=api.data.shots[0].id,track=api.data.shots[0].camera;track.keys[1].position[0]+=.05;
    await api.saveCameraTrack(id,track);const after=api.savedData.shots[0].camera;
    api.previewRig(id,'push',.1);const rig=api.data.shots[0].camera;
    api.discardCameraPreview(id);await api.undoTarget('camera',id);
    return {after,rig,restored:api.savedData.shots[0].camera,dirty:api.dirtyShots};
  });
  assert(Array.isArray(saved.after.keys));assert(!('keys' in saved.rig));assert(saved.rig.from&&saved.rig.to);assert.deepEqual(saved.restored,f2.shots[0].camera);assert.deepEqual(saved.dirty,[]);
  const old=await open(oldRoot);const old8=await snapshot(old.page,8,'corridor-t8');await snapshot(old.page,2,'corridor-t2');const oldRepeat=await snapshot(old.page,8,'corridor-t8-repeat');assert.equal(old8.hash,oldRepeat.hash);assert.equal(old8.state.actors.lead.prop.type,'block-rifle');
  assert.deepEqual(browserErrors,[]);assert.deepEqual(badResponses,[]);
  await writeFile(path.join(output,'browser-observations.json'),JSON.stringify({classification:'ACTUAL_BROWSER_TEST_OF_TEST_DEMO',observations,browserErrors,badResponses,saved},null,2)+'\n','utf8');
  t.diagnostic('Actual browser evidence: '+output);
});
