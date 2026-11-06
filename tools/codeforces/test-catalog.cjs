// Real HTTP, Prisma, PostgreSQL and filesystem integration. Uses only an empty
// loopback database named otog_cf_catalog_test, never the deployed site.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path')
const { createRequire } = require('node:module'),
  { randomBytes, randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..'),
  req = createRequire(root + '/apps/api/package.json')
const { PrismaClient } = req('@otog/database'),
  { JwtService } = req('@nestjs/jwt')
const url = process.env.DATABASE_URL
assert(url && new URL(url).pathname === '/otog_cf_catalog_test')
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
const db = new PrismaClient(),
  secret = randomBytes(32).toString('hex'),
  jwt = new JwtService({ secret })
const work = fs.mkdtempSync(
  path.join(require('node:os').tmpdir(), 'otog-cf-catalog-')
)
const checks = [],
  base = 'http://127.0.0.1:18324',
  token = (id) => jwt.sign({ id, jti: 'catalog-' + id }, { expiresIn: 600 })
let child, storage
const objects = new Map()
async function call(id, route, body, cookie) {
  const r = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(id ? { authorization: 'Bearer ' + token(id) } : {}),
      ...(cookie ? { cookie } : {}),
      ...(body === undefined || body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  })
  const text = await r.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: r.status, data }
}
async function ok(id, route, body) {
  const r = await call(id, route, body)
  assert(
    r.status >= 200 && r.status < 300,
    `${route} ${r.status} ${JSON.stringify(r.data)}`
  )
  return r.data
}
async function done() {
  await db.submission.updateMany({
    where: { status: 'waiting' },
    data: { status: 'accept' },
  })
}
const validator =
  '#include "testlib.h"\nint main(int argc,char**argv){registerValidation(argc,argv);inf.readInt(1,100,"n");inf.readEoln();inf.readEof();}'
const reference = '#include "task.h"\nint double_value(int n){return n*2;}'
async function main() {
  assert.equal(await db.user.count(), 0, 'Use an empty fixture database')
  storage = require('node:http').createServer((req, res) => {
    const key = decodeURIComponent(
        new URL(req.url, 'http://127.0.0.1').pathname
      ),
      chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.method === 'PUT' && req.headers['x-amz-copy-source']) {
        const from =
            '/' +
            decodeURIComponent(req.headers['x-amz-copy-source']).replace(
              /^\/+/,
              ''
            ),
          value = objects.get(from)
        if (!value) {
          res.writeHead(404)
          return res.end('<Error><Code>NoSuchKey</Code></Error>')
        }
        objects.set(key, Buffer.from(value))
        res.setHeader('content-type', 'application/xml')
        return res.end(
          '<CopyObjectResult><ETag>"fixture"</ETag><LastModified>2026-11-02T00:00:00.000Z</LastModified></CopyObjectResult>'
        )
      }
      if (req.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks))
        res.setHeader('etag', '"fixture"')
        res.end()
        return
      }
      if (req.method === 'GET' && objects.has(key)) {
        const b = objects.get(key)
        res.setHeader('content-length', b.length)
        return res.end(b)
      }
      res.writeHead(404)
      res.end()
    })
  })
  await new Promise((r) => storage.listen(18326, '127.0.0.1', r))
  for (const id of [1, 2, 3]) {
    await db.user.create({
      data: {
        id,
        username: 'catalog-' + id,
        showName: 'Catalog ' + id,
        password: randomBytes(32).toString('hex'),
        role: id === 1 ? 'admin' : 'user',
      },
    })
    await db.refreshToken.create({
      data: {
        id: 'catalog-rid-' + id,
        jwtId: 'catalog-' + id,
        userId: id,
        used: false,
        expiryDate: new Date(Date.now() + 600000),
      },
    })
  }
  const p = await db.problem.create({
    data: {
      name: 'Original OTOG',
      score: 100,
      timeLimit: 1000,
      memoryLimit: 64,
      show: true,
      case: '2',
      examples: [{ input: '2', output: '4' }],
    },
  })
  fs.mkdirSync(path.join(work, 'source', String(p.id)), { recursive: true })
  fs.mkdirSync(path.join(work, 'docs'))
  const source = path.join(work, 'source', String(p.id))
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(source, n + '.in'), n + '\n')
    fs.writeFileSync(path.join(source, n + '.sol'), n * 2 + '\n')
  }
  fs.writeFileSync(path.join(source, 'task.h'), 'int double_value(int);\n')
  fs.writeFileSync(
    path.join(source, 'grader.cpp'),
    '#include <iostream>\n#include "task.h"\nint main(){int n;std::cin>>n;std::cout<<double_value(n)<<"\\n";}'
  )
  fs.writeFileSync(path.join(work, 'docs', p.id + '.pdf'), '%PDF-fixture')
  const preload = path.join(work, 'loopback.cjs')
  fs.writeFileSync(
    preload,
    'const net=require("node:net"),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(typeof args[0]==="number")args=[{port:args[0],host:"127.0.0.1"},...args.slice(1)];return listen.apply(this,args)};'
  )
  const log = fs.openSync(path.join(work, 'api.log'), 'w')
  child = spawn(
    process.execPath,
    ['--require', preload, path.join(root, 'apps/api/dist/index.js')],
    {
      cwd: work,
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '18324',
        JWT_SECRET: secret,
        OTOG_AUTH_PROXY_SECRET: randomBytes(32).toString('hex'),
        COOKIE_DOMAIN: '',
        OFFLINE_MODE: 'false',
        USE_S3: 'false',
        S3_BUCKET: 'fixture',
        S3_REGION: 'us-east-1',
        S3_ENDPOINT: 'http://127.0.0.1:18326',
        S3_ACCESS_KEY_ID: 'fixture',
        S3_SECRET_ACCESS_KEY: 'fixture',
        OTOG_CF_TESTLIB: path.join(root, 'tools/grading/cf-testlib.h'),
      },
      stdio: ['ignore', log, log],
    }
  )
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(base + '/ping')).ok) break
    } catch {}
    if (i >= 70 || child.exitCode !== null)
      throw Error(
        'Fixture API startup failed: ' +
          fs.readFileSync(path.join(work, 'api.log'), 'utf8').slice(-3500)
      )
    await new Promise((r) => setTimeout(r, 200))
  }
  assert.equal((await call(null, '/codeforces/admin/problems')).status, 401)
  assert.equal((await call(2, '/codeforces/admin/problems')).status, 403)
  // Exercise the real multipart handlers and both protected PDF endpoints.
  const { PDFDocument } = req('pdf-lib')
  async function pdf(label) {
    const document = await PDFDocument.create()
    document.addPage().drawText(label)
    return Buffer.from(await document.save())
  }
  const thai = await pdf('Thai fixture'), english = await pdf('English fixture')
  async function uploadOtog(target, fields, method = 'PUT') {
    const data = new FormData()
    for (const [key, value] of Object.entries({ name: 'Original OTOG', sname: 'fixture', score: '100', timeLimit: '1', memoryLimit: '64', case: '2' })) data.set(key, value)
    for (const [field, bytes] of Object.entries(fields)) data.set(field, new Blob([bytes], {type:'application/pdf'}), field + '.pdf')
    const response = await fetch(base + '/problem' + (target ? '/' + target : ''), { method, headers: { authorization: 'Bearer ' + token(1) }, body: data })
    assert.equal(response.status, method === 'POST' ? 201 : 200, await response.text())
  }
  await uploadOtog(p.id, {pdfEn: english})
  async function document(route, language, expected, auth) {
    const response = await fetch(base + route, {headers: auth ? {authorization:'Bearer ' + token(auth)} : {}})
    assert.equal(response.status, 200, route)
    assert.equal(response.headers.get('content-language'), language)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert(bytes.equals(expected), route + ' returned wrong representation')
    return response.headers.get('etag')
  }
  const originalEn = fs.readFileSync(path.join(work, 'docs', p.id + '.en.pdf'))
  const englishTag = await document('/problem/doc/' + p.id, 'en', originalEn)
  assert.equal((await fetch(base+'/problem/doc/'+p.id+'?lang=fr')).status,400)
  await uploadOtog(p.id, {pdfTh: thai})
  const originalTh = fs.readFileSync(path.join(work, 'docs', p.id + '.th.pdf'))
  const thaiTag = await document('/problem/doc/' + p.id, 'th', originalTh)
  assert.notEqual(thaiTag, englishTag)
  await document('/problem/doc/' + p.id + '?lang=en', 'en', originalEn)
  assert.equal((await fetch(base+'/problem/doc/'+p.id, {headers:{'If-None-Match':thaiTag,'Cache-Control':'max-age=0'}})).status,304)
  assert.equal((await fetch(base+'/problem/doc/'+p.id+'?lang=en', {headers:{'If-None-Match':thaiTag}})).status,200)
  await uploadOtog(undefined, {pdfTh:thai,pdfEn:english}, 'POST')
  checks.push('Real OTOG create/update bilingual uploads; Thai default, English fallback, explicit selection, validators and invalid language rejection')
  const copied = await ok(1, '/codeforces/admin/problems/import', {
      problemId: p.id,
      destination: 'codeforces',
    }),
    id = copied.id
  for (const suffix of ['.th.pdf','.en.pdf','.pdf']) assert.deepEqual(fs.readFileSync(path.join(work,'docs',id+suffix)),fs.readFileSync(path.join(work,'docs',p.id+suffix)))
  assert.equal((await call(null, `/codeforces/statement/${id}?lang=en`)).status,404)
  await document(`/codeforces/statement/${id}`, 'th', originalTh, 1)
  const translation = new FormData()
  const newEn = await pdf('Independent updated English')
  translation.set('pdfEn',new Blob([newEn],{type:'application/pdf'}),'en.pdf')
  await ok(1, `/codeforces/admin/problems/${id}/files`, translation)
  const copiedEn = fs.readFileSync(path.join(work,'docs',id+'.en.pdf'))
  assert.deepEqual(fs.readFileSync(path.join(work,'docs',p.id+'.en.pdf')),originalEn)
  await document(`/codeforces/statement/${id}?lang=en`, 'en', copiedEn, 1)
  const thPath = path.join(work,'docs',id+'.th.pdf')
  fs.unlinkSync(thPath)
  await document(`/codeforces/statement/${id}`, 'en', copiedEn, 1)
  fs.unlinkSync(path.join(work,'docs',id+'.en.pdf'))
  await document(`/codeforces/statement/${id}`, null, Buffer.from('%PDF-fixture'), 1)
  fs.unlinkSync(path.join(work,'docs',id+'.pdf'))
  assert.equal((await call(1, `/codeforces/statement/${id}`)).status,404)
  const both = new FormData()
  both.set('pdfTh',new Blob([thai],{type:'application/pdf'}),'th.pdf')
  both.set('pdfEn',new Blob([newEn],{type:'application/pdf'}),'en.pdf')
  await ok(1, `/codeforces/admin/problems/${id}/files`, both)
  fs.writeFileSync(path.join(work,'docs',id+'.pdf'),'%PDF-fixture')
  assert.equal((await call(1, `/codeforces/statement/${id}?lang=../../secret`)).status,400)
  checks.push('Independent bilingual imports; real CF uploads; selected-language, English, legacy and missing PDF fallback; private gate before file access')
  const starter = new FormData()
  starter.set(
    'attachment',
    new Blob(['PK-library-starter'], { type: 'application/zip' }),
    'starter.zip'
  )
  await ok(1, `/codeforces/admin/problems/${id}/files`, starter)
  assert.equal((await call(null, `/codeforces/attachment/${id}`)).status, 404)
  assert.equal(
    (await call(1, `/codeforces/attachment/${id}`)).data,
    'PK-library-starter'
  )
  assert.equal(
    (await db.problem.findUnique({ where: { id: p.id } })).attachmentMetadata,
    null
  )
  assert.notEqual(id, p.id)
  assert.equal(
    (await db.problem.findUnique({ where: { id } })).area,
    'codeforces'
  )
  assert.equal((await call(null, '/codeforces/problemset/' + id)).status, 404)
  assert.equal((await call(1, '/problem/' + id)).status, 404)
  assert.equal((await call(null, '/problem/doc/' + id)).status, 404)
  const table = await ok(1, '/problem')
  assert(table.some((r) => r.id === p.id))
  assert(!table.some((r) => r.id === id))
  assert.equal(
    fs.readFileSync(path.join(work, 'source', String(id), '1.in'), 'utf8'),
    '1\n'
  )
  fs.writeFileSync(path.join(work, 'source', String(id), '1.in'), '5\n')
  assert.equal(fs.readFileSync(path.join(source, '1.in'), 'utf8'), '1\n')
  checks.push(
    'Admin-only independent OTOG-to-CF copies; private defaults; OTOG list/document isolation'
  )
  await ok(1, '/codeforces/admin/problems/' + id, {
    name: 'Independent CF',
    timeLimit: 1000,
    memoryLimit: 64,
    score: 100,
    case: '2',
  })
  assert.equal(
    (await db.problem.findUnique({ where: { id: p.id } })).name,
    'Original OTOG'
  )
  const settings = {
    name: 'Fixture CF',
    timeStart: new Date(Date.now() + 3600000).toISOString(),
    timeEnd: new Date(Date.now() + 7200000).toISOString(),
  }
  const contest = await ok(1, '/codeforces/admin', settings)
  const unprepared = await ok(1, '/codeforces/admin/problems', {
    name: 'Unprepared CF',
    timeLimit: 1000,
    memoryLimit: 64,
  })
  const cfg = {
    problemId: id,
    letter: 'A',
    points: 500,
    fullTests: [1, 2],
    pretests: [1],
    taskType: 'library',
    graderFiles: ['grader.cpp'],
    validatorSource: validator,
    referenceSource: reference,
    checkerSource: '',
  }
  assert.equal(
    (
      await call(1, `/codeforces/admin/${contest.id}/problem`, {
        ...cfg,
        problemId: unprepared.id,
      })
    ).status,
    400
  )
  assert.equal(
    (
      await call(1, `/codeforces/admin/${contest.id}/problem`, {
        ...cfg,
        problemId: p.id,
      })
    ).status,
    404
  )
  assert.equal(
    (
      await call(1, `/codeforces/admin/${contest.id}/problem`, {
        ...cfg,
        graderFiles: [],
      })
    ).status,
    400
  )
  assert.equal(
    (
      await call(1, `/codeforces/admin/${contest.id}/problem`, {
        ...cfg,
        graderFiles: ['missing.cpp'],
      })
    ).status,
    400
  )
  const frozen = await ok(1, `/codeforces/admin/${contest.id}/problem`, cfg)
  const bundled = path.join(work, 'source/.codeforces', frozen.bundle)
  assert(fs.existsSync(path.join(bundled, 'grader.cpp')))
  assert(fs.existsSync(path.join(bundled, 'task.h')))
  assert(!fs.existsSync(path.join(bundled, 'command.yaml')))
  assert.equal(
    (await call(null, `/codeforces/statement/${id}?contestId=${contest.id}`))
      .status,
    404
  )
  assert.equal(
    (await call(1, `/codeforces/statement/${id}?contestId=${contest.id}`))
      .status,
    200
  )
  checks.push(
    'Library config validation, complete immutable grader/header bundle, future statement time gate'
  )
  await done()
  await db.cfProblem.updateMany({
    where: { problemId: id },
    data: { validation: 'valid' },
  })
  await db.contest.update({
    where: { id: contest.id },
    data: {
      timeStart: new Date(Date.now() - 60000),
      timeEnd: new Date(Date.now() + 3600000),
    },
  })
  await db.cfContest.update({
    where: { contestId: contest.id },
    data: { phase: 'scheduled' },
  })
  await ok(2, `/codeforces/${contest.id}/register`, {})
  const submission = {
    problemId: id,
    language: 'cpp',
    sourceCode: reference,
    requestId: randomUUID(),
  }
  assert.equal(
    (
      await call(2, `/codeforces/${contest.id}/submit`, {
        ...submission,
        language: 'python',
      })
    ).status,
    400
  )
  const run = await ok(2, `/codeforces/${contest.id}/submit`, submission)
  assert.equal(
    (await ok(2, `/codeforces/${contest.id}/submit`, submission)).id,
    run.id
  )
  assert.equal(
    (
      await call(1, `/codeforces/admin/problems/${id}/visibility`, {
        show: true,
      })
    ).status,
    409
  )
  await done()
  await db.cfContest.update({
    where: { contestId: contest.id },
    data: { phase: 'final' },
  })
  await ok(1, `/codeforces/admin/problems/${id}/visibility`, { show: true })
  const publicProblem = await ok(null, '/codeforces/problemset/' + id)
  assert.equal(
    (await call(null, `/codeforces/attachment/${id}`)).data,
    'PK-library-starter'
  )
  assert.equal(publicProblem.canPractice, true)
  assert.equal(publicProblem.taskType, 'library')
  assert(!JSON.stringify(publicProblem).includes('validatorSource'))
  assert.equal(
    (
      await call(2, `/codeforces/problemset/${id}/submit`, {
        ...submission,
        language: 'python',
        requestId: randomUUID(),
      })
    ).status,
    400
  )
  const practice = await ok(2, `/codeforces/problemset/${id}/submit`, {
    ...submission,
    requestId: randomUUID(),
  })
  assert.equal(
    (await db.cfRun.findUnique({ where: { submissionId: practice.id } })).kind,
    'practice'
  )
  assert.equal(
    (await db.submission.findUnique({ where: { id: practice.id } })).contestId,
    null
  )
  assert.equal(
    (await ok(3, `/codeforces/problemset/${id}/submissions`)).length,
    0
  )
  checks.push(
    'C++ library admission, idempotency, release guard, full-test practice jobs and per-owner history'
  )
  const cfProblem = await db.cfProblem.findFirst({ where: { problemId: id } })
  const hackJob = await db.submission.create({
    data: {
      problemId: id,
      userId: 3,
      contestId: contest.id,
      status: 'accept',
      language: 'cpp',
    },
  })
  await db.cfRun.create({
    data: {
      submissionId: hackJob.id,
      cfProblemId: cfProblem.id,
      kind: 'hack',
      phase: 'hack',
      requestId: randomUUID(),
      plan: {},
    },
  })
  await db.cfHack.create({
    data: {
      submissionId: hackJob.id,
      targetId: run.id,
      input: '13\n',
      answer: '26\n',
      state: 'successful',
      inputDigest: 'fixture',
    },
  })
  const exported = await ok(1, '/codeforces/admin/problems/import', {
    problemId: id,
    destination: 'otog',
  })
  assert.equal(
    (await db.problem.findUnique({ where: { id: exported.id } })).area,
    'otog'
  )
  assert.equal(
    objects.get(`/fixture/attachment/${exported.id}.zip`).toString(),
    'PK-library-starter'
  )
  assert.notEqual(
    objects.get(`/fixture/attachment/${exported.id}.zip`),
    objects.get(`/fixture/attachment/${id}.zip`)
  )
  for (const suffix of ['.th.pdf','.en.pdf','.pdf']) assert.deepEqual(fs.readFileSync(path.join(work,'docs',exported.id+suffix)),fs.readFileSync(path.join(work,'docs',id+suffix)))
  checks.push('CF to OTOG export copies both statement languages independently')
  const command = JSON.parse(
    fs.readFileSync(
      path.join(work, 'source', String(exported.id), 'command.yaml'),
      'utf8'
    )
  )
  assert.equal(
    fs.readFileSync(
      path.join(work, 'source', String(exported.id), '3.in'),
      'utf8'
    ),
    '13\n'
  )
  assert.equal(
    (await db.problem.findUnique({ where: { id: exported.id } })).case,
    '3'
  )
  assert(command.cpp.compile.includes('/box/grader.cpp'))
  assert.equal(
    fs.readFileSync(
      path.join(work, 'source', String(exported.id), '1.in'),
      'utf8'
    ),
    '5\n'
  )
  checks.push(
    'Independent reverse import preserves library linking and starts private'
  )
  // Exercise migration of an existing pre-catalog CF assignment and its result.
  const legacy = await db.cfProblem.create({
    data: {
      contestId: contest.id,
      problemId: p.id,
      letter: 'B',
      points: 500,
      bundle: 'a'.repeat(32),
      config: { ...cfg, problemId: p.id },
      validation: 'valid',
    },
  })
  await db.contestProblem.create({
    data: { contestId: contest.id, problemId: p.id },
  })
  const historical = await db.submission.create({
    data: {
      problemId: p.id,
      userId: 2,
      contestId: contest.id,
      status: 'accept',
      language: 'cpp',
      sourceCode: reference,
    },
  })
  await db.cfRun.create({
    data: {
      submissionId: historical.id,
      cfProblemId: legacy.id,
      kind: 'contest',
      phase: 'system',
      requestId: randomUUID(),
      plan: { config: { problemId: p.id } },
      outcome: { verdict: 'accepted' },
    },
  })
  await db.submissionResult.create({
    data: {
      submissionId: historical.id,
      result: 'P',
      score: 100,
      timeUsed: 4,
      memUsed: 1024,
    },
  })
  await db.submission.update({
    where: { id: historical.id },
    data: { status: 'waiting' },
  })
  const countBefore = await db.problem.count()
  assert.equal(
    (await call(1, '/codeforces/admin/problems/migrate', {})).status,
    409
  )
  assert.equal(await db.problem.count(), countBefore)
  await db.submission.update({
    where: { id: historical.id },
    data: { status: 'accept' },
  })
  const migration = await ok(1, '/codeforces/admin/problems/migrate', {})
  const entry = migration.migrated.find((r) => r.from === p.id)
  assert(entry)
  assert.equal(
    (await db.cfProblem.findUnique({ where: { id: legacy.id } })).problemId,
    entry.to
  )
  assert.equal(
    (await db.submission.findUnique({ where: { id: historical.id } }))
      .problemId,
    entry.to
  )
  assert.equal(
    (await db.cfRun.findUnique({ where: { submissionId: historical.id } })).plan
      .config.problemId,
    entry.to
  )
  assert.equal(
    (
      await db.submissionResult.findUnique({
        where: { submissionId: historical.id },
      })
    ).timeUsed,
    4
  )
  assert.equal(
    (await db.problem.findUnique({ where: { id: p.id } })).area,
    'otog'
  )
  assert.deepEqual(
    (await ok(1, '/codeforces/admin/problems/migrate', {})).migrated,
    []
  )
  checks.push(
    'Retryable legacy migration preserves original OTOG data, submission IDs, plans and verdict history'
  )
  const file = new FormData()
  file.set(
    'pdf',
    new Blob([fs.readFileSync(path.join(work, 'docs', p.id + '.pdf'))], {
      type: 'application/pdf',
    }),
    'statement.pdf'
  )
  // Invalid PDF fails validation without replacing the previously imported file.
  assert.equal(
    (await call(1, `/codeforces/admin/problems/${id}/files`, file)).status,
    400
  )
  assert.equal(
    fs.readFileSync(path.join(work, 'docs', id + '.pdf'), 'utf8'),
    '%PDF-fixture'
  )
  checks.push('Invalid upload preserves the existing imported statement')
  // Fractional credit must survive persistence, API responses, and contest history.
  const fractional = 99.52799842055708
  const graded = await db.submission.create({data:{problemId:p.id,userId:2,language:'cpp',status:'reject',sourceCode:'int main(){}',submissionResult:{create:{score:fractional,result:'X',timeUsed:449,memUsed:1024,subtaskResults:{create:{subtaskIndex:1,score:59.52799842055708,fullScore:60.5,verdicts:{create:{testcaseIndex:1,status:'PARTIAL',percent:0.9106416928094863,timeUsed:1,memUsed:1024}}}}}}}})
  const details = await ok(1, `/submission/${graded.id}/code`)
  assert.equal(details.submissionResult.score,fractional)
  assert.equal(details.submissionResult.subtaskResults[0].score,59.52799842055708)
  assert.equal(details.submissionResult.subtaskResults[0].fullScore,60.5)
  // Compile the source contract with the same TS module resolution as the app;
  // Node's direct TypeScript loader does not resolve its extensionless imports.
  const ts = req('typescript'), modules = new Map()
  function loadContract(file) {
    if (modules.has(file)) return modules.get(file)
    const module = {exports:{}}
    modules.set(file,module.exports)
    const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
    function local(name) {
      return name.startsWith('.') ? loadContract(path.resolve(path.dirname(file),name+'.ts')) : createRequire(file)(name)
    }
    new Function('require','module','exports',code)(local,module,module.exports)
    modules.set(file,module.exports)
    return module.exports
  }
  const { SubmissionDetailSchema } = loadContract(root+'/packages/contract/src/index.ts')
  const parsed = SubmissionDetailSchema.parse(details)
  assert.equal(parsed.submissionResult.score,fractional)
  const contestScore = await db.contestScore.create({data:{contestId:contest.id,userId:1,problemId:exported.id,score:fractional,contestScoreHistory:{create:{submissionId:graded.id,score:fractional}}},include:{contestScoreHistory:true}})
  assert.equal(contestScore.score,fractional)
  assert.equal(contestScore.contestScoreHistory[0].score,fractional)
  checks.push('Fractional submission/subtask/max/history scores preserved through real PostgreSQL, Prisma, HTTP and contract validation')
  await require('../security/test-admin-activity.cjs')({db,base,token,contest,checks})
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      realPostgreSQL: true,
      realHttp: true,
      productionWrites: 0,
    })
  )
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    if (child && child.exitCode === null) {
      child.kill()
      await new Promise((r) => child.once('exit', r))
    }
    await db.$disconnect()
    if (storage) {
      storage.closeAllConnections()
      await new Promise((r) => storage.close(r))
    }
    assert(
      path.basename(work).startsWith('otog-cf-catalog-') &&
        path.dirname(work) === require('node:os').tmpdir()
    )
    fs.rmSync(work, { recursive: true, force: true })
  })
