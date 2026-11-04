import {readFile,readdir,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './check-upstream.mjs';
import {renderSceneText} from '../src/render-identity.js';

export async function sourceFingerprint(root){
  const files=[],visited=new Set();
  async function collect(relative,required=false){
    const absolute=path.resolve(root,relative);let info;
    try{info=await stat(absolute)}catch(error){if(error.code==='ENOENT'&&!required)return;throw error}
    if(info.isDirectory()){
      const canonical=await realpath(absolute);if(visited.has(canonical))return;visited.add(canonical);
      for(const name of (await readdir(absolute)).sort())await collect(path.join(relative,name),required);
    }
    else if(info.isFile())files.push(relative.replaceAll(path.sep,'/'));
  }
  for(const name of ['index.html','scene.json','package.json','package-lock.json','src','lib','assets','models','textures','fonts','media','audio','shaders'])await collect(name);
  const scene=JSON.parse(await readFile(path.join(root,'scene.json'),'utf8'));
  if(scene.renderDependencies!==undefined&&!Array.isArray(scene.renderDependencies))throw new Error('renderDependencies must be an explicit array of local paths.');
  const dependencies=[...(scene.renderDependencies||[]),...(scene.assetBindings||[]).map(binding=>binding.appearanceReference).filter(Boolean)];
  for(const dependency of dependencies){
    if(typeof dependency!=='string'||!dependency.trim()||(/^[a-z][a-z0-9+.-]*:/i.test(dependency)&&!/^[a-z]:[\\/]/i.test(dependency)))throw new Error('Render dependencies must be local filesystem paths; copy remote media into the project before exporting.');
    await collect(path.normalize(dependency),true);
  }
  files.sort();
  const entries=[];for(const file of [...new Set(files)])entries.push({path:file,sha256:file==='scene.json'?sha256(renderSceneText(scene)):sha256(await readFile(path.resolve(root,file)))});
  return {sha256:sha256(JSON.stringify(entries)),files:entries};
}
