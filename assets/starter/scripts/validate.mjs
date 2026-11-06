import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateScene } from '../src/scene-data.js';
import { checkUpstream } from './check-upstream.mjs';
import {sourceLineage} from './source-lineage.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
export function compositionHtml(html,s){
  for(const [key,value] of Object.entries({'composition-id':s.id,duration:s.duration,width:s.width,height:s.height,fps:s.fps}))
    html=html.replace(new RegExp(`data-${key}="[^"]*"`),`data-${key}="${value}"`);
  html=html.replace(/#stage\{width:\d+px;height:\d+px;/,`#stage{width:${s.width}px;height:${s.height}px;`);
  return html;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8'));
  const problems=validateScene(s);if(problems.length)throw new Error(problems.join('\n'));
  const upstream=await checkUpstream(root,s);
  const file=path.join(root,'index.html'),html=await readFile(file,'utf8'),next=compositionHtml(html,s);
  if(html!==next)await writeFile(file,next,'utf8');
  console.log(`Validated ${s.shots.length} shots, ${s.actors.length} actors, ${s.duration}s / ${s.width}x${s.height} / ${s.fps}fps.`);
  if(upstream){const source=sourceLineage(upstream,s);console.log(`Upstream ${source.provider}/${source.unit_id}: source, timing and asset structure checked; semantic/media review remains separate.`);}
}
