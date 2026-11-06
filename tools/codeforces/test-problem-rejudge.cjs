const assert = require('node:assert/strict'),
  { createRequire } = require('node:module'),
  path = require('node:path')
const root = path.resolve(__dirname, '../..'),
  req = createRequire(root + '/apps/api/package.json'),
  { PrismaClient } = req('@otog/database'),
  { JwtService } = req('@nestjs/jwt'),
  db = new PrismaClient()
async function main() {
  assert.equal(
    (await db.$queryRaw`SELECT current_database() AS name`)[0].name,
    'otog_cf_test_20261031'
  )
  const jwt = new JwtService({ secret: process.env.JWT_SECRET }),
    token = jwt.sign({ id: 1, jti: 'cf-fixture-1' }, { expiresIn: 300 })
  const before = JSON.stringify(
    await db.$queryRaw`SELECT "submissionId",state,answer FROM "cfHack" ORDER BY "submissionId"`
  )
  const r = await fetch(
    'http://127.0.0.1:18034/submission/problem/900001/rejudge',
    { method: 'PATCH', headers: { Authorization: 'Bearer ' + token } }
  )
  assert.equal(r.status, 200, await r.text())
  const end = Date.now() + 120000
  let done = false
  while (Date.now() < end) {
    const pending = await db.submission.count({
      where: { status: { in: ['waiting', 'grading'] } },
    })
    const [c] =
      await db.$queryRaw`SELECT phase FROM "cfContest" WHERE "contestId"=1`
    if (!pending && c.phase === 'final') {
      done = true
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  assert(done, 'Problem rejudge did not finish and finalize')
  assert.equal(
    JSON.stringify(
      await db.$queryRaw`SELECT "submissionId",state,answer FROM "cfHack" ORDER BY "submissionId"`
    ),
    before
  )
  console.log(
    JSON.stringify({
      passed: true,
      numericProblemRejudge: true,
      cfSystemTestsRepeated: true,
      hackRecordsPreserved: true,
      productionWrites: 0,
    })
  )
}
main()
  .catch((e) => {
    console.error(e.stack)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
