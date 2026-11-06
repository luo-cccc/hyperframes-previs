import {readFile,writeFile}from'node:fs/promises';
import {fileURLToPath}from'node:url';
import path from'node:path';
import {validateScene}from'../src/scene-data.js';
import {sha256,checkUpstream}from'./check-upstream.mjs';
import {isFightPacket,sourceLineage}from'./source-lineage.mjs';
export async function bindUpstream(root,intake='./upstream-intake.json'){
  root=path.resolve(root);
  const bytes=await readFile(path.resolve(root,intake)),packet=JSON.parse(bytes.toString('utf8'));
  const scene=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8'));
  const source={intake,intake_sha256:sha256(bytes)};
  scene.upstream=isFightPacket(packet)?{...source,provider:'xianxia-fight-director',lineage:packet.lineage}:{...source,...Object.fromEntries(['project_id','formal_id','prompt_version','budget_version'].map(key=>[key,packet[key]]))};
  const errors=validateScene(scene);if(errors.length)throw new Error(errors.join('\n'));
  const result=await checkUpstream(root,scene);
  await writeFile(path.join(root,'scene.json'),JSON.stringify(scene,null,2)+'\n','utf8');
  return {scene,lineage:sourceLineage(result,scene),upstream_writes:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
  const result=await bindUpstream(root,process.argv[2]||'./upstream-intake.json');
  console.log('Bound '+result.lineage.provider+' / '+result.lineage.unit_id+'; source unchanged.');
}
