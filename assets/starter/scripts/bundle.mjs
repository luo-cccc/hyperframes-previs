import {readFile,readdir,lstat,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {isFightPacket,sourceLineage} from './source-lineage.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const forward=value=>value.replaceAll(path.sep,'/');
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))};
const expect=(ok,message)=>{if(!ok)throw new Error(`Portable bundle: ${message}`)};
const excluded=name=>['node_modules','.hyperframes','.git','tmp','temp','.tmp','log','logs','locks','.locks'].includes(name.toLowerCase())||/\.(?:log|tmp|lock)$/i.test(name);

function relativeReference(ref,label){
  expect(typeof ref==='string'&&ref.trim(),`${label} must be an explicit relative filesystem path.`);
  expect(!path.isAbsolute(ref)&&!path.win32.isAbsolute(ref)&&!path.posix.isAbsolute(ref)&&!/^([a-zA-Z]:|[a-z][a-z0-9+.-]*:)/i.test(ref),`${label} is absolute or a URI (${ref}); first make an explicitly reviewed relative reference and rebind/re-render as required. This helper never rewrites references.`);
  return ref;
}

async function exists(file){try{await lstat(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function regularFile(file,label){const info=await lstat(file);expect(info.isFile()&&!info.isSymbolicLink(),`${label} must be a regular file, not a symlink/junction: ${file}`)}

export async function bundleProject({project,out}){
  project=path.resolve(project);out=path.resolve(out);
  expect(!await exists(out),`output already exists: ${out}`);
  expect(!inside(project,out),'output must be outside the source project.');
  for(const lock of ['.previs-save.lock','.previs-render.lock','.previs-handoff.lock','.previs-boundary.lock','.previs-state-capture.lock'])expect(!await exists(path.join(project,lock)),`project is locked (${lock}); wait for the operation to finish before bundling.`);
  const sceneFile=path.join(project,'scene.json'),sceneBytes=await readFile(sceneFile),scene=JSON.parse(sceneBytes.toString('utf8'));
  expect(scene.upstream,'this helper requires a bound upstream-adapter project.');
  const intakeReference=relativeReference(scene.upstream.intake,'scene.upstream.intake');
  const intakeFile=path.resolve(project,intakeReference),intakeBytes=await readFile(intakeFile),packet=JSON.parse(intakeBytes.toString('utf8'));
  expect(hash(intakeBytes)===scene.upstream.intake_sha256,'intake hash mismatch; review and bind current input before bundling.');
  expect(['STORYBOARD_PREVIS_ADAPTER_V1','PREVIS_FIGHT_ADAPTER_V1'].includes(packet.schema_version)&&packet.upstream_writes===false,'unsupported intake contract or missing read-only boundary.');
  if(isFightPacket(packet))expect(scene.upstream.provider==='xianxia-fight-director'&&JSON.stringify(scene.upstream.lineage)===JSON.stringify(packet.lineage),'fight source lineage differs from intake.');
  else for(const field of ['project_id','formal_id','prompt_version','budget_version'])expect(scene.upstream[field]===packet[field],`${field} differs from intake.`);
  expect(Array.isArray(packet.sources)&&packet.sources.length>0,'explicit source evidence is required.');
  const explicit=[{role:'intake',reference:intakeReference,file:intakeFile,sha256:hash(intakeBytes)}];
  for(const source of packet.sources){
    const ref=relativeReference(source.path,`intake.sources[${source.role}].path`),file=path.resolve(path.dirname(intakeFile),ref);
    await regularFile(file,source.role);
    explicit.push({role:source.role,reference:ref,file,first_snapshot_sha256:source.sha256});
  }
  for(const binding of scene.assetBindings||[]){
    if(binding.appearanceReference==null)continue;
    const ref=relativeReference(binding.appearanceReference,`assetBindings[${binding.actorId}].appearanceReference`),file=path.resolve(project,ref);
    await regularFile(file,'appearance reference');explicit.push({role:'appearance',actor_id:binding.actorId,reference:ref,file,first_snapshot_sha256:null});
  }
  // The canonical guard owns source scope rules. A whole-file SHA can change
  // while this target's selected state/budget/master scope remains unchanged.
  const {checkUpstream}=await import(pathToFileURL(path.join(project,'scripts/check-upstream.mjs')).href);
  const {sourceFingerprint}=await import(pathToFileURL(path.join(project,'scripts/source-fingerprint.mjs')).href);
  expect(typeof checkUpstream==='function'&&typeof sourceFingerprint==='function','project must provide canonical checkUpstream and sourceFingerprint helpers.');
  expect(await checkUpstream(project,scene),'canonical source validation returned no bound adapter.');
  const fingerprint=await sourceFingerprint(project);
  for(const dependency of fingerprint.files){
    const reference=relativeReference(dependency.path,'tracked render dependency'),file=path.resolve(project,reference);
    if(inside(project,file))continue;
    await regularFile(file,'tracked render dependency');
    explicit.push({role:'render_dependency',reference,file,first_snapshot_sha256:dependency.sha256});
  }
  for(const source of explicit){source.sha256=hash(await readFile(source.file));if(source.role==='intake')source.first_snapshot_sha256=source.sha256}
  // Preserve path relationships by copying a sparse tree rooted at a common ancestor.
  let common=path.dirname(project);
  while(!explicit.every(source=>inside(common,source.file))){const next=path.dirname(common);expect(next!==common,'sources span incompatible roots/volumes; relative references cannot be preserved.');common=next}
  const planned=new Map();
  function plan(file,role='project'){
    const relative=path.relative(common,file);expect(relative&&!path.isAbsolute(relative)&&inside(common,file),'cannot form a safe relative bundle path.');
    expect(!relative.split(path.sep).some(excluded),`explicit dependency is excluded as a runtime/cache/temporary file: ${file}`);
    const key=process.platform==='win32'?file.toLowerCase():file;
    if(!planned.has(key))planned.set(key,{file,relative:forward(relative),roles:[]});
    planned.get(key).roles.push(role);
  }
  async function collect(directory){
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(excluded(entry.name))continue;
      const absolute=path.join(directory,entry.name),info=await lstat(absolute);
      expect(!info.isSymbolicLink(),`project contains a symlink/junction outside excluded dependencies: ${absolute}`);
      if(info.isDirectory())await collect(absolute);else if(info.isFile())plan(absolute);
    }
  }
  await collect(project);for(const source of explicit)plan(source.file,source.role);
  // All references and files have been checked before creating the output directory.
  await mkdir(path.join(out,'tree'),{recursive:true});
  const files=[];
  for(const item of [...planned.values()].sort((a,b)=>a.relative.localeCompare(b.relative))){
    const before=hash(await readFile(item.file)),relative='tree/'+item.relative,destination=path.join(out,relative);
    await mkdir(path.dirname(destination),{recursive:true});await copyFile(item.file,destination);
    expect(hash(await readFile(destination))===before&&hash(await readFile(item.file))===before,`file changed while copying: ${item.file}`);
    files.push({path:relative,sha256:before,roles:[...new Set(item.roles)]});
  }
  expect(hash(await readFile(sceneFile))===hash(sceneBytes),'scene changed during bundling.');
  expect(hash(await readFile(intakeFile))===hash(intakeBytes),'intake changed during bundling.');
  const projectRelative='tree/'+forward(path.relative(common,project));
  const copiedProject=path.join(out,projectRelative);
  expect((await sourceFingerprint(project)).sha256===fingerprint.sha256,'tracked renderer inputs changed during bundling.');
  expect((await sourceFingerprint(copiedProject)).sha256===fingerprint.sha256,'tracked renderer inputs are missing or changed in the bundle.');
  expect(await checkUpstream(project,scene),'source adapter became invalid during bundling.');
  expect(await checkUpstream(copiedProject,scene),'copied evidence does not satisfy the canonical source scope.');
  const manifest={bundle_contract:'PREVIS_PORTABLE_EVIDENCE_V1',created_at:new Date().toISOString(),snapshot_role:'READ_ONLY_EVIDENCE_SNAPSHOT',upstream_authority:false,authority_notice:'Copied source evidence is a frozen, read-only snapshot. It must not replace or be committed as the upstream authoritative project state.',original_project_root:project,original_common_root:common,project_root:projectRelative,entry_html:projectRelative+'/studio.html',start_command:'node scripts/serve.mjs',start_command_cwd:projectRelative,source_lineage:sourceLineage(packet,scene),project_id:packet.project_id,formal_id:packet.formal_id,prompt_version:packet.prompt_version,budget_version:packet.budget_version,rewritten_project_files:[],source_snapshots:explicit.map(source=>({role:source.role,actor_id:source.actor_id,original_reference:source.reference,original_path:source.file,bundle_path:'tree/'+forward(path.relative(common,source.file)),first_snapshot_sha256:source.first_snapshot_sha256,copied_sha256:source.sha256,sha256:source.sha256})),renderer_inputs_sha256:fingerprint.sha256,renderer_inputs:fingerprint.files,files,validation_status:'CANONICAL_SCOPE_AND_COPY_INTEGRITY_CHECKED',render_claim:'Existing rendered bytes and receipts are copied unchanged. Bundling does not perform or claim a new render.'};
  await writeFile(path.join(out,'bundle-manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
  return {output:out,project:path.join(out,projectRelative),entry:manifest.entry_html,files:files.length,upstream_authority:false,rewritten_project_files:[]};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(let i=2;i<process.argv.length;i+=2){expect(['--project','--out'].includes(process.argv[i])&&process.argv[i+1],'Usage: node bundle.mjs --project <adapter-project> --out <new-bundle-directory>');options[process.argv[i].slice(2)]=process.argv[i+1]}
  expect(options.project&&options.out,'Usage: node bundle.mjs --project <adapter-project> --out <new-bundle-directory>');
  try{console.log(JSON.stringify(await bundleProject(options),null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
