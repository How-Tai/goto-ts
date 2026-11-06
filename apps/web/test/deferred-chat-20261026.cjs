const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');const root=path.resolve(__dirname,'../../..'),r=createRequire(root+'/apps/api/package.json'),ts=r('typescript');
let cursor=0,slots=[],effects=[],authenticated=true,loaded=0,lazyLoader,queryOptions;const handlers=new Map();const socket={on:(name,callback)=>handlers.set(name,callback),off:(name,callback)=>{if(handlers.get(name)===callback)handlers.delete(name)}};
const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=value]},useRef(value){const i=cursor++;return slots[i]??={current:value}},useEffect(callback,deps){const i=cursor++,old=effects[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){old?.cleanup?.();effects[i]={deps,cleanup:callback()}}},useMemo:callback=>callback(),useCallback:callback=>callback,forwardRef:callback=>callback,memo:callback=>callback,Children:{map:()=>[]},cloneElement:x=>x};
const jsx=(type,props)=>({type,props});
function load(relative,extra=''){const file=path.resolve(root,relative),module={exports:{}};
 function req(name){
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='next/dynamic')return{__esModule:true,default:factory=>{lazyLoader=factory;return'ChatPanel'}};
  if(name.endsWith('/socket-context'))return{useSocketContext:()=>({socket})};if(name.endsWith('/user-context'))return{useUserContext:()=>({isAuthenticated:authenticated})};
  if(name.endsWith('/env'))return{environment:{OFFLINE_MODE:false}};if(name==='./chat'){loaded++;return{Chat:()=>null}};
  if(name==='@tanstack/react-query')return{useInfiniteQuery:options=>(queryOptions=options,{data:undefined}),useQueryClient:()=>({})};
  if(name.endsWith('/api/query'))return{chatKey:{getChats:{_def:['chat']}},chatQuery:{getChats:{query:async()=>({status:200,body:[]})}}};
  if(name==='zod')return r(name);
  return new Proxy({},{get:(_target,key)=>String(key)})
 }
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;new Function('require','module','exports',code+'\n'+extra)(req,module,module.exports);return module.exports;
}
function nodes(value,out=[]){if(!value||typeof value!=='object')return out;out.push(value);for(const child of[value.props?.children].flat(Infinity))nodes(child,out);return out}
async function main(){const checks=[];let Component=load('apps/web/src/components/deferred-chat.tsx').DeferredChat;const render=()=>{cursor=0;return Component()};let view=render();assert.equal(loaded,0);assert(nodes(view).some(x=>x.props?.['aria-label']==='แชท'));handlers.get('chat')();view=render();assert(nodes(view).some(x=>x.props?.className?.includes('bg-orange-500')));
 const button=nodes(view).find(x=>x.type==='Button');button.props.onPointerEnter();await new Promise(resolve=>setImmediate(resolve));view=render();assert.equal(loaded,1);assert.notEqual(view.type,'ChatPanel');assert(nodes(view).some(x=>x.props?.className?.includes('bg-orange-500')));nodes(view).find(x=>x.type==='Button').props.onClick();view=render();assert.equal(view.type,'ChatPanel');assert.equal(view.props.open,true);assert.equal(view.props.initialUnread,false);assert(!handlers.has('chat'));checks.push('closed chat loads no panel code; lightweight unread badge works; preload keeps the launcher mounted until click and opening clears unread');
 for(const effect of effects)effect?.cleanup?.();cursor=0;slots=[];effects=[];loaded=0;Component=load('apps/web/src/components/deferred-chat.tsx').DeferredChat;view=render();nodes(view).find(x=>x.type==='Button').props.onClick();view=render();assert.equal(view.type,'ChatPanel');assert.equal(view.props.open,true);await lazyLoader();assert.equal(loaded,1);checks.push('first click opens the panel even while its code is loading');
 const chat=load('apps/web/src/components/chat.tsx','exports.__loadChat = useLoadChat;');chat.__loadChat(false);assert.equal(queryOptions.enabled,false);chat.__loadChat(true);assert.equal(queryOptions.enabled,true);authenticated=false;chat.__loadChat(true);assert.equal(queryOptions.enabled,false);checks.push('real chat-history hook fetches only for an authenticated open panel');
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));}
main().catch(error=>{console.error(error);process.exitCode=1});
