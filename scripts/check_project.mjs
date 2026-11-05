import {readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const options=process.argv.slice(2);let reportFile=null;
if(options.length){if(options.length!==2||options[0]!=='--report')throw new Error('Usage: node scripts/check_project.mjs [--report <new-json-file>]');reportFile=path.resolve(options[1])}
const names=await readdir(path.join(root,'tests'));
const nodeFiles=names.filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join('tests',name));
if(!nodeFiles.length||!names.some(name=>name.startsWith('test_')&&name.endsWith('.py')))throw new Error('Both Node and Python regression suites are required.');
const run=(name,command,args)=>new Promise(resolve=>{
  const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  child.once('error',error=>resolve({name,command:[command,...args],exit_code:null,stdout,stderr:stderr+'\n'+error.message}));
  child.once('close',exit_code=>resolve({name,command:[command,...args],exit_code,stdout,stderr}));
});
const runs=await Promise.all([run('node',process.execPath,['--test',...nodeFiles]),run('python',process.env.PREVIS_PYTHON||'python',['-B','-X','utf8','-m','unittest','discover','-s','tests','-p','test_*.py','-v'])]);
for(const item of runs){const text=item.stdout+'\n'+item.stderr;item.test_count=Number(item.name==='node'?text.match(/# tests (\d+)/)?.[1]:text.match(/Ran (\d+) tests?/)?.[1])||0;item.passed_count=item.name==='node'?Number(text.match(/# pass (\d+)/)?.[1])||0:item.exit_code===0?item.test_count:0;item.skipped_count=item.name==='node'?Number(text.match(/# skipped (\d+)/)?.[1])||0:0;console.log(item.name+': '+(item.exit_code===0?'PASS':'FAIL')+' ('+item.test_count+' tests)');if(item.exit_code!==0)console.error(text.slice(-14000))}
const report={status:runs.every(item=>item.exit_code===0&&item.test_count>0)?'PASS':'FAIL',scope:'DETERMINISTIC_CONTRACT_REGRESSION; real browser use, rendered media and upstream authorization are separate.',node_version:process.version,test_count:runs.reduce((sum,item)=>sum+item.test_count,0),passed_count:runs.reduce((sum,item)=>sum+item.passed_count,0),skipped_count:runs.reduce((sum,item)=>sum+item.skipped_count,0),runs};
if(reportFile){await mkdir(path.dirname(reportFile),{recursive:true});await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});console.log('Report: '+reportFile)}
if(report.status!=='PASS')process.exitCode=1;
