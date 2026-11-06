// Server-render real CF components with fixture query data. No browser automation.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..'),
  req = createRequire(root + '/apps/web/package.json'),
  React = req('react'),
  { renderToString } = req('react-dom/server'),
  ts = req('typescript')
let role = 'user',
  phase = 'scheduled'
const now = Date.now()
const problem = {
  id: 1,
  problemId: 900001,
  letter: 'A',
  name: 'Double <script>text</script>',
  points: 500,
  timeLimit: 1000,
  memoryLimit: 64,
  locked: true,
  validation: 'valid',
  hasAttachment: true,
  attachmentMetadata: { name: 'starter.zip', size: 100 },
  config: {
    pretests: [1],
    fullTests: [1, 2],
    validatorSource: 'PRIVATE_VALIDATOR',
    referenceSource: 'PRIVATE_REFERENCE',
    checkerSource: '',
    timeLimit: 1000,
    memoryLimit: 64,
  },
}
const detail = () => ({
  id: 1,
  name: 'CF <script>name</script>',
  phase,
  now: new Date().toISOString(),
  timeStart: new Date(now - 600000).toISOString(),
  timeEnd: new Date(now + 600000).toISOString(),
  registered: true,
  problems: [problem],
  settings: {
    minimumFraction: 0.3,
    wrongPenalty: 50,
    decayMinutes: 250,
    successfulHackPoints: 100,
    unsuccessfulHackPenalty: 50,
  },
})
const jobs = [
  {
    id: 2,
    userId: 2,
    showName: 'Fixture',
    letter: 'A',
    kind: 'contest',
    phase: 'pretest',
    status: 'accept',
    language: 'cpp',
    creationDate: new Date(now).toISOString(),
    preOutcome: { verdict: 'accepted' },
    outcome: { verdict: 'accepted', timeMs: 2, memoryKiB: 3200 },
  },
  {
    id: 3,
    userId: 3,
    showName: 'Other',
    letter: 'A',
    kind: 'hack',
    phase: 'hack',
    status: 'reject',
    hackState: 'invalid',
    targetId: 2,
  },
]
const query = {
  useQuery: ({ queryKey: k, enabled }) => ({
    dataUpdatedAt: Date.now(),
    isPending: false,
    error: null,
    data:
      enabled === false
        ? undefined
        : k.includes('catalog')
          ? { data: [{ ...problem, id: 900001, show: false }], total: 1 }
          : k.includes('catalog-problem')
            ? { ...problem, id: 900001, canPractice: true, taskType: 'library' }
            : k.includes('practice')
              ? jobs
              : k.includes('contests') || k.includes('list')
                ? [detail()]
                : k.includes('submissions') || k.includes('admin-jobs')
                  ? jobs
                  : k.includes('standings')
                    ? {
                        phase,
                        rows: [
                          {
                            rank: 1,
                            userId: 2,
                            showName: 'Fixture',
                            total: 480,
                            successfulHacks: 0,
                            unsuccessfulHacks: 0,
                            problems: [
                              {
                                letter: 'A',
                                points: 480,
                                minutes: 10,
                                attempts: 0,
                              },
                            ],
                          },
                        ],
                      }
                    : detail(),
  }),
  useMutation: () => ({ mutate() {}, isPending: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}
let area
function load(file) {
  const source = fs.readFileSync(
      root + '/apps/web/src/modules/codeforces/' + file + '.tsx',
      'utf8'
    ),
    code = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    m = { exports: {} }
  const mock = (name) =>
    name === '@tanstack/react-query'
      ? query
      : name === 'next/link'
        ? {
            __esModule: true,
            default: ({ children, ...props }) =>
              React.createElement('a', props, children),
          }
        : name === 'next/head'
          ? { __esModule: true, default: () => null }
          : name.endsWith('/user-context')
            ? {
                useUserContext: () => ({
                  user: role ? { id: 2, showName: 'Fixture', role } : null,
                  isAuthenticated: !!role,
                  isAdmin: role === 'admin',
                }),
              }
            : name === './client'
              ? {
                  field: 'field',
                  button: 'button',
                  primary: 'primary',
                  panel: 'panel',
                  cfApi: async () => {
                    throw Error('Render test must not issue requests')
                  },
                }
              : name === './area'
                ? area
                : name === '../../components/statement-viewer'
                  ? (() => {
                    const mod = {exports:{}}
                    const code = ts.transpileModule(fs.readFileSync(root+'/apps/web/src/components/statement-viewer.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
                    new Function('require','module','exports',code)(req,mod,mod.exports)
                    return mod.exports
                  })()
                  : req(name)
  new Function('require', 'module', 'exports', code)(mock, m, m.exports)
  return m.exports
}
area = load('area')
const admin = load('admin'),
  checks = []
const catalog = load('catalog')
function render(name, component, props = {}, expected) {
  const html = renderToString(React.createElement(component, props))
  assert(html.includes(expected), name + ' missing ' + expected)
  assert(!html.includes('<script>name</script>'))
  assert(!html.includes('PRIVATE_REFERENCE'))
  checks.push(name)
  return html
}
render('contest list', area.ContestList, {}, 'Codeforces-style contests')
render('contest problems', area.Contest, { id: 1 }, 'Double &lt;script&gt;')
render(
  'problem statement and submit form',
  area.Contest,
  { id: 1, tab: 'problem', letter: 'A' },
  'statement PDF'
)
render(
  'submission list',
  area.Contest,
  { id: 1, tab: 'submissions' },
  'Pretests passed'
)
render('standings', area.Contest, { id: 1, tab: 'standings' }, '480')
render(
  'hacks and locking',
  area.Contest,
  { id: 1, tab: 'hacks' },
  'Ignored: invalid input'
)
phase = 'final'
const closed = render(
  'final contest disables hack form',
  area.Contest,
  { id: 1, tab: 'hacks' },
  'Hack submissions are closed'
)
assert(!closed.includes('Counterexample input'))
phase = 'scheduled'
role = null
const guest = render('guest cannot submit', area.Contest, { id: 1 }, 'Log in')
assert(!guest.includes('Source code'))
role = 'admin'
phase = 'draft'
render(
  'admin list and create form',
  admin.CfAdmin,
  {},
  'Contest schedule and scoring'
)
render(
  'admin authoring and validation controls',
  admin.CfAdmin,
  { id: 1 },
  'Freeze bundle and validate'
)
role = 'user'
render(
  'non-admin authoring guard',
  admin.CfAdmin,
  { id: 1 },
  'Administrator access required'
)
assert.equal(
  area.verdict({
    status: 'grading',
    kind: 'contest',
    phase: 'pretest',
    outcome: { currentTest: 4 },
  }),
  'Running on pretest 4…'
)
assert.equal(
  area.verdict({
    status: 'reject',
    kind: 'contest',
    phase: 'pretest',
    outcome: { verdict: 'hacked' },
  }),
  'Hacked'
)
assert.equal(
  area.verdict({
    status: 'reject',
    kind: 'validator',
    phase: 'validation',
    outcome: { verdict: 'validation_failed', failedTest: 13 },
  }),
  'Validation failed on test 13'
)
assert.equal(
  area.verdict({
    status: 'accept',
    kind: 'validator',
    phase: 'validation',
    outcome: { verdict: 'accepted' },
  }),
  'Validation passed'
)
assert.equal(
  area.verdict({
    status: 'reject',
    kind: 'validator',
    phase: 'validation',
    outcome: { verdict: 'wrong_answer', failedTest: 1 },
  }),
  'Validation failed on test 1'
)
role = 'admin'
render(
  'CF catalog import/export and authoring',
  catalog.CfProblemSet,
  { admin: true },
  'Copy into CF'
)
role = 'user'
render('CF public problem set', catalog.CfProblemSet, {}, 'CF problem set')
const library = render(
  'Library practice page',
  catalog.CfProblemSet,
  { id: 900001 },
  'Practice submission'
)
assert(!library.includes('GNU C17'))
assert(!library.includes('Python 3'))
render(
  'CF catalog admin access guard',
  catalog.CfProblemSet,
  { admin: true },
  'Administrator access required'
)
console.log(
  JSON.stringify({
    passed: true,
    checks,
    realReactServerRendering: true,
    browserVisualInspection: false,
  })
)
