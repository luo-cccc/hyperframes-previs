import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {checkFightUpstream} from './fight-source.mjs';
import {checkStoryboardUpstream,STORYBOARD_SCHEMA} from './storyboard-source.mjs';

export const sha256=data=>createHash('sha256').update(data).digest('hex');
const expect=(ok,message)=>{if(!ok)throw new Error('Upstream adapter: '+message)};

function strictJson(text,label){
  text=text.replace(/^\uFEFF/,'');let cursor=0;
  const whitespace=()=>{while(/[ \t\r\n]/.test(text[cursor]||'\0'))cursor++};
  const fail=message=>{throw new Error(`Upstream adapter: invalid ${label}: ${message} at character ${cursor}`)};
  function string(){
    const start=cursor++;while(cursor<text.length){const char=text[cursor++];if(char==='\\'){cursor++;continue}if(char==='"'){try{return JSON.parse(text.slice(start,cursor))}catch{fail('invalid JSON string')}}}fail('unterminated string');
  }
  function value(depth=0){
    if(depth>256)fail('nesting too deep');whitespace();const char=text[cursor];
    if(char==='"')return string();
    if(char==='{'){
      cursor++;whitespace();const result=Object.create(null),keys=new Set();if(text[cursor]==='}'){cursor++;return result}
      while(true){whitespace();if(text[cursor]!=='"')fail('object key must be a string');const key=string();if(keys.has(key))fail(`duplicate key ${key}`);keys.add(key);whitespace();if(text[cursor++]!==':')fail('expected colon');result[key]=value(depth+1);whitespace();const delimiter=text[cursor++];if(delimiter==='}')return result;if(delimiter!==',')fail('expected comma or closing brace')}
    }
    if(char==='['){
      cursor++;whitespace();const result=[];if(text[cursor]===']'){cursor++;return result}
      while(true){result.push(value(depth+1));whitespace();const delimiter=text[cursor++];if(delimiter===']')return result;if(delimiter!==',')fail('expected comma or closing bracket')}
    }
    for(const [word,result] of [['true',true],['false',false],['null',null]])if(text.startsWith(word,cursor)){cursor+=word.length;return result}
    const number=text.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if(number){cursor+=number[0].length;const result=Number(number[0]);if(!Number.isFinite(result))fail('non-finite number');return result}
    fail('unexpected token');
  }
  const result=value();whitespace();if(cursor!==text.length)fail('trailing content');return result;
}


export async function checkUpstream(root,scene){
  if(!scene.upstream){
    for(const name of ['upstream-intake.json','adapter-project.json']){
      try{await access(path.join(root,name))}catch(error){if(error.code==='ENOENT')continue;throw error}
      throw new Error('Upstream adapter: '+name+' exists but scene.upstream is missing; bind this adapter before validation/export. Demonstration fallback is disabled.');
    }
    return null;
  }
  const u=scene.upstream;
  expect(typeof u.intake==='string'&&u.intake,'missing intake path.');
  const file=path.resolve(root,u.intake),bytes=await readFile(file),packet=strictJson(bytes.toString('utf8'),'intake JSON');
  expect(sha256(bytes)===u.intake_sha256,'intake changed; review the new source and bind a new adapter revision.');
  if(packet.schema_version==='PREVIS_FIGHT_ADAPTER_V1')return checkFightUpstream(root,scene);
  if(packet.schema_version===STORYBOARD_SCHEMA)return checkStoryboardUpstream(root,scene,{packet,file,bytes,parseJson:strictJson});
  throw new Error('Upstream adapter: unsupported intake contract; this release accepts current generic storyboard or fight 1.3 sources only.');
}
