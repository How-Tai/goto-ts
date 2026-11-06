const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),web=createRequire(root+'/apps/web/package.json'),api=createRequire(root+'/apps/api/package.json');
const React=web('react'),{renderToStaticMarkup}=web('react-dom/server'),ts=api('typescript'),moduleUnderTest={exports:{}};
const source=fs.readFileSync(root+'/apps/web/src/modules/announcement/elements.tsx','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function req(name){if(name==='../../utils/safe-link')return{isSafeLink:()=>true};if(name==='@otog/ui/button')return{Button:'button'};if(name==='@otog/ui/link')return{Link:'a'};return web(name)}
new Function('require','module','exports',js)(req,moduleUnderTest,moduleUnderTest.exports);
const ref=()=>{},attributes={'data-slate-placeholder':true,contentEditable:false,ref,style:{position:'absolute',pointerEvents:'none',opacity:.333}};
const result=moduleUnderTest.exports.Placeholder({attributes,children:'Enter announcement...'});
assert.equal(result.props['data-slate-placeholder'],true,'Slate must be able to identify placeholder DOM');
assert.equal(result.props.contentEditable,false,'The caret must not enter placeholder text');
assert.equal(result.ref,ref,'Slate must receive the placeholder DOM ref');
assert.equal(result.props.style.pointerEvents,'none');assert.equal(result.props.style.position,'absolute');assert.equal(result.props.style.top,'50%');
const html=renderToStaticMarkup(result);assert.match(html,/data-slate-placeholder="true"/);assert.match(html,/contenteditable="false"/);assert.ok(html.includes('Enter announcement...'));
console.log(JSON.stringify({passed:true,checks:['placeholder DOM preserves the Slate marker, noneditable flag and ref','positioning and pointer-event attributes survive custom rendering','placeholder children render without becoming editable'],productionWrites:0}));
