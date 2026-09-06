const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const repo = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "src/app/page.tsx"), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
})(ast);
function compile(text) {
  return ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
}
function harness(extra = {}, external = {}) {
  const globals = { console, Response, Request, URL, Blob, FormData, Headers, Buffer, Map, Set,
    crypto: require("node:crypto").webcrypto, process: { env: {} },
    fetch: async () => { throw Error("Network is forbidden in regression tests"); }, ...extra };
  const cache = new Map();
  function load(file) {
    const full = path.resolve(repo, file);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} };
    cache.set(full, module);
    function localRequire(name) {
      if (Object.hasOwn(external, name)) return external[name];
      let resolved;
      if (name.startsWith("@/")) resolved = path.join(repo, "src", name.slice(2));
      else if (name.startsWith(".")) resolved = path.resolve(path.dirname(full), name);
      else throw Error("External module forbidden: " + name);
      if (!path.extname(resolved)) resolved += ".ts";
      return load(resolved);
    }
    vm.runInNewContext(compile(fs.readFileSync(full, "utf8")),
      { ...globals, module, exports: module.exports, require: localRequire }, { filename: full });
    return module.exports;
  }
  function functions(names, context = {}, file) {
    let available = declarations;
    if (file) {
      const text = fs.readFileSync(path.join(repo, file), "utf8");
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      available = new Map();
      (function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name) available.set(node.name.text, node.getText(tree));
        ts.forEachChild(node, visit);
      })(tree);
    }
    const sandbox = { ...globals, exports: {}, require: name => {
      if (Object.hasOwn(external, name)) return external[name];
      throw Error("External module forbidden: " + name);
    }, ...context };
    const code = names.map(name => {
      if (!available.has(name)) throw Error("Missing source function: " + name);
      return available.get(name);
    }).join("\n");
    vm.runInNewContext(compile(code + "\nglobalThis.fns = {" + names.join(",") + "};"), sandbox);
    return sandbox.fns;
  }
  return { load, functions };
}
function database(handler) {
  return { from(table) {
    const op = { table, method: "select", filters: {}, order: [] };
    const query = {
      select() { return query; },
      eq(k, v) { op.filters[k] = v; return query; },
      is(k, v) { op.filters[k] = v; return query; },
      in(k, v) { op.filters[k] = v; return query; },
      order(k) { op.order.push(k); return query; },
      range(from, to) { op.range = [from, to]; return query; },
      limit(n) { op.limit = n; return query; },
      maybeSingle() { op.single = true; return query; },
      single() { op.single = true; return query; },
      upsert(value) { op.method = "upsert"; op.value = value; return query; },
      update(value) { op.method = "update"; op.value = value; return query; },
      insert(value) { op.method = "insert"; op.value = value; return query; },
      delete() { op.method = "delete"; return query; },
      then(ok, fail) { return Promise.resolve().then(() => handler(op)).then(ok, fail); },
    };
    return query;
  }};
}
const identity = value => value;
const noop = () => {};
module.exports = { harness, database, identity, noop, repo, source, declarations };
