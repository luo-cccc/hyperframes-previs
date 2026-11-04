import {open,rename,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function writeAtomic(file,contents){
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.tmp`);
  try{
    const handle=await open(temporary,'wx');
    try{await handle.writeFile(contents);await handle.sync()}finally{await handle.close()}
    await rename(temporary,file);
  }finally{try{await unlink(temporary)}catch(error){if(error.code!=='ENOENT')console.warn(`Temporary cleanup failed: ${error.message}`)}}
}
export const writeJsonAtomic=(file,value)=>writeAtomic(file,JSON.stringify(value,null,2)+'\n');
