import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const TRANSITION_SCHEMA='PREVIS_TRANSITION_CONTEXT_V1';
export const TRANSITION_HASH_PROFILE='PREVIS_TRANSITION_DEPENDENCIES_V1';
const clone=value=>JSON.parse(JSON.stringify(value));
const sortedKeys=value=>Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
const normalized=value=>Array.isArray(value)?value.map(normalized):value&&typeof value==='object'?Object.fromEntries(sortedKeys(value).map(key=>[key,normalized(value[key])])):value;
const same=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
const tagged=value=>{
  if(value===null)return ['null'];
  if(typeof value==='boolean')return ['boolean',value];
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new Error('Transition dependencies contain a non-finite JSON number.');
    const bytes=Buffer.alloc(8);bytes.writeDoubleBE(value===0?0:value);return ['number',bytes.toString('hex')];
  }
  if(typeof value==='string')return ['string',value];
  if(Array.isArray(value))return ['array',value.map(tagged)];
  if(value&&typeof value==='object')return ['object',sortedKeys(value).map(key=>[key,tagged(value[key])])];
  throw new Error('Transition dependencies must contain only JSON values.');
};

export function transitionContextSha256(context){
  const selected=Object.fromEntries(['schema_version','formal_id','prompt_version','plans','reviews','endpoint_dependencies'].map(key=>[key,context[key]]));
  return createHash('sha256').update(JSON.stringify(tagged(selected))).digest('hex');
}

const boundaryMatches=(declared,current)=>{
  if(declared===undefined||declared===null||declared===''||(typeof declared==='object'&&!Array.isArray(declared)&&Object.keys(declared).length===0))return false;
  if(declared&&typeof declared==='object'&&!Array.isArray(declared)&&current&&typeof current==='object'&&!Array.isArray(current))current=Object.fromEntries(Object.entries(current).filter(([key])=>!['source','viewing'].includes(key)||Object.hasOwn(declared,key)));
  return same(declared,current);
};

/** Retain original records, binding only current endpoint versions/boundaries. */
export function collectTransitionContext(state,formalId,promptVersion,sourceRef){
  const context={schema_version:TRANSITION_SCHEMA,formal_id:formalId,prompt_version:promptVersion,plans:[],reviews:[],endpoint_dependencies:[],source_locations:[],diagnostics:[],hash_profile:TRANSITION_HASH_PROFILE};
  if(sourceRef!==undefined)context.source_ref=sourceRef;
  const coverageRows=state.coverage_ledger?.length?state.coverage_ledger:state.coverage&&typeof state.coverage==='object'?[state.coverage]:[];
  const unique=(rows,filter)=>{
    const groups=new Map();for(const row of rows)if(filter(row)){const values=groups.get(row.formal_id)||[];values.push(row);groups.set(row.formal_id,values)}
    return new Map([...groups].filter(([,values])=>values.length===1).map(([id,values])=>[id,values[0]]));
  };
  const delivered=unique(coverageRows,row=>row?.status==='DONE');
  const planRows=Object.hasOwn(state,'segment_plan')?state.segment_plan:[];
  if(!Array.isArray(planRows))context.diagnostics.push({code:'UNSUPPORTED_SEGMENT_PLAN_COLLECTION',path:'/segment_plan',message:'Expected an explicit segment plan list; no endpoint plan versions were guessed.'});
  const planned=unique(Array.isArray(planRows)?planRows:[],row=>row&&typeof row==='object'&&row.status!=='INVALID');
  const endpoint=(record,side)=>{
    const value=record[side],nested=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return {id:typeof value==='object'?nested.formal_id??nested.id:value,version:Object.hasOwn(record,side+'_prompt_version')?record[side+'_prompt_version']:nested.prompt_version,planVersion:Object.hasOwn(record,side+'_plan_version')?record[side+'_plan_version']:nested.plan_version};
  };
  const bind=(record,side,collection)=>{
    const {id,version,planVersion}=endpoint(record,side);if(typeof id!=='string'||!id)return null;
    const current=delivered.get(id),plan=planned.get(id),boundaryKey=side==='from'?'end_state':'start_state',boundary=record[side==='from'?'previous_end_state':'next_start_state'];
    let basis;
    if(planVersion!==undefined&&planVersion!==null&&(!plan||planVersion!==plan.plan_version))return null;
    if(current){
      if(version!==undefined&&version!==null){if(version!==current.prompt_version)return null;basis='EXPLICIT_PROMPT_VERSION'}
      else if(collection==='transition_plan'&&boundaryMatches(boundary,current[boundaryKey]))basis='MATCHING_BOUNDARY_STATE';
      else return null;
      return {formal_id:id,prompt_version:current.prompt_version??null,delivery_status:'DONE',source_script_version:current.source_script_version??null,boundary_state:clone(current[boundaryKey]??null),binding_basis:basis};
    }
    if(planVersion!==undefined&&planVersion!==null){if(!plan||planVersion!==plan.plan_version)return null;basis='EXPLICIT_PLAN_VERSION'}
    else if(collection==='transition_plan'&&plan&&boundaryMatches(boundary,plan[boundaryKey]))basis='MATCHING_PLANNED_BOUNDARY_STATE';
    else if(version!==undefined&&version!==null&&(record.status==='PLANNED'||record.actual_next_formal_delivered===false))basis='DECLARED_FUTURE_PROMPT_VERSION';
    else return null;
    const result={formal_id:id,delivery_status:'PLANNED',binding_basis:basis};
    if(plan&&Object.hasOwn(plan,'plan_version'))result.plan_version=plan.plan_version;
    if(version!==undefined&&version!==null)result.prompt_version=version;
    if(plan&&Object.hasOwn(plan,boundaryKey))result.boundary_state=clone(plan[boundaryKey]);
    return result;
  };
  for(const [collection,output] of [['transition_plan','plans'],['transition_review','reviews']]){
    const rows=Object.hasOwn(state,collection)?state[collection]:[];
    if(!Array.isArray(rows)){context.diagnostics.push({code:'UNSUPPORTED_TRANSITION_COLLECTION',path:'/'+collection,message:'Expected the upstream transition list; no records were guessed.'});continue}
    rows.forEach((record,index)=>{
      if(!record||typeof record!=='object'||Array.isArray(record))return;
      const pair=Object.fromEntries(['from','to'].map(side=>[side,endpoint(record,side).id])),own=record.formal_id===formalId;
      if(!own&&!Object.values(pair).includes(formalId))return;
      if(record.status==='INVALID'||record.review_status==='INVALID')return;
      const dependencies={};
      if(own){if(record.prompt_version!==promptVersion)return;dependencies.formal={formal_id:formalId,prompt_version:promptVersion}}
      if(Object.values(pair).includes(formalId)){
        Object.assign(dependencies,Object.fromEntries(['from','to'].map(side=>[side,bind(record,side,collection)])));
        if(Object.values(dependencies).some(value=>value===null)){context.diagnostics.push({code:'TRANSITION_VERSION_NOT_CURRENT',path:'/'+collection+'/'+index,message:'Endpoint versions/boundary evidence do not bind to the current delivery or current plan; record omitted.'});return}
        if(Object.values(dependencies).some(value=>value.formal_id===formalId&&value.prompt_version!==promptVersion))return;
      }
      const selectedIndex=context[output].length;
      context[output].push(clone(record));
      context.endpoint_dependencies.push({collection:output,record_index:selectedIndex,endpoints:dependencies});
      context.source_locations.push({collection:output,record_index:selectedIndex,pointer:'/'+collection+'/'+index});
      if(Object.values(dependencies).some(item=>item.delivery_status==='PLANNED'))context.diagnostics.push({code:'TRANSITION_ENDPOINT_NOT_DELIVERED',path:'/'+collection+'/'+index,message:'A selected endpoint is only planned. The original record is retained; delivery and media checks are not promoted.'});
    });
  }
  context.sha256=transitionContextSha256(context);return context;
}

/** Check alias identity against the actual filesystem, retaining raw upstream fields. */
export async function resolveSourceScriptRef(script,base){
  const fail=message=>{throw new Error('Upstream adapter: '+message)};
  if(!script||typeof script!=='object'||Array.isArray(script))fail('source_script_ref must be an object with path or location and an explicit version.');
  const aliases=Object.fromEntries(['path','location'].filter(key=>Object.hasOwn(script,key)).map(key=>[key,script[key]]));
  if(!Object.keys(aliases).length)fail('source_script_ref.path or source_script_ref.location is required; neither field is present.');
  const resolved=[];
  for(const [key,value] of Object.entries(aliases)){
    if(typeof value!=='string'||!value.trim())fail('source_script_ref.'+key+' must be a nonempty local reference.');
    const split=value.indexOf('#'),raw=split<0?value:value.slice(0,split),fragment=split<0?'':value.slice(split+1);
    if(/^(https?|chat|conversation|user-message):/i.test(raw))fail('source_script_ref.'+key+': save/read the actual referenced content before CLI intake.');
    let file;
    try{file=await realpath(path.resolve(base,raw));if(!(await stat(file)).isFile())throw new Error('Referenced file is not a regular file.')}catch(error){fail('source_script_ref.'+key+': '+error.message)}
    resolved.push({path:file.replace(/\\/g,'/'),fragment});
  }
  const equivalent=(a,b)=>(process.platform==='win32'?a.path.toLowerCase()===b.path.toLowerCase():a.path===b.path)&&a.fragment===b.fragment;
  if(resolved.length===2&&!equivalent(resolved[0],resolved[1]))fail('source_script_ref.path and source_script_ref.location conflict: they resolve to different files or Markdown fragments.');
  return {aliases,resolved_path:resolved[0].path,fragment:resolved[0].fragment};
}

/** Transition-only edits cannot invalidate the core mother script or video. */
export function checkTransitionContext(packet,liveState){
  const expected=packet.transition_context;
  const current=liveState?collectTransitionContext(liveState,packet.formal_id,packet.prompt_version,expected?.source_ref):expected||collectTransitionContext({},packet.formal_id,packet.prompt_version);
  if(!expected)return {status:'NOT_DECLARED',expected_sha256:null,current_sha256:null,context:current,reasons:['This intake has no sealed transition context. Re-extract explicitly to track transition dependencies.']};
  if(expected.schema_version!==TRANSITION_SCHEMA||expected.hash_profile!==TRANSITION_HASH_PROFILE||expected.formal_id!==packet.formal_id||expected.prompt_version!==packet.prompt_version||expected.sha256!==transitionContextSha256(expected))throw new Error('Upstream adapter: sealed transition context integrity/lineage mismatch; re-extract this intake.');
  const changed=expected.sha256!==current.sha256,declared=expected.plans.length+expected.reviews.length+current.plans.length+current.reviews.length>0;
  return {status:changed?'STALE':declared?'CURRENT':'NOT_DECLARED',expected_sha256:expected.sha256,current_sha256:current.sha256,context:current,reasons:changed?['Related transition records or endpoint versions/boundaries changed. Recheck connection evidence; core authority remains valid.']:declared?[]:['No version-bound transition plan/review is declared for this formal.']};
}
