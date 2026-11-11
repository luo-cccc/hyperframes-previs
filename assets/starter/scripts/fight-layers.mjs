/** Optional fight 1.3 author records. These checks do not produce animation. */
export const LAYER_FIELDS=['tracks','vfx','forms','transitions'];
export const LAYER_PROFILE='FIGHT_SELECTED_SCOPE_V2';

export function validateFightLayers(project,ids,{fields,text,strings,demand,EPS}){
  const assets=new Map(project.assets.map(row=>[row.id,row])),beats=new Map(project.beats.map(row=>[row.id,row])),shots=new Map(project.shots.map(row=>[row.id,row])),costs=new Map((project.cost||[]).map(row=>[row.id,row])),copyable=[];
  function rows(group,required,optional=[]){
    if(!Object.hasOwn(project,group))return [];
    const value=project[group];demand(Array.isArray(value)&&value.length>0,group+': expected nonempty array');
    for(const row of value){fields(row,required,optional,group);text(row.id,group+'.id');demand(/^[A-Za-z][A-Za-z0-9_-]*$/.test(row.id)&&!ids.has(row.id),group+'.id: invalid or repeated global ID');ids.add(row.id);}
    return value;
  }
  function refs(values,mapping,label){strings(values,label,true,true);demand(values.every(value=>mapping.has(value)),label+': unknown reference');}
  const tracks=rows('tracks',['id','kind','name','time_relation']),trackMap=new Map(tracks.map(row=>[row.id,row]));
  if(tracks.length){demand(tracks.filter(row=>row.kind==='world').length===1&&tracks.some(row=>row.kind==='inner'),'tracks: one world and at least one inner required');for(const row of tracks){demand(['world','inner'].includes(row.kind),'tracks.kind: unsupported');copyable.push(row.name,row.time_relation);}}
  const previousByTrack=new Map();let previous=null;
  for(const beat of project.beats)demand(tracks.length?trackMap.has(beat.track):!Object.hasOwn(beat,'track'),'beats.track: must match declared tracks');
  for(const shot of project.shots){
    demand(tracks.length?trackMap.has(shot.track):!Object.hasOwn(shot,'track')&&!Object.hasOwn(shot,'outer_state'),'shots.track: must match declared tracks');
    if(tracks.length){
      demand(shot.beat_ids.every(id=>beats.get(id).track===shot.track),'shots.beat_ids: track differs from beat');
      const inner=trackMap.get(shot.track).kind==='inner';demand(Object.hasOwn(shot,'outer_state')===inner,'shots.outer_state: required only on inner track');if(inner)text(shot.outer_state,'shots.outer_state');
      const prior=previousByTrack.get(shot.track),returning=!inner&&previous&&trackMap.get(previous.track).kind==='inner';
      if(returning)demand(shot.opening_state===previous.outer_state,'shots: return to world differs from latest outer_state');
      else if(prior)demand(prior.end_state===shot.opening_state&&prior.execution.end_state===shot.execution.opening_state,'shots: track states are not literally continuous');
      previousByTrack.set(shot.track,shot);
    }
    previous=shot;
  }
  for(const row of rows('vfx',['id','owner','name','layer','scale','function','look','lifecycle','spends','route','shot_ids'],['asset_id'])){
    demand(assets.has(row.owner),'vfx.owner: unknown asset');demand(['world','post'].includes(row.layer)&&['micro','body','field','heaven'].includes(row.scale)&&['one_pass','composite','asset'].includes(row.route),'vfx: unsupported layer, scale or route');
    for(const key of ['name','function','look','spends'])text(row[key],'vfx.'+key);refs(row.shot_ids,shots,'vfx.shot_ids');
    fields(row.lifecycle,['release'],['omen','travel','contact','result','residue','fade'],'vfx.lifecycle');Object.values(row.lifecycle).forEach(value=>text(value,'vfx.lifecycle'));
    demand(!(row.layer==='post'&&['contact','residue'].some(key=>Object.hasOwn(row.lifecycle,key))),'vfx.lifecycle: post cannot contact or leave residue');
    demand(row.layer!=='world'||['residue','fade'].some(key=>Object.hasOwn(row.lifecycle,key)),'vfx.lifecycle: world needs residue or fade');
    demand(Object.hasOwn(row,'asset_id')===(row.route==='asset'),'vfx.asset_id: required only for asset route');if(Object.hasOwn(row,'asset_id'))demand(assets.has(row.asset_id),'vfx.asset_id: unknown asset');
    copyable.push(row.name,row.look,...Object.values(row.lifecycle));
  }
  const forms=rows('forms',['id','actor','from_asset','to_asset','beat_id','shot_ids','method','ladder','shared_anchors','cost_id','duration','exit']);
  for(const row of forms){
    demand(assets.has(row.actor)&&['character','creature','manifestation'].includes(assets.get(row.actor).kind),'forms.actor: expected acting asset');
    demand(assets.has(row.from_asset)&&assets.has(row.to_asset)&&row.from_asset!==row.to_asset,'forms: two different registered assets required');
    demand(beats.has(row.beat_id)&&beats.get(row.beat_id).marks?.includes('pivotal'),'forms.beat_id: expected pivotal beat');
    demand(costs.has(row.cost_id)&&costs.get(row.cost_id).owner===row.actor,'forms.cost_id: cost belongs to transforming actor');demand(['occlusion','morph','cut'].includes(row.method),'forms.method: unsupported');
    strings(row.ladder,'forms.ladder',true);demand(row.ladder.length>=3,'forms.ladder: at least three stages required');strings(row.shared_anchors,'forms.shared_anchors',true,true);
    demand(row.shared_anchors.every(anchor=>assets.get(row.from_asset).anchors.includes(anchor)&&assets.get(row.to_asset).anchors.includes(anchor)),'forms.shared_anchors: anchor not literal in both assets');
    for(const key of ['duration','exit'])text(row[key],'forms.'+key);refs(row.shot_ids,shots,'forms.shot_ids');
    for(const id of row.shot_ids){const shot=shots.get(id);demand(shot.beat_ids.includes(row.beat_id)&&[row.from_asset,row.to_asset].every(asset=>shot.asset_ids.includes(asset)),'forms.shot_ids: needs beat and both form assets');demand(row.method!=='morph'||shot.risk==='high','forms: morph requires high risk shots');}
    copyable.push(...row.ladder,...row.shared_anchors);
  }
  const transitions=rows('transitions',['id','from_shot','to_shot','method','layer','keeps','changes','cut_condition','route'],['occluder']);
  demand(transitions.length<=2*Math.ceil(project.duration_sec/30),'transitions: density limit exceeded');
  const indices=new Map(project.shots.map((row,index)=>[row.id,index])),cuts=new Set(),carriers=['occlusion','medium_pass','cloud_pass','space_tear','ink_bleed'],methods=[...carriers,'match_graphic','match_action','whip','eyeline','sound_bridge','dissolve'];
  for(const row of transitions){
    demand(shots.has(row.from_shot)&&shots.has(row.to_shot)&&indices.get(row.to_shot)===indices.get(row.from_shot)+1,'transitions: adjacent shots required');const cut=row.from_shot+'\n'+row.to_shot;demand(!cuts.has(cut),'transitions: one registration per cut');cuts.add(cut);
    demand(methods.includes(row.method)&&['world','post'].includes(row.layer)&&['cut','composite','bridge'].includes(row.route),'transitions: unsupported method, layer or route');
    demand(Object.hasOwn(row,'occluder')===carriers.includes(row.method),'transitions.occluder: required only for carrier method');
    for(const key of ['keeps','changes']){strings(row[key],'transitions.'+key,true);copyable.push(...row[key]);}
    for(const key of ['cut_condition',...(Object.hasOwn(row,'occluder')?['occluder']:[])]){text(row[key],'transitions.'+key);copyable.push(row[key]);}
    const before=shots.get(row.from_shot),after=shots.get(row.to_shot);
    if(row.layer==='post'){demand(before.track===after.track,'transitions: post cannot cross tracks');demand(!forms.some(form=>form.shot_ids.includes(before.id)&&form.shot_ids.includes(after.id)),'transitions: post cannot occur within a form switch');}
    demand(row.route!=='bridge'||before.risk==='high'&&after.risk==='high','transitions: bridge requires both shots high risk');
  }
  return copyable;
}

export function selectFightLayers(project,selection){
  const chosen=new Set(selection.shots.map(row=>row.id)),end=selection.shots.at(-1).end,shots=new Map(project.shots.map(row=>[row.id,row]));
  const vfx=(project.vfx||[]).filter(row=>row.shot_ids.some(id=>shots.get(id).start<end)),forms=(project.forms||[]).filter(row=>row.shot_ids.some(id=>shots.get(id).start<end)),transitions=(project.transitions||[]).filter(row=>chosen.has(row.from_shot)||chosen.has(row.to_shot));
  const dependencyIds=new Set([...vfx,...forms].flatMap(row=>row.shot_ids));for(const row of transitions){dependencyIds.add(row.from_shot);dependencyIds.add(row.to_shot);}if(project.tracks?.length)for(const row of project.shots)if(row.start<end)dependencyIds.add(row.id);
  const dependencies=project.shots.filter(row=>dependencyIds.has(row.id)&&!chosen.has(row.id)),assetIds=new Set(selection.assets.map(row=>row.id)),beatIds=new Set(selection.beats.map(row=>row.id)),beats=new Map(project.beats.map(row=>[row.id,row]));
  const frameIds=new Set(selection.keyframes.map(row=>row.id));for(const row of project.keyframes)if(dependencyIds.has(row.shot_id))frameIds.add(row.id);selection.keyframes=project.keyframes.filter(row=>frameIds.has(row.id));for(const row of selection.keyframes)for(const id of row.asset_ids)assetIds.add(id);
  function includeBeat(id){if(!beatIds.has(id)){beatIds.add(id);for(const prior of beats.get(id).requires)includeBeat(prior);}}
  for(const row of dependencies)for(const id of row.beat_ids)includeBeat(id);
  const formCosts=new Set(forms.map(row=>row.cost_id));for(const row of project.cost||[])if(formCosts.has(row.id)&&!selection.cost.some(item=>item.id===row.id)){selection.cost.push(row);includeBeat(row.from_beat);}
  const groups=[['cost',project.cost||[]],['attrition',project.scene.attrition||[]],['knowledge',project.knowledge||[]]],resourceIds=new Map(groups.map(([name])=>[name,new Set(selection[name].map(row=>row.id))]));
  for(;;){const previous=beatIds.size+[...resourceIds.values()].reduce((sum,rows)=>sum+rows.size,0);for(const [name,rows]of groups)for(const row of rows)if(beatIds.has(row.from_beat)||beatIds.has(row.resolved_by)){resourceIds.get(name).add(row.id);includeBeat(row.from_beat);if(row.resolved_by)includeBeat(row.resolved_by);}if(previous===beatIds.size+[...resourceIds.values()].reduce((sum,rows)=>sum+rows.size,0))break;}
  for(const [name,rows]of groups)selection[name]=rows.filter(row=>resourceIds.get(name).has(row.id));
  for(const id of beatIds)for(const actor of beats.get(id).actors)assetIds.add(actor);
  for(const row of selection.cost)assetIds.add(row.owner);for(const row of selection.knowledge)assetIds.add(row.holder);
  for(const row of vfx){assetIds.add(row.owner);if(Object.hasOwn(row,'asset_id'))assetIds.add(row.asset_id);}for(const row of forms)for(const key of ['actor','from_asset','to_asset'])assetIds.add(row[key]);for(const row of dependencies)for(const id of row.asset_ids)assetIds.add(id);
  Object.assign(selection,{schema_version:LAYER_PROFILE,tracks:project.tracks||[],vfx,forms,transitions,layer_dependencies:{shots:dependencies}});selection.assets=project.assets.filter(row=>assetIds.has(row.id));
  selection.beats=project.beats.filter(row=>beatIds.has(row.id));
  for(const row of selection.transition_context.boundaries){const before=shots.get(row.from_shot_id),after=shots.get(row.to_shot_id);Object.assign(row,{from_track:before.track??null,to_track:after.track??null,outer_state:before.outer_state??null,transitions:transitions.filter(item=>item.from_shot===before.id&&item.to_shot===after.id)});}
  return selection;
}

export function fightLayerFragments(selection){
  const chosen=new Set(selection.shots.map(row=>row.id)),result=[];
  function add(group,row,key,value){result.push({pointer:'/'+group+'/@'+row.id+'/'+key,text:value});}
  for(const row of selection.tracks||[])if(selection.shots.some(shot=>shot.track===row.id))for(const key of ['name','time_relation'])add('tracks',row,key,row[key]);
  for(const row of selection.vfx||[])if(row.shot_ids.some(id=>chosen.has(id))){for(const key of ['name','look'])add('vfx',row,key,row[key]);for(const [key,value] of Object.entries(row.lifecycle))add('vfx',row,'lifecycle/'+key,value);}
  for(const row of selection.forms||[])if(row.shot_ids.some(id=>chosen.has(id))){row.ladder.forEach((value,index)=>add('forms',row,'ladder/'+index,value));row.shared_anchors.forEach((value,index)=>add('forms',row,'shared_anchors/'+index,value));}
  for(const row of selection.transitions||[])for(const key of ['keeps','changes','cut_condition','occluder'])if(Object.hasOwn(row,key)){if(Array.isArray(row[key]))row[key].forEach((value,index)=>add('transitions',row,key+'/'+index,value));else add('transitions',row,key,row[key]);}
  return result;
}
