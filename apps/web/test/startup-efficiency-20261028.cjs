const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..'), api = createRequire(root + '/apps/api/package.json'), ts = api('typescript');
const modules = new Map();
function load(name) {
  const file = path.resolve(root, name);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(request => request.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(file), request) + '.ts')) : api(request), module, module.exports);
  return module.exports;
}
async function main() {
  const checks = [], { PageRequestOverlap } = load('apps/web/src/api/page-request-overlap.ts');
  let loads = 0;
  await Promise.all(Array.from({ length: 100 }, async (_, id) => {
    const page = new PageRequestOverlap(), token = 'synthetic-' + id;
    const request = async () => { loads++; await new Promise(resolve => setTimeout(resolve, id % 5)); return { privateCode: id }; };
    page.start('2/67', token, request); page.start('2/67', token, request);
    assert.deepEqual(await page.take('2/67', token, () => token), { privateCode: id });
    assert.equal(await page.take('2/67', token, () => token), null);
  }));
  assert.equal(loads, 100);
  checks.push('100 overlapping viewers remain isolated; repeated start and consumption perform exactly one load each');
  const page = new PageRequestOverlap(); let signal;
  page.start('2/67', 'alice', async value => { signal = value; return 'private-alice'; });
  await Promise.resolve(); assert.equal(await page.take('2/67', 'bob', () => 'bob'), null); assert(signal.aborted);
  page.start('2/67', 'alice', async () => 'private-alice');
  assert.equal(await page.take('2/68', 'alice', () => 'alice'), null);
  let release, token = 'alice';
  page.start('2/67', 'alice', () => new Promise(resolve => { release = resolve; }));
  const pending = page.take('2/67', token, () => token); await Promise.resolve(); token = 'bob'; release('private-alice'); assert.equal(await pending, null);
  page.start('2/67', 'alice', async () => { throw Error('network'); }); assert.equal(await page.take('2/67', 'alice', () => 'alice'), null);
  page.start('2/67', 'alice', async value => { signal = value; return 'private'; }); await Promise.resolve(); page.cancel(); assert(signal.aborted); assert.equal(await page.take('2/67', undefined, () => null), null);
  checks.push('account/route changes, midflight cookie changes, anonymous sessions, unmounts and transport failures discard early results');
  const { backgroundDelay } = load('apps/web/src/api/background-schedule.ts');
  assert.equal(backgroundDelay(1000, 150, () => 0), 1000); assert.equal(backgroundDelay(1000, 150, () => 1), 1149);
  const { SubmissionTracker } = load('apps/web/src/api/submission-tracker.ts');
  const times = Array.from({ length: 100 }, (_, id) => {
    const tracker = new SubmissionTracker(() => id / 100); tracker.subscribe(7, 'grading', () => {});
    const now = Date.now(); assert.deepEqual(tracker.pending(now - 1), []);
    assert.deepEqual(tracker.pending(now + 501), [7]); assert.deepEqual(tracker.pending(now + 1500), []);
    tracker.setReady(true); assert.deepEqual(tracker.pending(now + 99999), []); tracker.setReady(false);
    for (let bucket = 0; bucket < 10; bucket++) if (tracker.pending(Date.now() + bucket * 100).length) return bucket;
  });
  assert(new Set(times).size >= 7);
  checks.push('fallback timers retain minimum polling intervals, pause during live delivery, and spread 100 reconnect snapshots');
  const realDocument = global.document, realSet = global.setTimeout, realClear = global.clearTimeout;
  let handler, callbacks = new Map(), serial = 0; const changes = [];
  try {
    global.document = { visibilityState: 'visible', addEventListener: (_name, fn) => { handler = fn; }, removeEventListener: (_name, fn) => { assert.equal(fn, handler); handler = undefined; } };
    global.setTimeout = fn => { callbacks.set(++serial, fn); return serial; }; global.clearTimeout = id => callbacks.delete(id);
    const stop = load('apps/web/src/api/background-focus.ts').backgroundFocusListener(value => changes.push(value));
    handler(); handler(); assert.equal(callbacks.size, 1); assert.deepEqual(changes, []);
    document.visibilityState = 'hidden'; handler(); assert.equal(callbacks.size, 0); assert.deepEqual(changes, [false]);
    document.visibilityState = 'visible'; handler(); const [id, callback] = [...callbacks][0]; callbacks.delete(id); callback(); assert.deepEqual(changes, [false, true]);
    handler(); stop(); assert.equal(callbacks.size, 0); assert.equal(handler, undefined);
  } finally { global.document = realDocument; global.setTimeout = realSet; global.clearTimeout = realClear; }
  checks.push('visibility refetches are coalesced, hidden tabs immediately lose focus, and cleanup cancels pending work');
  console.log(JSON.stringify({ passed: true, checks, productionWrites: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
