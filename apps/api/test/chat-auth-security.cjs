// Real gateway + JWT + Nest/Socket.IO transport, with only database operations stubbed.
// Never reads production configuration or contacts the running site.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const api = path.resolve(
  process.env.OTOG_CHAT_TEST_API_ROOT || path.join(__dirname, '..')
)
const workspace = path.resolve(api, '../..')
const src = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(api, 'src')
const apiRequire = createRequire(path.join(api, 'package.json'))
const webRequire = createRequire(path.join(workspace, 'apps/web/package.json'))
const ts = apiRequire('typescript')
const { JwtService } = apiRequire('@nestjs/jwt')
const { Logger, Module } = apiRequire('@nestjs/common')
const { NestFactory, Reflector } = apiRequire('@nestjs/core')
const { io } = webRequire('socket.io-client')
Logger.overrideLogger(false)
const cache = new Map()
function loadTs(file) {
  file = path.resolve(file)
  assert.ok(file.startsWith(src + path.sep))
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
    fileName: file,
  })
  function sourceRequire(name) {
    if (name === 'src/env')
      throw new Error('Security tests must not load production configuration')
    if (name.startsWith('src/') || name.startsWith('.')) {
      const base = name.startsWith('src/')
        ? path.join(src, name.slice(4))
        : path.resolve(path.dirname(file), name)
      const target = [base + '.ts', path.join(base, 'index.ts')].find(
        fs.existsSync
      )
      if (target) return loadTs(target)
    }
    return apiRequire(name)
  }
  new Function('require', 'module', 'exports', compiled.outputText)(
    sourceRequire,
    module,
    module.exports
  )
  return module.exports
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function event(socket, name, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler)
      reject(new Error('Timed out waiting for ' + name))
    }, timeout)
    function handler(value) {
      clearTimeout(timer)
      resolve(value)
    }
    socket.once(name, handler)
  })
}
async function until(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Timed out waiting for cleanup')
    await wait(10)
  }
}
async function main() {
  const { ChatGateway } = loadTs(path.join(src, 'modules/chat/chat.gateway.ts'))
  const { JwtAuthGuard } = loadTs(
    path.join(src, 'core/guards/jwt-auth.guard.ts')
  )
  const { userList } = loadTs(path.join(src, 'utils/index.ts'))
  const jwt = new JwtService({
    secret: 'offline-correct-key-security-regression-only',
  })
  const wrongJwt = new JwtService({
    secret: 'offline-wrong-key-security-regression-only',
  })
  const user = {
    id: 424242,
    username: 'db-user',
    showName: 'Database name',
    role: 'user',
    rating: 123,
  }
  const admin = {
    id: 424243,
    username: 'db-admin',
    showName: 'Database admin',
    role: 'admin',
    rating: 321,
  }
  const writes = [],
    lookups = [],
    clients = [],
    checks = []
  let lookupHook
  let sessionActive = true
  const database = new Map([
    [user.id, user],
    [admin.id, admin],
  ])
  const service = {
    isSessionActive: async () => sessionActive,
    findUserForSocket: async (id) => {
      lookups.push(id)
      if (lookupHook) await lookupHook(id)
      return database.get(id) ?? null
    },
    create: async (message, userId) => {
      writes.push({ message, userId })
      return { id: writes.length, message, creationDate: new Date(0) }
    },
  }
  class StubDatabaseChatService {}
  class StubSubmissionService {}
  class StubSubmissionUpdates {}
  const updates = { ready: true, events: new (require('node:events').EventEmitter)() }
  Reflect.defineMetadata(
    'design:paramtypes',
    [StubDatabaseChatService, JwtService, StubSubmissionService, StubSubmissionUpdates],
    ChatGateway
  )
  class TestModule {}
  Module({
    providers: [
      ChatGateway,
      { provide: StubDatabaseChatService, useValue: service },
      { provide: JwtService, useValue: jwt },
      { provide: StubSubmissionService, useValue: { progressBatch: async () => [] } },
      { provide: StubSubmissionUpdates, useValue: updates },
    ],
  })(TestModule)
  const app = await NestFactory.create(TestModule, { logger: false })
  app.useGlobalGuards(new JwtAuthGuard(new Reflector()))
  const gateway = app.get(ChatGateway)
  const token = (claims = {}, options = { expiresIn: 60 }) =>
    jwt.sign({ id: user.id, jti: 'dummy-valid-session', ...claims }, options)
  let url
  function client(auth, transport = 'websocket') {
    const socket = io(url, {
      auth,
      transports: [transport],
      reconnection: false,
      autoConnect: false,
      timeout: 3000,
    })
    clients.push(socket)
    return socket
  }
  async function accept(auth, transport) {
    const socket = client(auth, transport)
    const connected = event(socket, 'connect')
    socket.connect()
    await connected
    assert.equal(
      userList.get(socket.id)?.id,
      auth.token === adminToken ? admin.id : user.id
    )
    return socket
  }
  async function disconnect(socket) {
    const id = socket.id
    socket.disconnect()
    await until(() => !userList.has(id))
  }
  const adminToken = token({ id: admin.id })
  try {
    await app.listen(0, '127.0.0.1')
    url = 'http://127.0.0.1:' + app.getHttpServer().address().port
    for (const transport of ['websocket', 'polling']) {
      for (const [origin, allowed] of [['http://localhost:3030', true], ['https://untrusted.invalid', false]]) {
        const socket = io(url, { auth: { token: token() }, transports: [transport], extraHeaders: { Origin: origin }, reconnection: false, autoConnect: false })
        clients.push(socket)
        const outcome = event(socket, allowed ? 'connect' : 'connect_error')
        socket.connect()
        await outcome
        if (allowed) await disconnect(socket)
        else assert.equal(socket.connected, false)
        socket.disconnect()
        checks.push((allowed ? 'allow' : 'reject') + ':origin:' + transport)
      }
    }
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url'
      ),
      Buffer.from(
        JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + 60 })
      ).toString('base64url'),
      '',
    ].join('.')
    const rejected = [
      ['missing', undefined],
      ['empty', ''],
      ['malformed', 'not-a-jwt'],
      ['null', null],
      ['number', 123],
      ['object', { id: user.id }],
      ['oversized', 'x'.repeat(16385)],
      ['wrong-signature', wrongJwt.sign({ id: user.id }, { expiresIn: 60 })],
      ['unsigned', unsigned],
      ['expired', token({}, { expiresIn: -1 })],
      ['future-not-before', token({}, { expiresIn: 60, notBefore: 60 })],
      ['wrong-algorithm', token({}, { expiresIn: 60, algorithm: 'HS384' })],
      ['no-expiry', token({}, {})],
      ['string-id', token({ id: String(user.id) })],
      ['fractional-id', token({ id: 1.5 })],
      ['zero-id', token({ id: 0 })],
      ['negative-id', token({ id: -1 })],
      ['overflow-id', token({ id: 2147483648 })],
      ['missing-id', jwt.sign({ exp: Math.floor(Date.now() / 1000) + 60 })],
      ['unsafe-expiry', token({ exp: Number.MAX_SAFE_INTEGER }, {})],
      ['nonexistent-user', token({ id: 999999 })],
    ]
    for (const transport of ['websocket', 'polling'])
      for (const [label, credential] of rejected) {
        const before = userList.size,
          count = writes.length,
          queries = lookups.length
        const socket = client(
          credential === undefined ? {} : { token: credential },
          transport
        )
        const failure = event(socket, 'connect_error')
        let connected = false
        socket.on('connect', () => {
          connected = true
        })
        socket.connect()
        const error = await failure
        assert.equal(error.message, 'Authentication required')
        assert.equal(connected, false)
        socket.emit('chat-server', 'must never be delivered')
        await wait(5)
        assert.equal(userList.size, before)
        assert.equal(writes.length, count)
        assert.equal(
          lookups.length,
          queries + (label === 'nonexistent-user' ? 1 : 0)
        )
        socket.disconnect()
        checks.push('reject:' + transport + ':' + label)
      }
    // Database failures must fail closed without leaking errors or registering presence.
    lookupHook = async () => {
      throw new Error('private synthetic database error')
    }
    const failed = client({ token: token() })
    const failure = event(failed, 'connect_error')
    failed.connect()
    assert.equal((await failure).message, 'Authentication required')
    assert.equal(userList.size, 0)
    failed.disconnect()
    lookupHook = undefined
    checks.push('database failure fails closed')

    // Signed stale/forged display claims are ignored in favor of the current database record.
    const socket = await accept({
      token: token({
        username: 'forged',
        showName: 'forged admin',
        role: 'admin',
        rating: 999999,
      }),
      userId: admin.id,
    })
    assert.deepEqual({ ...userList.get(socket.id) }, user)
    const chat = event(socket, 'chat')
    socket.emit('chat-server', 'normal authenticated chat')
    const delivered = await chat
    assert.deepEqual(delivered[3], [user.id, user.showName, user.rating])
    assert.deepEqual(writes.at(-1), {
      message: 'normal authenticated chat',
      userId: user.id,
    })
    checks.push('database identity and normal chat preserved')
    for (const message of [
      '',
      'x'.repeat(151),
      null,
      123,
      { message: 'pretend', userId: admin.id },
    ]) {
      const before = writes.length
      const rejectedMessage = event(socket, 'exception')
      socket.emit('chat-server', message)
      const error = await rejectedMessage
      assert.equal(error.status, 'error')
      assert.equal(writes.length, before)
      assert.equal(socket.connected, true)
    }
    const boundary = event(socket, 'chat')
    socket.emit('chat-server', 'x'.repeat(150))
    await boundary
    checks.push('message type/size and 150-character boundary')
    const tab = await accept({ token: token() }, 'polling')
    await disconnect(socket)
    assert.equal(userList.has(tab.id), true)
    const tabMessage = event(tab, 'chat')
    tab.emit('chat-server', 'second tab still authenticated')
    await tabMessage
    await disconnect(tab)
    checks.push('multiple tabs, polling and disconnect cleanup')
    const adminSocket = await accept({ token: adminToken })
    assert.equal(userList.get(adminSocket.id).role, 'admin')
    await disconnect(adminSocket)
    checks.push('legitimate administrator connection')

    // A socket cannot authenticate itself by populating the legacy presence cache.
    const fake = {
      id: 'synthetic-forged-cache-entry',
      connected: true,
      disconnect() {
        this.connected = false
        return this
      },
    }
    userList.set(fake.id, admin)
    const before = writes.length
    await gateway.receiveMsg(fake, 'must not be written')
    assert.equal(fake.connected, false)
    assert.equal(writes.length, before)
    assert.equal(userList.has(fake.id), false)
    checks.push('presence cache cannot authorize messages')

    const expiring = await accept({ token: token({}, { expiresIn: 2 }) })
    const expiringId = expiring.id
    await event(expiring, 'disconnect', 4000)
    await until(() => !userList.has(expiringId))
    checks.push('automatic expiry disconnect and cleanup')
    const late = await accept({ token: token() })
    const lateId = late.id
    const serverSocket = gateway.server.sockets.sockets.get(lateId)
    const oldNow = Date.now
    const beforeLate = writes.length
    const lost = event(late, 'disconnect')
    try {
      Date.now = () => oldNow() + 120000
      await gateway.receiveMsg(serverSocket, 'expired while timer delayed')
    } finally {
      Date.now = oldNow
    }
    await lost
    assert.equal(writes.length, beforeLate)
    assert.equal(userList.has(lateId), false)
    checks.push('message-time expiry check when timer is delayed')

    // A connection cancelled while waiting for the database never enters presence.
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    lookupHook = () => gate
    const baseline = lookups.length
    const abandoned = client({ token: token() })
    abandoned.connect()
    await until(() => lookups.length > baseline)
    abandoned.disconnect()
    release()
    await wait(50)
    lookupHook = undefined
    assert.equal(userList.size, 0)
    checks.push('cancelled handshake does not create stale presence')
    lookupHook = () => wait(2100)
    const slow = client({ token: token({}, { expiresIn: 2 }) })
    const expiredDuringLookup = event(slow, 'connect_error', 4000)
    const beforeSlow = lookups.length
    slow.connect()
    assert.equal((await expiredDuringLookup).message, 'Authentication required')
    assert.equal(lookups.length, beforeSlow + 1)
    assert.equal(userList.size, 0)
    slow.disconnect()
    lookupHook = undefined
    checks.push('expiry during database lookup rejected')
    const revoked = await accept({ token: token() })
    const revokedDisconnected = event(revoked, 'disconnect')
    const priorWrites = writes.length
    sessionActive = false
    revoked.emit('chat-server', 'must not be written')
    await revokedDisconnected
    assert.equal(writes.length, priorWrites)
    checks.push('revoked session cannot send chat messages')
    const denied = client({ token: token() })
    const deniedConnection = event(denied, 'connect_error')
    denied.connect()
    assert.equal((await deniedConnection).message, 'Authentication required')
    sessionActive = true
    checks.push('revoked session cannot reconnect')
  } finally {
    clients.forEach((socket) => socket.disconnect())
    await app.close()
    assert.equal(userList.size, 0)
  }
  const result = {
    passed: true,
    checks: checks.length,
    details: checks,
    liveRequests: 0,
    productionWrites: 0,
  }
  if (process.env.OTOG_CHAT_TEST_RESULT)
    fs.writeFileSync(
      process.env.OTOG_CHAT_TEST_RESULT,
      JSON.stringify(result, null, 2)
    )
  console.log(JSON.stringify(result, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
