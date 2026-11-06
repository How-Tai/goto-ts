// Offline audit only: actual source functions, dummy state, no sockets or production configuration.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'))
const webRequire = createRequire(path.join(root, 'apps/web/package.json'))
const ts = apiRequire('typescript')
const platformRequire = createRequire(apiRequire.resolve('@nestjs/platform-express'))
const noop = () => () => {}
const routes = new Proxy({}, { get: () => ({}) })
function load(relative, overrides = {}) {
  const filename = path.join(root, relative)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
    experimentalDecorators: true, emitDecoratorMetadata: false,
  } }).outputText
  const module = { exports: {} }
  function sourceRequire(name) {
    if (name in overrides) return overrides[name]
    if (name === '@nestjs/common') return new Proxy({}, { get: (_o, key) => key.endsWith('Exception') ? class extends Error {} : noop })
    if (name === '@ts-rest/nest') return { nestControllerContract: x => x, TsRestHandler: noop, tsRestHandler: (_route, fn) => fn }
    if (name === '@nestjs/platform-express') return { FileInterceptor: noop }
    if (name === '@otog/contract') return { contestRouter: routes, submissionRouter: routes }
    if (name === '@otog/database') return { ScoreboardPolicy: { AFTER_CONTEST: 'AFTER_CONTEST', DURING_CONTEST: 'DURING_CONTEST' }, SubmissionStatus: {}, UserRole: { user: 'user' } }
    if (name.includes('constants')) return { Role: { Admin: 'admin', User: 'user' }, AccessState: {} }
    if (name.startsWith('src/') || name.startsWith('.')) return new Proxy({}, { get: () => noop })
    if (name === 'multer') return {}
    return apiRequire(name)
  }
  new Function('require', 'module', 'exports', js)(sourceRequire, module, module.exports)
  return module.exports
}
async function main() {
  const results = []
  const { securityMiddleware } = load('apps/api/src/utils/security-middleware.ts')
  function request(url, ip, username) {
    let status = 200, next = false
    const req = { method: 'POST', path: url, socket: { remoteAddress: ip }, headers: {}, body: username === undefined ? undefined : { username } }
    const res = { setHeader() {}, status(s) { status = s; return this }, json() {} }
    securityMiddleware(req, res, () => { next = true })
    return { status, next }
  }
  const express = platformRequire('express')
  const app = express()
  app.post('/auth/login', () => {})
  app.post('/auth/register', () => {})
  for (const endpoint of ['login', 'register']) {
    const canonical = `/auth/${endpoint}`
    const layer = app._router.stack.find(x => x.route?.path === canonical)
    const ip = endpoint === 'login' ? '192.0.2.10' : '192.0.2.11'
    const normal = Array.from({ length: 125 }, (_, i) => request(canonical, ip, `audit-${i}`))
    assert.equal(normal.filter(x => x.status === 429).length, 5)
    for (const variant of [canonical.toUpperCase(), canonical + '/']) {
      assert(layer.match(variant))
      const responses = Array.from({ length: 125 }, (_, i) => request(variant, ip, `audit-${i}`))
      assert(responses.every(x => x.next && x.status === 200))
      results.push({ check: 'rate-limit route alias bypass', endpoint, variant, requests: 125, blocked: 0, expressRoutesToProtectedHandler: true })
    }
  }
  // No listener is started: initialize an empty real Nest app to inspect ordering.
  const { NestFactory } = apiRequire('@nestjs/core')
  const { Module } = apiRequire('@nestjs/common')
  class FixtureModule {}
  Module({})(FixtureModule)
  const nest = await NestFactory.create(FixtureModule, { logger: false })
  nest.use(securityMiddleware)
  await nest.init()
  const stack = nest.getHttpAdapter().getInstance()._router.stack
  const guardIndex = stack.findIndex(x => x.handle === securityMiddleware)
  const parserIndex = stack.findIndex(x => x.name === 'jsonParser')
  assert(guardIndex >= 0 && parserIndex > guardIndex)
  results.push({ check: 'username throttle precedes JSON body parser', guardIndex, parserIndex, usernameUnavailableAtThrottle: true })
  await nest.close()
  // Execute the real controller methods and actual service query construction.
  const { ContestController } = load('apps/api/src/modules/contest/contest.controller.ts')
  const { ContestService } = load('apps/api/src/modules/contest/contest.service.ts')
  const contest = { id: 7, timeStart: new Date(Date.now() - 60_000), timeEnd: new Date(Date.now() + 60_000), scoreboardPolicy: 'AFTER_CONTEST' }
  const sample = { id: 123, user: { id: 2, showName: 'Dummy contestant' }, problem: { id: 9 } }
  const prizePrisma = { contest: { findUnique: async () => contest }, $queryRaw: async () => [{ id: 123 }], submission: { findMany: async () => [sample] } }
  const contestService = new ContestService(prizePrisma)
  contestService.hasHiddenProblems = async () => false
  contestService.scoreboardByContestId = async () => ({ contest })
  const controller = new ContestController(contestService)
  assert.equal((await controller.getContestScoreboard(undefined)({ params: { contestId: '7' } })).status, 403)
  const prize = await controller.getContestPrize(undefined)({ params: { contestId: '7' } })
  assert.equal(prize.status, 200)
  assert.equal(prize.body.firstBlood[0].id, 123)
  results.push({ check: 'prizes bypass AFTER_CONTEST scoreboard restriction', scoreboardStatus: 403, prizeStatus: 200, disclosed: ['submission ID', 'problem ID', 'contestant ID', 'show name', 'accepted/unique-solver information'] })
  const { SubmissionController } = load('apps/api/src/modules/submission/submission.controller.ts')
  const { SubmissionService } = load('apps/api/src/modules/submission/submission.service.ts')
  let actualQuery
  const row = { id: 123, userId: 2, problemId: 9, contestId: 7, public: false }
  const submissionService = new SubmissionService({
    problem: { findFirst: async () => ({ id: 9 }) },
    submission: { findMany: async (query) => { actualQuery = query; return [row] } },
  })
  const sc = new SubmissionController(submissionService, {})
  const response = await sc.getSubmissionsByProblemId({ id: 1, role: 'user' })({ params: { userId: '2', problemId: '9' }, query: { limit: 10, offset: 1000 } })
  assert.equal(response.status, 200)
  assert.equal(response.body[0].contestId, 7)
  assert.equal(actualQuery.where.contestId, undefined)
  assert.equal(actualQuery.where.OR, undefined)
  results.push({ check: 'public-problem submission list omits contest visibility', status: 200, where: actualQuery.where, returnedContestId: response.body[0].contestId, sourceCodeSelected: !!actualQuery.select.sourceCode })
  const inventory = {
    nextRequested: webRequire('./package.json').dependencies.next,
    nextInstalled: webRequire('next/package.json').version,
    multerRequested: apiRequire('../../package.json').pnpm.overrides.multer,
    multerInstalled: platformRequire('multer/package.json').version,
    expressInstalled: platformRequire('express/package.json').version,
    reactInstalled: webRequire('react/package.json').version,
    node: process.version,
  }
  assert.equal(inventory.nextRequested, '15.5.28')
  assert.equal(inventory.nextInstalled, '14.2.3')
  assert.equal(inventory.multerRequested, '2.4.0')
  assert.equal(inventory.multerInstalled, '1.4.4-lts.1')
  results.push({ check: 'installed dependency drift', ...inventory })
  const files = ['apps/api/src/utils/security-middleware.ts','apps/api/src/index.ts','apps/api/src/modules/contest/contest.controller.ts','apps/api/src/modules/contest/contest.service.ts','apps/api/src/modules/submission/submission.controller.ts','apps/api/src/modules/submission/submission.service.ts']
  const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
  const output = { date: '2026-10-21', mode: 'offline source execution; dummy DB; no listener', passed: true, results, hashes, productionRequests: 0, productionWrites: 0 }
  fs.writeFileSync(path.join(__dirname, 'offline-api-results.json'), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(output, null, 2))
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
