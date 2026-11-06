// Real submission components with fixture data; no network or browser automation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module')
const root=path.resolve(__dirname,'../..'),r=createRequire(root+'/apps/web/package.json'),React=r('react'),{renderToStaticMarkup}=r('react-dom/server'),ts=r('typescript'),table=r('@tanstack/react-table')
const component=({children})=>React.createElement('div',null,children)
const cache=new Map()
function load(name){
 if(cache.has(name))return cache.get(name)
 const file=root+'/apps/web/src/'+name+'.'+(name.startsWith('utils/')?'ts':'tsx'),m={exports:{}}
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
 function req(id){
  if(id.endsWith('/format-score'))return load('utils/format-score')
  if(id.endsWith('/problem-document'))return {problemDocumentUrl:id=>'/problem/'+id}
  if(id==='next/link')return {__esModule:true,default:component}
  if(id.startsWith('@otog/ui/'))return new Proxy({}, {get:(_t,key)=>key==='useControllableState'?()=>[false,()=>{}]:component})
  if(id==='@phosphor-icons/react')return new Proxy({}, {get:()=>()=>null})
  if(id.endsWith('/api/query'))return {submissionQuery:{shareSubmission:{useMutation:()=>({})},rejudgeSubmission:{useMutation:()=>({})}}}
  if(id.endsWith('/submission-state'))return {isSubmissionPending:s=>['waiting','grading'].includes(s.status)}
  if(id.endsWith('/user-context'))return {useUserContext:()=>({user:null})}
  if(id.endsWith('/use-clipboard'))return {useClipboard:()=>({})}
  if(id.endsWith('/use-live-submission'))return {useLiveSubmission:()=>({})}
  if(id==='@tanstack/react-query')return {useQueryClient:()=>({})}
  if(id.endsWith('/enums'))return {LanguageName:{cpp:'C++'}}
  if(id.endsWith('/exhaustive-guard'))return {exhaustiveGuard:()=>{throw Error('Unexpected verdict')}}
  if(id==='./code-highlight')return {CodeHighlight:()=>null}
  if(id==='./user-avatar')return {UserAvatar:()=>null}
  if(id==='./table-component')return {TableComponent:({table:t})=>React.createElement('div',null,...t.getRowModel().rows.map(row=>React.createElement('div',{key:row.id},...row.getVisibleCells().map(cell=>React.createElement('span',{key:cell.id},table.flexRender(cell.column.columnDef.cell,cell.getContext()))))))}
  return r(id)
 }
 new Function('require','module','exports',code)(req,m,m.exports);cache.set(name,m.exports);return m.exports
}
const {SubmissionDetail}=load('components/submission-dialog'),{formatScore}=load('utils/format-score')
const fixture={id:805,problem:{id:74,name:'Homework Manager',score:100},user:{id:1,showName:'Fixture'},userId:1,creationDate:new Date(),language:'cpp',status:'reject',submissionResult:{score:99.52799842055708,timeUsed:449,memUsed:1024,subtaskResults:[{subtaskIndex:4,score:59.52799842055708,fullScore:60,verdicts:[{status:'PARTIAL',percent:.9106416928094863,timeUsed:1,memUsed:1024}]}]}}
let html=renderToStaticMarkup(React.createElement(SubmissionDetail,{submission:fixture}))
assert(html.includes('99.53 / 100'));assert(html.includes('59.53 / 60'));assert(html.includes('91.06%'));assert(!html.includes('99.527998'))
html=renderToStaticMarkup(React.createElement(SubmissionDetail,{submission:{...fixture,status:'grading'}}))
assert(!html.includes('99.53'));assert(html.includes('Grading...'))
assert.equal(formatScore(0),'0');assert.equal(formatScore(100),'100');assert.equal(formatScore(99.5),'99.50');assert.equal(formatScore(1/3),'0.33')
console.log(JSON.stringify({passed:true,checks:['805 total and subtask formatted to 2dp','partial testcase percentage visible','pending rejudge hides previous score','whole scores preserved'],realReactServerRendering:true}))
