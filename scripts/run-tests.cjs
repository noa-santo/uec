const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function requireTs(filePath) {
  const fullPath = path.resolve(filePath);
  const code = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const m = { exports: {} };
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText);
  const customRequire = (id) => {
    if (id.startsWith('.')) return requireTs(path.resolve(path.dirname(fullPath), id + (id.endsWith('.ts') ? '' : '.ts')));
    if (id === 'react-native') return { Platform: { OS: 'web' } };
    if (id === '@react-native-async-storage/async-storage') return { default: {} };
    if (id === 'expo-secure-store') return {};
    return require(id);
  };
  fn(customRequire, m, m.exports, fullPath, path.dirname(fullPath));
  return m.exports;
}

requireTs('lib/alias_rules.test.ts');
