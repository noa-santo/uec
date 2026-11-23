const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// In-memory stand-ins for the storage APIs used by the pure lib modules.
const backing = new Map();
const asyncStorage = {
  getItem: async (key) => (backing.has(key) ? backing.get(key) : null),
  setItem: async (key, value) => {
    if (global.__quotaFail) {
      const error = new Error('Quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    backing.set(key, String(value));
  },
  removeItem: async (key) => { backing.delete(key); },
  getAllKeys: async () => [...backing.keys()],
};
const secureStore = {
  getItemAsync: async (key) => (backing.has(`secure:${key}`) ? backing.get(`secure:${key}`) : null),
  setItemAsync: async (key, value) => { backing.set(`secure:${key}`, String(value)); },
  deleteItemAsync: async (key) => { backing.delete(`secure:${key}`); },
};

function requireTs(filePath) {
  const fullPath = path.resolve(filePath);
  const code = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const m = { exports: {} };
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText);
  const customRequire = (id) => {
    if (id.startsWith('.')) return requireTs(path.resolve(path.dirname(fullPath), id + (id.endsWith('.ts') ? '' : '.ts')));
    if (id === 'react-native') return { Platform: { OS: 'web' } };
    if (id === '@react-native-async-storage/async-storage') return { __esModule: true, default: asyncStorage };
    if (id === 'expo-secure-store') return secureStore;
    return require(id);
  };
  fn(customRequire, m, m.exports, fullPath, path.dirname(fullPath));
  return m.exports;
}

requireTs('lib/alias_rules.test.ts');
requireTs('lib/email_utils.test.ts');
requireTs('lib/inbox_folders.test.ts');
requireTs('lib/storage.test.ts');
