import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {sectionText} from './source-fragments.mjs';
import {ADAPTER_VERSION} from './adapter-version.mjs';

export const STORYBOARD_PROVIDER='storyboard';
export const STORYBOARD_SCHEMA='PREVIS_STORYBOARD_ADAPTER_V1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&Buffer.from(value).toString('utf8')===value;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER;
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-6;
const need=(ok,message)=>{if(!ok)throw new Error('Storyboard adapter: '+message)};
const normalize=value=>value.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');

/** Same numeric/Unicode canonical form as the read-only Python intake. */
export function storyboardSelectionSha256(value){
  function encode(item){
    if(item===null)return 'null';
    if(typeof item==='boolean')return item?'true':'false';
    if(typeof item==='number'){need(finite(item),'canonical value must be finite and exactly representable.');const bytes=Buffer.alloc(8);bytes.writeDoubleBE(item===0?0:item);return 'n'+bytes.toString('hex')}
    if(typeof item==='string'){need(Buffer.from(item).toString('utf8')===item,'source contains invalid Unicode.');return JSON.stringify(item)}
    if(Array.isArray(item))return '['+item.map(encode).join(',')+']';
    need(object(item),'canonical value must contain only JSON values.');
    return '{'+Object.keys(item).sort().map(key=>encode(key)+':'+encode(item[key])).join(',')+'}';
  }
  return hash('STORYBOARD_CANONICAL_V1\n'+encode(value));
}
const same=(a,b)=>storyboardSelectionSha256(a)===storyboardSelectionSha256(b);

export function selectStoryboardSource(source,masterSha256){
  need(object(source)&&['PREVIS_STORYBOARD_SOURCE_V1','PREVIS_STORYBOARD_DRAFT_V1'].includes(source.schema_version),'unsupported normalized source; retain original input and create a supported explicit source/draft.');
  need(text(source.id)&&source.time_basis==='SEGMENT'&&finite(source.duration_s)&&source.duration_s>0,'source requires original id, SEGMENT clock and positive duration_s.');
  need(object(source.master)&&text(source.master.path),'source master.path must reference the actual source text artifact.');
  need(source.asset_catalog===undefined||object(source.asset_catalog),'source asset_catalog must be an object when supplied.');
  for(const key of ['project_id','version'])if(Object.hasOwn(source,key))need(text(source[key]),'source '+key+' must be nonempty text when supplied.');
  need(Array.isArray(source.shots)&&source.shots.length>0,'source shots are missing.');
  const ids=new Set();let cursor=0;
  for(const shot of source.shots){
    need(object(shot)&&text(shot.id)&&!ids.has(shot.id),'source shot IDs must be nonempty and unique.');ids.add(shot.id);
    need(near(shot.start_s,cursor)&&finite(shot.end_s)&&shot.end_s>shot.start_s&&shot.end_s<=source.duration_s+1e-6,'source shots must continuously cover the original segment.');cursor=shot.end_s;
    if(Object.hasOwn(shot,'duration_s'))need(near(shot.duration_s,shot.end_s-shot.start_s),'explicit source shot.duration_s differs from its interval.');
  }
  need(near(cursor,source.duration_s),'source shots do not cover the segment end.');
  const asset_catalog={};
  for(const group of ['actors','scenes','props']){
    const rows=source.asset_catalog&&Object.hasOwn(source.asset_catalog,group)?source.asset_catalog[group]:[];need(Array.isArray(rows),'asset_catalog.'+group+' must be an array.');
    need(rows.every(row=>object(row)&&text(row.id))&&new Set(rows.map(row=>row.id)).size===rows.length,'asset_catalog.'+group+' has missing or duplicate IDs.');asset_catalog[group]=rows;
    for(const row of rows){
      for(const field of ['height_cm','height_m'])if(Object.hasOwn(row,field))need(finite(row[field])&&row[field]>0,'explicit source '+field+' must be positive.');
      if(Object.hasOwn(row,'height_cm')&&Object.hasOwn(row,'height_m'))need(near(row.height_cm/100,row.height_m),'explicit source height_cm and height_m conflict.');
    }
  }
  need(source.production_settings===undefined||object(source.production_settings),'production_settings must be an object when supplied.');
  need(source.assumptions===undefined||Array.isArray(source.assumptions),'assumptions must be an array when supplied.');
  const unit={id:source.id,duration_s:source.duration_s,source_start_s:0,source_end_s:source.duration_s};
  const budget={time_basis:'SEGMENT',duration_s:source.duration_s,shots:source.shots.map(shot=>({id:shot.id,start_s:shot.start_s,end_s:shot.end_s,duration_s:shot.end_s-shot.start_s}))};
  return {unit,budget,shots:source.shots,production_settings:source.production_settings||{},asset_catalog,states:{start_state:source.start_state??null,end_state:source.end_state??null},assumptions:source.assumptions||[],master_sha256:masterSha256};
}

export async function checkStoryboardUpstream(root,scene,{packet,file,bytes,parseJson}){
  need(packet.schema_version===STORYBOARD_SCHEMA&&packet.provider===STORYBOARD_PROVIDER,'source provider/schema differs from the generic storyboard intake.');
  need(packet.adapter_version===ADAPTER_VERSION,'unsupported adapter version; create a current explicit intake.');
  need(scene.upstream.provider===STORYBOARD_PROVIDER&&same(scene.upstream.lineage,packet.lineage),'source binding lineage differs from intake.');
  need(packet.upstream_writes===false,'intake must explicitly preserve read-only upstream access.');
  need(['STORYBOARD_JSON','STORYBOARD_TRANSCRIPTION'].includes(packet.input_mode),'unsupported generic input mode.');
  need(packet.hash_profile==='STORYBOARD_CANONICAL_V1'&&packet.validation_profile==='STORYBOARD_EXPLICIT_SOURCE_V1','unsupported generic validation/hash profile.');
  need(text(packet.master?.text)&&hash(packet.master.text)===packet.master.text_sha256,'master text integrity mismatch.');
  need(Array.isArray(packet.sources)&&packet.sources.length>0,'explicit source evidence is required.');
  for(const role of ['input','master'])need(packet.sources.filter(source=>source.role===role).length===1,'exactly one '+role+' source is required.');
  let input=null,inputHash=null,master=null;const diagnostics=[...(packet.diagnostics||[])];
  for(const source of packet.sources){
    need(text(source.role)&&text(source.path)&&/^[a-f0-9]{64}$/.test(source.sha256),'every source requires role, path and SHA-256.');
    const content=await readFile(path.resolve(path.dirname(file),source.path)),actual=hash(content);
    let selected=source.role==='master'||source.selector?normalize(new TextDecoder('utf-8',{fatal:true}).decode(content)):null;
    if(source.selector){
      need(source.selector.kind==='MARKDOWN_FRAGMENT_V1'&&text(source.selector.fragment)&&source.selector.normalization==='LF_STRIP_BOUNDARY_WHITESPACE','unsupported source selector.');
      need(source.role!=='input','normalized input JSON must be verified as a whole file.');
      selected=sectionText(selected,source.selector.fragment);
      need(hash(selected.trim())===source.selected_sha256,'selected '+source.role+' fragment changed; read and seal a new intake revision.');
      if(actual!==source.sha256)diagnostics.push({code:'SOURCE_OUTSIDE_SELECTED_FRAGMENT_CHANGED',role:source.role,path:source.path,first_sha256:source.sha256,current_sha256:actual,scope:'Selected fragment remains unchanged; this source difference does not invalidate the selected unit.'});
    }else need(actual===source.sha256,source.role+' source changed; read and seal a new intake revision.');
    if(source.role==='input'){input=parseJson(content.toString('utf8'),'generic storyboard source JSON');inputHash=actual;}
    if(source.role==='master')master=selected;
  }
  need(master===packet.master.text,'master copy differs from its actual source.');
  need(same(input,packet.source_snapshot),'source snapshot differs from its actual normalized input.');
  need(input.schema_version===(packet.input_mode==='STORYBOARD_JSON'?'PREVIS_STORYBOARD_SOURCE_V1':'PREVIS_STORYBOARD_DRAFT_V1'),'input mode must preserve explicit source versus human transcription.');
  const selection=selectStoryboardSource(input,packet.master.text_sha256);
  need(same(selection,packet.selection),'selected source records differ from the sealed selection.');
  for(const key of ['unit','budget','production_settings','asset_catalog','states','assumptions'])need(same(packet[key],selection[key]),key+' drifted from the selected source.');
  const expectedLineage={source_kind:STORYBOARD_PROVIDER,unit_id:selection.unit.id,source_revision:inputHash,unit_revision:storyboardSelectionSha256(selection)};
  for(const key of ['project_id','version']){
    need(Object.hasOwn(input,key)===Object.hasOwn(packet.lineage,key),'source lineage must preserve only explicitly supplied '+key+'.');
    if(Object.hasOwn(input,key))expectedLineage[key]=input[key];
  }
  need(same(packet.lineage,expectedLineage),'source/unit revision or explicit lineage mismatch.');
  need(near(scene.duration,selection.unit.duration_s),'scene duration changes the source budget.');
  const aspect=selection.production_settings.video_aspect_ratio;
  if(aspect!==undefined){
    const ratio=String(aspect).match(/^\s*([\d.]+)\s*[:：/]\s*([\d.]+)\s*$/);
    need(ratio&&Number(ratio[1])>0&&Number(ratio[2])>0,'supplied aspect ratio is not numerically mapped.');
    need(Math.abs(scene.width/scene.height-Number(ratio[1])/Number(ratio[2]))<.002,'render aspect ratio changes the supplied source setting.');
  }
  need(Array.isArray(scene.shots)&&scene.shots.length===selection.budget.shots.length,'shot count differs; a phase must not become a cut.');
  need(Array.isArray(scene.adaptationMap)&&scene.adaptationMap.length===scene.shots.length,'every source shot needs an explicit adaptation map.');
  need(new Set(scene.adaptationMap.map(row=>row.source_shot_id)).size===scene.adaptationMap.length,'duplicate source shot mapping.');
  selection.budget.shots.forEach((shot,index)=>{
    const target=scene.shots[index],mapping=scene.adaptationMap.find(row=>row.source_shot_id===shot.id);
    need(target.id===shot.id&&near(target.start,shot.start_s)&&near(target.end,shot.end_s),'original shot ID/order/interval changed: '+shot.id);
    need(mapping&&mapping.scene_shot_id===target.id&&text(mapping.source_ref)&&mapping.status==='MAPPED','shot has no source mapping: '+shot.id);
  });
  need(Array.isArray(scene.assetBindings)&&scene.assetBindings.length===scene.actors.length,'every actor needs exactly one source asset binding, including [] for no actors.');
  need(new Set(scene.assetBindings.map(row=>row.actorId)).size===scene.assetBindings.length,'actor bindings must be unique.');
  for(const actor of scene.actors){
    const binding=scene.assetBindings.find(row=>row.actorId===actor.id),source=selection.asset_catalog.actors.find(row=>row.id===binding?.assetId);
    need(binding&&source&&text(binding.representation),'actor is not bound to an explicit source asset: '+actor.id);
    if(source.height_cm!==undefined||source.height_m!==undefined){
      const height=source.height_cm!==undefined?source.height_cm/100:source.height_m;
      need(finite(height)&&height>0&&near(actor.height,height),'actor height changes an explicit source dimension: '+actor.id);
      for(const field of ['height_cm','height_m'])if(binding[field]!==undefined)need(source[field]!==undefined&&near(binding[field],source[field]),'binding invents or changes source '+field+': '+actor.id);
    }else{
      need(['LOCAL_EXECUTION_ASSUMPTION','EXECUTION_ASSUMPTION'].includes(binding.dimensions_basis),'missing source dimensions require an explicit local execution assumption: '+actor.id);
      need(binding.height_cm===undefined&&binding.height_m===undefined,'local proxy dimensions must not be labelled as upstream height: '+actor.id);
    }
    for(const field of ['look_version','state_version'])if(binding[field]!==undefined||source[field]!==undefined)need(binding[field]===source[field],'asset version differs from explicit source provenance: '+field);
    if(binding.appearanceReference)await readFile(path.resolve(root,binding.appearanceReference));
  }
  for(const group of ['actors','scenes','props']){
    const field=group;
    const declared=scene.sourceAssetIds?.[field];if(declared===undefined)continue;
    need(Array.isArray(declared)&&new Set(declared).size===declared.length&&declared.every(id=>selection.asset_catalog[group].some(row=>row.id===id)),'sourceAssetIds.'+field+' must name unique actual source assets.');
    if(group==='actors')need(scene.assetBindings.every(row=>declared.includes(row.assetId)),'sourceAssetIds.actors omits a bound actor.');
  }
  need(scene.sourceAssetIds?.characters===undefined,'sourceAssetIds.characters is unsupported; declare sourceAssetIds.actors.');
  return {packet,file,intakeSha256:hash(bytes),structuralOnly:true,transitions:{status:'NOT_DECLARED',reasons:['Generic storyboard sources do not declare a workflow transition ledger.']},diagnostics};
}
