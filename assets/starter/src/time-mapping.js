/** Three independent clocks. Ranges are half-open, except the final segment endpoint.
 * Mapping never rounds, adds handles, inserts shots or authorizes a speed change.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const close=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));

export function validateTimeMapping(scene){
  if(!object(scene))return ['Time mapping requires a scene object.'];
  if(scene.timeMapping===undefined)return [];
  const errors=[],expect=(ok,message)=>{if(!ok)errors.push(message)};
  const mapping=scene.timeMapping;
  if(!object(mapping))return ['timeMapping must be an object when provided.'];
  expect(mapping.schema_version==='PREVIS_TIME_MAPPING_V1','timeMapping.schema_version must be PREVIS_TIME_MAPPING_V1.');
  expect(finite(scene.duration)&&scene.duration>0,'Time mapping requires a positive finite scene.duration.');
  if(!Array.isArray(mapping.segments)||!mapping.segments.length)return [...errors,'timeMapping.segments must be a nonempty array.'];
  let end=0;const inputs=new Map();
  mapping.segments.forEach((segment,index)=>{
    const label=`timeMapping.segments[${index}]`;
    if(!object(segment)){errors.push(`${label} must be an object.`);return}
    for(const name of ['input_id','source_version'])expect(text(segment[name]),`${label}.${name} must be a nonempty string.`);
    expect(text(segment.formal_id)||text(segment.unit_id),`${label}: formal_id or source unit_id must be a nonempty string.`);
    for(const name of ['formal_id','unit_id'])if(segment[name]!==undefined)expect(text(segment[name]),`${label}.${name} must be a nonempty string when provided.`);
    if(segment.formal_id!==undefined&&segment.unit_id!==undefined)expect(segment.formal_id===segment.unit_id,`${label}: formal_id and unit_id aliases must agree when both are provided.`);
    for(const name of ['source_duration_s','source_start_s','source_end_s','segment_start_s','segment_end_s','edit_start_s','edit_end_s','playback_rate'])expect(finite(segment[name]),`${label}.${name} must be a finite number.`);
    expect(finite(segment.source_duration_s)&&segment.source_duration_s>0,`${label}.source_duration_s must be positive.`);
    expect(segment.source_start_s>=0&&segment.source_end_s>segment.source_start_s&&segment.source_end_s<=segment.source_duration_s,`${label}: source range must be positive and inside source_duration_s.`);
    expect(segment.segment_start_s>=0&&segment.segment_end_s>segment.segment_start_s&&segment.segment_end_s<=scene.duration,`${label}: segment range must be positive and inside the declared budget.`);
    expect(segment.edit_start_s>=0&&segment.edit_end_s>segment.edit_start_s,`${label}: edit range must be positive and nonnegative.`);
    // No authorization field is supported in V1. A request to change speed needs a
    // separately designed contract; data alone cannot grant that authorization.
    expect(segment.playback_rate===1,`${label}: playback_rate must be 1; speed changes are not authorized by PREVIS_TIME_MAPPING_V1.`);
    expect(segment.segment_start_s===end,`${label}: segment ranges must be ordered and continuously cover the budget without gaps or overlap.`);
    const duration=segment.segment_end_s-segment.segment_start_s;
    expect(close(segment.source_end_s-segment.source_start_s,duration),`${label}: source and segment spans must agree at playback_rate 1.`);
    expect(close(segment.edit_end_s-segment.edit_start_s,duration),`${label}: edit and segment spans must agree at playback_rate 1.`);
    if(finite(segment.segment_end_s))end=segment.segment_end_s;
    if(text(segment.input_id)){
      const identity=JSON.stringify([segment.unit_id??segment.formal_id,segment.source_version,segment.source_duration_s]);
      expect(!inputs.has(segment.input_id)||inputs.get(segment.input_id)===identity,`${label}: one input_id cannot identify conflicting source versions or durations.`);
      inputs.set(segment.input_id,identity);
    }
  });
  expect(end===scene.duration,'timeMapping.segments must cover exactly scene.duration; no duration is rounded or extended.');
  return errors;
}

/** Return the source/edit coordinates explicitly declared for segment-local t.
 * Edit intervals may deliberately overlap, including across independent projects.
 * This is a coordinate lookup, not an overlap compositor or a stitching operation.
 * Omitted timeMapping leaves external clocks unknown rather than inventing them.
 */
export function mapSegmentTime(scene,t){
  const errors=validateTimeMapping(scene);
  if(!finite(scene?.duration)||scene.duration<=0)errors.push('mapSegmentTime requires a positive finite scene.duration.');
  if(!finite(t)||t<0||t>scene?.duration)errors.push('Segment time must be a finite number inside [0, scene.duration]; no clamping or rounding is performed.');
  if(errors.length){const error=new Error(errors.join('\n'));error.code='TIME_MAPPING_INVALID';error.problems=errors;throw error}
  if(scene.timeMapping===undefined)return {segment_time_s:t,source_time_s:null,edit_time_s:null,input_id:null,formal_id:null,source_version:null,mapping_index:null,playback_rate:1,basis:'SEGMENT_ONLY'};
  const segments=scene.timeMapping.segments;
  const index=segments.findIndex((segment,i)=>t>=segment.segment_start_s&&(t<segment.segment_end_s||i===segments.length-1&&t===segment.segment_end_s));
  const segment=segments[index],offset=t-segment.segment_start_s;
  return {segment_time_s:t,source_time_s:segment.source_start_s+offset,edit_time_s:segment.edit_start_s+offset,input_id:segment.input_id,formal_id:segment.formal_id??null,...(segment.unit_id!==undefined?{unit_id:segment.unit_id}:{}),source_version:segment.source_version,mapping_index:index,playback_rate:1,basis:'PREVIS_TIME_MAPPING_V1'};
}
