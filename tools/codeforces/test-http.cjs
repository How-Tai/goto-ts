const assert = require('node:assert/strict'),
  { createRequire } = require('node:module'),
  path = require('node:path')
const root = path.resolve(__dirname, '../..'),
  web = createRequire(root + '/apps/web/package.json'),
  api = createRequire(root + '/apps/api/package.json'),
  { encode } = web('next-auth/jwt'),
  { JwtService } = api('@nestjs/jwt')
const jwt = new JwtService({ secret: process.env.JWT_SECRET }),
  base = 'http://127.0.0.1:18035'
async function cookie(id, role) {
  const accessToken = jwt.sign(
    { id, jti: 'cf-fixture-' + id },
    { expiresIn: 300 }
  )
  const encrypted = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: 300,
    token: {
      accessToken,
      user: {
        id,
        username: 'cf-fixture-' + id,
        showName: 'Fixture',
        role,
        rating: 0,
      },
    },
  })
  return `next-auth.session-token=${encrypted}; __Secure-next-auth.session-token=${encrypted}`
}
async function main() {
  const checks = [],
    admin = await cookie(1, 'admin'),
    user = await cookie(2, 'user')
  for (const route of [
    '/codeforces',
    '/codeforces/contest/1',
    '/codeforces/contest/1/problem/A',
    '/codeforces/contest/1/submissions',
    '/codeforces/contest/1/hacks',
    '/codeforces/contest/1/standings',
  ]) {
    const r = await fetch(base + route)
    assert.equal(r.status, 200, route)
    const html = await r.text()
    assert(html.includes('OTOG'))
    assert(!html.includes('client-side exception'))
    checks.push({ route, status: r.status })
  }
  for (const route of [
    '/admin/codeforces',
    '/admin/codeforces/1',
    '/admin/codeforces/problems',
  ]) {
    const anonymous = await fetch(base + route, { redirect: 'manual' })
    assert([302, 303, 307, 308].includes(anonymous.status))
    assert(anonymous.headers.get('location').includes('/login'))
    const regular = await fetch(base + route, {
      redirect: 'manual',
      headers: { Cookie: user },
    })
    assert([302, 303, 307, 308].includes(regular.status))
    assert(regular.headers.get('location').includes('/codeforces'))
    const authorized = await fetch(base + route, {
      redirect: 'manual',
      headers: { Cookie: admin },
    })
    assert.equal(authorized.status, 200, route)
    const html = await authorized.text()
    assert(html.includes('Manage') || html.includes('Administrator'))
    checks.push({
      route,
      status: 200,
      anonymousBlocked: true,
      nonAdminBlocked: true,
    })
    const urls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (m) => m[1]
    )
    assert(urls.length > 0)
    for (const url of urls) {
      const script = await fetch(new URL(url, base))
      assert.equal(script.status, 200, 'Static JS ' + url)
      assert((await script.arrayBuffer()).byteLength > 0)
    }
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      staticAssetsVerified: true,
      realNextAuthSessionChecks: true,
      browserVisualInspection: false,
    })
  )
}
main().catch((e) => {
  console.error(e.stack)
  process.exitCode = 1
})
