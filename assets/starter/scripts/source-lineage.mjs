export const FIGHT_PROVIDER='xianxia-fight-director';
export const isFightPacket=packet=>packet?.schema_version==='PREVIS_FIGHT_ADAPTER_V1';
export const isStoryboardPacket=packet=>packet?.schema_version==='PREVIS_STORYBOARD_ADAPTER_V1';
export function sourceLineage(upstream,scene={}){
  const packet=upstream?.packet||upstream;
  if(!packet)return {schema_version:'PREVIS_SOURCE_LINEAGE_V1',provider:'DEMONSTRATION',unit_id:scene.id||null,unit_revision:null,source_revision:null};
  if(isFightPacket(packet))return {schema_version:'PREVIS_SOURCE_LINEAGE_V1',provider:FIGHT_PROVIDER,...packet.lineage,unit_id:packet.unit?.id||packet.lineage?.unit_id||null};
  if(isStoryboardPacket(packet))return {schema_version:'PREVIS_SOURCE_LINEAGE_V1',provider:'storyboard',...packet.lineage,unit_id:packet.unit?.id||packet.lineage?.unit_id||null};
  throw new Error('Source lineage: unsupported intake contract; create a current explicit intake.');
}

export function fightReceiptMap(packet,scene){
  if(!isFightPacket(packet))throw new Error('Fight mapping requires an explicit fight packet.');
  const offset=packet.unit.battle_start_s,selection=packet.selection;
  const shots=packet.budget.shots.map(shot=>{
    const original=selection.shots.find(source=>source.id===shot.id);
    return {...shot,...Object.fromEntries(['track','outer_state'].filter(key=>Object.hasOwn(original,key)).map(key=>[key,original[key]])),
      execution_cues:original.execution.cues.map(cue=>({battle_start_s:cue.start,battle_end_s:cue.end,start_s:cue.start-offset,end_s:cue.end-offset,text:cue.text})),
      beat_windows:original.beat_ids.map(id=>{
        const beat=selection.beats.find(beat=>beat.id===id),start=Math.max(beat.start,shot.battle_start_s),end=Math.min(beat.end,shot.battle_end_s);
        return {beat_id:id,...(beat.track?{track:beat.track}:{}),full_battle_range:[beat.start,beat.end],observed_battle_range:[start,end],observed_segment_range:[start-offset,end-offset],already_started:beat.start<start,continues_after_shot:beat.end>end,requires:beat.requires};
      })};
  });
  const layers=Object.fromEntries(['tracks','vfx','forms','transitions','layer_dependencies'].filter(key=>Object.hasOwn(selection,key)).map(key=>[key,selection[key]]));
  return {schema_version:'PREVIS_FIGHT_MAP_V1',source:sourceLineage(packet,scene),unit:packet.unit,source_clock:'BATTLE_PRESENTATION',runtime_clock:'SEGMENT',shots,
    source_states:selection.states,cost:selection.cost,attrition:selection.attrition,knowledge:selection.knowledge,
    source_layers:{status:'SOURCE_REQUIREMENT_ONLY',automatic_animation:'NOT_IMPLEMENTED',...layers},
    implementation:scene.fightImplementation||null,semantic_status:'NEEDS_REVIEW',upstream_writes:false};
}
