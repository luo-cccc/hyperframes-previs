import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [moduleFile,root,intake,optionsFile]=process.argv.slice(2);
const api=await import(pathToFileURL(moduleFile));
const options=optionsFile?JSON.parse(await readFile(optionsFile,'utf8')):{};
try{
  if(options.parse_only){api.parseFightJson(await readFile(path.join(root,intake)));console.log(JSON.stringify({ok:true}));}
  else{
    const bytes=await readFile(path.join(root,intake));const packet=api.parseFightJson(bytes);
    const scene={duration:packet.budget.duration_s,width:1280,height:720,shots:packet.budget.shots.map(row=>({id:row.id,start:row.start_s,end:row.end_s})),actors:packet.asset_catalog.actors.map((row,i)=>({id:'proxy_'+i,height:1.75})),assetBindings:packet.asset_catalog.actors.map((row,i)=>({actorId:'proxy_'+i,assetId:row.id,representation:'proxy',dimensions_basis:'LOCAL_EXECUTION_ASSUMPTION'})),fightClock:{battle_start_s:packet.unit.battle_start_s,battle_end_s:packet.unit.battle_end_s,unit_id:packet.unit.id},upstream:{intake,intake_sha256:createHash('sha256').update(bytes).digest('hex'),provider:'xianxia-fight-director',lineage:packet.lineage},...options.scene};
    if(options.binding)Object.assign(scene.upstream,options.binding);
    const result=await api.checkFightUpstream(root,scene);
    console.log(JSON.stringify({ok:true,structuralOnly:result.structuralOnly,lineage:result.lineage,transitions:result.transitions,diagnostics:result.diagnostics,selected_sha256:api.fightSelectionSha256(result.packet.selection)}));
  }
}catch(error){console.log(JSON.stringify({ok:false,code:error.code||'ERROR',message:error.message}));process.exitCode=1;}
