const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),web=createRequire(root+'/apps/web/package.json'),api=createRequire(root+'/apps/api/package.json');
const React=web('react'),{renderToStaticMarkup}=web('react-dom/server'),ts=api('typescript');let pending=false;
const data={observedAt:new Date().toISOString(),waiting:0,grading:0,queueLimit:100,maxWorkersPerUser:5,memoryReservationsEnabled:false,maxCompilerJobs:10,queue:[],workers:Array.from({length:7},(_,index)=>({id:index+1,enabled:index<6,connected:true,cpuId:index,startedAt:new Date().toISOString(),submissionId:null})),compilation:{slots:[]},telemetry:null,resourceStatus:{state:'unavailable'}};
const moduleUnderTest={exports:{}};
data.graderAllocation={count:6,revision:1,appliedRevision:1};data.cpuAllocation={observedAt:new Date().toISOString(),serviceCpus:[6,7],drainingWorkers:[],error:null};
data.telemetry={machine:{name:'test',cpuCount:8,uptimeSeconds:1,memoryTotalMb:6000,memoryAvailableMb:4000,diskFreeGb:28,diskTotalGb:59,swapTotalMb:2048},history:[],warnings:[],services:Array.from({length:7},(_,i)=>({name:'otog-grader'+(i?i+1:'')+'-1',state:'running'}))};
function req(name){
 if(name==='react-hot-toast')return{success(){},error(){}};
 if(name==='@tanstack/react-query')return{useQuery:()=>({data,isPending:false,isError:false,isFetching:false}),useQueryClient:()=>({invalidateQueries:async()=>{}}),useMutation:options=>({isPending:pending&&String(options.mutationFn).includes('/worker-count'),mutate(){}})};
 if(name==='next/link')return'a';if(name==='next/head')return()=>null;
 if(name==='@otog/ui/button')return{Button:({variant,size,...props})=>React.createElement('button',props)};
 if(name==='@otog/ui/tabs')return{Tabs:({children})=>React.createElement('div',null,children),TabsList:({children})=>React.createElement('div',null,children),TabsTrigger:({children})=>React.createElement('div',null,children)};
 if(name==='../../api/server')return{withSession:fn=>fn};if(name==='../../api/browser')return{client:{}};
 if(name.endsWith('/chart-data'))return{historySegments:()=>[],historyTime:()=>0};
 if(name.endsWith('/resource-readings'))return{ResourceReadings:({children})=>React.createElement(React.Fragment,null,children)};
 if(name.startsWith('../../components/'))return new Proxy({},{get:()=>()=>null});
 return web(name);
}
const js=ts.transpileModule(fs.readFileSync(root+'/apps/web/src/pages/admin/grading.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','module','exports',js)(req,moduleUnderTest,moduleUnderTest.exports);
let html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));
let select=html.match(/<select[^>]*id="grader-count"[^>]*>([\s\S]*?)<\/select>/);assert(select);assert.equal((select[1].match(/<option /g)||[]).length,7);assert.match(select[1],/value="6" selected=""/);assert(!select[0].includes('disabled='));assert(html.includes('CPUs 0–5'));assert(html.includes('CPUs 6, 7'));assert(!html.includes('Worker 7'));assert(!html.includes('otog-grader7-1'));
pending=true;html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));select=html.match(/<select[^>]*id="grader-count"[^>]*>/);assert.match(select[0],/disabled=""/);
assert(html.includes('Updating CPU allocation…'));pending=false;
for(const count of [1,3,7]){data.graderAllocation.count=count;html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));assert.equal((html.match(/class="font-medium">Worker /g)||[]).length,count)}
data.graderAllocation.count=3;data.cpuAllocation.drainingWorkers=[7];data.workers[6].submissionId=900;
html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));assert(html.includes('Worker 7'));assert(html.includes('Finishing, then releasing CPU'));assert(html.includes('otog-grader7-1'));assert(!html.includes('Worker 4'));
data.cpuAllocation.drainingWorkers=[];data.workers[6].submissionId=null;html=renderToStaticMarkup(React.createElement(moduleUnderTest.exports.default));assert(!html.includes('Worker 7'));assert(!html.includes('otog-grader7-1'));
console.log(JSON.stringify({passed:true,checks:['hidden inactive grader rows and telemetry entries','chosen count persists independently from individual pause state','retiring jobs remain visible until finished','actual service CPU pool shown','transition state rendered'],productionWrites:0}));
