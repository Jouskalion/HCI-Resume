import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the real event handlers and save function. Only transport/rendering are stubbed.
const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .split("loading('正在打开简序…');")[0];

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function resume(id) {
  const record = { id, title: id, status: 'draft', content: { profile: { name: id, summary: '原内容' } }, sourceText: '原始简历', warnings: [], busy: false };
  record.savedSignature = JSON.stringify({ title: record.title, content: record.content, warnings: record.warnings });
  return record;
}

function browserHarness() {
  const handlers = new Map(), nodes = new Map(), messages = [], navigations = [];
  const node = () => ({ innerHTML: '', dataset: {}, disabled: false, classList: { contains: () => false }, addEventListener() {} });
  const context = vm.createContext({
    structuredClone, FormData, URL, URLSearchParams, console,
    document: {
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
      querySelectorAll() { return []; },
      addEventListener(name, handler) { handlers.set(name, handler); },
    },
    window: { addEventListener() {} },
    testToast(message) { messages.push(message); },
    testRender() {},
    testNavigate: async path => { navigations.push(path); },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    toast = testToast; renderImport = testRender; renderEditor = testRender;
    showPublishSuccess = testRender; editorDirtyStatus = testRender; closeModal = testRender;
    navigate = testNavigate;
    globalThis.setEditor = value => { editor = value; };
    globalThis.setVersion = value => { routeVersion = value; };
    globalThis.setUser = value => { user = value; };
    globalThis.setImport = value => { importState = value; };
    globalThis.getState = () => ({ editor, importState, routeVersion, user, dirty: dirty() });
    globalThis.setApi = value => { api = value; };
  `, context);
  context.setUser({ id: 'user-A' });
  return { context, handlers, messages, navigations };
}

test('保存请求阻塞后切换编辑对象，不会发布另一份简历或覆盖其状态', async () => {
  const { context } = browserHarness();
  const waiting = deferred(), requests = [], first = resume('A'), second = resume('B');
  context.setEditor(first);
  context.setApi(async (path, options) => {
    requests.push({ path, method: options.method });
    if (requests.length === 1) return waiting.promise;
    return { resume: { status: 'published', slug: 'A-public' } };
  });
  const saving = context.saveEditor(true);
  context.setEditor(second);
  context.setVersion(2);
  waiting.resolve({ resume: { status: 'draft', slug: null } });
  await saving;
  assert.ok(requests.every(request => request.path === '/api/resumes/A' || request.path === '/api/resumes/A/publish'));
  assert.equal(context.getState().editor, second);
  assert.equal(second.status, 'draft');
  assert.equal(second.slug, undefined);
  assert.equal(second.content.profile.summary, '原内容');
  assert.equal(first.busy, false);
  assert.equal(second.busy, false);
});

test('保存只确认发出时的快照，等待期间新增内容不会被覆盖或误标为已保存', async () => {
  const { context } = browserHarness();
  const waiting = deferred(), record = resume('A');
  context.setEditor(record);
  context.setApi(() => waiting.promise);
  const saving = context.saveEditor();
  record.content.profile.summary = '请求发出之后的新编辑';
  waiting.resolve({ resume: { status: 'draft', slug: null } });
  await saving;
  assert.equal(record.content.profile.summary, '请求发出之后的新编辑');
  assert.equal(context.getState().dirty, true);
  assert.equal(record.busy, false);
});

test('导入等待期间离开并编辑其他草稿，完成后保留新编辑且不强制跳转', async () => {
  const { context, handlers, navigations } = browserHarness();
  const waiting = deferred(), requests = [];
  const original = { tab: 'text', text: '待解析的完整原始简历', file: null, useAI: false, busy: false, error: '' };
  context.setImport(original);
  context.setApi(async (path, options) => {
    requests.push({ path, body: options.body });
    if (path === '/api/import') return waiting.promise;
    return { resume: { id: 'imported-C' } };
  });
  const importing = handlers.get('submit')({ target: { id: 'import-form' }, preventDefault() {} });
  context.setVersion(2);
  const other = resume('B');
  other.content.profile.summary = '不能丢失的未保存编辑';
  context.setEditor(other);
  waiting.resolve({ content: { profile: { name: '导入人' } }, sourceText: original.text, warnings: [] });
  await importing;
  assert.equal(context.getState().editor, other);
  assert.equal(other.content.profile.summary, '不能丢失的未保存编辑');
  assert.equal(context.getState().dirty, true);
  assert.deepEqual(navigations, []);
  assert.equal(original.busy, false);
  assert.equal(requests[1].path, '/api/resumes');
  assert.equal(requests[1].body.expectedUserId, 'user-A');
});

test('导入等待期间切换账号，不会把原账号的简历创建到新账号', async () => {
  const { context, handlers, navigations } = browserHarness();
  const waiting = deferred(), requests = [];
  context.setImport({ tab: 'text', text: 'A账号的私人简历原文', file: null, useAI: false, busy: false, error: '' });
  context.setApi(async path => { requests.push(path); return waiting.promise; });
  const importing = handlers.get('submit')({ target: { id: 'import-form' }, preventDefault() {} });
  context.setVersion(2);
  context.setUser({ id: 'user-B' });
  waiting.resolve({ content: { profile: { name: '原账号求职者' } }, sourceText: 'A账号的私人简历原文', warnings: [] });
  await importing;
  assert.deepEqual(requests, ['/api/import']);
  assert.deepEqual(navigations, []);
  assert.equal(context.getState().importState.busy, false);
});

test('导入失败后保留原文，可修改后重新提交', async () => {
  const { context, handlers } = browserHarness();
  const original = { tab: 'text', text: '不能丢失的简历原文', file: null, useAI: false, busy: false, error: '' };
  context.setImport(original);
  context.setApi(async () => { throw new Error('测试网络失败'); });
  await handlers.get('submit')({ target: { id: 'import-form' }, preventDefault() {} });
  assert.equal(context.getState().importState, original);
  assert.equal(original.text, '不能丢失的简历原文');
  assert.equal(original.error, '测试网络失败');
  assert.equal(original.busy, false);
});
