import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const typescript = createRequire(join(root, 'package.json'))('typescript');
const {
  createSourceFile,
  isArrowFunction,
  isCallExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isNewExpression,
  isPropertyAccessExpression,
  isVariableStatement,
  ScriptKind,
} = typescript;

/**
 * `package.json` must not advertise `"sideEffects": false` while any shipped module still performs
 * work at import time. That declaration is a promise to every bundler in the dependency tree: it
 * authorizes them to drop a module the moment none of its exports are used, and to hoist or prune
 * its top-level statements. When a module contradicts the promise the notice is silently lost in
 * exactly the production bundles where losing it matters most, and nothing in the type system or the
 * test suite catches it because the un-bundled build still behaves correctly.
 *
 * The fix is a targeted allowlist rather than deleting the field. The tests below are the regression
 * guard: they discover side-effecting modules from the source AST rather than from a hand-kept list,
 * so adding a new import-time side effect without declaring it fails the suite. The scan treats both
 * a top-level expression statement and a top-level call in a variable initializer as side effects,
 * because both perform work at import time, and dedicated fixture tests pin that behaviour in both
 * directions so the scan cannot silently narrow back to the weaker check.
 */
const BUILT_FORMATS = ['esm', 'cjs'];

function listSourceFiles() {
  const files = [];
  visit(join(root, 'src'));

  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) files.push(full);
    }
  }

  return files.sort();
}

/**
 * Globals whose results are fully determined by their arguments and which cannot escape.
 *
 * `Object.freeze` is here specifically because `EMPTY_STATE_SNAPSHOT` in `src/core/GuardCore.ts`
 * is built by one. Reporting it would force the library's largest module into the `sideEffects`
 * allowlist, which is a far worse outcome than the theoretical over-report: a bundler would be
 * forbidden from ever dropping the core module. Over-reporting is only acceptable when it is cheap.
 */
const PURE_GLOBALS = new Set([
  'Array.from',
  'Array.of',
  'Boolean',
  'JSON.parse',
  'JSON.stringify',
  'Math.abs',
  'Math.ceil',
  'Math.floor',
  'Math.max',
  'Math.min',
  'Math.round',
  'Math.trunc',
  'Number',
  'Number.isFinite',
  'Number.isInteger',
  'Number.isSafeInteger',
  'Object.assign',
  'Object.create',
  'Object.entries',
  'Object.freeze',
  'Object.fromEntries',
  'Object.keys',
  'Object.seal',
  'Object.values',
  'String',
]);

/** `new X(...)` for these collection builtins cannot escape either. */
const PURE_CONSTRUCTORS = new Set(['Array', 'Map', 'Object', 'Set', 'WeakMap', 'WeakSet']);

/**
 * Instance methods that only read their receiver and their arguments.
 *
 * Needed because a call on a value the module built itself, e.g.
 * `new Set(entries.map(normalizeModel))`, is a member call on `entries` and would otherwise be
 * reported as escaping. Only methods that provably cannot mutate anything outside the receiver and
 * cannot invoke a user callback are listed: `forEach`, `map`, `filter`, `reduce` and friends are
 * absent on purpose, because a callback can do anything and this scan does not model its body.
 */
const PURE_INSTANCE_METHODS = new Set([
  'at',
  'concat',
  'endsWith',
  'includes',
  'indexOf',
  'join',
  'lastIndexOf',
  'padEnd',
  'padStart',
  'repeat',
  'slice',
  'split',
  'startsWith',
  'substring',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
]);

/** Renders a call's callee as a dotted name, or null when it is not statically nameable. */
function calleeName(node, source) {
  if (isIdentifier(node)) return node.text;
  if (isPropertyAccessExpression(node)) {
    const owner = calleeName(node.expression, source);
    return owner === null ? null : `${owner}.${node.name.text}`;
  }
  return null;
}

/**
 * Maps names declared in this file to their function body, so a top-level call to an internal helper
 * can be checked instead of assumed harmless.
 */
function localFunctions(source) {
  const functions = new Map();
  const variables = new Set();

  for (const statement of source.statements) {
    if (isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    } else if (isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (isIdentifier(declaration.name)) variables.add(declaration.name.text);
        if (
          declaration.initializer &&
          (isArrowFunction(declaration.initializer) || isFunctionExpression(declaration.initializer)) &&
          isIdentifier(declaration.name)
        ) {
          functions.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }

  return { functions, variables };
}

/**
 * Returns every `src` module that performs an observable action when it is imported.
 *
 * A module contradicts the `sideEffects` promise whenever work happens at import time, and work
 * happens through more than one shape. The scan has to catch all of them:
 *
 * 1. A top-level `ExpressionStatement`, e.g. `warnIfPricingIsStale();`. Nothing is exported, yet
 *    work happens at import time.
 * 2. A top-level variable initializer that calls something, e.g.
 *    `const SALT = randomBytes(16);` in `src/core/scope-fingerprint.ts`. The variable is exported or
 *    not, but the call already happened, and a bundler that prunes the module discarded it.
 * 3. The same call *nested* inside a larger initializer, e.g. `const KEY = flag ? randomBytes(1) : 0`
 *    or `const LIST = [randomBytes(16)]`. Checking only whether the initializer is itself a
 *    `CallExpression` misses every one of these.
 * 4. A top-level call to a local helper that is itself impure, e.g.
 *    `const SALT = makeSalt();` where `makeSalt` calls `randomBytes`. Trusting every same-file name
 *    would make this invisible.
 *
 * "Can escape" is the operative test, and it is deliberately biased toward reporting. A call is
 * inert only when it is a known-pure global, a known-pure collection constructor, a known-pure
 * instance method, or a local helper whose own body passes the same test. Anything else - an
 * imported function, `randomBytes`, `Date.now`, a global write - is reported. Two deliberate
 * limits: function and arrow bodies are not descended into, because a function that is merely
 * *defined* at import time has not run; and local-helper recursion is followed only once per name,
 * which is enough to reach an impure leaf without looping.
 */
function findSideEffectsInSource(text, fileName = 'fixture.ts') {
  const source = createSourceFile(fileName, text, 99, true, ScriptKind.TS);
  const { functions: local, variables } = localFunctions(source);
  const reasons = [];
  const expandedLocals = new Set();

  const addReason = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  /**
   * Walks an expression that is evaluated at import time, reporting any call or construction that
   * can be observed from outside this module.
   */
  const scan = (node, label) => {
    if (isCallExpression(node)) {
      const name = calleeName(node.expression, source);
      const receiver = isPropertyAccessExpression(node.expression)
        ? calleeName(node.expression.expression, source)
        : null;
      const method = isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;

      const pure =
        (name !== null && PURE_GLOBALS.has(name)) ||
        (method !== null && receiver !== null && variables.has(receiver) && PURE_INSTANCE_METHODS.has(method));

      if (!pure) {
        if (name !== null && local.has(name)) {
          // Follow the helper instead of trusting the name, then re-check the arguments, which are
          // evaluated at import time whether or not the helper turns out to be pure.
          if (!expandedLocals.has(name)) {
            expandedLocals.add(name);
            for (const argument of local.get(name).parameters ?? []) {
              if (argument.initializer) scan(argument.initializer, `${label} default argument`);
            }
            const body = local.get(name).body;
            if (body) scan(body, `${label} -> ${name}()`);
          }
        } else {
          addReason(name === null ? `${label} invokes a call with a computed callee` : `${label} invokes ${name}()`);
        }
      }

      for (const argument of node.arguments) scan(argument, label);
      return;
    }

    if (isNewExpression(node)) {
      const name = isIdentifier(node.expression) ? node.expression.text : null;
      if (name === null || !PURE_CONSTRUCTORS.has(name)) {
        addReason(name === null ? `${label} constructs an instance` : `${label} constructs ${name}()`);
      }
      for (const argument of node.arguments ?? []) scan(argument, label);
      return;
    }

    // A function or arrow that is only *defined* at import time has not been called, so its body is
    // not import-time work. Descending into it would flag every deferred callback in the codebase.
    if (isFunctionExpression(node) || isArrowFunction(node) || isFunctionDeclaration(node)) return;

    node.forEachChild((child) => {
      if (child) scan(child, label);
    });
  };

  for (const statement of source.statements) {
    if (isExpressionStatement(statement)) {
      addReason('top-level expression statement');
      continue;
    }

    if (!isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      // A literal or a bare identifier is inert and is inlined or pruned correctly by any bundler,
      // so flagging it would be noise.
      if (!initializer) continue;

      scan(initializer, 'top-level initializer for `' + declaration.name.getText(source) + '`');
    }
  }

  return reasons;
}

function findModulesWithTopLevelSideEffects() {
  const modules = [];

  for (const file of listSourceFiles()) {
    const reasons = findSideEffectsInSource(readFileSync(file, 'utf8'), file);
    if (reasons.length > 0) modules.push({ file: relativeToRoot(file), reasons });
  }

  return modules;
}

function relativeToRoot(file) {
  return file.slice(root.length + 1).split(sep).join(posix.sep);
}

/** Maps a `src` module to the specifier a bundler resolves it under, per build format. */
function distSpecifier(sourcePath, format) {
  const withoutExtension = sourcePath.replace(/\.ts$/u, '').split(sep).join(posix.sep);
  return `./dist/${format}/${withoutExtension.replace(/^src\//u, '')}.js`;
}

test('package.json does not claim the package is side-effect free', () => {
  assert.notEqual(
    packageJson.sideEffects,
    false,
    'package.json declares "sideEffects": false, but a shipped module warns at import time. Bundlers are ' +
      'then permitted to prune that warning. Declare the affected modules in a "sideEffects" array instead.'
  );
  assert.ok(
    Array.isArray(packageJson.sideEffects),
    '"sideEffects" should be an explicit allowlist array so the intent is auditable in the published manifest'
  );
});

test('the side-effect scan actually finds the known import-time side effect', () => {
  // Guards the two tests below from passing vacuously if the AST walk silently stops matching.
  const detected = findModulesWithTopLevelSideEffects().map((entry) => entry.file);
  assert.ok(
    detected.includes('src/pricing/index.ts'),
    `expected src/pricing/index.ts to be detected as side-effecting, got ${JSON.stringify(detected)}`
  );
});

test('the scan detects a top-level call in a variable initializer, not just expression statements', () => {
  // Regression guard for the original defect: the scan only looked for `ExpressionStatement`, so
  // `const SALT = randomBytes(16)` was invisible to it. This fixture is the shape that must fail.
  const fixture = findSideEffectsInSource(
    "import { randomBytes } from 'node:crypto';\n" +
      'const SALT = randomBytes(16);\n' +
      'export function label() { return SALT.length; }\n'
  );
  assert.equal(
    fixture.length,
    1,
    `a top-level call in a variable initializer must be reported exactly once, got ${JSON.stringify(fixture)}`
  );
  assert.match(
    fixture[0],
    /randomBytes\(\)/u,
    'the report must name the escaping call so the allowlist entry can be traced back to it'
  );
});

test('the scan does not report inert top-level declarations', () => {
  // The mirror image of the fixture above. Each of these runs at import time but cannot escape, and
  // reporting them would be noise that trains maintainers to ignore the allowlist. The
  // `Object.freeze` case is load-bearing: `EMPTY_STATE_SNAPSHOT` in GuardCore.ts is built that way,
  // and flagging it would force the library's largest module into the allowlist.
  const fixture = findSideEffectsInSource(
    'const LIMIT = 10;\n' +
      'const NAME = "x";\n' +
      'const TABLE = new Map<string, number>();\n' +
      'const SNAPSHOT = Object.freeze({ a: 1 });\n' +
      'function build() { return { a: 1 }; }\n' +
      'const BUILT = build();\n' +
      'export { LIMIT, NAME, TABLE, SNAPSHOT, BUILT };\n'
  );
  assert.deepEqual(fixture, [], 'inert top-level declarations must not be reported');
});

test('the scan reports a member call that is not whitelisted as pure', () => {
  // A bare `randomBytes(16)` is caught above. This pins that a global which is *not* whitelisted as
  // pure is caught even when it is spelled as a member call, which is the shape a future
  // `process.emitWarning(...)` or `Date.now()` dependency would take.
  const fixture = findSideEffectsInSource('const START = Date.now();\nexport { START };\n');
  assert.equal(fixture.length, 1, `expected Date.now() to be reported, got ${JSON.stringify(fixture)}`);
  assert.match(fixture[0], /Date\.now\(\)/u);
});

test('the scan reaches an observable call nested inside a larger initializer', () => {
  // Checking only `isCallExpression(initializer)` sees none of these, because the initializer is a
  // conditional, an array, or an object literal and the escaping call is somewhere inside it. Each
  // shape is one keyword away from a real import-time effect, so all of them have to be caught.
  const nested = [
    'const KEY = process.env.CI ? randomBytes(16) : "dev";\n',
    'const LIST = [randomBytes(16)];\n',
    'const NESTED = { salt: randomBytes(16) };\n',
  ];

  for (const source of nested) {
    const fixture = findSideEffectsInSource(source);
    assert.equal(
      fixture.length,
      1,
      `expected exactly one reason for ${JSON.stringify(source)}, got ${JSON.stringify(fixture)}`
    );
    assert.match(fixture[0], /randomBytes\(\)/u, `the reason must name the escaping call for ${source}`);
  }

  // Arguments are evaluated before the call they belong to, so an observable call nested in an
  // argument is reported in addition to the enclosing call, not instead of it.
  const wrapped = findSideEffectsInSource('const WRAPPED = wrap(randomBytes(16));\n');
  assert.equal(wrapped.length, 2, `both calls escape, got ${JSON.stringify(wrapped)}`);
  assert.ok(
    wrapped.some((reason) => /randomBytes\(\)/u.test(reason)) && wrapped.some((reason) => /wrap\(\)/u.test(reason)),
    `the nested and the enclosing call must both be named, got ${JSON.stringify(wrapped)}`
  );
});

test('the scan follows a local helper instead of trusting that it is local', () => {
  // `const SALT = makeSalt();` looks identical to the inert `build()` fixture above, and trusting
  // every same-file name is exactly how an impure helper would slip through. The helper's own body
  // has to be checked, including transitively.
  const direct = findSideEffectsInSource(
    "import { randomBytes } from 'node:crypto';\n" +
      'function makeSalt() { return randomBytes(16); }\n' +
      'const SALT = makeSalt();\n' +
      'export { SALT };\n'
  );
  assert.equal(
    direct.length,
    1,
    `a local helper that calls randomBytes must be reported, got ${JSON.stringify(direct)}`
  );
  assert.match(direct[0], /randomBytes\(\)/u);

  // Reached through a second hop, so the check cannot be a single level deep.
  const transitive = findSideEffectsInSource(
    "import { randomBytes } from 'node:crypto';\n" +
      'function makeSalt() { return randomBytes(16); }\n' +
      'function saltPair() { return [makeSalt(), makeSalt()]; }\n' +
      'const SALT = saltPair();\n' +
      'export { SALT };\n'
  );
  assert.equal(
    transitive.length,
    1,
    `the check must follow a helper chain, got ${JSON.stringify(transitive)}`
  );
  assert.match(transitive[0], /randomBytes\(\)/u);
});

test('the scan does not report a callback that is only defined at import time', () => {
  // The mirror of the two tests above, and the reason the walk stops at function boundaries. A
  // handler that has merely been declared has not run, so reporting it would flag essentially every
  // module in a codebase and train maintainers to ignore the allowlist. A pure helper is still fine.
  const fixture = findSideEffectsInSource(
    "import { randomBytes } from 'node:crypto';\n" +
      'export function onEvent() { return randomBytes(16); }\n' +
      'const HANDLER = () => randomBytes(16);\n' +
      'function build() { return { a: 1 }; }\n' +
      'const BUILT = build();\n' +
      'export { HANDLER, BUILT };\n'
  );
  assert.deepEqual(fixture, [], 'deferred callbacks and pure helpers must not be reported');
});

test('the scan keeps reporting the pure-looking builtins used by the real pricing registry', () => {
  // `src/pricing/index.ts` builds a Map and sorts an array at import time. Neither can escape, but
  // the receiver of `.map(...)` is an array literal the scan cannot prove anything about, so both are
  // reported. That is the intended bias: the module is allowlisted for a real reason anyway, and a
  // false positive costs one line while a false negative costs a silently dropped salt.
  const detected = findModulesWithTopLevelSideEffects();
  const pricing = detected.find((entry) => entry.file === 'src/pricing/index.ts');
  assert.ok(pricing, 'src/pricing/index.ts must be detected');
  assert.ok(
    pricing.reasons.includes('top-level expression statement'),
    'the genuine import-time warn must still be reported'
  );
});

test('every module with an import-time side effect is covered by the sideEffects allowlist', () => {
  const declared = new Set(packageJson.sideEffects);

  for (const { file, reasons } of findModulesWithTopLevelSideEffects()) {
    for (const format of BUILT_FORMATS) {
      const specifier = distSpecifier(file, format);
      assert.ok(
        declared.has(specifier),
        `${file} performs a side effect at import time (${reasons.join('; ')}), so "${specifier}" must be ` +
          'listed in package.json "sideEffects" or bundlers may drop it.'
      );
    }
  }
});

test('sideEffects: false is rejected while any module has an import-time side effect', () => {
  // The headline promise. If the manifest ever claims the package is side-effect free while the scan
  // still finds work at import time, bundlers are authorized to delete it in exactly the production
  // bundles where losing it matters, and the un-bundled build still behaves correctly.
  const detected = findModulesWithTopLevelSideEffects();
  if (packageJson.sideEffects === false) {
    assert.equal(
      detected.length,
      0,
      `package.json declares "sideEffects": false, but ${detected
        .map((entry) => entry.file)
        .join(', ')} ${detected.length === 1 ? 'performs' : 'perform'} work at import time. Declare them in a ` +
        '"sideEffects" array instead.'
    );
  }
});

test('every sideEffects entry resolves to a file the build actually emits', () => {
  for (const specifier of packageJson.sideEffects) {
    assert.ok(
      specifier.startsWith('./dist/'),
      `"sideEffects" entries must be rooted at ./dist/ so they match the published layout, got ${specifier}`
    );
    assert.ok(
      existsSync(join(root, specifier)),
      `"sideEffects" lists ${specifier}, which the build does not emit. A stale entry silently disables ` +
        'tree-shaking hints for the whole package and hides the next real side effect.'
    );
  }
});

test('the built pricing module emits its freshness notice on import exactly when the registry is stale', () => {
  for (const format of BUILT_FORMATS) {
    const { emittedNotice, registryStale } = importInChildProcess(format);

    // The notice and the exported predicate are driven by the same threshold, so the relationship
    // holds whether or not the snapshot is currently old. Asserting the relationship instead of a
    // hardcoded warning keeps the test honest across future price-refresh commits.
    assert.equal(
      emittedNotice,
      registryStale,
      `dist/${format}/pricing/index.js must warn on import if and only if the built-in registry is stale`
    );
  }
});

/**
 * Imports a built pricing entry point in a child process and reports both observable outcomes.
 *
 * A child process is required because module state and `console.warn` capture are both
 * process-global: the suite's own pricing tests already trigger the notice, and
 * `builtinNoticeEmitted` latches after the first emission, so an in-process import could not
 * distinguish "warning was suppressed" from "warning was already sent".
 */
function importInChildProcess(format) {
  const specifier = distSpecifier('src/pricing/index.ts', format);
  const target = join(root, specifier.replace(/^\.\//u, ''));

  const script =
    format === 'esm'
      ? `import(${JSON.stringify(pathToFileURL(target).href)}).then(report, fail);`
      : `const { createRequire } = require('node:module');
         const mod = createRequire(${JSON.stringify(join(root, 'noop.js'))})(${JSON.stringify(target)});
         report(mod);`;

  const scriptWithReport = `
    function report(mod) {
      if (typeof mod.isBuiltInPricingStale !== 'function') throw new Error('isBuiltInPricingStale is not exported');
      process.stdout.write(JSON.stringify({ registryStale: mod.isBuiltInPricingStale() }));
    }
    function fail(error) {
      process.stderr.write(String(error && error.stack ? error.stack : error));
      process.exit(1);
    }
    ${script}
  `;

  const child = spawnSync(process.execPath, ['-e', scriptWithReport], { encoding: 'utf8', cwd: root });
  assert.equal(child.status, 0, `importing dist/${format}/pricing/index.js failed:\n${child.stderr}`);

  return {
    emittedNotice: /built-in pricing entries are older than/u.test(child.stderr),
    registryStale: JSON.parse(child.stdout).registryStale,
  };
}
