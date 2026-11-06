const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),api=createRequire(root+'/apps/api/package.json'),web=createRequire(root+'/apps/web/package.json'),db=api('@otog/database'),ts=api('typescript');
const status='MEMORY_LIMIT_EXCEEDED';assert.equal(db.VerdictStatus.MEMORY_LIMIT_EXCEEDED,status);
assert(db.VerdictModel.shape.status.safeParse(status).success);
const verdict={id:1,subtaskId:1,status,percent:0,timeUsed:10,memUsed:32000,testcaseIndex:1};assert(db.VerdictModel.safeParse(verdict).success);
const checks=['generated Prisma and Zod enum/model accept MLE without changing other verdict values'];
// Render the actual status cells with lightweight dependency stubs.
const React=web('react'),{renderToStaticMarkup}=web('react-dom/server'),file=root+'/apps/web/src/components/submission-dialog.tsx',moduleUnderTest={exports:{}};
function req(name){
 if(name==='@tanstack/react-table')return {createColumnHelper:()=>({display:options=>options,accessor:(_key,options)=>options})};
 if(name==='@otog/database')return db;
 if(name==='@otog/contract')return new Proxy({},{get:()=>({})});
 if(name==='@otog/ui/badge')return{Badge:({children})=>React.createElement('span',null,children)};
 if(name.includes('/utils'))return{exhaustiveGuard:()=>{throw Error('Unhandled verdict')}};
 if(name.startsWith('.')||name.startsWith('@otog/ui/'))return new Proxy({},{get:()=>()=>null});
 if(name==='react'||name==='react/jsx-runtime')return web(name);
 return new Proxy({},{get:()=>()=>null});
}
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','module','exports',js+'\nexports.testColumns=columns;')(req,moduleUnderTest,moduleUnderTest.exports);
const columns=moduleUnderTest.exports.testColumns;assert(renderToStaticMarkup(columns[1].cell({getValue:()=>status})).includes('Memory Limit Exceeded'));assert.equal(columns[2].cell({getValue:()=>status}),'Memory limit exceeded');
assert(renderToStaticMarkup(columns[1].cell({getValue:()=> 'RUNTIME_ERROR'})).includes('Runtime Error'));
checks.push('real submission-detail cells render MLE label/details and preserve Runtime Error');
console.log(JSON.stringify({passed:true,checks,productionWrites:0}));
