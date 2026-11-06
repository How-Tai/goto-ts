// Bounded regression fixtures for S02–S06. No production configuration/accounts.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createRequire } = require('node:module'), { EventEmitter } = require('node:events')
const api = path.resolve(__dirname, '..'), root = path.resolve(api, '../..'), r = createRequire(api + '/package.json')
const ts = r('typescript'), cache = new Map()
const secret = require('node:crypto').randomBytes(32).toString('hex')
process.env.OTOG_AUTH_PROXY_SECRET = secret
const environment = { JWT_SECRET: secret, S3_BUCKET: 'dummy', S3_REGION: 'dummy', S3_ENDPOINT: 'http://127.0.0.1:9', USE_S3: false }
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, experimentalDecorators: true, esModuleInterop: true } }).outputText
  function req(name) {
    if (name === 'src/env') return { environment }
    if (name === 'src/core/database/prisma.service') return { PrismaService: class {} }
    if (name === '@otog/contract') return load(root + '/packages/contract/src/index.ts')
    const base = name.startsWith('src/') ? path.join(api, name) : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null
    if (base) { const target = [base + '.ts', base + '/index.ts'].find(fs.existsSync); if (target) return load(target) }
    return createRequire(file)(name)
  }
  new Function('require', 'module', 'exports', js)(req, mod, mod.exports)
  return mod.exports
}
const a = name => load(api + '/src/' + name + '.ts')
async function main() {
  const checks = []
  const { securityMiddleware } = a('utils/security-middleware')
  const { authProxyHeaders } = load(root + '/apps/web/src/api/auth-proxy.ts')
  const { ingressAddress, loginCredentials, loginClientAddress } = a('utils/auth-admission')
  const request = (ip, username, query = {}) => ({ method: 'POST', path: '/auth/login', body: { username, password: 'dummy-password' }, query, socket: { remoteAddress: '127.0.0.1' }, headers: authProxyHeaders({ socket: { remoteAddress: ip } }) })
  const admit = req => { let status = 200, next = false; const res = { setHeader() {}, status(v) { status = v; return this }, json() {} }; securityMiddleware(req, res, () => { next = true }); return { status, next } }
  assert.equal(loginCredentials({ body: {}, query: { username: 'x', password: 'y' } }), null)
  for (const query of [{ username: 'x' }, { password: 'x' }, { username: ['x'] }]) assert.equal(admit(request('192.0.2.1', 'mixed', query)).status, 400)
  for (const body of [{ username: ['x'], password: 'y' }, { username: 'x', password: {} }, { username: 'x', password: 'y'.repeat(256) }]) assert.equal(loginCredentials({ body, query: {} }), null)
  for (let i = 0; i < 30; i++) assert(admit(request('192.0.2.3', 'same-account')).next)
  assert.equal(admit(request('192.0.2.3', 'same-account')).status, 429)
  assert(admit(request('192.0.2.40', 'same-account')).next)
  for (let i = 0; i < 120; i++) assert(admit(request('198.51.100.1', 'peer-' + i)).next)
  for (let i = 0; i < 1000; i++) assert.equal(admit(request('198.51.100.1', 'peer-exhausted')).status, 429)
  assert(admit(request('198.51.100.2', 'unrelated-client')).next)
  assert.equal(ingressAddress({ socket: { remoteAddress: '203.0.113.1' }, headers: { 'x-forwarded-for': '198.51.100.1' } }), '203.0.113.1')
  assert.equal(ingressAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'spoof, 198.51.100.9, 127.0.0.1' } }), '198.51.100.9')
  const forged = request('198.51.100.9', 'forged'); forged.headers['x-otog-client-signature'] = '0'.repeat(64)
  assert.equal(loginClientAddress(forged), '127.0.0.1')
  checks.push('body-only exact credentials; mixed/query/malformed inputs rejected; independent signed client/account admission; forged headers rejected')

  // Exercise actual installed Passport Local over an isolated HTTP listener.
  const express = createRequire(r.resolve('@nestjs/platform-express/package.json'))('express'), passport = r('passport'), app = express()
  const { LocalStrategy } = a('modules/auth/local.strategy')
  let verified = 0
  new LocalStrategy({ validateUser: async () => { verified++; return { id: 1 } } })
  app.use(express.json(), express.urlencoded({ extended: true }), securityMiddleware)
  app.post('/auth/login', passport.authenticate('local', { session: false }), (_req, res) => res.json({ ok: true }))
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try {
    const base = 'http://127.0.0.1:' + server.address().port + '/auth/login'
    assert.equal((await fetch(base + '?username=query&password=dummy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400)
    assert.equal(verified, 0)
    for (const [contentType, body] of [['application/json', JSON.stringify({ username: 'http-json', password: 'dummy' })], ['application/x-www-form-urlencoded', 'username=http-form&password=dummy']])
      assert.equal((await fetch(base, { method: 'POST', headers: { 'content-type': contentType }, body })).status, 200)
    assert.equal(verified, 2)
  } finally { await new Promise(resolve => server.close(resolve)) }
  checks.push('real Passport HTTP: JSON/form credentials accepted, query credentials never reach password verifier')

  const { AuthService } = a('modules/auth/auth.service'), { JwtRefreshTokenStrategy } = a('modules/auth/jwt.refreshtoken.strategy')
  const row = { id: 'fixture-rid', jwtId: 'fixture-jti', userId: 1, used: false, expiryDate: new Date(Date.now() + 60000) }
  const match = (where) => Object.entries(where).every(([k, v]) => k === 'expiryDate' ? row[k] > v.gt : row[k] === v)
  let reads = 0
  const service = new AuthService({}, {}, { refreshToken: { updateMany: async ({ where, data }) => { if (!match(where)) return { count: 0 }; Object.assign(row, data); return { count: 1 } } } })
  const strategy = new JwtRefreshTokenStrategy(service, { findOneById: async id => { reads++; return { id, role: id === 2 ? 'admin' : 'user' } } })
  await assert.rejects(() => strategy.validate({ cookies: { RID: row.id } }, { id: 2, jti: row.jwtId }))
  assert.equal(reads, 0); assert.equal(row.used, false)
  for (const id of ['1', -1, 1.5, null]) await assert.rejects(() => service.validateToken(row.id, row.jwtId, id))
  const race = await Promise.allSettled([service.validateToken(row.id, row.jwtId, 1), service.validateToken(row.id, row.jwtId, 1)])
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1)
  const { strongSecret } = a('utils/secret-policy')
  for (const value of ['', 'MyJwtSecret', 'a'.repeat(64), 'replace-' + secret]) assert.equal(strongSecret(value), false)
  assert(strongSecret(secret))
  checks.push('refresh ownership/type binding before identity lookup; one-time atomic consumption; weak/placeholder secret policy')

  const { readableProblemFilter } = a('utils/problem-visibility')
  const { ContestService } = a('modules/contest/contest.service'), { ContestPageService } = a('modules/submission/contest-page.service')
  const ordinary = { id: 1, role: 'user' }, admin = { id: 2, role: 'admin' }
  let visible = false, start = new Date(Date.now() - 10000), end = new Date(Date.now() + 10000), metadataReads = 0
  const allowed = where => !where.OR || where.OR.some(rule => rule.show === true ? visible : !!rule.contestProblem && start <= new Date() && end >= new Date())
  const problem = { id: 67, name: 'fixture', show: false }
  const prisma = { problem: { findMany: async ({ where }) => allowed(where) ? [{ id: 67 }] : [], findFirst: async ({ where }) => allowed(where) ? problem : null, findUnique: async () => { metadataReads++; return problem } },
    contest: { findUnique: async ({ select }) => ({ id: 2, timeStart: start, timeEnd: end, contestProblem: select.contestProblem ? (allowed(select.contestProblem.where.problem) ? [{ problem }] : []) : undefined }) },
    $queryRaw: async () => [{ id: 2, contestVersion: '1', problemVersion: '1', timeStart: start, timeEnd: end, problemId: 67, show: visible }] }
  const contests = new ContestService(prisma), pages = new ContestPageService(prisma, contests, { findFirstByProblemIdAndUserId: async () => null })
  for (const phase of ['before', 'during', 'after']) {
    start = new Date(Date.now() + (phase === 'before' ? 60000 : -60000)); end = new Date(Date.now() + (phase === 'after' ? -10000 : 60000))
    for (const show of [false, true]) { visible = show
      for (const user of [undefined, ordinary, admin]) {
        const expected = show || user?.role === 'admin' || !!user && phase === 'during'
        assert.equal(allowed(readableProblemFilter(user)), expected)
        assert.equal(!!await contests.getContestProblem(2, 67, user), expected)
        assert.equal((await contests.getContestDetail(2, user)).contestProblem.length > 0, expected)
      }
    }
  }
  visible = false; start = new Date(0); end = new Date(Date.now() + 60000)
  assert.equal((await pages.problemPage(2, 67, ordinary)).status, 200)
  const previousReads = metadataReads; end = new Date(0)
  assert.equal((await pages.problemPage(2, 67, ordinary)).status, 403)
  assert.equal(metadataReads, previousReads)
  assert.equal((await pages.problemPage(2, 67, admin)).status, 200)
  contests.buildScoreboard = async () => ({ contest: { id: 2, contestProblem: [{ problemId: 67, problem }] }, userContest: [{ contestScores: [{ problemId: 67, score: 100 }] }] })
  assert.equal((await contests.scoreboardByContestId(2, admin)).contest.contestProblem.length, 1)
  const hiddenBoard = await contests.scoreboardByContestId(2, ordinary)
  assert.equal(hiddenBoard.contest.contestProblem.length, 0); assert.equal(hiddenBoard.userContest[0].contestScores.length, 0)
  const history = [{ problemId: 67, contestScoreHistory: [{ submission: { creationDate: start } }] }]
  prisma.user = { findUnique: async () => ({ id: 3, role: 'user' }) }
  prisma.contestScore = { findMany: async ({ where }) => {
    assert.equal(where.contestId, 2)
    assert.equal(where.userId, 3)
    return allowed(where.problem) ? history : []
  } }
  assert.deepEqual(await contests.getUserContestScoreHistory(2, 3, ordinary), [])
  assert.deepEqual(await contests.getUserContestScoreHistory(2, 3, admin), history)
  visible = true
  assert.deepEqual(await contests.getUserContestScoreHistory(2, 3, ordinary), history)
  checks.push('guest/user/admin × public/hidden × before/during/after policy; score history and warm caches respect problem visibility')

  const { ChatGateway } = a('modules/chat/chat.gateway')
  let sessionCalls = 0, identityCalls = 0, progressCalls = 0
  let block, waiting = false
  const gateway = new ChatGateway({ isSessionActive: async () => { sessionCalls++; return true }, findUserForSocket: async id => { identityCalls++; return { id, role: 'user' } } },
    { verifyAsync: async () => ({ id: 7, jti: 'fixture', exp: Math.floor(Date.now()/1000) + 600 }) },
    { progressBatch: async () => { progressCalls++; if (waiting) await new Promise(resolve => { block = resolve }); return [] } }, { ready: true, events: new EventEmitter() })
  gateway.server = { emit() {}, sockets: { emit() {} } }
  const socket = () => ({ connected: true, handshake: { auth: { token: 'fixture' } }, emit() {}, disconnect() { this.connected = false } })
  const sockets = []
  for (let i = 0; i < 8; i++) { const s = socket(); await gateway.authenticate(s); sockets.push(s) }
  const beforeNinth = sessionCalls + identityCalls
  await assert.rejects(() => gateway.authenticate(socket()))
  assert.equal(sessionCalls + identityCalls, beforeNinth)
  const beforeMalformed = sessionCalls
  for (let i = 0; i < 50; i++) await assert.rejects(() => gateway.receiveMsg(sockets[0], {}))
  assert.equal(sessionCalls, beforeMalformed)
  await gateway.watchSubmissions(sockets[0], { ids: Array.from({ length: 500 }, (_, i) => i + 1) })
  await gateway.watchSubmissions(sockets[1], { ids: Array.from({ length: 500 }, (_, i) => i + 1) })
  const beforeExcess = sessionCalls
  await assert.rejects(() => gateway.watchSubmissions(sockets[2], { ids: [1] }))
  assert.equal(sessionCalls, beforeExcess)
  waiting = true
  const p1 = gateway.sendProgress(sockets[0], [1]); await new Promise(resolve => setImmediate(resolve))
  const first = block
  const p2 = gateway.sendProgress(sockets[1], [1]); await new Promise(resolve => setImmediate(resolve))
  const second = block, beforeBusy = sessionCalls
  assert.equal(await gateway.sendProgress(sockets[0], [1]), false); assert.equal(sessionCalls, beforeBusy)
  assert.equal((await gateway.watchSubmissions(sockets[4], { ids: [] })).live, false)
  assert.equal(sessionCalls, beforeBusy)
  first(); second(); await Promise.all([p1, p2])
  for (const s of sockets) gateway.clearAuthentication(s)
  assert.equal(gateway.accountSockets.size, 0); assert.equal(gateway.inFlight.size, 0)
  const closing = socket(); closing.conn = new EventEmitter(); closing.conn.readyState = 'closed'
  await assert.rejects(() => gateway.authenticate(closing))
  assert.equal(gateway.accountSockets.size, 0)
  checks.push('eight sockets/account; 1,000 subscriptions/account; malformed events and excess/in-flight work rejected before database calls; disconnect cleanup')
  console.log(JSON.stringify({ passed: true, checks, productionWrites: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
