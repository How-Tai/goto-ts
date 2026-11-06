// Smoke the built frontend on loopback. Does not contact the deployed site.
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  { createRequire } = require('node:module'),
  { randomBytes } = require('node:crypto')
const root = path.resolve(__dirname, '../..'),
  req = createRequire(root + '/apps/web/package.json'),
  web = path.join(root, 'apps/web'),
  logfile = path.join(
    require('node:os').tmpdir(),
    'otog-cf-pages-' + randomBytes(8).toString('hex') + '.log'
  ),
  log = fs.openSync(logfile, 'w')
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_APP_HOST: 'http://127.0.0.1:18325',
  NEXT_PUBLIC_API_HOST: '/backend',
  API_HOST_SSR: 'http://127.0.0.1:18324',
  NEXT_PUBLIC_SOCKET_HOST: 'same-origin',
  NEXT_PUBLIC_FIREBASE_CONFIG: Buffer.from('{}').toString('base64'),
  NEXT_PUBLIC_OFFLINE_MODE: 'false',
  NEXTAUTH_URL: 'http://127.0.0.1:18325',
  NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
  OTOG_AUTH_PROXY_SECRET: randomBytes(32).toString('hex'),
  NEXT_PUBLIC_CONTACT_LINK: '',
  NEXT_PUBLIC_GITHUB_LINK: 'https://github.com/How-Tai/goto',
  NEXT_PUBLIC_CPP_REF_LINK: 'https://en.cppreference.com/',
}
const child = spawn(
  process.execPath,
  [
    req.resolve('next/dist/bin/next'),
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    '18325',
  ],
  { cwd: web, env, windowsHide: true, stdio: ['ignore', log, log] }
)
async function main() {
  let ready = false
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch('http://127.0.0.1:18325/api/auth/session')).ok) {
        ready = true
        break
      }
    } catch {}
    if (child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 200))
  }
  assert(
    ready,
    'Fixture frontend startup failed: ' +
      fs.readFileSync(logfile, 'utf8').slice(-1500)
  )
  const checks = []
  for (const route of [
    '/codeforces',
    '/codeforces/problemset',
    '/admin/codeforces/problems',
    '/login',
  ]) {
    const r = await fetch('http://127.0.0.1:18325' + route, {
        redirect: 'manual',
      }),
      html = await r.text()
    if (route === '/admin/codeforces/problems') {
      assert([302, 303, 307, 308].includes(r.status))
      assert(r.headers.get('location').includes('/login'))
      checks.push(route)
      continue
    }
    assert.equal(r.status, 200, route)
    if (route === '/codeforces/problemset')
      assert(html.includes('CF problem set'))
    if (route === '/login') assert(!html.includes('href="/codeforces'))
    checks.push(route)
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      productionBuild: true,
      loopbackOnly: true,
      browserVisualInspection: false,
    })
  )
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    if (child.exitCode === null) {
      child.kill()
      await new Promise((r) => child.once('exit', r))
    }
    fs.closeSync(log)
    fs.rmSync(logfile, { force: true })
  })
