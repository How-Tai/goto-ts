const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..'), web = createRequire(root + '/apps/web/package.json'), api = createRequire(root + '/apps/api/package.json');
const tools = createRequire(path.resolve(process.env.OTOG_REACT_TEST_TOOLS, 'package.json'));
const React = web('react'), renderer = tools('react-test-renderer'), { act } = renderer, ts = api('typescript');
const query = web('@tanstack/react-query'); const modules = new Map();
let status, session, cookie, calls, fallbacks, redirects, mode, router;
const jwt = id => 'e30.' + Buffer.from(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.synthetic';
const body = id => ({ contest: { id: 2, name: 'Contest' }, problem: { id, name: 'Problem ' + id }, serverTime: new Date(), latestSubmission: { sourceCode: cookie } });
const wrapper = ({ children, ...props }) => React.createElement('div', props, children);
function load(relative) {
  const file = path.resolve(root, relative); if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  function req(name) {
    if (name === 'react') return React;
    if (name === 'next-auth/react') return { useSession: () => ({ status, data: session }) };
    if (name === 'next/router') return { useRouter: () => router };
    if (name === 'next/dynamic') return () => () => null;
    if (name === 'next/head') return () => null;
    if (name === 'next/link') return wrapper;
    if (name === 'next/error') return props => React.createElement('div', { 'data-error': props.statusCode });
    if (name === 'lucide-react') return new Proxy({}, { get: () => wrapper });
    if (name.startsWith('@otog/ui/')) return new Proxy({}, { get: (_t, key) => key === 'clsx' ? (...args) => args.filter(Boolean).join(' ') : wrapper });
    if (name === '@otog/contract') return { contestRouter: { getContestProblemPage: { responses: { 200: { parse: value => value } } } } };
    if (name.endsWith('/api/auth')) return { getAccessToken: () => cookie };
    if (name.endsWith('/api/session-expiry')) return { redirectToLogin: async () => { redirects++; } };
    if (name === './query' || name.endsWith('/api/query')) return { contestKey: { getContestProblemPage: ({ params }) => ({ queryKey: ['contest', 'page', params], queryFn: async context => {
      if (context?.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      fallbacks++; return { status: 200, body: body(Number(params.problemId)) };
    } }) }, submissionKey: {} };
    if (name.endsWith('/env')) return { environment: { API_HOST: 'https://fixture.invalid' } };
    if (name.endsWith('/modules/contest/sidebar')) return { ContestLayout: wrapper, useContest: () => ({ contest: { id: 2, name: 'Contest' }, contestStatus: 'RUNNING' }) };
    if (name.endsWith('/hooks/use-container-breakpoint')) return { useContainerBreakpoint: () => ({ containerRef: null, isBreakpoint: false }) };
    if (name.endsWith('/components/portals')) return { useHtmlPortalNode: () => ({}), ClientInPortal: wrapper, ClientOutPortal: () => null };
    if (name.includes('/components/')) return new Proxy({}, { get: () => wrapper });
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), name) + '.ts' + (name.endsWith('contest-problem-page') || name.endsWith('use-problem-page-overlap') || name.endsWith('page-request-overlap') ? '' : 'x')));
    return web(name);
  }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', source)(req, module, module.exports); return module.exports;
}
const Provider = load('apps/web/src/hooks/use-problem-page-overlap.ts').ProblemPageOverlapProvider;
const Page = load('apps/web/src/pages/contest/[contestId]/problem/[problemId].tsx').default;
const realFetch = global.fetch;
function reset(nextMode = 'normal') {
  status = 'loading'; session = null; cookie = jwt(1); calls = []; fallbacks = redirects = 0; mode = nextMode;
  router = { isReady: true, pathname: '/contest/[contestId]/problem/[problemId]', query: { contestId: '2', problemId: '67' }, push: () => {} };
  global.fetch = async (url, options) => {
    const id = Number(url.match(/problem\/(\d+)/)[1]), issuedToken = options.headers.Authorization.slice(7); calls.push({ id, signal: options.signal });
    if (mode === 'pending') await new Promise(resolve => { calls.at(-1).release = resolve; });
    return { status: mode === 'forbidden' ? 403 : mode === 'unauthorized' ? 401 : 200, headers: new Headers(), json: async () => ({ ...body(id), latestSubmission: { sourceCode: issuedToken } }) };
  };
}
function createView(client) {
  // The actual app remounts its AccountUpdates subtree when the session resolves.
  return React.createElement(query.QueryClientProvider, { client }, React.createElement(Provider, null,
    React.createElement(React.Fragment, { key: session?.user?.id ?? 'anonymous' }, React.createElement(Page))));
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
const ready = view => view.root.findAll(node => node.props['data-contest-problem-ready']).map(node => node.props['data-contest-problem-ready']);
async function main() {
  const checks = []; let view, client;
  async function mount() { client = new query.QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } }); await act(async () => { view = renderer.create(createView(client)); }); await settle(); }
  async function signIn(id = 1) { status = 'authenticated'; session = { user: { id }, accessToken: cookie }; await act(async () => { view.update(createView(client)); }); await settle(); }
  async function close() { await act(async () => view.unmount()); client.clear(); }
  try {
    reset(); await mount(); assert.equal(calls.length, 1); assert.deepEqual(ready(view), []);
    await signIn(); assert.deepEqual(ready(view), [67]); assert.equal(calls.length, 1); assert.equal(fallbacks, 0);
    await close(); checks.push('actual page waits for session verification and reuses one authorized request across the account-subtree remount');
    reset('pending'); await mount(); const original = calls[0]; cookie = jwt(2); await signIn(2);
    assert(original.signal.aborted); original.release(); await settle(); assert.equal(fallbacks, 1); assert.deepEqual(ready(view), [67]);
    const pages = client.getQueryCache().getAll().filter(q => q.state.status === 'success'); assert(pages.every(q => q.state.data.body.latestSubmission.sourceCode === cookie));
    await close(); checks.push('an account switch discards the prior request and only the new account response reaches the real page query');
    reset('pending'); await mount(); const first = calls[0]; router.query = { contestId: '2', problemId: '68' }; await act(async () => view.update(createView(client))); await settle();
    assert(first.signal.aborted); assert.equal(calls.length, 2); first.release(); calls[1].release(); await signIn(); assert.deepEqual(ready(view), [68]); assert.equal(fallbacks, 0); await close();
    checks.push('route changes abort the old request and cannot display the previous problem');
    reset(); cookie = 'e30.' + Buffer.from(JSON.stringify({ exp: 0 })).toString('base64url') + '.synthetic'; await mount(); assert.equal(calls.length, 0); await signIn(); assert.equal(fallbacks, 1); assert.deepEqual(ready(view), [67]); await close();
    reset('unauthorized'); await mount(); await signIn(); assert.equal(fallbacks, 1); assert.deepEqual(ready(view), [67]); await close();
    checks.push('expired credentials skip early requests; an early HTTP 401 delegates to the existing normal authentication path');
    reset('forbidden'); await mount(); await signIn(); assert.equal(fallbacks, 0); assert.deepEqual(ready(view), []); assert.equal(view.root.findAllByProps({ 'data-error': 404 }).length, 1); await close();
    reset('pending'); await mount(); const pending = calls[0]; status = 'unauthenticated'; await act(async () => view.update(createView(client))); assert(pending.signal.aborted); pending.release(); await settle(); assert.deepEqual(ready(view), []); assert(redirects > 0); await close();
    checks.push('forbidden contents remain hidden; logout cancels the request and redirects without rendering the problem');
    console.log(JSON.stringify({ passed: true, checks, actualReact: React.version, productionWrites: 0 }));
  } finally { global.fetch = realFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
