const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..'), web = createRequire(root + '/apps/web/package.json'), api = createRequire(root + '/apps/api/package.json');
const ts = api('typescript'), { QueryClient, QueryObserver } = web('@tanstack/react-query');
const moduleUnderTest = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(root + '/apps/web/src/api/contest-problem-page.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('require', 'module', 'exports', code)(name => {
  if (name === './query') return { contestKey: { getContestProblemPage: ({ params }) => ({ queryKey: ['contest', 'getContestProblemPage', params], queryFn: async () => { throw Error('Test must explicitly select its synthetic transport'); } }) } };
  return web(name);
}, moduleUnderTest, moduleUnderTest.exports);
async function main() {
  const { problemRouteId, contestProblemPageOptions } = moduleUnderTest.exports;
  for (const invalid of [undefined, ['2'], '', '0', '-1', '1.5', 'NaN', '2e3', '2147483648']) assert.equal(problemRouteId(invalid), null);
  assert.equal(problemRouteId('00067'), '67'); assert.equal(problemRouteId('2147483647'), '2147483647');
  const client = new QueryClient();
  const outcomes = await Promise.all(Array.from({ length: 100 }, async (_, viewerId) => {
    const options = contestProblemPageOptions('2', '67', viewerId);
    const value = await client.fetchQuery({ ...options, queryFn: async () => { await new Promise(resolve => setTimeout(resolve, viewerId % 5)); return { body: { sourceCode: 'synthetic-private-code-' + viewerId } }; } });
    assert.equal(value.body.sourceCode, 'synthetic-private-code-' + viewerId);
    return options;
  }));
  assert.equal(new Set(outcomes.map(o => JSON.stringify(o.queryKey))).size, 100);
  assert.notDeepEqual(contestProblemPageOptions('2', '68', 1).queryKey, outcomes[1].queryKey);
  const options = outcomes[1];
  for (const status of [400, 401, 403, 404]) assert.equal(options.retry(0, { status }), false);
  assert.equal(options.retry(0, { status: 503 }), true); assert.equal(options.retry(1, { status: 503 }), false);
  // A real observer losing its last subscriber must not retain personal code.
  const observer = new QueryObserver(client, { ...options, queryFn: async () => 'private', enabled: false });
  const unsubscribe = observer.subscribe(() => {}); unsubscribe();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(client.getQueryData(options.queryKey), undefined); client.clear();
  console.log(JSON.stringify({ passed: true, checks: ['100 concurrent viewers retain independent private results', 'problem changes use independent query identities', 'last observer cleanup removes private query contents', 'invalid route IDs and permanent API failures are not retried; transient failures have one retry'], productionWrites: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
