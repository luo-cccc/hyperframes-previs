import {readFile} from 'node:fs/promises';
import path from 'node:path';

export async function sourceContext(root,upstream){
  if(!upstream)return {mode:'DEMONSTRATION',upstream_authority:false};
  for(let folder=path.resolve(root);;folder=path.dirname(folder)){
    const file=path.join(folder,'bundle-manifest.json');let manifest;
    try{manifest=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
    if(manifest?.bundle_contract==='PREVIS_PORTABLE_EVIDENCE_V1'&&path.resolve(folder,manifest.project_root)===path.resolve(root))return {mode:'BUNDLED_SNAPSHOT',upstream_authority:false,as_of:manifest.created_at,notice:'Only the frozen bundled evidence is checked; this does not establish the current validity of the live upstream project.'};
    if(path.dirname(folder)===folder)break;
  }
  return {mode:upstream.packet.input_mode==='STATE_JSON'?'LIVE_REFERENCES':'MANUAL_EVIDENCE',upstream_authority:upstream.packet.input_mode==='STATE_JSON',notice:'Adapter remains read-only; only the upstream skill may commit authoritative workflow changes.'};
}
