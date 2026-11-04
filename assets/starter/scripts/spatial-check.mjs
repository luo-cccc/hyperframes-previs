import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditScene} from '../src/spatial-audit.js';
import {validateScene} from '../src/scene-data.js';
import {checkUpstream,sha256} from './check-upstream.mjs';
import {sourceFingerprint} from './source-fingerprint.mjs';
import {sourceContext} from './source-context.mjs';
import {writeJsonAtomic} from './atomic-file.mjs';
import {renderSceneText} from '../src/render-identity.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const options={};
for(let index=2;index<process.argv.length;index+=2){
  const key=process.argv[index],value=Number(process.argv[index+1]);
  if(key==='--every-frames')options.everyFrames=value;
  else if(key==='--max-samples')options.maxSamples=value;
  else throw new Error('Usage: node scripts/spatial-check.mjs [--every-frames <integer>] [--max-samples <integer>]');
}
const bytes=await readFile(path.join(root,'scene.json')),scene=JSON.parse(bytes.toString('utf8'));
const errors=validateScene(scene);if(errors.length)throw new Error(errors.join('\n'));
const upstream=await checkUpstream(root,scene),fingerprint=await sourceFingerprint(root);
const report=auditScene(scene,options);
if(sha256(await readFile(path.join(root,'scene.json')))!==sha256(bytes)||(await sourceFingerprint(root)).sha256!==fingerprint.sha256)throw new Error('Scene or render inputs changed during the spatial audit; run it again. No report was replaced.');
await checkUpstream(root,scene);
const output={...report,generated_at:new Date().toISOString(),render_identity:'PREVIS_RENDER_CONTENT_V2',scene_sha256:sha256(renderSceneText(scene)),scene_file_sha256:sha256(bytes),render_inputs_sha256:fingerprint.sha256,intake_sha256:upstream?.intakeSha256||null,sourceContext:await sourceContext(root,upstream),media_review:'NOT_RUN',semantic_review:'NOT_RUN'};
const file=path.join(root,'review','spatial-report.json');await writeJsonAtomic(file,output);
console.log(JSON.stringify({status:output.status,scope:output.scope,sampledFrames:output.sampling.sampleCount,issueGroups:output.counts.issueGroups,output:file,media_review:'NOT_RUN'},null,2));
