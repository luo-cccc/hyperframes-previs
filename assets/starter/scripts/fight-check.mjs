import {readFile}from'node:fs/promises';
import path from'node:path';
import {fileURLToPath}from'node:url';
import {validateScene}from'../src/scene-data.js';
import {sampleActions}from'../src/action-data.js';
import {auditCombat}from'../src/spatial-audit.js';
import {checkUpstream,sha256}from'./check-upstream.mjs';
import {sourceFingerprint}from'./source-fingerprint.mjs';
import {renderSceneText}from'../src/render-identity.js';
import {writeJsonAtomic}from'./atomic-file.mjs';
import {sourceLineage}from'./source-lineage.mjs';
export function auditFight(scene,{everyFrames=1,maxSamples=20000,contactTolerance=.15}={}){
 const errors=validateScene(scene);if(errors.length)throw new Error(errors.join('\n'));
 if(!scene.combat)throw new Error('Fight check requires an explicit PREVIS_COMBAT_V1 implementation; unimplemented combat cannot pass by omission.');
 if(!Number.isInteger(everyFrames)||everyFrames<1||!Number.isInteger(maxSamples)||maxSamples<1||!Number.isFinite(contactTolerance)||contactTolerance<0)throw new Error('Invalid explicit fight sample settings.');
 const frameCount=Math.round(scene.duration*scene.fps),indices=[];for(let f=0;f<frameCount;f+=everyFrames)indices.push(f);if(indices.at(-1)!==frameCount-1)indices.push(frameCount-1);
 if(indices.length>maxSamples)throw new Error('Fight sample budget exceeded; choose an explicit everyFrames. No automatic decimation.');
 const observations=[],issues=[];let contactSamples=0,maxGap=0;
 const seenIssues=new Set();const issue=(code,target,frame,details)=>{const key=code+':'+target;if(!seenIssues.has(key)){seenIssues.add(key);issues.push({code,target,first_frame:frame,time_s:frame/scene.fps,...details})}};
 for(const frame of indices){
  const t=frame/scene.fps,state=sampleActions(scene,t).combat;
  const ids=Object.keys(state.objects);if(new Set(ids).size!==scene.combat.objects.length)issue('OBJECT_IDENTITY_MISMATCH','objects',frame,{});
  for(const object of Object.values(state.objects)){if(object.owner_id&&!scene.actors.some(actor=>actor.id===object.owner_id))issue('UNKNOWN_OBJECT_OWNER',object.id,frame,{});}
  for(const contact of state.contacts){contactSamples++;maxGap=Math.max(maxGap,contact.gap_m);if(contact.expected&&contact.gap_m>contactTolerance)issue('EXPECTED_PROXY_CONTACT_GAP',contact.id,frame,{gap_m:contact.gap_m,tolerance_m:contactTolerance});if(contact.expected&&!contact.target_visible)issue('EXPECTED_CONTACT_TARGET_HIDDEN',contact.id,frame,{});}
  if(frame===0||frame===indices.at(-1))observations.push({frame,time_s:t,objects:Object.fromEntries(Object.entries(state.objects).map(([id,item])=>[id,{owner_id:item.owner_id,hand:item.hand,state:item.state,visible:item.visible,position:item.position}])),state:state.state});
 }
 const geometry=auditCombat(scene,{everyFrames,maxSamples});for(const found of geometry.issues)issues.push(found);
 const before=sampleActions(scene,scene.duration*.8).combat;sampleActions(scene,scene.duration*.2);const repeated=sampleActions(scene,scene.duration*.8).combat;
 if(JSON.stringify(before)!==JSON.stringify(repeated))issues.push({code:'NONDETERMINISTIC_PROXY_STATE'});
 return {schema_version:'PREVIS_FIGHT_REPORT_V1',status:issues.length?'ISSUES_FOUND':'NO_ISSUES_OBSERVED',scope:'SAMPLED_DECLARED_COMBAT_PROXY; not combat causality, anatomical reach, impact physics, video semantics or audio acceptance.',sampling:{fps:scene.fps,frameCount,everyFrames,sampleCount:indices.length,includes_exclusive_end:false},counts:{issueGroups:issues.length,contactSamples,max_contact_gap_m:maxGap,objects:scene.combat.objects.length,events:scene.combat.events.length},issues,observations,combat_audit:geometry,checks:{identity:'SAMPLED',declared_contact:'SAMPLED',nonsequential_state:'CHECKED',attack_response:'NOT_RUN',semantic_state:'NEEDS_REVIEW',audio:'NOT_RUN'},upstream_writes:false};
}
export async function checkFightProject(root,options={}){
 root=path.resolve(root);const scene=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8')),source=await checkUpstream(root,scene),fingerprint=await sourceFingerprint(root),sceneHash=sha256(renderSceneText(scene));
 const report={...auditFight(scene,options),source_lineage:sourceLineage(source,scene),render_identity:'PREVIS_RENDER_CONTENT_V2',scene_sha256:sceneHash,render_inputs_sha256:fingerprint.sha256,intake_sha256:source?.intakeSha256||null};
 const after=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8'));if(sha256(renderSceneText(after))!==sceneHash||(await sourceFingerprint(root)).sha256!==fingerprint.sha256)throw new Error('Saved combat inputs changed during sampling; previous report retained.');
 await checkUpstream(root,after);await writeJsonAtomic(path.join(root,'review/fight-report.json'),report);return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),options={};for(let i=2;i<process.argv.length;i+=2){if(process.argv[i]==='--every-frames')options.everyFrames=Number(process.argv[i+1]);else throw new Error('Usage: npm run fight-check [-- --every-frames <positive integer>]');}
 const result=await checkFightProject(root,options);console.log(JSON.stringify({status:result.status,sampling:result.sampling,counts:result.counts,scope:result.scope},null,2));
}
