const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),web=createRequire(root+'/apps/web/package.json'),ts=createRequire(root+'/apps/api/package.json')('typescript'),real=web('@ts-rest/react-query');let initialized=0;
const moduleUnderTest={exports:{}};
function req(name){if(name==='@ts-rest/react-query')return{...real,initQueryClient:(routes,args)=>{initialized+=Object.keys(routes).length;return real.initQueryClient(routes,args)}};return web(name)}
const code=ts.transpileModule(fs.readFileSync(root+'/apps/web/src/api/lazy-server-query.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(req,moduleUnderTest,moduleUnderTest.exports);
async function main(){const {lazyServerQuery}=moduleUnderTest.exports;
 const routes={contest:{read:{method:'GET',path:'/fixture/:id',responses:{200:null}},unused:{method:'GET',path:'/unused',responses:{200:null}}},other:{read:{method:'GET',path:'/other',responses:{200:null}}}};
 Object.freeze(routes.contest);Object.freeze(routes);
 const clients=Array.from({length:100},(_,identity)=>lazyServerQuery(routes,{baseUrl:'',jsonQuery:true,baseHeaders:{authorization:'fixture-'+identity},api:async({headers,path})=>{await new Promise(resolve=>setTimeout(resolve,(99-identity)%5));assert.equal(headers.authorization,'fixture-'+identity);return{status:200,body:{identity,path},headers:new Headers()}}}));
 assert.equal(initialized,0);assert.equal(clients[0].then,undefined);const first=clients[0].contest;assert.equal(initialized,0);assert.equal(clients[0].contest,first);
 const results=await Promise.all(clients.map((client,id)=>client.contest.read.query({params:{id:String(id)}})));
 assert.equal(initialized,100);results.forEach((result,id)=>assert.deepEqual(result.body,{identity:id,path:'/fixture/'+id}));
 const again=await clients[0].contest.read.query({params:{id:'again'}});assert.equal(initialized,100);assert.equal(again.body.identity,0);assert.equal(again.body.path,'/fixture/again');
 await clients[0].other.read.query();assert.equal(initialized,101);assert.equal(clients[0].unknown,undefined);
 console.log(JSON.stringify({passed:true,checks:['100 interleaved requests keep independent authentication callbacks and responses','unused routers and routes do not initialize; repeated route access reuses only that request’s client','nested routes retain real ts-rest path construction and query behavior'],productionWrites:0}));}
main().catch(error=>{console.error(error);process.exitCode=1});
