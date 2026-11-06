// Exercise actual callers after security overrides; small temporary fixtures only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createRequire}=require('node:module')
const root=path.resolve(__dirname,'../../..'),web=createRequire(root+'/apps/web/package.json')
const plugin=web('@next/eslint-plugin-next'),pluginRequire=createRequire(web.resolve('@next/eslint-plugin-next'))
const glob=pluginRequire('glob')
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'otog-dependency-check-'))
async function main(){try{
  const pages=path.join(directory,'pages');fs.mkdirSync(pages);fs.writeFileSync(path.join(pages,'index.js'),'export default function Page() { return null }')
  assert.equal(glob.globSync('**/*.js',{cwd:directory}).length,1)
  const eslintEntry=fs.readdirSync(root+'/node_modules/.pnpm').find(n=>n.startsWith('eslint@8.'))
  assert(eslintEntry)
  const {Linter}=require(root+'/node_modules/.pnpm/'+eslintEntry+'/node_modules/eslint'),linter=new Linter()
  linter.defineRule('next-link',plugin.rules['no-html-link-for-pages'])
  const messages=linter.verify('const item = <a href="/">Home</a>',{parserOptions:{ecmaVersion:2022,sourceType:'module',ecmaFeatures:{jsx:true}},rules:{'next-link':['error',pages]}})
  assert(messages.some(m=>m.ruleId==='next-link'))
  const aborted=new AbortController();aborted.abort()
  await assert.rejects(glob.glob('**/*',{cwd:directory,signal:aborted.signal}))
  // Resolve Express's actual serializer/parser dependency rather than a top-level tool copy.
  const api=createRequire(root+'/apps/api/package.json'),express=createRequire(api.resolve('@nestjs/platform-express/package.json'))
  const expressRequire=createRequire(express.resolve('express')),query=expressRequire('qs')
  assert.equal(query.parse('item=a&item=b').item.length,2)
  assert.doesNotThrow(()=>query.stringify({item:[{toString:'dummy'}]},{arrayFormat:'comma'}))
  const old=[]
  for(const major of [3,5]){
    const entries=fs.readdirSync(root+'/node_modules/.pnpm').filter(n=>n.startsWith('minimatch@'+major+'.'))
    for(const entry of entries){
      const folder=root+'/node_modules/.pnpm/'+entry+'/node_modules/minimatch',mm=require(folder)
      assert.equal(typeof mm,'function');assert(mm('a.js','*.js'))
      assert.equal(mm.Minimatch.prototype.firstPhasePreProcess,undefined)
      assert(!fs.readFileSync(folder+'/minimatch.js','utf8').includes('optimizationLevel'))
      old.push(JSON.parse(fs.readFileSync(folder+'/package.json','utf8')).version)
    }
  }
  console.log(JSON.stringify({passed:true,globAndNextLintCaller:true,abortCancellation:true,expressQueryHandling:true,legacyMinimatchWithoutAffectedOptimizer:old}))
}finally{fs.rmSync(directory,{recursive:true,force:true})}}
main().catch(error=>{console.error(error);process.exitCode=1})
