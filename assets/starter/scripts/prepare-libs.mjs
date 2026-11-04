import { mkdir, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const three=path.join(root,'node_modules','three');
const version=JSON.parse(await readFile(path.join(three,'package.json'),'utf8')).version;
await mkdir(path.join(root,'lib'),{recursive:true});
for(const [source,target] of [
  ['build/three.module.js','three.module.js'],['build/three.core.js','three.core.js'],
  ['examples/jsm/controls/OrbitControls.js','OrbitControls.js'],['LICENSE','THREE-LICENSE.txt']
]) await copyFile(path.join(three,source),path.join(root,'lib',target));
console.log(`Local Three.js ${version} modules prepared.`);
