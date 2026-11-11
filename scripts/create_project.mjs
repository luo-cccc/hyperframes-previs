import { cp, mkdir, stat,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = process.argv[2];
if (!destination||process.argv.slice(3).some(arg=>arg!=='--demo')) throw new Error('Usage: node create_project.mjs <new-project-directory> [--demo]');
const target = path.resolve(destination);
try {
  await stat(target);
  throw new Error(`Target already exists; use a new directory: ${target}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const source = fileURLToPath(new URL('../assets/starter/', import.meta.url));
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true, errorOnExist: true, force: false });
if(!process.argv.includes('--demo'))await writeFile(path.join(target,'adapter-project.json'),JSON.stringify({mode:'UPSTREAM_ADAPTER',template_is_demonstration:true,required:'Replace the sample scene using the supplied storyboard or director script, preserve source IDs and timing, prepare source/asset mappings, then run npm run bind-upstream.'},null,2)+'\n','utf8');
console.log(`Created ${target}\n${process.argv.includes('--demo')?'Explicit runtime demonstration.\nNext: npm run validate, then npm run studio.':'Adapter binding is required before validation/export.\nNext: implement the scene from the supplied script, seal the source intake, bind and validate, then preview.'}\nInstall render dependencies with npm ci when exporting.`);
