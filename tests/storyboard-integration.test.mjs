import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bindUpstream} from '../assets/starter/scripts/bind-upstream.mjs';
import {checkUpstream,sha256} from '../assets/starter/scripts/check-upstream.mjs';
import {sourceLineage} from '../assets/starter/scripts/source-lineage.mjs';
import {storyboardSelectionSha256} from '../assets/starter/scripts/storyboard-source.mjs';
import {sourceContext} from '../assets/starter/scripts/source-context.mjs';
import {createHandoff} from '../assets/starter/scripts/handoff.mjs';
import {bundleProject} from '../assets/starter/scripts/bundle.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n','utf8');
const camera=()=>({from:{position:[0,2,5],target:[0,1,0],fov:50},to:{position:[0,2,5],target:[0,1,0],fov:50},offset:{position:[0,0,0],target:[0,0,0],fov:0}});

async function fixture(t,{draft=false,actors=[],fragment=false,settings}={}){
  const base=await mkdtemp(path.join(tmpdir(),'previs-generic-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const root=path.join(base,'中文 预演工程'),evidence=path.join(base,'原始 来源');
  await mkdir(evidence);await cp(path.join(repo,'assets/starter'),root,{recursive:true});
  const masterFile=path.join(evidence,'导演稿.md'),master=fragment?'# 当前单元\n\n一个方块落下，随后停住。\n\n# 其他单元\n\n另一段原文。\n':'方块落下，镜头切换后停住。\r\n';
  await writeFile(masterFile,master,'utf8');
  const source={schema_version:draft?'PREVIS_STORYBOARD_DRAFT_V1':'PREVIS_STORYBOARD_SOURCE_V1',id:'原单元 乙',time_basis:'SEGMENT',duration_s:2,master:{path:'导演稿.md'+(fragment?'#当前单元':'')},shots:[{id:'原镜 一',start_s:0,end_s:.5,text:'方块起落。',detail:{'𠀀':.125,'\ue000':0}},{id:'原镜 二',start_s:.5,end_s:2,text:'方块停住。'}],asset_catalog:{actors,scenes:[],props:[]},...(settings?{production_settings:settings}:{})};
  const input=path.join(evidence,'来源.json'),intake=path.join(root,'upstream-intake.json');await save(input,source);
  const run=spawnSync(process.env.PREVIS_PYTHON||'python',['-B','-X','utf8',path.join(repo,'scripts/intake_storyboard.py'),draft?'--draft':'--project',input,'--out',intake],{encoding:'utf8',windowsHide:true});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const scene={schemaVersion:1,id:'generic-original-source',title:'SYNTHETIC generic integration',duration:2,width:1280,height:720,fps:60,environment:{type:'dutyroom',width:8,height:4,length:8,floorCenter:[0,0,0]},door:null,actors:actors.map((actor,index)=>({id:actor.id,role:'Synthetic proxy',height:actor.height_cm!==undefined?actor.height_cm/100:actor.height_m??1.7,color:'#33ccaa',path:[{t:0,position:[index,0,0]},{t:2,position:[index,0,0]}]})),assetBindings:actors.map(actor=>({actorId:actor.id,assetId:actor.id,representation:'proxy',...(actor.height_cm===undefined&&actor.height_m===undefined?{dimensions_basis:'LOCAL_EXECUTION_ASSUMPTION'}:{})})),sourceAssetIds:{actors:actors.map(actor=>actor.id),scenes:[],props:[]},shots:source.shots.map(shot=>({id:shot.id,start:shot.start_s,end:shot.end_s,beat:shot.text,camera:camera()})),adaptationMap:source.shots.map(shot=>({source_shot_id:shot.id,scene_shot_id:shot.id,source_ref:'导演稿.md/'+shot.id,status:'MAPPED'}))};
  await save(path.join(root,'scene.json'),scene);
  return {base,root,evidence,masterFile,input,intake,source,scene,packet:await json(intake)};
}

for(const draft of [false,true])test('generic '+(draft?'transcription':'source')+' binds original IDs without a workflow state',async t=>{
  const f=await fixture(t,{draft}),before=await readFile(f.input),bound=await bindUpstream(f.root);
  assert.equal(bound.lineage.provider,'storyboard');assert.equal(bound.lineage.unit_id,'原单元 乙');
  assert.equal(bound.lineage.unit_revision,storyboardSelectionSha256(f.packet.selection));
  assert.equal(bound.lineage.formal_id,undefined);assert.equal(bound.lineage.prompt_version,undefined);
  assert.equal(bound.scene.upstream.project_id,undefined);assert.equal(bound.scene.upstream.lineage.project_id,undefined);
  const checked=await checkUpstream(f.root,bound.scene),context=await sourceContext(f.root,checked);
  assert.equal(context.upstream_authority,false);assert.equal(context.mode,draft?'STORYBOARD_TRANSCRIPTION':'STORYBOARD_SOURCE_SNAPSHOT');
  assert.deepEqual(await readFile(f.input),before);
  const output=await createHandoff(f.root);
  assert.equal(output.videoStatus,'not-rendered');assert.equal(output.goal,'IN_PROGRESS');
  assert.equal(output.result.formal_id,undefined);assert.equal(output.result.base_prompt_version,undefined);assert.equal(output.result.budget_version,undefined);
  assert.equal(output.result.source_lineage.unit_id,f.source.id);assert.equal(output.result.checks.render_specs.status,'NOT_RUN');
  assert.equal(await readFile(path.join(f.root,'handoff/prompts.md'),'utf8'),f.packet.master.text);
  const bundle=await bundleProject({project:f.root,out:path.join(f.base,'portable')}),copied=await json(path.join(bundle.project,'scene.json'));
  assert.equal((await checkUpstream(bundle.project,copied)).packet.unit.id,f.source.id);
  assert.equal((await sourceContext(bundle.project,{packet:f.packet})).mode,'BUNDLED_SNAPSHOT');
});

test('new binding rejects changed timing and preserves the previously saved scene',async t=>{
  const f=await fixture(t);f.scene.shots[0].end=1;f.scene.shots[1].start=1;await save(path.join(f.root,'scene.json'),f.scene);const before=await readFile(path.join(f.root,'scene.json'));
  await assert.rejects(()=>bindUpstream(f.root),/original shot ID\/order\/interval changed/);
  assert.deepEqual(await readFile(path.join(f.root,'scene.json')),before);
});
test('generic sealed records cannot drift from their actual normalized source',async t=>{
  const f=await fixture(t);f.packet.budget.shots[0].end_s=.75;await save(f.intake,f.packet);
  await assert.rejects(()=>bindUpstream(f.root),/budget drifted/);
});
test('changed normalized source invalidates a bound adapter',async t=>{
  const f=await fixture(t),{scene}=await bindUpstream(f.root);f.source.shots[0].text='A changed original action.';await save(f.input,f.source);
  await assert.rejects(()=>checkUpstream(f.root,scene),/input source changed/);
});
test('explicit master fragments permit unrelated text edits and reject selected edits',async t=>{
  const f=await fixture(t,{fragment:true}),{scene}=await bindUpstream(f.root),original=await readFile(f.masterFile,'utf8');
  await writeFile(f.masterFile,original.replace('另一段原文。','其他单元继续追加。'));const checked=await checkUpstream(f.root,scene);assert.equal(checked.packet.unit.id,f.source.id);assert.ok(checked.diagnostics.some(row=>row.code==='SOURCE_OUTSIDE_SELECTED_FRAGMENT_CHANGED'));
  await writeFile(f.masterFile,original.replace('一个方块落下','一个方块升起'));await assert.rejects(()=>checkUpstream(f.root,scene),/selected master fragment changed/);
});
test('current generic packets reject a previous adapter version',async t=>{
  const f=await fixture(t);f.packet.adapter_version='0.6.1';await save(f.intake,f.packet);await assert.rejects(()=>bindUpstream(f.root),/unsupported adapter version/);
});
test('generic asset declarations use original actor IDs and reject the old character alias',async t=>{
  const f=await fixture(t,{actors:[{id:'original-actor'}]});f.scene.sourceAssetIds.actors=['unprovided-actor'];await save(path.join(f.root,'scene.json'),f.scene);await assert.rejects(()=>bindUpstream(f.root),/sourceAssetIds.actors/);
  f.scene.sourceAssetIds={characters:['original-actor'],scenes:[],props:[]};await save(path.join(f.root,'scene.json'),f.scene);await assert.rejects(()=>bindUpstream(f.root),/characters is unsupported/);
});
for(const [label,mutate,pattern] of [
  ['missing master path',source=>source.master.path='',/master.path/],
  ['non-object asset catalog',source=>source.asset_catalog=[],/asset_catalog must be an object/],
  ['null catalog collection',source=>source.asset_catalog.actors=null,/actors must be an array/],
  ['negative declared height',source=>source.asset_catalog.actors[0].height_cm=-10,/height_cm must be positive/],
  ['conflicting declared heights',source=>Object.assign(source.asset_catalog.actors[0],{height_cm:178,height_m:1.9}),/height_cm and height_m conflict/],
  ['conflicting explicit shot duration',source=>source.shots[0].duration_s=99,/shot.duration_s differs/]
])test('JavaScript rejects rehashed malformed source: '+label,async t=>{
  const f=await fixture(t,{actors:[{id:'original-actor'}]});mutate(f.source);await save(f.input,f.source);
  f.packet.source_snapshot=structuredClone(f.source);f.packet.lineage.source_revision=sha256(await readFile(f.input));f.packet.sources.find(row=>row.role==='input').sha256=f.packet.lineage.source_revision;
  if(Array.isArray(f.source.asset_catalog?.actors)){
    f.packet.asset_catalog.actors=structuredClone(f.source.asset_catalog.actors);f.packet.selection.asset_catalog.actors=structuredClone(f.source.asset_catalog.actors);
  }
  f.packet.selection.shots=structuredClone(f.source.shots);f.packet.lineage.unit_revision=storyboardSelectionSha256(f.packet.selection);await save(f.intake,f.packet);
  await assert.rejects(()=>bindUpstream(f.root),pattern);
});
test('missing source dimensions require an honest local proxy assumption',async t=>{
  const f=await fixture(t,{actors:[{id:'原人物'}]});delete f.scene.assetBindings[0].dimensions_basis;await save(path.join(f.root,'scene.json'),f.scene);
  await assert.rejects(()=>bindUpstream(f.root),/local execution assumption/);
  f.scene.assetBindings[0].dimensions_basis='LOCAL_EXECUTION_ASSUMPTION';await save(path.join(f.root,'scene.json'),f.scene);await bindUpstream(f.root);
});
test('explicit source dimensions and aspect ratio remain binding constraints',async t=>{
  const f=await fixture(t,{actors:[{id:'原人物',height_cm:178}],settings:{video_aspect_ratio:'16:9',visual_style:'Simple geometry'}});
  f.scene.actors[0].height=1.8;await save(path.join(f.root,'scene.json'),f.scene);await assert.rejects(()=>bindUpstream(f.root),/explicit source dimension/);
  f.scene.actors[0].height=1.78;f.scene.width=720;f.scene.height=1280;await save(path.join(f.root,'scene.json'),f.scene);await assert.rejects(()=>bindUpstream(f.root),/aspect ratio changes/);
});
test('old storyboard contracts are rejected before source binding',async t=>{
  const f=await fixture(t);await save(f.intake,{schema_version:'STORYBOARD_PREVIS_ADAPTER_V1',upstream_writes:false});await assert.rejects(()=>bindUpstream(f.root),/Unsupported intake contract/);
  f.scene.upstream={provider:'script-to-storyboard-prompts',intake:'./upstream-intake.json',intake_sha256:sha256(await readFile(f.intake))};
  await assert.rejects(()=>checkUpstream(f.root,f.scene),/unsupported intake contract/);
  assert.throws(()=>sourceLineage({schema_version:'STORYBOARD_PREVIS_ADAPTER_V1'}),/unsupported intake contract/);
});
