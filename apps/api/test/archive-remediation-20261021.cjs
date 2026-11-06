// Temporary real ZIP fixtures, controlled filesystem failures; no production files.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {createRequire}=require('node:module');const api=path.resolve(__dirname,'..'),r=createRequire(api+'/package.json'),ts=r('typescript');
async function main(){
 const temp=fs.mkdtempSync(path.join(process.cwd(),'archive-audit-')),previous=process.cwd();
 let entered,release,failCleanup=false;
 const reached=new Promise(done=>entered=done),resume=new Promise(done=>release=done);
 const fakePromises={...fsp,statfs:async()=>({bavail:6*1024**3,bsize:1}),
  chmod:async (_path,mode)=>{if(mode&0o6000)throw Object.assign(new Error('setgid is forbidden by RestrictSUIDSGID'),{code:'EPERM'})},
  mkdir:async (directory,options)=>{if(String(directory).includes('.upload-')&&!entered.done){entered.done=true;entered();await resume}return fsp.mkdir(directory,options)},
  rm:async(p,opts)=>{if(failCleanup&&String(p).includes('.upload-')){failCleanup=false;throw new Error('fixture cleanup error')}return fsp.rm(p,opts)}};
 const mod={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(api+'/src/utils/file.util.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true}}).outputText;
 function req(name){if(name==='node:fs/promises')return fakePromises;if(name==='./pdf-title.util')return{setProblemPdfTitle:async x=>x};if(name==='./problem-statement')return{statementFiles:()=>[]};if(name.startsWith('src/'))return{FileManager:class{}};return r(name)}
 new Function('require','module','exports',source)(req,mod,mod.exports);
 const update=mod.exports.updateProblemTestCase;
 const python=process.platform==='win32'?'python':'python3';
 function zip(name,unsafe=false){cp.execFileSync(python,['-c','import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w");z.writestr("../escape" if sys.argv[2]=="yes" else "1.in","fixture");z.writestr("1.sol","answer");z.close()',name,unsafe?'yes':'no'])}
 process.chdir(temp);
 try{
  zip('first.zip');zip('second.zip');
  const first=update('1','first.zip',{});await reached;
  await assert.rejects(()=>update('2','second.zip',{}),/disk space/);
  release();await first;
  assert.equal(fs.readFileSync('source/1/1.in','utf8'),'fixture');
  // Invalid extraction plus a failing stage deletion must still release the
  // per-problem lock and disk reservation, permitting a subsequent valid ZIP.
  zip('bad.zip',true);failCleanup=true;
  await assert.rejects(()=>update('3','bad.zip',{}),/cleanup error/);
  assert(!fs.existsSync('bad.zip'));
  zip('retry.zip');await update('3','retry.zip',{});
  assert.equal(fs.readFileSync('source/3/1.sol','utf8'),'answer');
  assert(!fs.existsSync('escape'));
  cp.execFileSync(python,['-c',[
   'import zipfile,sys',
   'for name,payload in [("empty-dir.zip",b""),("payload-dir.zip",b"x"*65536)]:',
   ' with zipfile.ZipFile(name,"w",zipfile.ZIP_DEFLATED) as z:',
   '  z.writestr("nested/",payload)',
   '  z.writestr("nested/1.in","input")',
   '  z.writestr("nested/1.sol","output")',
   ' if payload:',
   '  with open(name,"r+b") as f: f.seek(22); f.write(bytes(4))',
  ].join('\n')]);
  await update('4','empty-dir.zip',{});
  assert.equal(fs.readFileSync('source/4/nested/1.sol','utf8'),'output');
  await assert.rejects(()=>update('3','payload-dir.zip',{}),/directory entries must be empty/);
  assert.equal(fs.readFileSync('source/3/1.sol','utf8'),'answer');
  assert(!fs.existsSync('payload-dir.zip'));
  console.log(JSON.stringify({passed:true,checks:['staging avoids forbidden setgid chmod','concurrent uploads reserve a shared expansion budget','cleanup exceptions release the problem lock and reservation','valid retry after failed cleanup succeeds','ZIP traversal remains rejected','only empty directory entries are accepted'],productionWrites:0}));
 }finally{release();process.chdir(previous);fs.rmSync(temp,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
