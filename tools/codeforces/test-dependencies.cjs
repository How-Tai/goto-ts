const { createRequire } = require('node:module'),
  path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..'),
  web = createRequire(root + '/apps/web/package.json'),
  api = createRequire(root + '/apps/api/package.json')
const language = createRequire(
    web.resolve('vscode-languageclient/package.json')
  ),
  modern = language('minimatch')
assert.equal(language('minimatch/package.json').version, '11.0.4')
for (const [pattern, file, options, expected] of [
  ['**/*.cpp', 'task/main.cpp', { noext: true }, true],
  ['**/*.cpp', 'task/main.py', { noext: true }, false],
  ['**/task.h', '.hidden/task.h', { dot: true }, true],
  ['**/*.CPP', 'task/main.cpp', { dot: true, nocase: true }, true],
  ['**/*.cpp', 'task/main.CPP', { dot: true }, false],
  ['{src,include}/**', 'include/task.h', { dot: true }, true],
]) {
  const matcher = new modern.Minimatch(pattern, options)
  assert.equal(matcher.match(file), expected)
}
// Test the actual remaining legacy consumer, not an API-incompatible blanket override.
const eslint = createRequire(web.resolve('eslint/package.json')),
  legacy = eslint('minimatch')
assert.equal(eslint('minimatch/package.json').version, '3.1.5')
assert.equal(typeof legacy, 'function')
assert(legacy('src/main.ts', '**/*.ts'))
assert(new legacy.Minimatch('src/**').match('src/main.ts'))
const ts = web('typescript')
function expression(file, predicate) {
  const text = fs.readFileSync(
    language.resolve('vscode-languageclient/lib/common/' + file),
    'utf8'
  )
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  let found
  function visit(node) {
    if (predicate(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(found, file)
  return (ts.isVariableDeclaration(found) ? found.initializer : found).getText(
    source
  )
}
const notebook = new Function(
  'minimatch',
  'return ' +
    expression(
      'notebook.js',
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'matchNotebook'
    )
)(modern)
assert(
  notebook(
    { pattern: '**/*.cpp' },
    { uri: { scheme: 'file', fsPath: '/src/main.cpp' } }
  )
)
assert(
  !notebook(
    { pattern: '**/*.cpp' },
    { uri: { scheme: 'file', fsPath: '/src/main.py' } }
  )
)
const resource = new Function(
  'minimatch',
  'options',
  'diagnosticPullOptions',
  'vscode_languageserver_protocol_1',
  'return ' +
    expression(
      'diagnostic.js',
      (n) => ts.isVariableDeclaration(n) && n.name.getText() === 'matchResource'
    )
)(
  modern,
  { documentSelector: [{ pattern: '**/*.cpp' }] },
  {},
  language('vscode-languageserver-protocol')
)
assert(resource({ scheme: 'file', fsPath: '/src/main.cpp' }))
assert(!resource({ scheme: 'file', fsPath: '/src/main.py' }))
const operationFile = language.resolve(
    'vscode-languageclient/lib/common/fileOperations.js'
  ),
  operationRequire = createRequire(operationFile),
  operations = { exports: {} }
new Function(
  'require',
  'exports',
  'module',
  fs.readFileSync(operationFile, 'utf8')
)(
  (name) =>
    name === 'vscode'
      ? {
          workspace: { onDidCreateFiles: () => ({ dispose() {} }) },
          FileType: { File: 1, Directory: 2 },
        }
      : operationRequire(name),
  operations.exports,
  operations
)
const feature = new operations.exports.DidCreateFilesFeature({
  code2ProtocolConverter: { asDidCreateFilesParams: (x) => x },
})
feature.register({
  id: 'fixture',
  registerOptions: {
    filters: [{ pattern: { glob: '**/*.CPP', options: { ignoreCase: true } } }],
  },
})
assert(feature._filters.get('fixture')[0].matcher.match('src/main.cpp'))
assert(!feature._filters.get('fixture')[0].matcher.match('src/main.py'))
feature.unregister('fixture')
const configSource = fs.readFileSync(eslint.resolve('minimatch'), 'utf8')
assert(!configSource.includes('firstPhasePreProcess'))
assert(!configSource.includes('optimizationLevel'))
console.log(
  JSON.stringify({
    passed: true,
    checks: [
      'actual patched language-client diagnostic, notebook and file-operation filters with minimatch 11',
      'legacy ESLint callable minimatch API',
      'legacy branch lacks the implementation and option described by GHSA-g3hv-75wg-m249',
    ],
    remainingAdvisoryMatches: 1,
  })
)
