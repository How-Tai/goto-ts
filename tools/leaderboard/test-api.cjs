// Run against an isolated empty PostgreSQL database and API, never production.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const dbRequire = createRequire(root + '/packages/database/package.json')
const { PrismaClient } = dbRequire('./__generated__/prisma-client')
const prisma = new PrismaClient()
const url = process.env.LEADERBOARD_TEST_URL || 'http://127.0.0.1:18260'
assert(new URL(process.env.DATABASE_URL).pathname === '/leaderboard_test', 'Use the disposable leaderboard_test database')
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname))
const password = crypto.randomBytes(18).toString('hex')
const checks = []
const check = (name, fn) => Promise.resolve().then(fn).then(() => checks.push(name))
const jsonQuery = values => new URLSearchParams(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]))
async function request(route, token, method = 'GET', body) {
  const response = await fetch(url + route, { method, headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'content-type': 'application/json' } : {}),
  }, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}
async function main() {
  assert.equal(await prisma.user.count(), 0, 'Test database must be empty')
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url + '/time')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await check('migration defaults and existing admin backfill', async () => {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "user" (id int, role text) ON COMMIT DROP')
      await tx.$executeRawUnsafe("INSERT INTO pg_temp.\"user\" VALUES (1,'user'),(2,'admin')")
      const migration = fs.readFileSync(path.join(root, 'packages/database/prisma/migrations/20261101010000_leaderboard/migration.sql'), 'utf8')
      for (const sql of migration.split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(sql)
      const rows = await tx.$queryRawUnsafe('SELECT * FROM pg_temp."user" ORDER BY id')
      assert.deepEqual(rows.map(r => r.showInLeaderboard), [true, false])
    })
  })
  async function user(username, rating, showInLeaderboard = true, role = 'user') {
    await prisma.user.create({ data: { username, showName: username, password: crypto.createHash('sha256').update(password).digest('hex'), rating, showInLeaderboard, role } })
    const result = await request('/auth/login', null, 'POST', { username, password })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.user.showInLeaderboard, showInLeaderboard)
    return { ...result.body.user, token: result.body.accessToken }
  }
  const alice = await user('Alice', 1200), bob = await user('Bob', 1500)
  const hidden = await user('Hidden', 1800, false), admin = await user('Admin', 0, false, 'admin')
  const problems = []
  for (let i = 0; i < 5; i++) problems.push(await prisma.problem.create({ data: { name: `Fixture ${i}`, sname: `fixture-${i}`, score: 100, timeLimit: 1000, memoryLimit: 64, show: i !== 3 } }))
  const now = Date.now()
  const contest = await prisma.contest.create({ data: { name: 'Unreleased results', mode: 'unrated', gradingMode: 'classic', scoreboardPolicy: 'AFTER_CONTEST', timeStart: new Date(now - 60000), timeEnd: new Date(now + 3600000) } })
  let latest
  async function solve(who, index, extra = {}) {
    return prisma.submission.create({ data: { userId: who.id, problemId: problems[index].id, language: 'cpp', status: 'accept', ...extra } })
  }
  await solve(alice, 0, { creationDate: new Date(now - 5000) })
  latest = await solve(alice, 0, { creationDate: new Date(now - 1000) })
  await solve(alice, 1); await solve(alice, 3); await solve(alice, 4, { contestId: contest.id })
  await solve(bob, 0); await solve(hidden, 0); await solve(hidden, 1); await solve(hidden, 2)
  const board = (who, query = {}) => request('/user/leaderboard?' + jsonQuery({ limit: 10, skip: 0, ...query }), who?.token)
  await check('public ranking counts distinct published problems and hides unreleased results/private totals', async () => {
    const result = await board()
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.total, 2)
    assert.deepEqual(result.body.data.map(r => [r.username, r.passedCount, r.rank]), [['Alice', 2, 1], ['Bob', 1, 2]])
    assert(result.body.data.every(r => !('passedCountAll' in r)))
  })
  await check('hidden users see themselves; ordinary users cannot request all users', async () => {
    assert.deepEqual((await board(hidden)).body.data.map(r => r.username), ['Hidden', 'Alice', 'Bob'])
    assert.equal((await board(bob, { showAll: true })).body.total, 2)
  })
  await check('admin can include hidden users and private totals', async () => {
    const result = await board(admin, { showAll: true })
    assert.equal(result.body.total, 4)
    assert.equal(result.body.data.find(r => r.id === alice.id).passedCountAll, 4)
  })
  await check('search preserves global ranks, offset and empty-page total', async () => {
    assert.equal((await board(null, { search: 'bOb' })).body.data[0].rank, 2)
    assert.equal((await board(null, { skip: 1, limit: 1 })).body.data[0].id, bob.id)
    const empty = (await board(null, { skip: 100 })).body
    assert.equal(empty.total, 2); assert.deepEqual(empty.data, [])
    assert.equal((await board(null, { search: "' OR true --" })).body.total, 0)
  })
  await check('query and path validation reject invalid values', async () => {
    for (const query of [{ limit: 101 }, { skip: -1 }, { showAll: 'oops' }]) assert.equal((await board(null, query)).status, 400)
    assert.equal((await request('/user/NaN/passed-problems')).status, 400)
    assert.equal((await request('/user/0/leaderboard-visibility', alice.token, 'PATCH', { showInLeaderboard: true })).status, 400)
  })
  await check('solved list deduplicates, sorts and respects problem/contest visibility', async () => {
    const publicList = await request(`/user/${alice.id}/passed-problems?sortBy=id`)
    assert.equal(publicList.status, 200, JSON.stringify(publicList.body))
    assert.deepEqual(publicList.body.map(p => p.id), [problems[0].id, problems[1].id])
    assert.equal(publicList.body[0].submissionId, latest.id)
    assert.equal((await request(`/user/${alice.id}/passed-problems?sortBy=solvedDate`, alice.token)).body.length, 3)
    assert.equal((await request(`/user/${alice.id}/passed-problems?sortBy=id`, admin.token)).body.length, 4)
  })
  await check('privacy update requires owner/admin and applies to existing sessions', async () => {
    const route = `/user/${alice.id}/leaderboard-visibility`
    assert.equal((await request(route, null, 'PATCH', { showInLeaderboard: false })).status, 401)
    assert.equal((await request(route, bob.token, 'PATCH', { showInLeaderboard: false })).status, 403)
    assert.equal((await request(route, alice.token, 'PATCH', { showInLeaderboard: 'false' })).status, 400)
    const updated = await request(route, alice.token, 'PATCH', { showInLeaderboard: false })
    assert.equal(updated.status, 200); assert.equal(updated.body.showInLeaderboard, false)
    assert.equal((await board()).body.total, 1)
    assert.equal((await board(alice)).body.total, 2)
    assert.equal((await request(`/user/${alice.id}/profile`, alice.token)).body.showInLeaderboard, false)
    assert.equal((await request(route, admin.token, 'PATCH', { showInLeaderboard: true })).status, 200)
    assert.equal((await board()).body.total, 2)
  })
  await check('promoting users hides them and revokes old sessions', async () => {
    const response = await request(`/user/${bob.id}`, admin.token, 'PUT', { role: 'admin', username: bob.username, showName: bob.showName, password: '' })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(response.body.showInLeaderboard, false)
    assert.equal((await board(bob)).status, 401)
  })
  console.log(JSON.stringify({ passed: true, checks, realPostgresAndHttp: true }))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
