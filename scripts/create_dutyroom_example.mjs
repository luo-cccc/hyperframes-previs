import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScene} from '../assets/starter/src/scene-data.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
/** Creates independent F1/F2 TEST/DEMO projects. The destination must be new.
 * Run: node scripts/create_dutyroom_example.mjs <new-directory>
 * Then in each of F1 and F2: npm ci; npm run validate; npm run studio.
 * No upstream intake/binding, prompt authority, sound or movie assembly is claimed.
 */
export async function createDutyroomExample(destination){
  if(typeof destination!=='string'||!destination.trim())throw new Error('A new demonstration directory is required.');
  const target=path.resolve(destination);
  const fixtures=await Promise.all(['F1','F2'].map(async id=>{
    const scene=JSON.parse(await readFile(path.join(repo,'assets/examples/dutyroom',id+'.scene.json'),'utf8'));
    const errors=validateScene(scene);if(errors.length)throw new Error(id+': '+errors.join('\n'));
    return {id,scene};
  }));
  await mkdir(path.dirname(target),{recursive:true});
  try{await mkdir(target)}catch(error){if(error.code==='EEXIST')throw new Error('Destination already exists; choose a new directory: '+target);throw error}
  for(const {id,scene} of fixtures){
    const project=path.join(target,id);
    await cp(path.join(repo,'assets/starter'),project,{recursive:true,force:false,errorOnExist:true,filter:source=>!['node_modules','.hyperframes','renders','review'].includes(path.basename(source))});
    await writeFile(path.join(project,'scene.json'),JSON.stringify(scene,null,2)+'\n','utf8');
    const index=path.join(project,'index.html');let html=await readFile(index,'utf8');
    for(const [key,value] of Object.entries({'composition-id':scene.id,duration:scene.duration,width:scene.width,height:scene.height,fps:scene.fps}))html=html.replace(new RegExp(`data-${key}="[^"]*"`),`data-${key}="${value}"`);
    html=html.replace(/#stage\{width:\d+px;height:\d+px;/,`#stage{width:${scene.width}px;height:${scene.height}px;`);
    await writeFile(index,html,'utf8');
    await writeFile(path.join(project,'demo-notice.json'),JSON.stringify(scene._demo,null,2)+'\n','utf8');
  }
  const boundaryPlan=await readFile(path.join(repo,'assets/examples/dutyroom/boundary-plan.json'),'utf8');
  await writeFile(path.join(target,'F1/boundary-plan.json'),boundaryPlan.replace(/^\uFEFF/,''),'utf8');
  return {directory:target,classification:'TEST_DEMO_ONLY',projects:fixtures.map(({id,scene})=>({id,directory:path.join(target,id),duration:scene.duration,fps:scene.fps})),notice:'F1 and F2 export independently. Source/edit clock coordinates are demonstration plans. Audio and final media acceptance have not run. No upstream authorization/binding is established.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw new Error('Usage: node scripts/create_dutyroom_example.mjs <new-directory>');
  console.log(JSON.stringify(await createDutyroomExample(process.argv[2]),null,2));
}
