// Maintenance CLI. Run as the API OS user in its persistent working directory,
// with the intended database/environment loaded by a trusted release runner.
const fs = require('node:fs'),
  path = require('node:path'),
  { createRequire } = require('node:module')
process.umask(0o007)
const root = path.resolve(__dirname, '../..'),
  api = root + '/apps/api',
  r = createRequire(api + '/package.json'),
  ts = r('typescript'),
  cache = new Map()
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const m = { exports: {} }
  cache.set(file, m)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      esModuleInterop: true,
    },
  }).outputText
  function req(name) {
    const base = name.startsWith('src/')
      ? path.join(api, name)
      : name.startsWith('.')
        ? path.resolve(path.dirname(file), name)
        : null
    if (base) {
      const f = [base + '.ts', base + '/index.ts'].find(fs.existsSync)
      if (f) return load(f)
    }
    return createRequire(file)(name)
  }
  new Function('require', 'exports', 'module', code)(req, m.exports, m)
  return m.exports
}
async function main() {
  const { PrismaClient } = r('@otog/database'),
    db = new PrismaClient()
  try {
    if (process.env.CF_CATALOG_MIGRATE !== '1') {
      console.log(
        JSON.stringify({
          dryRun: true,
          legacyProblems: await db.problem.count({
            where: { area: 'otog', cfProblems: { some: {} } },
          }),
        })
      )
      return
    }
    const { CfCatalogService } = load(
      api + '/src/modules/codeforces/catalog.service.ts'
    )
    console.log(
      JSON.stringify({
        passed: true,
        ...(await new CfCatalogService(db).migrateLegacy()),
      })
    )
  } finally {
    await db.$disconnect()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
