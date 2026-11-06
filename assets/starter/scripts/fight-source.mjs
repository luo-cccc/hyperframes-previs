import {sectionText} from './source-fragments.mjs';
/** Independent xianxia-fight-director adapter; no check-upstream import or upstream code. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const FIGHT_PROVIDER='xianxia-fight-director';
export const FIGHT_SCHEMA='PREVIS_FIGHT_ADAPTER_V1';
const PROFILE='FIGHT_SELECTED_SCOPE_V1', EPS=1e-6;
const ACTORS=new Set(['character','creature','manifestation']);
const KINDS=new Set([...ACTORS,'scene','prop','formation']);
const EVIDENCE_ROLES=new Set(['design','assets','storyboard','keyframes','execution','review']);
const hash=data=>createHash('sha256').update(data).digest('hex');
const near=(a,b)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=EPS;
function demand(ok,message,code='INVALID_FIGHT_SOURCE'){
  if(!ok){const error=new Error('Fight adapter: '+message);error.code=code;throw error;}
}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fields(value,required,optional=[],label='project'){
  demand(isObject(value),label+': expected object');
  const allowed=new Set([...required,...optional]);
  demand(required.every(key=>Object.hasOwn(value,key)),label+': missing required fields');
  demand(Object.keys(value).every(key=>allowed.has(key)),label+': unknown fields');
}
function text(value,label){demand(typeof value==='string'&&value.trim().length>0&&Buffer.from(value).toString('utf8')===value,label+': expected nonempty valid Unicode text');}
function number(value,label){demand(typeof value==='number'&&Number.isFinite(value),label+': expected finite number, not boolean');demand(Math.abs(value)<=Number.MAX_SAFE_INTEGER,label+': timing exceeds exact JavaScript numeric range; no rounded adaptation is permitted');}
function strings(value,label,nonempty=false,unique=false){
  demand(Array.isArray(value)&&(!nonempty||value.length>0),label+': expected '+(nonempty?'nonempty ':'')+'text array');
  value.forEach(item=>text(item,label));
  demand(!unique||new Set(value).size===value.length,label+': duplicate references');
}

/** Source byte hashes and scoped semantic identities have different purposes. */
export function fightSelectionSha256(value){
  function encode(item){
    if(item===null)return 'null';
    if(typeof item==='boolean')return item?'true':'false';
    if(typeof item==='number'){
      number(item,'canonical number');const bytes=Buffer.alloc(8);bytes.writeDoubleBE(item===0?0:item);return 'n'+bytes.toString('hex');
    }
    if(typeof item==='string')return JSON.stringify(item);
    if(Array.isArray(item))return '['+item.map(encode).join(',')+']';
    demand(isObject(item),'Cannot hash non-JSON value');
    return '{'+Object.keys(item).sort().map(key=>encode(key)+':'+encode(item[key])).join(',')+'}';
  }
  return hash('FIGHT_CANONICAL_V1\n'+encode(value));
}
const same=(a,b)=>fightSelectionSha256(a)===fightSelectionSha256(b);

/** A small strict JSON reader also rejects duplicate keys, invalid UTF8 and overflow. */
export function parseFightJson(bytes,label='JSON'){
  let source;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}
  catch{demand(false,label+': invalid UTF8');}
  let offset=0;
  function token(){
    while(offset<source.length&&/[ \t\r\n]/.test(source[offset]))offset++;
    const tail=source.slice(offset), match=tail.match(/^(?:"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\[\],:])/);
    demand(match,label+': invalid token at '+offset);offset+=match[0].length;return match[0];
  }
  function value(first,depth){
    demand(depth<256,label+': nesting too deep');
    if(first==='{'){
      const result=Object.create(null);let next=token();if(next==='}')return result;
      for(;;){
        demand(next.startsWith('"'),label+': object key must be a string');const key=JSON.parse(next);
        demand(!Object.hasOwn(result,key),label+': duplicate JSON key '+key);
        demand(token()===':',label+': missing colon');result[key]=value(token(),depth+1);next=token();
        if(next==='}')return result;demand(next===',',label+': missing comma');next=token();
      }
    }
    if(first==='['){
      const result=[];let next=token();if(next===']')return result;
      for(;;){result.push(value(next,depth+1));next=token();if(next===']')return result;demand(next===',',label+': missing comma');next=token();}
    }
    let result;try{result=JSON.parse(first);}catch{demand(false,label+': invalid scalar');}
    demand(typeof result!=='number'||Number.isFinite(result),label+': non-finite number');
    demand(result===null||typeof result!=='object',label+': unexpected scalar');return result;
  }
  const result=value(token(),0);demand(source.slice(offset).trim()==='',label+': trailing content');return result;
}

export function validateFightProject(project){
  fields(project,'schema_version title duration_sec aspect_ratio style assumptions constraints design assets scene beats shots segments keyframes'.split(' '),['cost','knowledge','review']);
  demand(['1.1','1.2'].includes(project.schema_version),'schema_version: only declared 1.1/1.2 is supported');
  const modern=project.schema_version==='1.2';
  demand(modern||(!Object.hasOwn(project,'cost')&&!Object.hasOwn(project,'knowledge')),'1.1 cannot contain 1.2 cost/knowledge fields');
  for(const key of ['title','aspect_ratio','style'])text(project[key],key);
  number(project.duration_sec,'duration_sec');demand(project.duration_sec>0,'duration_sec: must be positive');
  for(const key of ['assumptions','constraints'])strings(project[key],key);
  fields(project.design,['goals','rules','turns','outcome'],['viewing_tasks'],'design');
  for(const key of ['goals','rules','turns','viewing_tasks'])if(Object.hasOwn(project.design,key))strings(project.design[key],'design.'+key,true);
  text(project.design.outcome,'design.outcome');
  if(Object.hasOwn(project,'review')){
    const review=project.review;fields(review,['scope','fixed','pending','invalidated','verification'],['media_observations'],'review');
    for(const key of ['scope','verification'])text(review[key],'review.'+key);
    for(const key of ['fixed','pending','invalidated'])strings(review[key],'review.'+key);
    if(Object.hasOwn(review,'media_observations')){
      demand(Array.isArray(review.media_observations),'review.media_observations: expected array');
      for(const row of review.media_observations){fields(row,['source','kind','observation','limitations'],[],'review.media_observations');Object.values(row).forEach(v=>text(v,'media observation'));demand(['image','video','audio'].includes(row.kind),'review.media_observations.kind: unsupported');}
    }
  }
  const shapes={assets:['id kind name anchors states image_prompt','reference'],beats:['id start end actors action response result requires',modern?'marks':''],shots:['id start end beat_ids asset_ids opening_state camera effects sound end_state execution'+(modern?' light risk':''),modern?'fallback':''],segments:['id shot_ids opening_state closing_state prompt_context',''],keyframes:['id shot_id time_sec asset_ids state prompt'+(modern?' role':''),'']};
  if(modern){shapes.cost=['id owner item from_beat irreversible consequence',''];if(Object.hasOwn(project,'knowledge'))shapes.knowledge=['id holder belief truth from_beat cue','resolved_by'];}
  const ids=new Set(),maps={};
  for(const [group,[required,optional]] of Object.entries(shapes)){
    demand(Array.isArray(project[group])&&project[group].length>0,group+': expected nonempty array');maps[group]=new Map();
    for(const row of project[group]){
      fields(row,required.split(' '),optional?optional.split(' '):[],group);text(row.id,group+'.id');
      demand(/^[A-Za-z][A-Za-z0-9_-]*$/.test(row.id)&&!ids.has(row.id),group+'.id: invalid or repeated global ID '+row.id);
      ids.add(row.id);maps[group].set(row.id,row);
    }
  }
  fields(project.scene,['asset_id','geography',...(modern?['attrition']:[])],[],'scene');text(project.scene.geography,'scene.geography');
  const assets=maps.assets,beats=maps.beats,shots=maps.shots;
  function refs(values,table,label,allowEmpty=false,actors=false){
    strings(values,label,!allowEmpty,true);for(const id of values){demand(table.has(id),label+': unknown reference '+id);if(actors)demand(ACTORS.has(table.get(id).kind),label+': expected acting asset');}
  }
  function interval(row,label){number(row.start,label+'.start');number(row.end,label+'.end');demand(row.start>=0&&row.start<row.end&&row.end<=project.duration_sec+EPS,label+': invalid battle interval');}
  for(const row of project.assets){
    demand(KINDS.has(row.kind),'assets.kind: unsupported');for(const key of ['name','image_prompt'])text(row[key],'assets.'+key);
    strings(row.anchors,'assets.anchors',true);strings(row.states,'assets.states');
    if(Object.hasOwn(row,'reference')){fields(row.reference,['source','control','keep','exclude'],[],'assets.reference');Object.values(row.reference).forEach(v=>text(v,'assets.reference'));}
  }
  refs([project.scene.asset_id],assets,'scene.asset_id');demand(assets.get(project.scene.asset_id).kind==='scene','scene.asset_id: expected scene asset');
  for(const row of project.beats){
    interval(row,'beats.'+row.id);refs(row.actors,assets,'beats.actors',false,true);refs(row.requires,beats,'beats.requires',true);
    for(const key of ['action','response','result'])text(row[key],'beats.'+key);
    if(Object.hasOwn(row,'marks')){strings(row.marks,'beats.marks',true,true);demand(row.marks.every(mark=>['pivotal','breath','adaptation'].includes(mark)),'beats.marks: unsupported');}
    for(const id of row.requires)demand(id!==row.id&&beats.get(id).end<=row.start+EPS,'beats.requires: self or unfinished dependency');
  }
  const completed=new Set(),pending=new Set(beats.keys());
  while(pending.size){const ready=[...pending].filter(id=>beats.get(id).requires.every(ref=>completed.has(ref)));demand(ready.length>0,'beats.requires: dependency cycle');for(const id of ready){completed.add(id);pending.delete(id);}}
  const copyable=[],coverage=new Map([...beats.keys()].map(id=>[id,[]]));let cursor=0,previous=null;
  for(const shot of project.shots){
    interval(shot,'shots.'+shot.id);demand(near(shot.start,cursor),'shots: gap, overlap or order mismatch');cursor=shot.end;
    refs(shot.asset_ids,assets,'shots.asset_ids');refs(shot.beat_ids,beats,'shots.beat_ids');
    for(const key of ['opening_state','end_state','camera','effects','sound',...(modern?['light']:[])])text(shot[key],'shots.'+key);
    if(modern){demand(['low','high'].includes(shot.risk),'shots.risk: unsupported');demand(Object.hasOwn(shot,'fallback')===(shot.risk==='high'),'shots.fallback: required only for high risk');if(Object.hasOwn(shot,'fallback'))copyable.push(shot.fallback);}
    const execution=shot.execution,execKeys=['opening_state','end_state','camera','effects','sound',...(modern?['light']:[])];
    fields(execution,[...execKeys,'cues'],[],'shots.execution');for(const key of execKeys){text(execution[key],'execution.'+key);copyable.push(execution[key]);}
    demand(Array.isArray(execution.cues)&&execution.cues.length>0,'execution.cues: expected nonempty array');let edge=shot.start;
    for(const cue of execution.cues){
      fields(cue,['start','end','text'],[],'execution.cues');number(cue.start,'cue.start');number(cue.end,'cue.end');text(cue.text,'cue.text');
      demand(cue.start>=shot.start-EPS&&cue.start<cue.end&&cue.end<=shot.end+EPS,'execution.cues: outside owning shot');demand(near(cue.start,edge),'execution.cues: not continuous');edge=cue.end;copyable.push(cue.text);
    }
    demand(near(edge,shot.end),'execution.cues: missing shot end');
    if(previous){demand(previous.end_state===shot.opening_state,'shots: world states are not literally continuous');demand(previous.execution.end_state===execution.opening_state,'shots: execution states are not literally continuous');}previous=shot;
    for(const id of shot.beat_ids){const beat=beats.get(id),start=Math.max(beat.start,shot.start),end=Math.min(beat.end,shot.end);demand(start<end,'shots.beat_ids: no positive overlap');coverage.get(id).push([start,end]);}
  }
  demand(near(cursor,project.duration_sec),'shots: battle timeline is incomplete');
  for(const [id,windows] of coverage){let edge=beats.get(id).start;for(const [start,end] of windows.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){demand(start<=edge+EPS,'beats: uncovered window '+id);edge=Math.max(edge,end);}demand(edge>=beats.get(id).end-EPS,'beats: incomplete coverage '+id);}
  const assigned=[];
  for(const row of project.segments){refs(row.shot_ids,shots,'segments.shot_ids');for(const key of ['opening_state','closing_state','prompt_context'])text(row[key],'segments.'+key);demand(row.opening_state===shots.get(row.shot_ids[0]).opening_state&&row.closing_state===shots.get(row.shot_ids.at(-1)).end_state,'segments: states differ from owning whole shots');assigned.push(...row.shot_ids);copyable.push(row.prompt_context);}
  demand(same(assigned,project.shots.map(shot=>shot.id)),'segments: each whole shot must be assigned exactly once in original order');
  const frameCounts=new Map([...shots.keys()].map(id=>[id,0]));
  for(const frame of project.keyframes){
    refs([frame.shot_id],shots,'keyframes.shot_id');refs(frame.asset_ids,assets,'keyframes.asset_ids');const shot=shots.get(frame.shot_id);
    demand(frame.asset_ids.every(id=>shot.asset_ids.includes(id)),'keyframes.asset_ids: not registered in owning shot');number(frame.time_sec,'keyframes.time_sec');demand(frame.time_sec>=shot.start-EPS&&frame.time_sec<=shot.end+EPS,'keyframes.time_sec: outside closed owning-shot interval');
    text(frame.state,'keyframes.state');text(frame.prompt,'keyframes.prompt');if(modern)demand(['single','prep','contact','result','handoff'].includes(frame.role),'keyframes.role: unsupported');frameCounts.set(frame.shot_id,frameCounts.get(frame.shot_id)+1);copyable.push(frame.prompt);
  }
  demand([...frameCounts.values()].every(Boolean),'keyframes: every shot needs a frame');
  if(modern){
    demand(Array.isArray(project.scene.attrition)&&project.scene.attrition.length>0,'scene.attrition: expected nonempty array');
    for(const row of project.scene.attrition){fields(row,['id','mark','from_beat','consequence'],[],'scene.attrition');text(row.id,'attrition.id');demand(/^[A-Za-z][A-Za-z0-9_-]*$/.test(row.id)&&!ids.has(row.id),'attrition.id: invalid or repeated global ID');ids.add(row.id);text(row.mark,'attrition.mark');text(row.consequence,'attrition.consequence');refs([row.from_beat],beats,'attrition.from_beat');}
    for(const group of ['cost','knowledge'])for(const row of project[group]||[]){
      refs([row[group==='cost'?'owner':'holder']],assets,group+'.owner',false,true);refs([row.from_beat],beats,group+'.from_beat');
      for(const key of group==='cost'?['item','consequence']:['belief','truth','cue'])text(row[key],group+'.'+key);
      if(group==='cost')demand(typeof row.irreversible==='boolean','cost.irreversible: expected boolean');
      else{demand(row.belief!==row.truth,'knowledge: belief equals truth');if(Object.hasOwn(row,'resolved_by')){refs([row.resolved_by],beats,'knowledge.resolved_by');demand(row.resolved_by!==row.from_beat&&beats.get(row.resolved_by).start>=beats.get(row.from_beat).start-EPS,'knowledge.resolved_by: same or earlier than origin');}}
    }
    const marked=Object.fromEntries(['pivotal','breath','adaptation'].map(mark=>[mark,project.beats.filter(beat=>beat.marks?.includes(mark))]));
    demand(Object.values(marked).every(rows=>rows.length>0),'beats.marks: pivotal, breath and adaptation required');
    for(const beat of marked.pivotal){const times=['prep','contact','result'].map(role=>{const picked=project.keyframes.filter(frame=>frame.role===role&&frame.time_sec>=beat.start-EPS&&frame.time_sec<=beat.end+EPS).map(frame=>frame.time_sec);demand(picked.length>0,'keyframes: pivotal missing '+role);return Math.min(...picked);});demand(times[0]<times[1]&&times[1]<times[2],'keyframes: pivotal role times must increase');}
    for(const beat of marked.breath)demand(!beat.marks.includes('pivotal')&&!marked.pivotal.some(other=>beat.start<other.end-EPS&&other.start<beat.end-EPS),'beats: breath overlaps pivotal');
    demand(marked.adaptation.every(beat=>beat.requires.length>0),'beats: adaptation missing completed prerequisite');
    for(const segment of project.segments.slice(0,-1)){const last=shots.get(segment.shot_ids.at(-1)),picked=project.keyframes.filter(frame=>frame.role==='handoff'&&near(frame.time_sec,last.end));demand(picked.length>0&&picked.every(frame=>frame.shot_id===last.id),'keyframes: handoff must belong to preceding segment final shot at closed endpoint');}
    demand(project.shots.length===1||new Set(project.shots.map(shot=>shot.light)).size>=2,'shots.light: differing multi-shot light registration required');
    const earliest=Math.min(...marked.pivotal.map(beat=>beat.start));demand(project.scene.attrition.some(row=>beats.get(row.from_beat).end<=earliest+EPS),'scene.attrition: no mark before pivotal beat');
    demand(project.cost.some(row=>row.irreversible)&&new Set(project.cost.map(row=>row.owner)).size>=2,'cost: irreversible expenditure and two owners required');
  }
  for(const value of copyable){text(value,'copyable text');demand(!/[0-9]+(?:\.[0-9]+)?\s*秒|[0-9]+(?:[:：][0-9]{1,2}){1,2}(?:\.[0-9]+)?/.test(value),'copyable text: numeric timecode belongs in cue fields');demand(![...ids].some(id=>id.length>=4&&value.includes(id)),'copyable text: internal registered ID leaked');}
  return project;
}

export function selectFightProject(project,segmentId){
  const candidates=project.segments.filter(row=>row.id===segmentId);demand(candidates.length===1,'Unknown or ambiguous original segment ID '+segmentId);
  const segment=candidates[0],shotsById=new Map(project.shots.map(row=>[row.id,row])),beatsById=new Map(project.beats.map(row=>[row.id,row]));
  const shots=segment.shot_ids.map(id=>shotsById.get(id)),end=shots.at(-1).end,beatIds=new Set();
  function include(id){if(!beatIds.has(id)){beatIds.add(id);beatsById.get(id).requires.forEach(include);}}
  shots.forEach(shot=>shot.beat_ids.forEach(include));
  const relevant=row=>beatIds.has(row.from_beat)||beatsById.get(row.from_beat).start<end;
  const cost=(project.cost||[]).filter(relevant),attrition=(project.scene.attrition||[]).filter(relevant),knowledge=(project.knowledge||[]).filter(relevant);
  for(const row of [...cost,...attrition,...knowledge]){include(row.from_beat);if(Object.hasOwn(row,'resolved_by'))include(row.resolved_by);}
  const boundaries=[],frameIds=new Set(),index=project.segments.indexOf(segment);
  for(const priorIndex of [index-1,index]){
    if(priorIndex<0||priorIndex>=project.segments.length-1)continue;
    const before=project.segments[priorIndex],after=project.segments[priorIndex+1],last=shotsById.get(before.shot_ids.at(-1)),first=shotsById.get(after.shot_ids[0]);
    const keyframes=project.keyframes.filter(frame=>frame.role==='handoff'&&frame.shot_id===last.id&&near(frame.time_sec,last.end));keyframes.forEach(frame=>frameIds.add(frame.id));
    boundaries.push({from_unit_id:before.id,to_unit_id:after.id,from_shot_id:last.id,to_shot_id:first.id,battle_time_s:last.end,world_state:last.end_state,execution_state:last.execution.end_state,keyframes});
  }
  for(const frame of project.keyframes){const owner=shotsById.get(frame.shot_id);if(segment.shot_ids.includes(frame.shot_id)||owner.beat_ids.some(id=>beatIds.has(id)&&frame.time_sec>=beatsById.get(id).start-EPS&&frame.time_sec<=beatsById.get(id).end+EPS))frameIds.add(frame.id);}
  const keyframes=project.keyframes.filter(frame=>frameIds.has(frame.id)),assetIds=new Set([project.scene.asset_id]);
  shots.forEach(shot=>shot.asset_ids.forEach(id=>assetIds.add(id)));beatIds.forEach(id=>beatsById.get(id).actors.forEach(actor=>assetIds.add(actor)));keyframes.forEach(frame=>frame.asset_ids.forEach(id=>assetIds.add(id)));cost.forEach(row=>assetIds.add(row.owner));knowledge.forEach(row=>assetIds.add(row.holder));
  return {schema_version:PROFILE,source_schema_version:project.schema_version,battle:Object.fromEntries(['title','aspect_ratio','style','assumptions','constraints','design'].map(key=>[key,project[key]])),segment,shots,beats:project.beats.filter(beat=>beatIds.has(beat.id)),assets:project.assets.filter(asset=>assetIds.has(asset.id)),keyframes,scene:Object.fromEntries(Object.entries(project.scene).filter(([key])=>key!=='attrition')),cost,attrition,knowledge,states:{world:{opening_state:shots[0].opening_state,end_state:shots.at(-1).end_state},execution:{opening_state:shots[0].execution.opening_state,end_state:shots.at(-1).execution.end_state},segment:{opening_state:segment.opening_state,closing_state:segment.closing_state}},transition_context:{schema_version:'PREVIS_FIGHT_BOUNDARY_CONTEXT_V1',unit_id:segmentId,boundaries}};
}
function mappedBudget(selection){
  const start=selection.shots[0].start,end=selection.shots.at(-1).end;
  return {unit:{id:selection.segment.id,battle_start_s:start,battle_end_s:end,duration_s:end-start},budget:{time_basis:'SEGMENT',duration_s:end-start,shots:selection.shots.map(shot=>({id:shot.id,start_s:shot.start-start,end_s:shot.end-start,duration_s:shot.end-shot.start,battle_start_s:shot.start,battle_end_s:shot.end}))}};
}
function executionMaster(selection){
  const fragments=[{pointer:'/segments/@'+selection.segment.id+'/prompt_context',text:selection.segment.prompt_context}];
  for(const shot of selection.shots){const prefix='/shots/@'+shot.id+'/execution/',execution=shot.execution;fragments.push({pointer:prefix+'opening_state',text:execution.opening_state});execution.cues.forEach((cue,index)=>fragments.push({pointer:prefix+'cues/'+index+'/text',text:cue.text}));for(const key of ['camera','effects','light','sound','end_state'])if(Object.hasOwn(execution,key))fragments.push({pointer:prefix+key,text:execution[key]});}
  const content=fragments.map(row=>row.text).join('\n\n');return {text:content,text_sha256:hash(content),origin:'SELECTED_EXECUTION_FIELDS',fragments};
}
function assetCatalog(selection){return {assets:selection.assets,actors:selection.assets.filter(row=>ACTORS.has(row.kind)),...Object.fromEntries([['characters','character'],['creatures','creature'],['manifestations','manifestation'],['props','prop'],['formations','formation'],['scenes','scene']].map(([name,kind])=>[name,selection.assets.filter(row=>row.kind===kind)]))};}
function validateDraft(draft){
  fields(draft,['schema_version','project','segment_id','mapping','assumptions'],[],'draft');demand(draft.schema_version==='PREVIS_FIGHT_DRAFT_V1','draft: unsupported declared schema');text(draft.segment_id,'draft.segment_id');strings(draft.assumptions,'draft.assumptions');validateFightProject(draft.project);demand(Array.isArray(draft.mapping)&&draft.mapping.length>0,'draft.mapping: explicit evidence mapping required');const roles=new Set();
  for(const row of draft.mapping){
    fields(row,['target','role','locator'],[],'draft.mapping');Object.values(row).forEach(value=>text(value,'draft.mapping'));demand(EVIDENCE_ROLES.has(row.role),'draft.mapping: unsupported role');demand(row.target==='/project'||row.target.startsWith('/project/'),'draft.mapping: expected /project pointer');
    let current=draft;for(const raw of row.target.split('/').slice(1)){const key=raw.replaceAll('~1','/').replaceAll('~0','~');if(Array.isArray(current))demand(/^(?:0|[1-9][0-9]*)$/.test(key),'draft.mapping: noncanonical array index');demand(current!==null&&typeof current==='object'&&Object.hasOwn(current,key),'draft.mapping: unresolved pointer '+row.target);current=current[key];}roles.add(row.role);
  }
  demand(roles.size===EVIDENCE_ROLES.size,'draft.mapping: six original evidence roles require explicit locators');selectFightProject(draft.project,draft.segment_id);return draft;
}
function checkScene(scene,packet,diagnostics){
  if(Object.hasOwn(scene,'fightClock')){const clock=scene.fightClock;fields(clock,['battle_start_s','battle_end_s','unit_id'],[],'scene.fightClock');demand(near(clock.battle_start_s,packet.unit.battle_start_s)&&near(clock.battle_end_s,packet.unit.battle_end_s)&&clock.unit_id===packet.unit.id,'fightClock changes original battle endpoints or unit ID','FIGHT_BINDING_MISMATCH');}
  demand(near(scene.duration,packet.budget.duration_s),'scene duration changes original segment budget','FIGHT_BINDING_MISMATCH');
  demand(Array.isArray(scene.shots)&&scene.shots.length===packet.budget.shots.length,'scene shot count changes original whole-shot assignment','FIGHT_BINDING_MISMATCH');
  packet.budget.shots.forEach((source,index)=>{const shot=scene.shots[index];demand(shot?.id===source.id&&near(shot.start,source.start_s)&&near(shot.end,source.end_s),'scene shot ID/order/local window differs from '+source.id,'FIGHT_BINDING_MISMATCH');});
  if(Object.hasOwn(scene,'adaptationMap')){
    demand(Array.isArray(scene.adaptationMap)&&scene.adaptationMap.length===scene.shots.length,'adaptationMap: every source shot requires one mapping','FIGHT_BINDING_MISMATCH');
    demand(new Set(scene.adaptationMap.map(row=>row.source_shot_id)).size===scene.shots.length,'adaptationMap: duplicate source mapping','FIGHT_BINDING_MISMATCH');
    for(const shot of scene.shots){const row=scene.adaptationMap.find(entry=>entry.source_shot_id===shot.id);demand(row?.scene_shot_id===shot.id&&row.status==='MAPPED'&&typeof row.source_ref==='string'&&row.source_ref.trim(),'adaptationMap: missing explicit source identity','FIGHT_BINDING_MISMATCH');}
  }else diagnostics.push({code:'SHOT_MAPPING_BY_EXACT_ID_AND_WINDOW',scope:'scene mapping',message:'Shot IDs/order/windows checked directly; no separate adaptationMap supplied.'});
  demand(Array.isArray(scene.actors)&&Array.isArray(scene.assetBindings),'scene requires actors and assetBindings (empty arrays allowed)','FIGHT_BINDING_MISMATCH');
  demand(scene.assetBindings.length===scene.actors.length&&new Set(scene.assetBindings.map(row=>row.actorId)).size===scene.actors.length&&new Set(scene.actors.map(row=>row.id)).size===scene.actors.length,'each actor requires exactly one unique actorId/assetId binding','FIGHT_BINDING_MISMATCH');
  demand(new Set(scene.assetBindings.map(row=>row.assetId)).size===scene.assetBindings.length,'a source actor cannot silently become duplicate bodies','FIGHT_BINDING_MISMATCH');
  for(const actor of scene.actors){const binding=scene.assetBindings.find(row=>row.actorId===actor.id);demand(binding&&packet.asset_catalog.actors.some(row=>row.id===binding.assetId&&ACTORS.has(row.kind)),actor.id+': missing original character/creature/manifestation asset','FIGHT_BINDING_MISMATCH');{number(actor.height,'local actor.height');demand(actor.height>0,'local actor.height: must be positive');diagnostics.push({code:'LOCAL_PROXY_SCALE',scope:actor.id,message:'Height is a local proxy dimension; no upstream height or LOOK field is inferred.'});}}
  const ratio=packet.selection.battle.aspect_ratio.match(/^\s*([0-9.]+)\s*[:：/]\s*([0-9.]+)\s*$/);
  if(ratio&&Number(ratio[1])>0&&Number(ratio[2])>0){number(scene.width,'scene.width');number(scene.height,'scene.height');demand(scene.width>0&&scene.height>0&&Math.abs(scene.width/scene.height-Number(ratio[1])/Number(ratio[2]))<.002,'scene aspect ratio changes source setting','FIGHT_BINDING_MISMATCH');}
  else diagnostics.push({code:'ASPECT_RATIO_NEEDS_LOCAL_MAPPING',scope:'render settings',message:'Source aspect description retained; no numeric ratio invented.'});
}

export async function checkFightUpstream(root,scene){
  const binding=scene?.upstream;demand(binding&&typeof binding.intake==='string'&&binding.intake.trim(),'scene.upstream.intake is required','FIGHT_BINDING_MISMATCH');
  const file=path.resolve(root,binding.intake),bytes=await readFile(file),intakeSha256=hash(bytes),packet=parseFightJson(bytes,'fight intake');
  demand(binding.intake_sha256===intakeSha256,'intake bytes changed; explicitly bind a new packet revision','FIGHT_BINDING_MISMATCH');
  demand(packet.schema_version===FIGHT_SCHEMA&&packet.adapter_version==='0.6.0'&&packet.provider===FIGHT_PROVIDER&&packet.source_kind===FIGHT_PROVIDER,'packet schema/provider/adapter version unsupported','FIGHT_PACKET_INVALID');
  demand(binding.provider===FIGHT_PROVIDER&&(!binding.schema_version||binding.schema_version===FIGHT_SCHEMA)&&isObject(binding.lineage)&&same(binding.lineage,packet.lineage),'binding must match provider and complete original lineage','FIGHT_BINDING_MISMATCH');
  demand(['FIGHT_JSON','FIGHT_TRANSCRIPTION'].includes(packet.input_mode)&&packet.validation_profile===PROFILE,'unsupported input mode or scoped profile','FIGHT_PACKET_INVALID');
  demand(packet.semantic_status==='needs_review'&&packet.semantic_review==='NOT_RUN'&&packet.upstream_writes===false&&packet.mapped_structural_status==='pass','intake cannot claim semantic/media acceptance','FIGHT_PACKET_INVALID');
  const manual=packet.input_mode==='FIGHT_TRANSCRIPTION';demand(packet.structural_status===(manual?'NOT_CLAIMED':'pass'),'incorrect original-source structural claim','FIGHT_PACKET_INVALID');
  validateFightProject(packet.source_snapshot);
  const expected=selectFightProject(packet.source_snapshot,packet.unit?.id),selectedHash=fightSelectionSha256(expected),mapped=mappedBudget(expected);
  demand(same(expected,packet.selection)&&packet.source_selection?.profile===PROFILE&&packet.source_selection.segment_id===packet.unit.id&&packet.source_selection.identity==='FIGHT_CANONICAL_V1'&&packet.source_selection.selected_sha256===selectedHash,'sealed selection differs from original snapshot','FIGHT_PACKET_INVALID');
  demand(same(mapped.unit,packet.unit)&&same(mapped.budget,packet.budget)&&same(executionMaster(expected),packet.master)&&same(assetCatalog(expected),packet.asset_catalog)&&same(expected.transition_context,packet.transition_context)&&same(packet.source_snapshot.review??null,packet.review),'derived budget/master/assets/state mapping changed','FIGHT_PACKET_INVALID');
  demand(Array.isArray(packet.sources)&&packet.sources.length>0,'source evidence missing','FIGHT_PACKET_INVALID');
  const sourceRole=manual?'draft':'project',primary=packet.sources.filter(row=>row.role===sourceRole);demand(primary.length===1,'exactly one original project/draft source required','FIGHT_PACKET_INVALID');
  const source=primary[0];demand(source.selector?.kind==='FIGHT_SEGMENT_V1'&&source.selector.profile===PROFILE&&source.selector.segment_id===packet.unit.id&&source.selected_sha256===selectedHash,'unsupported source selection','FIGHT_PACKET_INVALID');
  const lineage={source_kind:FIGHT_PROVIDER,battle_id:'UNKNOWN',battle_title:expected.battle.title,unit_id:packet.unit.id,source_revision:'sha256:'+source.sha256,unit_revision:'sha256:'+selectedHash};
  demand(same(lineage,packet.lineage),'lineage does not identify original evidence and selected unit','FIGHT_PACKET_INVALID');
  const diagnostics=Array.isArray(packet.diagnostics)?structuredClone(packet.diagnostics):[];
  const frozen=[];let currentProject=null,currentSelection=null;
  const evidenceRoles=new Set();
  demand(Array.isArray(packet.evidence_snapshot),'sealed evidence snapshots missing','FIGHT_PACKET_INVALID');
  demand(new Set(packet.evidence_snapshot.map(row=>row.role)).size===packet.evidence_snapshot.length,'duplicate sealed evidence snapshot','FIGHT_PACKET_INVALID');
  for(const row of packet.sources){
    text(row.path,'source.path');demand(typeof row.sha256==='string'&&/^[0-9a-f]{64}$/.test(row.sha256),'source evidence SHA256 invalid','FIGHT_PACKET_INVALID');
    const sourceFile=path.resolve(path.dirname(file),row.path),raw=await readFile(sourceFile);frozen.push({file:sourceFile,raw});
    if(row===source){
      const live=parseFightJson(raw,'live fight source');
      if(manual){
        validateDraft(live);validateDraft(packet.draft_snapshot);demand(live.segment_id===packet.unit.id&&packet.draft_snapshot.segment_id===packet.unit.id&&same(packet.draft_snapshot.project,packet.source_snapshot),'draft snapshot has wrong project/segment','FIGHT_PACKET_INVALID');
        const original={mapping:packet.draft_snapshot.mapping,assumptions:packet.draft_snapshot.assumptions,segment_id:packet.unit.id};
        demand(packet.transcription?.schema_version==='PREVIS_FIGHT_DRAFT_V1'&&packet.transcription.source_claim==='HUMAN_TRANSCRIPTION_ONLY'&&same(packet.transcription.mapping,original.mapping)&&same(packet.transcription.assumptions,original.assumptions)&&packet.transcription.sha256===fightSelectionSha256(original),'sealed human mapping changed','FIGHT_PACKET_INVALID');
        demand(same(original,{mapping:live.mapping,assumptions:live.assumptions,segment_id:live.segment_id}),'explicit human mapping or assumptions changed','FIGHT_SOURCE_CHANGED');currentProject=live.project;
      }else currentProject=validateFightProject(live);
      currentSelection=selectFightProject(currentProject,packet.unit.id);
      demand(fightSelectionSha256(currentSelection)===selectedHash,'selected segment, shot/cue, related beat/prerequisite, asset, keyframe, resource, knowledge or world rule changed; refresh this unit','FIGHT_SOURCE_CHANGED');
      if(hash(raw)!==row.sha256)diagnostics.push({code:'SOURCE_BYTES_CHANGED_OUTSIDE_SELECTION',scope:packet.unit.id,message:'Original full-file SHA retained as evidence; current selected dependencies still match.',original_sha256:row.sha256,current_sha256:hash(raw)});
      if(!same(currentProject.review??null,packet.review))diagnostics.push({code:'UPSTREAM_REVIEW_CHANGED',scope:'author notes only',message:'Original author review retained. Current annotations differ; no semantic or media acceptance inferred.',current_review:currentProject.review??null});
    }else{
      demand(EVIDENCE_ROLES.has(row.role)&&!evidenceRoles.has(row.role),'unknown or duplicated evidence role','FIGHT_PACKET_INVALID');evidenceRoles.add(row.role);demand(!row.selector||row.selector.kind==='MARKDOWN_FRAGMENT_V1'&&typeof row.selector.fragment==='string'&&row.selector.fragment&&row.selector.normalization==='LF_STRIP_BOUNDARY_WHITESPACE','unsupported original-evidence selector','FIGHT_PACKET_INVALID');
      const sealed=packet.evidence_snapshot.find(entry=>entry.role===row.role);demand(sealed&&sealed.sha256===row.sha256&&typeof sealed.bytes_base64==='string','original evidence byte snapshot missing','FIGHT_PACKET_INVALID');const original=Buffer.from(sealed.bytes_base64,'base64');demand(original.toString('utf8').replace(/^\uFEFF/,'').trim().length>0,'empty original evidence cannot establish a six-part delivery','FIGHT_PACKET_INVALID');demand(original.toString('base64')===sealed.bytes_base64&&hash(original)===row.sha256,'sealed original evidence bytes do not match SHA256','FIGHT_PACKET_INVALID');
      if(row.selector){const select=bytes=>sectionText(bytes.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),row.selector.fragment).trim();demand(hash(Buffer.from(select(original),'utf8'))===row.selected_sha256,'sealed selected evidence differs from original bytes','FIGHT_PACKET_INVALID');demand(hash(Buffer.from(select(raw),'utf8'))===row.selected_sha256,'selected '+row.role+' evidence fragment changed; re-read this scope','FIGHT_SOURCE_CHANGED');if(hash(raw)!==row.sha256)diagnostics.push({code:'EVIDENCE_BYTES_CHANGED_OUTSIDE_FRAGMENT',role:row.role,fragment:row.selector.fragment});}
      else if(row.role==='review'&&hash(raw)!==row.sha256)diagnostics.push({code:'UPSTREAM_REVIEW_EVIDENCE_CHANGED',scope:'review annotations',message:'Original review evidence hash retained; review-only edits do not invalidate animation.'});
      else demand(hash(raw)===row.sha256,'explicit '+row.role+' evidence bytes changed; re-read and seal the human mapping','FIGHT_SOURCE_CHANGED');
    }
  }
  demand(packet.evidence_snapshot.length===evidenceRoles.size,'unmatched sealed evidence snapshots','FIGHT_PACKET_INVALID');
  demand(currentSelection!==null,'live project was not checked','FIGHT_PACKET_INVALID');if(manual)demand(evidenceRoles.size===EVIDENCE_ROLES.size,'manual intake requires all six original evidence files','FIGHT_PACKET_INVALID');
  checkScene(scene,packet,diagnostics);
  for(const entry of frozen)demand((await readFile(entry.file)).equals(entry.raw),'source changed during validation; retry a stable snapshot','FIGHT_SOURCE_CHANGED');
  const context=currentSelection.transition_context,declared=context.boundaries.length>0;
  return {packet,file,intakeSha256,structuralOnly:true,lineage:packet.lineage,transitions:{status:declared?'CURRENT':'NOT_DECLARED',expected_sha256:declared?fightSelectionSha256(expected.transition_context):null,current_sha256:declared?fightSelectionSha256(context):null,context,reasons:[]},diagnostics};
}
