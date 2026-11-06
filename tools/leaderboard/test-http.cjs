// Smoke-test the production Next build against the disposable leaderboard API/database.
const assert = require('node:assert/strict'), path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..'), req = createRequire(root + '/packages/database/package.json')
const { PrismaClient } = req('./__generated__/prisma-client'), prisma = new PrismaClient()
const origin = 'http://127.0.0.1:18262'
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/leaderboard_test')
async function main() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/leaderboard')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { username: 'Alice' } })
  const checks = []
  for (const [route, expected] of [
    ['/leaderboard', 'ตารางอันดับ'],
    [`/user/${user.id}?tab=passed`, 'ข้อที่ผ่าน'],
    ['/codeforces', 'Codeforces'],
  ]) {
    const response = await fetch(origin + route), html = await response.text()
    assert.equal(response.status, 200, route)
    assert(html.includes(expected), route)
    const script = html.match(/src="([^\"]*\/_next\/static\/[^\"]+\.js)"/)
    assert(script, route + ' missing client assets')
    assert.equal((await fetch(new URL(script[1].replace(/&amp;/g, '&'), origin))).status, 200)
    checks.push(route)
  }
  const response = await fetch(origin + '/backend/user/leaderboard?limit=10&skip=0')
  assert.equal(response.status, 200)
  assert(Array.isArray((await response.json()).data))
  checks.push('same-origin leaderboard API proxy')
  console.log(JSON.stringify({ passed: true, checks, productionNextBuild: true }))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
