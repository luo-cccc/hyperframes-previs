export const FIGHT_PROVIDER='xianxia-fight-director';
export const isFightPacket=packet=>packet?.schema_version==='PREVIS_FIGHT_ADAPTER_V1';
export function sourceLineage(upstream,scene={}){
  const packet=upstream?.packet||upstream;
  if(!packet)return {schema_version:'PREVIS_SOURCE_LINEAGE_V1',provider:'DEMONSTRATION',unit_id:scene.id||null,unit_revision:null,source_revision:null};
  if(isFightPacket(packet))return {schema_version:'PREVIS_SOURCE_LINEAGE_V1',provider:FIGHT_PROVIDER,...packet.lineage,unit_id:packet.unit?.id||packet.lineage?.unit_id||null};
  return {schema_version:'PREVIS_SOURCE_LINEAGE_V1',provider:'script-to-storyboard-prompts',project_id:packet.project_id,unit_id:packet.formal_id,unit_revision:packet.prompt_version,source_revision:packet.upstream_snapshot?.source_script_ref?.version||null,formal_id:packet.formal_id,prompt_version:packet.prompt_version,budget_version:packet.budget_version};
}

export function fightReceiptMap(packet,scene){
  if(!isFightPacket(packet))throw new Error('Fight mapping requires an explicit fight packet.');
  const offset=packet.unit.battle_start_s,selection=packet.selection;
  return {schema_version:'PREVIS_FIGHT_MAP_V1',source:sourceLineage(packet,scene),unit:packet.unit,source_clock:'BATTLE_PRESENTATION',runtime_clock:'SEGMENT',shots:packet.budget.shots.map(shot=>({...shot,execution_cues:selection.shots.find(source=>source.id===shot.id).execution.cues.map(cue=>({battle_start_s:cue.start,battle_end_s:cue.end,start_s:cue.start-offset,end_s:cue.end-offset,text:cue.text})),beat_windows:selection.shots.find(source=>source.id===shot.id).beat_ids.map(id=>{const beat=selection.beats.find(beat=>beat.id===id),start=Math.max(beat.start,shot.battle_start_s),end=Math.min(beat.end,shot.battle_end_s);return {beat_id:id,full_battle_range:[beat.start,beat.end],observed_battle_range:[start,end],observed_segment_range:[start-offset,end-offset],already_started:beat.start<start,continues_after_shot:beat.end>end,requires:beat.requires}})})),source_states:selection.states,cost:selection.cost,attrition:selection.attrition,knowledge:selection.knowledge,implementation:scene.fightImplementation||null,semantic_status:'NEEDS_REVIEW',upstream_writes:false};
}
