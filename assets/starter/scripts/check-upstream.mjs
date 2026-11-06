import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { collectTransitionContext, checkTransitionContext, resolveSourceScriptRef } from './transition-context.mjs';
import {checkFightUpstream} from './fight-source.mjs';

export const sha256=data=>createHash('sha256').update(data).digest('hex');
const near=(a,b)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<1e-6;
const expect=(ok,message)=>{if(!ok)throw new Error(`Upstream adapter: ${message}`)};
const pick=(record,names)=>Object.fromEntries(names.filter(name=>Object.hasOwn(record,name)).map(name=>[name,record[name]]));
const normalized=value=>Array.isArray(value)?value.map(normalized):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])])):value;
const same=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));

function strictJson(text,label){
  text=text.replace(/^\uFEFF/,'');let cursor=0;
  const whitespace=()=>{while(/[ \t\r\n]/.test(text[cursor]||'\0'))cursor++};
  const fail=message=>{throw new Error(`Upstream adapter: invalid ${label}: ${message} at character ${cursor}`)};
  function string(){
    const start=cursor++;while(cursor<text.length){const char=text[cursor++];if(char==='\\'){cursor++;continue}if(char==='"'){try{return JSON.parse(text.slice(start,cursor))}catch{fail('invalid JSON string')}}}fail('unterminated string');
  }
  function value(depth=0){
    if(depth>256)fail('nesting too deep');whitespace();const char=text[cursor];
    if(char==='"')return string();
    if(char==='{'){
      cursor++;whitespace();const result=Object.create(null),keys=new Set();if(text[cursor]==='}'){cursor++;return result}
      while(true){whitespace();if(text[cursor]!=='"')fail('object key must be a string');const key=string();if(keys.has(key))fail(`duplicate key ${key}`);keys.add(key);whitespace();if(text[cursor++]!==':')fail('expected colon');result[key]=value(depth+1);whitespace();const delimiter=text[cursor++];if(delimiter==='}')return result;if(delimiter!==',')fail('expected comma or closing brace')}
    }
    if(char==='['){
      cursor++;whitespace();const result=[];if(text[cursor]===']'){cursor++;return result}
      while(true){result.push(value(depth+1));whitespace();const delimiter=text[cursor++];if(delimiter===']')return result;if(delimiter!==',')fail('expected comma or closing bracket')}
    }
    for(const [word,result] of [['true',true],['false',false],['null',null]])if(text.startsWith(word,cursor)){cursor+=word.length;return result}
    const number=text.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if(number){cursor+=number[0].length;const result=Number(number[0]);if(!Number.isFinite(result))fail('non-finite number');return result}
    fail('unexpected token');
  }
  const result=value();whitespace();if(cursor!==text.length)fail('trailing content');return result;
}

function sectionText(text,fragment){
  const anchors=[...text.matchAll(/<a\s+id=(["'])(.*?)\1\s*>\s*<\/a>/gi)];
  const incomingTrim=(start,end)=>{for(const anchor of anchors){if(anchor.index>=start&&anchor.index+anchor[0].length<=end&&!text.slice(anchor.index+anchor[0].length,end).trim())return anchor.index}return end};
  const anchor=anchors.find(item=>item[2]===fragment);
  if(anchor){
    const start=anchor.index+anchor[0].length,rest=text.slice(start),heading=rest.match(/^\s*(#{1,6})[ \t]+[^\r\n]+(?:\r?\n|$)/);
    if(heading){const searchStart=start+heading[0].length,boundary=text.slice(searchStart).match(new RegExp('^#{1,'+heading[1].length+'}[ \\t]+','m'));return text.slice(start,boundary?incomingTrim(start,searchStart+boundary.index):text.length)}
    const next=text.slice(start).search(/<a\s+id=/i);return next>=0?text.slice(start,start+next):text.slice(start);
  }
  for(const heading of text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)){
    const slug=heading[2].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu,'').replaceAll(' ','-');
    if(fragment!==heading[2]&&fragment!==slug)continue;
    const start=heading.index+heading[0].length,boundary=text.slice(start).match(new RegExp('^#{1,'+heading[1].length+'}\\s+','m'));
    return text.slice(start,boundary?incomingTrim(start,start+boundary.index):text.length);
  }
  throw new Error(`Upstream adapter: cannot locate explicit fragment #${fragment}; use a precise heading/anchor or a dedicated source file.`);
}

export function currentStateScope(state,formalId,profile='SCOPED_STATE_V3'){
  expect(['SCOPED_STATE_V2','SCOPED_STATE_V3'].includes(profile),'unsupported scoped state validation profile.');
  const rows=(state.coverage_ledger||[]).filter(row=>row.formal_id===formalId);
  expect(rows.length===1&&rows[0].status==='DONE','target no longer has one current DONE coverage record.');
  const coverage=rows[0],script=state.source_script_ref;
  expect(script&&typeof script==='object'&&typeof script.version==='string'&&script.version,'source version is missing; recover explicit upstream lineage.');
  expect(coverage.source_script_version===script.version,'target source_script_version differs from the current source (or is missing).');
  expect(Object.hasOwn(coverage,'start_state')&&Object.hasOwn(coverage,'end_state'),'target start/end states are missing.');
  const prompts=(state.prompt_versions||[]).filter(row=>row.formal_id===formalId&&row.prompt_version===coverage.prompt_version);
  expect(prompts.length===1&&prompts[0].status==='DONE','target mother-script version is no longer effective.');
  const prompt=prompts[0],textCheck=coverage.checks?.TEXT||{};
  expect(prompt.budget_version===coverage.budget_version&&['CHECKED','FROZEN'].includes(prompt.budget_status),'target budget lineage is invalid.');
  expect(prompt.delivery_ref===coverage.delivery_ref,'target delivery lineage differs.');
  expect(textCheck.status==='PASS'&&typeof textCheck.evidence==='string'&&textCheck.evidence.trim(),'target TEXT evidence is no longer valid.');
  const steps=(state.step_ledger||[]).filter(row=>row.step_id===formalId&&!row.request_id&&['DONE','REUSED'].includes(row.status)&&(row.prompt_version||coverage.prompt_version)===coverage.prompt_version);
  expect(steps.length>0,'no completed target step evidence.');
  for(const blocker of state.blocking_items||[]){if(profile==='SCOPED_STATE_V3'&&blocker.request_id&&!(blocker.blocks||[]).includes(formalId))continue;const blocks=blocker.blocks||[];expect(!blocks.includes(formalId)&&!blocks.includes('*')&&blocker.step_id!==formalId,'a current blocker applies to this target.')}
  expect(![formalId,coverage.segment_id].includes(state.edit_lock)||[null,undefined,'NONE'].includes(state.edit_lock),'target is edit-locked.');
  const settings={};
  for(const key of ['video_aspect_ratio','visual_style','segment_max_s']){const item=state.production_settings?.[key]||{};expect(item.status==='CONFIRMED'&&item.decision_ref&&item.selected!==null&&item.selected!==undefined,`${key} is no longer confirmed.`);settings[key]=pick(item,['selected','status','decision_ref'])}
  return {profile,project_id:state.project_id,state_version:state.state_version,workflow_schema:state.workflow_schema,production_settings:settings,source_script_ref:script,coverage:{...pick(coverage,['formal_id','episode_id','scene_id','segment_id','prompt_version','budget_version','source_script_version','chains','start_cursor','end_cursor','start_anchor','end_anchor','start_state','end_state','delivery_ref','status']),TEXT:pick(textCheck,profile==='SCOPED_STATE_V3'?['status','scope','evidence']:['status','evidence'])},prompt:pick(prompt,['formal_id','prompt_version','budget_version','budget_status','budget_ref','delivery_ref','status']),steps:steps.map(row=>pick(row,['step_id','status','prompt_version','delivery_ref']))};
}

// Keep transition data outside the core equality comparison.
export function snapshotV3(state,formalId){
  const core=currentStateScope(state,formalId,'SCOPED_STATE_V3');
  return {core,transition_context:collectTransitionContext(state,formalId,core.coverage.prompt_version)};
}

const registry=value=>Array.isArray(value)?value:value&&typeof value==='object'?Object.entries(value).map(([id,entry])=>({id,...(entry&&typeof entry==='object'?entry:{text:entry})})):[];
const assetId=entry=>entry.id||entry.character_id||entry.asset_id;
// Expand only explicit typed fields or the upstream four-view LOOK/STATE version token.
// Free-form character descriptions never become machine provenance.
export function assetVersionRecords(row){
  const result=[];
  if(row.look_version||row.state_version)result.push(row);
  for(const view of Array.isArray(row.four_views)?row.four_views:[]){
    if(!view||typeof view!=='object'||Array.isArray(view))continue;
    const match=typeof view.version==='string'?view.version.match(/^\s*(LOOK-[^/\s]+)\s*\/\s*(STATE-[^/\s]+)\s*$/):null;
    const look=view.look_version||match?.[1],state=view.state_version||match?.[2];
    if(!look&&!state)continue;
    const parent={...row};delete parent.four_views;
    result.push({...parent,...(look?{look_version:look}:{}),...(state?{state_version:state}:{}),four_views:[view]});
  }
  return result.length?result:[row];
}
function selectedAssetRecords(state,key,id,binding){
  let rows=registry(state[key]).filter(row=>assetId(row)===id);
  if(binding&&key==='character_assets'&&(binding.look_version||binding.state_version))rows=rows.flatMap(assetVersionRecords);
  if(binding&&key==='character_assets')for(const field of ['look_version','state_version'])if(binding[field])rows=rows.filter(row=>row[field]===binding[field]);
  if(binding?.profile_version&&key==='character_profiles')rows=rows.filter(row=>row.version===binding.profile_version||row.profile_version===binding.profile_version);
  return rows;
}

function checkRelatedAssets(scene,packet,liveState){
  const original=packet.upstream_snapshot||{},declared=scene.sourceAssetIds||{};
  const actorIds=scene.assetBindings?.map(binding=>binding.assetId)||[];
  const ids={characters:declared.characters||actorIds,scenes:declared.scenes,props:declared.props};
  expect(Array.isArray(ids.characters),'declare sourceAssetIds.characters or actor bindings.');
  expect(actorIds.every(id=>ids.characters.includes(id)),'sourceAssetIds.characters cannot omit an actor that is present in this scene.');
  for(const [kind,key] of [['scenes','scene_assets'],['props','prop_assets']]){
    if(registry(original[key]).length||registry(liveState?.[key]).length)expect(Array.isArray(ids[kind]),`declare sourceAssetIds.${kind} explicitly (including [] when none are used); related assets must not be guessed.`);
    else ids[kind]=ids[kind]||[];
  }
  for(const [kind,keys] of [['characters',['character_profiles','character_assets']],['scenes',['scene_assets']],['props',['prop_assets']]]){
    expect(new Set(ids[kind]).size===ids[kind].length,`duplicate sourceAssetIds.${kind}.`);
    for(const id of ids[kind])for(const key of keys){
      const binding=scene.assetBindings?.find(item=>item.assetId===id),before=selectedAssetRecords(original,key,id,binding);
      if(key==='character_assets'&&registry(original[key]).length===0)continue;
      expect(before.length>0,`no explicit ${key} provenance for ${id}; normalize/recover the actual LOOK/STATE mapping.`);
      if(liveState){const after=selectedAssetRecords(liveState,key,id,binding);expect(same(before,after),`relevant ${key} changed or became invalid: ${id}; refresh/review this adapter.`)}
    }
  }
}

export async function checkUpstream(root,scene){
  if(!scene.upstream){
    for(const name of ['upstream-intake.json','adapter-project.json']){
      try{await access(path.join(root,name))}catch(error){if(error.code==='ENOENT')continue;throw error}
      throw new Error(`Upstream adapter: ${name} exists but scene.upstream is missing; bind this adapter before validation/export. Demonstration fallback is disabled.`);
    }
    return null;
  }
  const u=scene.upstream;
  expect(typeof u.intake==='string'&&u.intake,'missing intake path.');
  const file=path.resolve(root,u.intake),bytes=await readFile(file),packet=strictJson(bytes.toString('utf8'),'intake JSON');
  expect(sha256(bytes)===u.intake_sha256,'intake changed; review the new source and bind a new adapter revision.');
  if(packet.schema_version==='PREVIS_FIGHT_ADAPTER_V1'||u.provider==='xianxia-fight-director')return checkFightUpstream(root,scene);
  expect(!u.provider||u.provider==='script-to-storyboard-prompts','source provider does not match this intake.');
  expect(packet.schema_version==='STORYBOARD_PREVIS_ADAPTER_V1','unsupported intake contract.');
  expect(packet.upstream_writes===false,'intake must explicitly preserve read-only upstream access.');
  for(const field of ['project_id','formal_id','prompt_version','budget_version'])expect(u[field]===packet[field],`${field} differs from the intake.`);
  expect(packet.master?.text&&sha256(packet.master.text)===packet.master.text_sha256,'mother-script text integrity mismatch.');
  expect(Array.isArray(packet.sources)&&packet.sources.length>0,'source evidence is missing.');
  const roles=new Set(packet.sources.map(s=>s.role));
  for(const role of ['state','budget','master','source_script','text_evidence'])expect(roles.has(role),`missing source role ${role}.`);
  let liveState=null;
  expect(['STATE_JSON','MANUAL_TRANSCRIPTION'].includes(packet.input_mode),'unknown input mode.');
  for(const source of packet.sources){
    expect(typeof source.path==='string'&&source.path,'source path is missing.');
    const sourceFile=path.resolve(path.dirname(file),source.path),content=await readFile(sourceFile),actual=sha256(content);
    if(source.role==='master'){
      const raw=content.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
      // Legacy manual packets retain full-file SHA validation below; only recover their explicit master selection.
      const fragment=source.selector?.kind==='MARKDOWN_FRAGMENT_V1'?source.selector.fragment:packet.input_mode==='MANUAL_TRANSCRIPTION'&&!source.selector?source.fragment:undefined;
      expect(fragment===undefined||typeof fragment==='string','invalid mother-script fragment.');
      const selected=fragment?sectionText(raw,fragment):raw;
      const start=selected.indexOf('场《');
      expect(start>=0&&selected.slice(start).trim()===packet.master.text.replace(/\r\n?/g,'\n').trim(),'packet mother-script copy differs from its actual source; re-extract instead of manually editing a sealed intake.');
    }
    if(source.role==='state'&&packet.input_mode==='STATE_JSON'){
      expect(['SCOPED_STATE_V2','SCOPED_STATE_V3'].includes(packet.validation_profile)&&packet.state_scope?.profile===packet.validation_profile,'legacy STATE_JSON intake lacks scoped authority validation; refresh intake from the effective upstream state (do not silently relabel it).');
      liveState=strictJson(content.toString('utf8'),'live state JSON');
      // Unchanged sealed aliases were resolved during intake. Reopening their
      // original absolute paths would break a portable read-only evidence copy.
      if(packet.validation_profile==='SCOPED_STATE_V3'&&!same(liveState.source_script_ref,packet.state_scope.source_script_ref))await resolveSourceScriptRef(liveState.source_script_ref,path.dirname(sourceFile));
      const current=currentStateScope(liveState,packet.formal_id,packet.validation_profile);
      expect(same(current,packet.state_scope),'target lineage/settings/start-end evidence changed; refresh/review this adapter (including the selected TEXT status/scope/evidence).');
    }else if(source.selector?.kind==='JSON_BUDGET_V1'){
      const selector=source.selector;
      expect(source.role==='budget','JSON budget selector belongs only to a budget source.');
      for(const key of ['formal_id','prompt_version','budget_version'])expect(selector[key]===packet[key],`budget selector ${key} differs from target lineage.`);
      expect(same(source.selected_value,packet.budget),'packet budget drifted from its selected source snapshot.');
      const parsed=strictJson(content.toString('utf8'),'budget JSON'),rows=(Array.isArray(parsed)?parsed:[parsed]).filter(row=>row&&['formal_id','prompt_version','budget_version'].every(key=>row[key]===selector[key]));
      expect(rows.length===1&&same(rows[0],source.selected_value),'selected formal/prompt/budget content changed or is ambiguous; refresh this adapter.');
    }else if(source.selector?.kind==='MARKDOWN_FRAGMENT_V1'){
      expect(['master','text_evidence','source_script'].includes(source.role),'Markdown fragment selector is unsupported for this source role.');
      expect(typeof source.selector.fragment==='string'&&source.selector.fragment&&source.selector.normalization==='LF_STRIP_BOUNDARY_WHITESPACE','invalid Markdown source selector.');
      const selected=sectionText(content.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),source.selector.fragment).trim();
      expect(selected&&sha256(selected)===source.selected_sha256,`${source.role} selected fragment #${source.selector.fragment} changed; refresh this adapter.`);
    }else{
      expect(!source.selector,`unsupported source selector for ${source.role}; refresh with a supported intake version.`);
      expect(actual===source.sha256,`${source.role} source changed: ${sourceFile}. This source has no explicit fragment/selector, so full-file verification remains conservative; use a precise fragment or a dedicated file and refresh intake.`);
    }
  }
  const settings=packet.production_settings||{};
  if(packet.input_mode==='STATE_JSON'){
    expect(['SCOPED_STATE_V2','SCOPED_STATE_V3'].includes(packet.state_scope?.profile),'scoped state validation is missing.');
    const selected=Object.fromEntries(['video_aspect_ratio','visual_style','segment_max_s'].map(key=>[key,pick(settings[key]||{},['selected','status','decision_ref'])]));
    expect(same(selected,packet.state_scope.production_settings),'packet production_settings drifted from the scoped authority snapshot.');
  }
  for(const key of ['video_aspect_ratio','visual_style','segment_max_s'])expect(settings[key]?.status==='CONFIRMED'&&settings[key]?.decision_ref,`${key} has no confirmed decision.`);
  const ratio=String(settings.video_aspect_ratio.selected).match(/^([\d.]+)\s*[:：/]\s*([\d.]+)$/);
  expect(ratio&&Number(ratio[1])>0&&Number(ratio[2])>0,'aspect ratio is not numerically mapped.');
  expect(Math.abs(scene.width/scene.height-Number(ratio[1])/Number(ratio[2]))<.002,'render aspect ratio changes the upstream decision.');
  const budget=packet.budget;
  expect(budget?.time_basis==='SEGMENT','budget clock must be SEGMENT.');
  for(const key of ['formal_id','prompt_version','budget_version'])expect(budget[key]===packet[key],`budget ${key} differs from target lineage.`);
  const limit=typeof settings.segment_max_s.selected==='object'?settings.segment_max_s.selected?.value:settings.segment_max_s.selected;
  expect(typeof limit==='number'&&Number.isFinite(limit)&&limit>0&&budget.duration_s<=limit&&near(budget.target_max_s,limit),'budget exceeds or changes the confirmed segment limit.');
  expect(near(scene.duration,budget.duration_s),'scene duration changes the upstream budget.');
  expect(scene.shots.length===budget.shots.length,'shot count differs; a phase must not become a cut.');
  const map=scene.adaptationMap;
  expect(Array.isArray(map)&&map.length===budget.shots.length,'every source shot needs one explicit adaptation map.');
  budget.shots.forEach((source,i)=>{
    const shot=scene.shots[i],entry=map.find(m=>m.source_shot_id===source.id);
    expect(shot.id===source.id&&near(shot.start,source.start_s)&&near(shot.end,source.end_s),`shot ${source.id} ID/interval was changed.`);
    expect(entry&&entry.scene_shot_id===shot.id&&entry.source_ref&&entry.status==='MAPPED',`shot ${source.id} has no source mapping.`);
  });
  const profiles=packet.asset_catalog?.characters||packet.upstream_snapshot?.character_profiles||[];
  const characters=Array.isArray(profiles)?profiles:Object.entries(profiles).map(([id,value])=>({id,...(typeof value==='object'?value:{text:value})}));
  expect(Array.isArray(scene.assetBindings),'assetBindings is required, including [] for a no-character scene.');
  expect(scene.assetBindings.length===scene.actors.length,'every actor must have exactly one upstream asset binding.');
  expect(new Set(scene.assetBindings.map(b=>b.actorId)).size===scene.assetBindings.length,'actor bindings must be unique.');
  for(const actor of scene.actors){
    const binding=scene.assetBindings.find(b=>b.actorId===actor.id);
    expect(binding?.assetId&&binding.representation,`${actor.id} is not bound to an upstream character.`);
    const profile=characters.find(p=>(p.id||p.character_id||p.asset_id)===binding.assetId);
    expect(profile&&near(profile.height_cm,binding.height_cm),`${actor.id}: upstream height/identity mapping is missing or inconsistent.`);
    const versions=[...registry(packet.upstream_snapshot?.character_assets),...registry(packet.asset_catalog?.characters)].filter(entry=>assetId(entry)===binding.assetId);
    for(const field of ['look_version','state_version']){
      const candidates=binding.look_version||binding.state_version?versions.flatMap(assetVersionRecords):versions;
      const known=new Set(candidates.map(entry=>entry[field]).filter(Boolean));
      if(known.size||binding[field])expect(binding[field]&&known.has(binding[field]),`${actor.id}: ${field} is missing or differs from explicit upstream provenance.`);
    }
    expect(near(actor.height,binding.height_cm/100),`${actor.id}: scene height differs from the upstream centimetre value.`);
    if(binding.appearanceReference)await readFile(path.resolve(root,binding.appearanceReference));
  }
  checkRelatedAssets(scene,packet,liveState);
  const transitions=checkTransitionContext(packet,liveState);
  return {packet,file,intakeSha256:sha256(bytes),structuralOnly:true,transitions,diagnostics:packet.diagnostics||[]};
}
