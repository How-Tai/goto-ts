const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),web=createRequire(root+'/apps/web/package.json'),api=createRequire(root+'/apps/api/package.json');
const React=web('react'),{renderToStaticMarkup}=web('react-dom/server'),ts=api('typescript');let pending=false;
const data={observedAt:new Date().toISOString(),waiting:0,grading:0,queueLimit:100,maxWorkersPerUser:5,memoryReservationsEnabled:false,maxCompilerJobs:10,queue:[],workers:Array.from({length:7},(_,index)=>({id:index+1,enabled:index<6,connected:true,cpuId:index,startedAt:new Date().toISOString(),submissionId:null})),compilation:{slots:[]},telemetry:null,resourceStatus:{state:'unavailable'}};
const moduleUnderTest={exports:{}};
function req(name){
 if(name==='react-hot-toast')return{success(){},error(){}};
 if(name==='@tanstack/react-query')return{useQuery:()=>({data,isPending:false,isError:false,isFetching:false}),useQueryClient:()=>({invalidateQueries:async()=>{}}),useMutation:options=>({isPending:pending&&String(options.mutationFn).includes('/worker-count'),mutate(){}})};
 if(name==='next/link')return'a';if(name==='next/head')return()=>null;
 if(name==='@otog/ui/button')return{Button:({variant,size,...props})=>React.createElement('button',props)};
 if(name==='@otog/ui/tabs')return{Tabs:({children})=>React.createElement('div',null,children),TabsList:({children})=>React.createElement('div',null,children),TabsTrigger:({children})=>React.createElement('div',null,children)};
 if(name==='../../api/server')return{withSession:fn=>fn};if(name==='../../api/browser')return{client:{}};
 if(name.startsWith('../../components/'))return new Proxy({},{get:()=>()=>null});
 return web(name);
}
const js=ts.transpileModule(fs.readFileSync(root+'/apps/web/src/pages/admin/grading.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','module','exports',js)(req,moduleUnderTest,moduleUnderTest.exports);
let html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));
let select=html.match(/<select[^>]*id="grader-count"[^>]*>([\s\S]*?)<\/select>/);assert(select);assert.equal((select[1].match(/<option /g)||[]).length,7);assert.match(select[1],/value="6" selected=""/);assert(!select[0].includes('disabled='));assert(html.includes('CPUs 0–6'));assert(html.includes('CPU 7'));
pending=true;html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));select=html.match(/<select[^>]*id="grader-count"[^>]*>/);assert.match(select[0],/disabled=""/);
assert.equal((html.match(/>Updating…</g)||[]).length,1);
console.log(JSON.stringify({passed:true,checks:['real dashboard renders choices 1–7 with current selection','CPU allocation explained','controls disabled while fleet update is pending'],productionWrites:0}));
