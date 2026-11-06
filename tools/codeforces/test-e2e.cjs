const assert = require('node:assert/strict'),
  { createRequire } = require('node:module'),
  { randomUUID } = require('node:crypto'),
  fs = require('node:fs/promises'),
  { spawnSync } = require('node:child_process')
const req = createRequire(process.cwd() + '/package.json'),
  { PrismaClient } = req('@otog/database'),
  { JwtService } = req('@nestjs/jwt'),
  db = new PrismaClient()
const jwt = new JwtService({ secret: process.env.JWT_SECRET }),
  checks = [],
  base = 'http://127.0.0.1:18034/codeforces'
const token = (id) =>
  jwt.sign({ id, jti: 'cf-fixture-' + id }, { expiresIn: 900 })
async function call(user, path, body) {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(user ? { Authorization: 'Bearer ' + token(user) } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: await r.json() }
}
async function ok(user, path, body) {
  const r = await call(user, path, body)
  assert(
    r.status >= 200 && r.status < 300,
    `${path}: ${r.status} ${JSON.stringify(r.body)}`
  )
  return r.body
}
async function waitJob(id, allowJudgeError = false) {
  const end = Date.now() + 120000
  while (Date.now() < end) {
    const s = await db.submission.findUnique({
      where: { id },
      include: { submissionResult: true },
    })
    if (!['waiting', 'grading'].includes(s.status)) {
      const [r] =
        await db.$queryRaw`SELECT * FROM "cfRun" WHERE "submissionId"=${id}`
      if (!allowJudgeError)
        assert.notEqual(s.status, 'judgeError', JSON.stringify({ id, ...r }))
      return { ...r, status: s.status }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Job timed out: ' + id)
}
function worker(command) {
  const p = spawnSync('/usr/bin/docker', [command, 'otog-cf-fixture-worker'], {
    encoding: 'utf-8',
  })
  assert.equal(p.status, 0, p.stderr)
}
const reference =
  '#include <iostream>\nint main(){long long n;std::cin>>n;std::cout<<n*2<<"\\n";}'
const victim =
  '#include <iostream>\nint main(){long long n;std::cin>>n;std::cout<<(n==13?999:n*2)<<"\\n";}'
async function main() {
  assert.equal(
    (await db.$queryRaw`SELECT current_database() AS name`)[0].name,
    'otog_cf_test_20261031'
  )
  for (const id of [1, 2, 3, 4]) {
    await db.user.create({
      data: {
        id,
        username: 'cf-fixture-' + id,
        showName: 'CF fixture ' + id,
        password: require('node:crypto')
          .createHash('sha256')
          .update('cf-fixture-password')
          .digest('hex'),
        role: id === 1 ? 'admin' : 'user',
      },
    })
    await db.refreshToken.create({
      data: {
        id: 'cf-fixture-' + id,
        userId: id,
        jwtId: 'cf-fixture-' + id,
        used: false,
        expiryDate: new Date(Date.now() + 3600000),
      },
    })
  }
  await db.problem.create({
    data: {
      id: 900001,
      area: 'codeforces',
      name: 'CF double fixture',
      score: 100,
      timeLimit: 1000,
      memoryLimit: 64,
      show: false,
      case: '2',
    },
  })
  const settings = {
    name: 'Disposable CF fixture',
    timeStart: new Date(Date.now() + 3600000).toISOString(),
    timeEnd: new Date(Date.now() + 7200000).toISOString(),
    wrongPenalty: 50,
    minimumFraction: 0.3,
    decayMinutes: 250,
    successfulHackPoints: 100,
    unsuccessfulHackPenalty: 50,
  }
  assert.equal((await call(null, '/admin', {})).status, 401)
  assert.equal((await call(2, '/admin', settings)).status, 403)
  const { id } = await ok(1, '/admin', settings)
  assert.equal((await call(null, `/${id}`)).status, 404)
  const cfg = {
    problemId: 900001,
    letter: 'A',
    points: 500,
    fullTests: [1, 2],
    pretests: [1],
    validatorSource:
      '#include "testlib.h"\nint main(int argc,char**argv){registerValidation(argc,argv);inf.readInt(1,100,"n");inf.readEoln();inf.readEof();}',
    referenceSource: reference,
    checkerSource: '',
  }
  assert.equal((await call(1, `/admin/${id}/publish`, {})).status, 409)
  assert.equal(
    (
      await call(1, `/admin/${id}/problem`, {
        ...cfg,
        fullTests: [1],
        pretests: [2],
      })
    ).status,
    400
  )
  const malformed = await ok(1, `/admin/${id}/problem`, {
    ...cfg,
    validatorSource: 'this is not C++',
  })
  assert.equal(
    (await waitJob(malformed.validator.id, true)).status,
    'judgeError'
  )
  await waitJob(malformed.reference.id)
  assert.equal((await call(1, `/admin/${id}/publish`, {})).status, 409)
  const prepared = await ok(1, `/admin/${id}/problem`, cfg)
  await waitJob(prepared.validator.id)
  await waitJob(prepared.reference.id)
  await db.problem.create({
    data: {
      id: 900002,
      area: 'codeforces',
      name: 'CF checker fixture',
      score: 100,
      timeLimit: 1000,
      memoryLimit: 64,
      show: false,
      case: '2',
    },
  })
  const checkerCfg = {
    ...cfg,
    problemId: 900002,
    letter: 'B',
    points: 1000,
    checkerSource:
      '#include "testlib.h"\nint main(int argc,char**argv){registerTestlibCmd(argc,argv);long long a=ans.readLong(),b=ouf.readLong();if(a!=b)quitf(_wa,"different");quitf(_ok,"equal");}',
  }
  const checkerPrepared = await ok(1, `/admin/${id}/problem`, checkerCfg)
  await waitJob(checkerPrepared.validator.id)
  await waitJob(checkerPrepared.reference.id)
  const author = await ok(1, `/admin/${id}`)
  assert.equal(author.problems[0].validation, 'valid')
  checks.push(
    'testlib input validator and reference solution execute in real hardened worker; all inputs and answers pass before publication'
  )
  await ok(1, `/admin/${id}/publish`, {})
  assert.equal((await call(1, `/admin/${id}/problem`, cfg)).status, 409)
  const before = await ok(null, `/${id}`)
  assert.equal(before.problems.length, 0)
  for (const u of [2, 3, 4]) await ok(u, `/${id}/register`, {})
  const early = await call(2, `/${id}/submit`, {
    problemId: 900001,
    language: 'cpp',
    sourceCode: victim,
    requestId: randomUUID(),
  })
  assert.equal(early.status, 409)
  await db.contest.update({
    where: { id },
    data: {
      timeStart: new Date(Date.now() - 600000),
      timeEnd: new Date(Date.now() + 600000),
    },
  })
  const oldList = await fetch('http://127.0.0.1:18034/contest/now', {
    headers: { Authorization: 'Bearer ' + token(2) },
  })
  assert.equal(oldList.status, 200)
  assert.deepEqual(await oldList.json(), [])
  const oldDelete = await fetch('http://127.0.0.1:18034/contest/' + id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token(1) },
  })
  assert.equal(oldDelete.status, 409)
  const detail = await ok(2, `/${id}`)
  assert.equal(detail.problems[0].config, undefined)
  assert.equal(detail.problems[0].bundle, undefined)
  await fs.writeFile(
    process.env.CF_FIXTURE_ROOT + '/source/900001/1.in',
    '99\n'
  )
  const data = {
      problemId: 900001,
      language: 'cpp',
      sourceCode: victim,
      requestId: randomUUID(),
    },
    a = await ok(2, `/${id}/submit`, data),
    again = await ok(2, `/${id}/submit`, data)
  assert.equal(a.id, again.id)
  assert.equal(
    (await call(2, `/${id}/submit`, { ...data, sourceCode: reference })).status,
    409
  )
  const b = await ok(3, `/${id}/submit`, {
    ...data,
    sourceCode: reference,
    requestId: randomUUID(),
  })
  const bad = await ok(4, `/${id}/submit`, {
    ...data,
    sourceCode: 'this is not C++',
    requestId: randomUUID(),
  })
  assert.equal((await waitJob(bad.id)).outcome.verdict, 'compile_error')
  assert((await ok(4, `/${id}/source/${bad.id}`)).compilerLog.length > 0)
  let weak = await ok(4, `/${id}/submit`, {
    ...data,
    sourceCode: '#include <iostream>\nint main(){std::cout<<2<<"\\n";}',
    requestId: randomUUID(),
  })
  for (const sid of [a.id, b.id, weak.id])
    assert.equal((await waitJob(sid)).preOutcome.verdict, 'accepted')
  const sharing = await fetch(
    'http://127.0.0.1:18034/submission/' + a.id + '/share',
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token(2),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ show: true }),
    }
  )
  assert.equal(sharing.status, 409)
  const bypass = new FormData()
  bypass.set(
    'sourceCode',
    new File([reference], 'solution.cpp', { type: 'text/plain' })
  )
  bypass.set('language', 'cpp')
  assert.equal(
    (
      await fetch(
        'http://127.0.0.1:18034/submission/problem/900001?contestId=' + id,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token(3) },
          body: bypass,
        }
      )
    ).status,
    400
  )
  checks.push(
    'pretests run against immutable snapshot; early submissions blocked; request retries are idempotent; CE and provisional acceptance are separate'
  )
  assert.equal((await call(4, `/${id}/source/${a.id}`)).status, 403)
  await ok(3, `/${id}/lock`, { problemId: 900001 })
  assert.equal(
    (await call(3, `/${id}/submit`, { ...data, requestId: randomUUID() }))
      .status,
    409
  )
  assert.equal((await ok(3, `/${id}/source/${a.id}`)).sourceCode, victim)
  assert.equal(
    (
      await call(3, `/${id}/hack`, {
        targetId: b.id,
        input: '13\n',
        requestId: randomUUID(),
      })
    ).status,
    400
  )
  const invalid = await ok(3, `/${id}/hack`, {
    targetId: a.id,
    input: '0\n',
    requestId: randomUUID(),
  })
  assert.equal((await waitJob(invalid.id)).outcome.hackState, 'invalid')
  const unsuccessful = await ok(3, `/${id}/hack`, {
    targetId: a.id,
    input: '6\n',
    requestId: randomUUID(),
  })
  assert.equal(
    (await waitJob(unsuccessful.id)).outcome.hackState,
    'unsuccessful'
  )
  const hackData = { targetId: a.id, input: '13\n', requestId: randomUUID() },
    success = await ok(3, `/${id}/hack`, hackData)
  assert.equal((await ok(3, `/${id}/hack`, hackData)).id, success.id)
  assert.equal(
    (await call(3, `/${id}/hack`, { ...hackData, requestId: randomUUID() }))
      .status,
    409
  )
  assert.equal((await waitJob(success.id)).outcome.hackState, 'successful')
  const [saved] =
    await db.$queryRaw`SELECT * FROM "cfHack" WHERE "submissionId"=${success.id}`
  assert.equal(saved.answer, '26\n')
  let standings = await ok(null, `/${id}/standings`)
  assert.equal(standings.rows.find((r) => r.userId === 2).problems[0].points, 0)
  assert.equal(standings.rows.find((r) => r.userId === 3).successfulHacks, 1)
  checks.push(
    'source permission and permanent problem locks; self hacks blocked; invalid, unsuccessful and successful hacks; duplicate requests cannot duplicate work or points; successful input/answer retained'
  )
  const fixed = await ok(2, `/${id}/submit`, {
    ...data,
    sourceCode: reference,
    requestId: randomUUID(),
  })
  const fixedResult = await waitJob(fixed.id)
  assert.equal(fixedResult.outcome.tested, 2)
  const cfirst = await ok(2, `/${id}/submit`, {
    ...data,
    problemId: 900002,
    sourceCode: reference,
    requestId: randomUUID(),
  })
  await waitJob(cfirst.id)
  const cbad = await ok(2, `/${id}/submit`, {
      ...data,
      problemId: 900002,
      requestId: randomUUID(),
    }),
    cgood = await ok(3, `/${id}/submit`, {
      ...data,
      problemId: 900002,
      sourceCode: reference,
      requestId: randomUUID(),
    })
  await waitJob(cbad.id)
  await waitJob(cgood.id)
  await ok(3, `/${id}/lock`, { problemId: 900002 })
  const customHack = await ok(3, `/${id}/hack`, {
    targetId: cbad.id,
    input: '13\n',
    requestId: randomUUID(),
  })
  assert.equal((await waitJob(customHack.id)).outcome.hackState, 'successful')
  assert.equal(
    (await ok(2, `/${id}/submissions`)).find((r) => r.id === cbad.id).outcome
      .verdict,
    'hacked'
  )
  checks.push(
    'testlib checker compiles per job and accepts/rejects both normal submissions and hacks; hacked targets immediately display Hacked'
  )
  weak = await ok(4, `/${id}/submit`, {
    ...data,
    sourceCode: '#include <iostream>\nint main(){std::cout<<2<<"\\n";}',
    requestId: randomUUID(),
  })
  const claimEnd = Date.now() + 15000
  let claimed = false
  while (Date.now() < claimEnd) {
    const s = await db.submission.findUnique({ where: { id: weak.id } })
    if (s.status === 'grading') {
      claimed = true
      break
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  assert(claimed, 'Fixture job was not claimed')
  worker('kill')
  worker('start')
  assert.equal((await waitJob(weak.id)).preOutcome.verdict, 'accepted')
  checks.push(
    'a deliberately restarted disposable worker recovers its leased CF job and commits its result without losing the submission'
  )
  checks.push(
    'a hacked participant’s resubmission must pass their successful counterexample in addition to pretests'
  )
  worker('pause')
  const late = await ok(3, `/${id}/hack`, {
    targetId: weak.id,
    input: '1\n',
    requestId: randomUUID(),
  })
  await db.contest.update({
    where: { id },
    data: { timeEnd: new Date(Date.now() - 1000) },
  })
  assert.equal(
    (
      await call(3, `/${id}/hack`, {
        targetId: fixed.id,
        input: '17\n',
        requestId: randomUUID(),
      })
    ).status,
    409
  )
  assert.equal(
    (await call(2, `/${id}/submit`, { ...data, requestId: randomUUID() }))
      .status,
    409
  )
  await ok(1, `/admin/${id}/system-tests`, {})
  assert.equal((await ok(1, `/admin/${id}`)).phase, 'system_pending')
  const restarted = spawnSync(
    '/usr/bin/systemctl',
    ['restart', 'otog-cf-fixture-api'],
    { encoding: 'utf-8' }
  )
  assert.equal(restarted.status, 0, restarted.stderr)
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:18034/ping')
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  worker('unpause')
  assert.equal((await waitJob(late.id)).outcome.hackState, 'unsuccessful')
  const end = Date.now() + 120000
  let final
  while (Date.now() < end) {
    final = await ok(1, `/admin/${id}`)
    if (final.phase === 'final') break
    await new Promise((r) => setTimeout(r, 500))
  }
  assert.equal(final.phase, 'final')
  const finalRuns =
    await db.$queryRaw`SELECT "submissionId",phase,outcome FROM "cfRun" WHERE "submissionId" IN (${fixed.id},${b.id},${weak.id})`
  assert.equal(
    finalRuns.find((r) => r.submissionId === fixed.id).outcome.tested,
    3
  )
  assert.equal(
    finalRuns.find((r) => r.submissionId === weak.id).outcome.verdict,
    'wrong_answer'
  )
  standings = await ok(null, `/${id}/standings`)
  assert.equal(standings.phase, 'final')
  assert.equal(standings.rows.find((r) => r.userId === 4).problems[0].points, 0)
  assert(standings.rows.find((r) => r.userId === 2).problems[0].points > 0)
  checks.push(
    'hacks/submissions close at contest end; durable automatic system testing includes full cases plus successful hacks; system-test failure removes provisional points; final standings only after completion'
  )
  checks.push(
    'a hack accepted before cutoff finishes after cutoff; system testing waits for it and resumes automatically across an API restart'
  )
  await fs.writeFile(process.env.CF_FIXTURE_ROOT + '/source/900001/1.in', '1\n')
  const classic = await db.submission.create({
    data: {
      userId: 2,
      problemId: 900001,
      sourceCode: reference,
      language: 'cpp',
      status: 'waiting',
    },
  })
  assert.equal((await waitJob(classic.id)).status, 'accept')
  checks.push(
    'ordinary classic batch submission still grades correctly through the updated worker and persistence hooks'
  )
  const [legacyScore] =
    await db.$queryRaw`SELECT count(*)::int AS count FROM "contestScore" WHERE "contestId"=${id}`
  assert.equal(legacyScore.count, 0)

  const hacksBefore = JSON.stringify(
    await db.$queryRaw`SELECT "submissionId",state,answer FROM "cfHack" ORDER BY "submissionId"`
  )
  const redo = await fetch(
    'http://127.0.0.1:18034/submission/' + success.id + '/rejudge',
    { method: 'PATCH', headers: { Authorization: 'Bearer ' + token(1) } }
  )
  assert.equal(redo.status, 200)
  await waitJob(success.id)
  assert.equal(
    JSON.stringify(
      await db.$queryRaw`SELECT "submissionId",state,answer FROM "cfHack" ORDER BY "submissionId"`
    ),
    hacksBefore
  )
  const bulk = await fetch(
    'http://127.0.0.1:18034/submission/problem/all/rejudge',
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token(1),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: 'cf-fixture-password' }),
    }
  )
  assert.equal(bulk.status, 200)
  assert((await bulk.json()).queued > 0)
  const rejudgeEnd = Date.now() + 180000
  let done = false
  while (Date.now() < rejudgeEnd) {
    const pending = await db.submission.count({
      where: { status: { in: ['waiting', 'grading'] } },
    })
    const c = await ok(1, `/admin/${id}`)
    if (!pending && c.phase === 'final') {
      done = true
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  assert(done, 'CF rejudge did not return to finalized results')
  assert.equal(
    JSON.stringify(
      await db.$queryRaw`SELECT "submissionId",state,answer FROM "cfHack" ORDER BY "submissionId"`
    ),
    hacksBefore
  )
  const afterRejudge = await ok(null, `/${id}/standings`)
  assert.equal(
    afterRejudge.rows
      .find((r) => r.userId === 2)
      .problems.find((p) => p.letter === 'B').points,
    0
  )
  checks.push(
    'single/bulk rejudges preserve finalized hack decisions and their system tests; contestant rejudges repeat pretests and final system testing without falling back from a hacked verified solution'
  )
  const cancelled = await ok(1, '/admin', {
    ...settings,
    name: 'Cancellation fixture',
  })
  const cancellationJobs = await ok(1, `/admin/${cancelled.id}/problem`, cfg)
  await waitJob(cancellationJobs.validator.id)
  await waitJob(cancellationJobs.reference.id)
  await ok(1, `/admin/${cancelled.id}/publish`, {})
  assert.equal((await call(2, `/admin/${cancelled.id}/cancel`, {})).status, 403)
  await ok(1, `/admin/${cancelled.id}/cancel`, {})
  assert.equal((await ok(null, `/${cancelled.id}`)).phase, 'cancelled')
  assert.equal((await call(2, `/${cancelled.id}/register`, {})).status, 409)
  checks.push(
    'CF contests stay out of classic lists and cannot be edited/deleted through classic endpoints; admin cancellation closes further participation'
  )
  assert.equal(await db.gradingWorkerJob.count(), 0)
  // Separate library contest so its scoring does not alter earlier fixtures.
  await db.problem.create({
    data: {
      id: 900003,
      area: 'codeforces',
      name: 'Library fixture',
      score: 100,
      timeLimit: 1000,
      memoryLimit: 64,
      show: false,
      case: '2',
    },
  })
  const libraryDir = require('node:path').join(process.env.CF_FIXTURE_ROOT, 'source/900003')
  await fs.mkdir(libraryDir, { recursive: true })
  for (const n of [1, 2]) {
    await fs.writeFile(libraryDir + '/' + n + '.in', n + '\n')
    await fs.writeFile(libraryDir + '/' + n + '.sol', n * 2 + '\n')
  }
  await fs.writeFile(libraryDir + '/task.h', 'int doubled(int);\n')
  await fs.writeFile(
    libraryDir + '/grader.cpp',
    '#include <iostream>\n#include "task.h"\nint main(){int n;std::cin>>n;std::cout<<doubled(n)<<"\\n";}'
  )
  const lc = await ok(1, '/admin', {
    ...settings,
    name: 'Library fixture contest',
  })
  const libSource = '#include "task.h"\nint doubled(int n){return n*2;}'
  const libCfg = {
    ...cfg,
    problemId: 900003,
    taskType: 'library',
    graderFiles: ['grader.cpp'],
    referenceSource: libSource,
  }
  const invalidValidator = await ok(1, `/admin/${lc.id}/problem`, {
    ...libCfg,
    validatorSource:
      '#include "testlib.h"\nint main(int argc,char**argv){registerValidation(argc,argv);}',
  })
  const rejected = await waitJob(invalidValidator.validator.id)
  assert.equal(rejected.outcome.verdict, 'validation_failed')
  assert.match(
    (
      await db.submissionResult.findUnique({
        where: { submissionId: invalidValidator.validator.id },
      })
    ).errmsg,
    /readEof/
  )
  await waitJob(invalidValidator.reference.id)
  const lb = await ok(1, `/admin/${lc.id}/problem`, libCfg)
  await waitJob(lb.validator.id)
  await waitJob(lb.reference.id)
  await ok(1, `/admin/${lc.id}/publish`, {})
  await db.contest.update({
    where: { id: lc.id },
    data: {
      timeStart: new Date(Date.now() - 60000),
      timeEnd: new Date(Date.now() + 600000),
    },
  })
  for (const u of [2, 3]) await ok(u, `/${lc.id}/register`, {})
  const ls = async (u, sourceCode) =>
    ok(u, `/${lc.id}/submit`, {
      problemId: 900003,
      language: 'cpp',
      sourceCode,
      requestId: randomUUID(),
    })
  const lv = await ls(
      2,
      '#include "task.h"\nint doubled(int n){return n==13?999:n*2;}'
    ),
    lr = await ls(3, libSource)
  assert.equal((await waitJob(lv.id)).outcome.verdict, 'accepted')
  await waitJob(lr.id)
  await ok(3, `/${lc.id}/lock`, { problemId: 900003 })
  const lh = await ok(3, `/${lc.id}/hack`, {
    targetId: lv.id,
    input: '13\n',
    requestId: randomUUID(),
  })
  assert.equal((await waitJob(lh.id)).outcome.hackState, 'successful')
  checks.push(
    'Library references/submissions/hack targets link the same grader inside Isolate; validator rejection retains its author diagnostic'
  )
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      productionWrites: 0,
      contestId: id,
      jobs: await db.submission.count(),
      standings: standings.rows.map((r) => ({
        userId: r.userId,
        total: r.total,
      })),
    })
  )
}
main()
  .catch((e) => {
    console.error(e.stack)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
