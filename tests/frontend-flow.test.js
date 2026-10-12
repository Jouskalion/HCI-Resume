import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { emptyContent, fields, sections, newRecord } from '../public/data.js';
import { esc, icon } from '../public/resume.js';
import * as reviewHelpers from '../public/review.js';

// Execute the real event handlers and save function. Only transport/rendering are stubbed.
const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .split("loading('正在打开简序…');")[0];
const autosaveSource = (await readFile(new URL('../public/autosave.js', import.meta.url), 'utf8')).replace(/^export /gm, '');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function fakeClock() {
  let now = 0, sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay = 0) { const id = ++sequence; tasks.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, task] = next;
        tasks.delete(id); now = task.at; task.callback();
      }
      now = end;
    },
    pending: () => tasks.size,
  };
}

async function settle() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

function resume(id) {
  const content = emptyContent();
  Object.assign(content.profile, { name: id, summary: '原内容' });
  const record = { id, title: id, status: 'draft', content, sourceText: '原始简历', warnings: [], review: { version: 1, fields: [], confirmations: [] }, busy: false };
  record.savedSignature = JSON.stringify({ title: record.title, content: record.content, warnings: record.warnings, confirmations: [] });
  return record;
}

function browserHarness({ mobile = false, realReviewFocus = false } = {}) {
  const handlers = new Map(), windowHandlers = new Map(), nodes = new Map(), collections = new Map(), messages = [], navigations = [], focused = [], clock = fakeClock();
  const mediaHandlers = new Map(), domFocus = [], scrolls = [], renders = [];
  const media = { matches: mobile, addEventListener(name, handler) { mediaHandlers.set(name, handler); } };
  const node = () => ({ innerHTML: '', dataset: {}, attributes: {}, disabled: false, classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, addEventListener() {}, focus() { domFocus.push(this); context.document.activeElement = this; }, scrollTo() {}, scrollIntoView(options) { scrolls.push({ node: this, options }); }, setAttribute(name, value) { this.attributes[name] = value; }, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } });
  const context = vm.createContext({
    structuredClone, FormData, URL, URLSearchParams, console, fields, sections, newRecord, esc, icon, ...reviewHelpers,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    requestAnimationFrame: callback => callback(),
    document: {
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
      querySelectorAll(selector) { return collections.get(selector) || []; },
      addEventListener(name, handler) { handlers.set(name, handler); },
    },
    window: { addEventListener(name, handler) { windowHandlers.set(name, handler); }, matchMedia: () => media, scrollTo() {} },
    history: { pushState(_state, _unused, path) { navigations.push(path); }, replaceState(_state, _unused, path) { navigations.push(path); } },
    testToast(message) { messages.push(message); },
    testRender() {},
    testEditorRender() { renders.push(true); },
    testNavigate: async path => { navigations.push(path); },
    testFocus: selection => { focused.push(structuredClone(selection)); },
  });
  vm.runInContext(autosaveSource, context);
  vm.runInContext(source, context);
  vm.runInContext(`
    toast = testToast; renderImport = testRender; renderEditor = testEditorRender;
    showPublishSuccess = testRender; editorDirtyStatus = testRender; closeModal = testRender;
    const realNavigate = navigate;
    navigate = testNavigate;
    globalThis.enableNavigation = () => { navigate = realNavigate; renderRoute = testRender; };
    const realFocusReview = focusReview;
    focusReview = selection => { activeReview = selection; testFocus(selection); };
    globalThis.enableReviewFocus = () => { focusReview = realFocusReview; };
    globalThis.setEditor = value => { editor = value; };
    globalThis.setEditorSection = value => { editorSection = value; };
    globalThis.setVersion = value => { routeVersion = value; };
    globalThis.setUser = value => { user = value; };
    globalThis.setImport = value => { importState = value; };
    globalThis.getState = () => ({ editor, importState, routeVersion, user, activeReview, reviewFilter, editorSection, proofTab, mobileEditorPanel, dirty: dirty() });
    globalThis.setApi = value => { api = value; };
  `, context);
  context.setUser({ id: 'user-A' });
  if (realReviewFocus) context.enableReviewFocus();
  const resize = matches => { media.matches = matches; mediaHandlers.get('change')?.({ matches }); };
  return { context, handlers, windowHandlers, messages, navigations, focused, clock, nodes, collections, node, domFocus, scrolls, renders, resize };
}

function inputField(handlers, section, field, value, index = 0) {
  handlers.get('input')({ target: { dataset: { section, field, index: String(index) }, value } });
}

function clickAction(handlers, action, dataset = {}) {
  const button = { dataset: { action, ...dataset }, disabled: false };
  return handlers.get('click')({ target: { closest: selector => selector === '[data-action]' ? button : null } });
}

function educationReviewFixture() {
  const record = resume('A');
  record.sourceText = '杭州电子科技大学 本科 硕士研究生';
  // Same institution, reversed visual order: handlers must address record IDs.
  record.content.education = [
    { id: 'edu-second', school: '杭州电子科技大学', level: '硕士研究生' },
    { id: 'edu-first', school: '杭州电子科技大学', level: '本科' },
  ];
  record.review.fields = record.content.education.flatMap(row => ['school', 'level'].map(field => ({
    section: 'education', recordId: row.id, field, value: row[field], ranges: [{ start: 0, end: 3 }], match: 'exact',
  })));
  return record;
}

test('保存请求阻塞后切换编辑对象，不会发布另一份简历或覆盖其状态', async () => {
  const { context } = browserHarness();
  const waiting = deferred(), requests = [], first = resume('A'), second = resume('B');
  first.content.profile.summary = '等待保存的 A 草稿';
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
  record.content.profile.summary = '请求发出时的内容';
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

test('字段确认会使草稿变更，保存成功后保留核对证据并恢复已保存状态', async () => {
  const { context } = browserHarness(), record = resume('A');
  const selected = { section: 'profile', recordId: 'profile', field: 'name' };
  record.review.fields = [{ ...selected, value: 'A', ranges: [{ start: 0, end: 1 }] }];
  context.setEditor(record);
  assert.equal(context.getState().dirty, false);
  reviewHelpers.confirmField(record, selected);
  assert.equal(context.getState().dirty, true, '仅标记核对完成也需要保存');
  let sent;
  context.setApi(async (_path, options) => {
    sent = structuredClone(options.body);
    return { resume: { status: 'draft', slug: null } };
  });
  await context.saveEditor();
  assert.equal(sent.review.version, 1);
  assert.deepEqual(sent.review.confirmations, record.review.confirmations);
  assert.deepEqual(record.review.fields, [{ ...selected, value: 'A', ranges: [{ start: 0, end: 1 }] }], '保存完成不得清空已有原文证据');
  assert.equal(context.getState().dirty, false);
  assert.equal(reviewHelpers.getFieldReview(record, selected).confirmed, true);
});

test('保存核对快照后继续修改确认，不污染请求也不会丢失新确认', async () => {
  const { context } = browserHarness(), record = resume('A'), waiting = deferred();
  const name = { section: 'profile', recordId: 'profile', field: 'name' };
  const summary = { section: 'profile', recordId: 'profile', field: 'summary' };
  reviewHelpers.confirmField(record, name);
  context.setEditor(record);
  let sent;
  context.setApi((_path, options) => { sent = options.body; return waiting.promise; });
  const saving = context.saveEditor();
  reviewHelpers.invalidateField(record, name);
  reviewHelpers.confirmField(record, summary);
  waiting.resolve({ resume: { status: 'draft', slug: null } });
  await saving;
  assert.deepEqual(sent.review.confirmations, [{ ...name, value: 'A' }]);
  assert.deepEqual(record.review.confirmations, [{ ...summary, value: '原内容' }]);
  assert.equal(context.getState().dirty, true);
});

test('保存失败保留字段核对状态和未保存标记，可以继续重试', async () => {
  const { context, messages } = browserHarness(), record = resume('A');
  const name = { section: 'profile', recordId: 'profile', field: 'name' };
  context.setEditor(record);
  reviewHelpers.confirmField(record, name);
  context.setApi(async () => { throw new Error('测试保存失败'); });
  await context.saveEditor();
  assert.equal(reviewHelpers.getFieldReview(record, name).confirmed, true);
  assert.equal(context.getState().dirty, true);
  assert.equal(record.busy, false);
  assert.ok(messages.includes('测试保存失败'));
});

test('真实输入与下拉事件只作废当前经历的确认，改回原值仍需重新核对', () => {
  const { context, handlers } = browserHarness(), record = resume('A');
  record.content.education = [{ id: 'edu-1', level: '本科' }, { id: 'edu-2', level: '本科' }];
  record.content.experience = [{ id: 'exp-1', type: 'internship' }, { id: 'exp-2', type: 'work' }];
  const selections = [
    { section: 'education', recordId: 'edu-1', field: 'level' },
    { section: 'education', recordId: 'edu-2', field: 'level' },
    { section: 'experience', recordId: 'exp-1', field: 'type' },
    { section: 'experience', recordId: 'exp-2', field: 'type' },
  ];
  for (const selected of selections) reviewHelpers.confirmField(record, selected);
  context.setEditor(record);
  const input = { dataset: { section: 'education', index: '0', field: 'level' }, value: '硕士研究生' };
  handlers.get('input')({ target: input });
  input.value = '本科';
  handlers.get('input')({ target: input });
  const select = { tagName: 'SELECT', dataset: { section: 'experience', index: '0', field: 'type' }, value: 'work' };
  handlers.get('change')({ target: select });
  select.value = 'internship';
  handlers.get('change')({ target: select });
  assert.equal(reviewHelpers.getFieldReview(record, selections[0]).confirmed, false);
  assert.equal(reviewHelpers.getFieldReview(record, selections[1]).confirmed, true);
  assert.equal(reviewHelpers.getFieldReview(record, selections[2]).confirmed, false);
  assert.equal(reviewHelpers.getFieldReview(record, selections[3]).confirmed, true);
});

test('删除经历处理器仅清理该条提醒和确认，取消删除和另一段经历均不受影响', async () => {
  const { context, handlers } = browserHarness(), record = resume('A');
  record.content.education = [{ id: 'edu-1', school: '杭州电子科技大学', level: '本科' }, { id: 'edu-2', school: '浙江大学', level: '硕士研究生' }];
  const first = { section: 'education', recordId: 'edu-1', field: 'level' };
  const second = { section: 'education', recordId: 'edu-2', field: 'level' };
  const firstWarning = { ...first, message: '请核对第一段学历' };
  const secondWarning = { ...second, message: '请核对第二段学历' };
  const generalWarning = { section: 'education', field: '', message: '请检查是否遗漏教育经历' };
  record.warnings = [firstWarning, secondWarning, generalWarning];
  reviewHelpers.confirmField(record, first);
  reviewHelpers.confirmField(record, second);
  context.setEditor(record);
  const button = { dataset: { action: 'delete-record', section: 'education', index: '0' }, disabled: false };
  const event = { target: { closest: selector => selector === '[data-action]' ? button : null } };
  context.confirmDialog = async () => false;
  await handlers.get('click')(event);
  assert.equal(record.content.education.length, 2);
  assert.equal(record.warnings.length, 3);
  assert.equal(record.review.confirmations.length, 2);
  context.confirmDialog = async () => true;
  await handlers.get('click')(event);
  assert.deepEqual(record.content.education.map(row => row.id), ['edu-2']);
  assert.deepEqual(record.warnings, [secondWarning, generalWarning]);
  assert.deepEqual(record.review.confirmations, [{ ...second, value: '硕士研究生' }]);
  assert.deepEqual(context.warningList(), [generalWarning], '已删除条目不再形成无法定位的发布提醒');
  assert.equal(context.getState().dirty, true);
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
  const importedReview = { version: 1, fields: [{ section: 'profile', recordId: 'profile', field: 'name', value: '导入人', ranges: [] }], confirmations: [] };
  waiting.resolve({ content: { profile: { name: '导入人' } }, sourceText: original.text, warnings: [], review: importedReview });
  await importing;
  assert.equal(context.getState().editor, other);
  assert.equal(other.content.profile.summary, '不能丢失的未保存编辑');
  assert.equal(context.getState().dirty, true);
  assert.deepEqual(navigations, []);
  assert.equal(original.busy, false);
  assert.equal(requests[1].path, '/api/resumes');
  assert.equal(requests[1].body.expectedUserId, 'user-A');
  assert.deepEqual(requests[1].body.review, importedReview, '导入结果的字段证据必须随私人草稿持久化');
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

test('真实输入事件合并连续编辑，停止输入后自动保存最新草稿且不发布', async () => {
  const { context, handlers, clock } = browserHarness(), record = resume('A'), requests = [];
  record.status = 'published';
  context.setEditor(record);
  context.setApi(async (path, options) => {
    requests.push({ path, ...structuredClone(options) });
    return { resume: { status: 'published', slug: 'A-public', hasUnpublishedChanges: true } };
  });
  inputField(handlers, 'profile', 'summary', '第一次编辑');
  clock.advance(600);
  assert.equal(requests.length, 0);
  inputField(handlers, 'profile', 'summary', '最后一次编辑');
  clock.advance(600);
  assert.equal(requests.length, 0, '后续输入应重新等待，而非保存过时的中间内容');
  clock.advance(500);
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/resumes/A');
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].body.content.profile.summary, '最后一次编辑');
  assert.equal(context.getState().dirty, false);
  assert.equal(record.hasUnpublishedChanges, true);
  assert.equal(record.busy, false, '自动保存不锁住编辑器');
  assert.equal(clock.pending(), 0);
});

test('自动保存等待响应时继续输入会串行保存下一份快照，不丢失最新编辑', async () => {
  const { context, handlers, clock } = browserHarness(), record = resume('A'), first = deferred(), requests = [];
  context.setEditor(record);
  context.setApi((path, options) => {
    requests.push({ path, ...structuredClone(options) });
    return requests.length === 1 ? first.promise : Promise.resolve({ resume: { status: 'draft' } });
  });
  inputField(handlers, 'profile', 'summary', '正在保存的第一版');
  clock.advance(1000);
  assert.equal(requests.length, 1);
  assert.equal(record.busy, false);
  inputField(handlers, 'profile', 'summary', '请求期间编辑的第二版');
  clock.advance(1000);
  assert.equal(requests.length, 1, '前一请求返回前不发送另一 PUT');
  first.resolve({ resume: { status: 'draft' } });
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.content.profile.summary, '正在保存的第一版');
  assert.equal(requests[1].body.content.profile.summary, '请求期间编辑的第二版');
  assert.equal(record.content.profile.summary, '请求期间编辑的第二版');
  assert.equal(context.getState().dirty, false);
  assert.equal(clock.pending(), 0);
});

test('自动保存失败保留本地修改，停止后台重试并允许点击保存重试最新内容', async () => {
  const { context, handlers, clock } = browserHarness(), record = resume('A'), requests = [];
  context.setEditor(record);
  context.setApi(async (path, options) => {
    requests.push({ path, ...structuredClone(options) });
    if (requests.length === 1) throw new Error('网络暂时不可用');
    return { resume: { status: 'draft' } };
  });
  inputField(handlers, 'profile', 'summary', '断网前编辑');
  clock.advance(1000);
  await settle();
  assert.equal(context.getState().dirty, true);
  assert.equal(record.content.profile.summary, '断网前编辑');
  inputField(handlers, 'profile', 'summary', '保存失败后继续编辑');
  clock.advance(10000);
  await settle();
  assert.equal(requests.length, 1, '错误状态应等待用户重试，不发送循环请求');
  await clickAction(handlers, 'save');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.content.profile.summary, '保存失败后继续编辑');
  assert.equal(context.getState().dirty, false);
  assert.equal(record.busy, false);
  assert.equal(clock.pending(), 0);
});

test('离开前释放待执行自动保存，其他简历的编辑不会串入原简历请求', async () => {
  const { context, handlers, clock } = browserHarness(), first = resume('A'), second = resume('B'), requests = [];
  context.setApi(async (path, options) => {
    requests.push({ path, ...structuredClone(options) });
    return { resume: { status: 'draft' } };
  });
  context.setEditor(first);
  inputField(handlers, 'profile', 'summary', '已明确放弃的 A 修改');
  context.disposeAutosave();
  context.setVersion(2);
  context.setEditor(second);
  inputField(handlers, 'profile', 'summary', 'B 的私人草稿');
  clock.advance(1000);
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/resumes/B');
  assert.equal(requests[0].body.content.profile.summary, 'B 的私人草稿');
  assert.equal(context.getState().editor, second);
  assert.equal(context.getState().dirty, false);
});

test('确认并下一项按经历 ID 确认，跳到紧邻未核对字段并自动保存确认', async () => {
  const { context, handlers, clock, focused } = browserHarness(), record = educationReviewFixture(), requests = [];
  context.setEditor(record);
  context.setApi(async (_path, options) => { requests.push(structuredClone(options.body)); return { resume: { status: 'draft' } }; });
  await clickAction(handlers, 'confirm-next', { reviewSection: 'education', reviewRecord: 'edu-second', reviewField: 'school' });
  assert.equal(reviewHelpers.getFieldReview(record, { section: 'education', recordId: 'edu-second', field: 'school' }).confirmed, true);
  assert.equal(reviewHelpers.getFieldReview(record, { section: 'education', recordId: 'edu-first', field: 'school' }).confirmed, false);
  assert.equal(focused.at(-1).recordId, 'edu-second');
  assert.equal(focused.at(-1).field, 'level', '当前项移出清单后不应跳过下一字段');
  clock.advance(1000);
  await settle();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].review.confirmations, [{ section: 'education', recordId: 'edu-second', field: 'school', value: '杭州电子科技大学' }]);
  assert.equal(context.getState().dirty, false);
});

test('真实筛选事件限制下一项范围，确认提醒后不会跳入其他普通字段', async () => {
  const { context, handlers, focused, messages } = browserHarness(), record = educationReviewFixture();
  record.warnings = [{ section: 'education', recordId: 'edu-first', field: 'level', message: '请检查学历' }];
  context.setEditor(record);
  handlers.get('change')({ target: { id: 'review-filter', dataset: {}, value: 'warning' } });
  assert.equal(context.getState().reviewFilter, 'warning');
  await clickAction(handlers, 'next-review');
  assert.equal(focused.at(-1).recordId, 'edu-first');
  assert.equal(focused.at(-1).field, 'level');
  const focusCount = focused.length;
  await clickAction(handlers, 'confirm-next', { reviewSection: 'education', reviewRecord: 'edu-first', reviewField: 'level' });
  assert.equal(focused.length, focusCount, '筛选内已完成时不擅自转向普通待核对字段');
  assert.ok(messages.some(message => message.includes('当前筛选下已无待核对项')));
  assert.ok(reviewHelpers.getPendingReviewItems(record).length > 0);
});

test('整段确认事件只确认目标经历的可靠字段，异常项和另一段继续保留待核对', async () => {
  const { context, handlers, clock } = browserHarness(), record = educationReviewFixture();
  record.warnings = [{ section: 'education', recordId: 'edu-second', field: 'level', message: '请单独检查学历' }];
  context.setEditor(record);
  let sent;
  context.setApi(async (_path, options) => { sent = structuredClone(options.body); return { resume: { status: 'draft' } }; });
  await clickAction(handlers, 'confirm-record', { reviewSection: 'education', reviewRecord: 'edu-second' });
  assert.deepEqual(record.review.confirmations, [{ section: 'education', recordId: 'edu-second', field: 'school', value: '杭州电子科技大学' }]);
  assert.equal(reviewHelpers.getFieldReview(record, { section: 'education', recordId: 'edu-second', field: 'level' }).confirmed, false);
  assert.equal(reviewHelpers.getFieldReview(record, { section: 'education', recordId: 'edu-first', field: 'school' }).confirmed, false);
  clock.advance(1000);
  await settle();
  assert.deepEqual(sent.review.confirmations, record.review.confirmations);
  assert.equal(context.getState().dirty, false);
});

test('真实页面导航等待正在保存的请求并补存最新编辑，再离开编辑器', async () => {
  const { context, handlers, clock, navigations } = browserHarness(), record = resume('A'), first = deferred(), second = deferred(), requests = [];
  context.enableNavigation();
  context.setEditor(record);
  context.setApi((path, options) => {
    requests.push({ path, ...structuredClone(options) });
    return requests.length === 1 ? first.promise : second.promise;
  });
  inputField(handlers, 'profile', 'summary', '正在发送的内容');
  clock.advance(1000);
  inputField(handlers, 'profile', 'summary', '离开前最终内容');
  const leaving = context.navigate('/dashboard');
  assert.equal(record.busy, true);
  assert.deepEqual(navigations, []);
  assert.equal(requests.length, 1);
  first.resolve({ resume: { status: 'draft' } });
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.content.profile.summary, '离开前最终内容');
  assert.deepEqual(navigations, [], '最终快照成功前不得离开');
  second.resolve({ resume: { status: 'draft' } });
  await leaving;
  assert.deepEqual(navigations, ['/dashboard']);
  assert.equal(context.getState().editor, null);
  assert.equal(record.busy, false);
  assert.equal(clock.pending(), 0);
});

test('离开时保存失败，取消离开保留全部编辑；明确放弃后才导航', async () => {
  const { context, handlers, clock, navigations } = browserHarness(), record = resume('A');
  context.enableNavigation();
  context.setEditor(record);
  context.setApi(async () => { throw new Error('离线'); });
  context.confirmDialog = async () => false;
  inputField(handlers, 'profile', 'summary', '不能丢失的修改');
  await context.navigate('/dashboard');
  assert.deepEqual(navigations, []);
  assert.equal(context.getState().editor, record);
  assert.equal(record.content.profile.summary, '不能丢失的修改');
  assert.equal(context.getState().dirty, true);
  assert.equal(record.busy, false);
  context.confirmDialog = async () => true;
  await context.navigate('/dashboard');
  assert.deepEqual(navigations, ['/dashboard']);
  assert.equal(context.getState().editor, null);
  assert.equal(clock.pending(), 0);
});

test('保存途中撤回到原值，导航仍等待过时请求并补存原值后才离开', async () => {
  const { context, handlers, clock, navigations } = browserHarness(), record = resume('A'), first = deferred(), second = deferred(), requests = [];
  context.enableNavigation();
  context.setEditor(record);
  context.setApi((_path, options) => {
    requests.push(structuredClone(options.body));
    return requests.length === 1 ? first.promise : second.promise;
  });
  inputField(handlers, 'profile', 'summary', '已经发出的过时编辑');
  clock.advance(1000);
  inputField(handlers, 'profile', 'summary', '原内容');
  assert.equal(context.getState().dirty, false, '内容暂与上次成功快照相同，但仍有旧请求在途中');
  const leaving = context.navigate('/dashboard');
  assert.deepEqual(navigations, []);
  first.resolve({ resume: { status: 'draft' } });
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].content.profile.summary, '原内容');
  assert.deepEqual(navigations, []);
  second.resolve({ resume: { status: 'draft' } });
  await leaving;
  assert.deepEqual(navigations, ['/dashboard']);
  assert.equal(record.content.profile.summary, '原内容');
  assert.equal(clock.pending(), 0);
});

test('保存途中撤回到原值仍提示关闭风险，原值最终保存后才允许无提示关闭', async () => {
  const { context, handlers, windowHandlers, clock } = browserHarness(), record = resume('A'), waiting = deferred(), requests = [];
  context.setEditor(record);
  context.setApi((_path, options) => {
    requests.push(structuredClone(options.body));
    return requests.length === 1 ? waiting.promise : Promise.resolve({ resume: { status: 'draft' } });
  });
  inputField(handlers, 'profile', 'summary', '发出中的编辑');
  clock.advance(1000);
  inputField(handlers, 'profile', 'summary', '原内容');
  assert.equal(context.getState().dirty, false);
  let prevented = false;
  const closing = { preventDefault() { prevented = true; } };
  windowHandlers.get('beforeunload')(closing);
  assert.equal(prevented, true);
  assert.equal(closing.returnValue, '');
  waiting.resolve({ resume: { status: 'draft' } });
  await settle();
  clock.advance(1000);
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].content.profile.summary, '原内容');
  prevented = false;
  windowHandlers.get('beforeunload')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(context.getState().dirty, false);
});

test('发布排队立即锁定并阻止离开，双重加锁结束后恢复控件原始禁用状态', async () => {
  const { context, handlers, clock, collections, navigations } = browserHarness(), record = resume('A'), first = deferred(), second = deferred(), requests = [];
  const enabled = { disabled: false, dataset: {} }, disabled = { disabled: true, dataset: {} };
  collections.set('#resume-title,[data-field],[data-setting],[data-order-position],.editor-shell button,.editor-header button', [enabled, disabled]);
  context.enableNavigation();
  context.setEditor(record);
  context.setApi((path, options) => {
    requests.push({ path, ...structuredClone(options) });
    if (requests.length === 1) return first.promise;
    if (requests.length === 2) return second.promise;
    return Promise.resolve({ resume: { status: 'published', slug: 'A-public' } });
  });
  inputField(handlers, 'profile', 'summary', '等待自动保存的内容');
  clock.advance(1000);
  const publishing = context.saveEditor(true);
  assert.equal(record.busy, true, '发布请求尚在排队也必须阻止编辑和离开');
  assert.equal(enabled.disabled, true);
  assert.equal(disabled.disabled, true);
  await context.navigate('/dashboard');
  assert.deepEqual(navigations, []);
  assert.equal(requests.length, 1);
  first.resolve({ resume: { status: 'draft' } });
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(record.busy, true);
  assert.equal(enabled.dataset.wasDisabled, 'false', '真正开始发布再次加锁不能覆盖首次状态');
  assert.equal(disabled.dataset.wasDisabled, 'true');
  second.resolve({ resume: { status: 'draft' } });
  await publishing;
  assert.equal(requests[2].path, '/api/resumes/A/publish');
  assert.equal(record.status, 'published');
  assert.equal(record.busy, false);
  assert.equal(enabled.disabled, false);
  assert.equal(disabled.disabled, true);
  assert.equal(enabled.dataset.wasDisabled, undefined);
  assert.equal(disabled.dataset.wasDisabled, undefined);
});

function mountedField(harness, record, section, field, index = 0) {
  const input = harness.node(), container = harness.node();
  const row = section === 'profile' ? record.content.profile : record.content[section][index];
  const selection = { section, recordId: section === 'profile' ? 'profile' : row.id, field };
  Object.assign(input, { value: row[field] || '', selectionStart: 2, selectionEnd: 4 });
  input.dataset = { section, field, index: String(index) };
  input.closest = selector => selector === '.editor-main' ? container : null;
  container.dataset.fieldContainer = reviewHelpers.reviewKey(selection);
  container.querySelector = selector => selector === '[data-field]' ? input : null;
  const fields = harness.collections.get('[data-field-container]') || [];
  fields.push(container);
  harness.collections.set('[data-field-container]', fields);
  return { input, container, selection };
}

for (const mobile of [false, true]) {
  test(`${mobile ? '手机' : '桌面'}正常输入字段焦点只联动原文，不抢焦点或切换工作区`, () => {
    const h = browserHarness({ mobile, realReviewFocus: true }), record = resume('A');
    h.context.setEditor(record);
    const { input, selection } = mountedField(h, record, 'profile', 'summary');
    input.focus();
    h.handlers.get('focusin')({ target: input });
    assert.deepEqual(structuredClone(h.context.getState().activeReview), selection);
    assert.equal(h.context.getState().mobileEditorPanel, 'edit');
    assert.equal(h.context.document.activeElement, input);
    assert.deepEqual(h.domFocus, [input], '原文联动不能把焦点移到核对面板或另一个字段');
    assert.equal(h.renders.length, 0, '同模块输入不能重建编辑器');
    assert.equal(h.scrolls.length, 0, '普通字段焦点不能滚走正在输入的内容');
  });
}

test('手机查看原文再返回编辑保留字段节点、输入内容和选择范围', async () => {
  const h = browserHarness({ mobile: true, realReviewFocus: true }), record = resume('A');
  h.context.setEditor(record);
  const { input, container, selection } = mountedField(h, record, 'profile', 'summary');
  input.value = '仍在编辑中的最新内容';
  h.handlers.get('input')({ target: input });
  await clickAction(h.handlers, 'review-field', { reviewSection: 'profile', reviewRecord: 'profile', reviewField: 'summary' });
  assert.equal(h.context.getState().mobileEditorPanel, 'proof');
  assert.equal(h.context.getState().proofTab, 'source');
  assert.deepEqual(structuredClone(h.context.getState().activeReview), selection);
  assert.equal(h.context.document.activeElement, h.nodes.get('.source-inspector h2'));
  assert.equal(h.domFocus.includes(input), false, '进入核对不能聚焦已隐藏的输入框而弹出手机键盘');
  await clickAction(h.handlers, 'editor-pane', { panel: 'edit' });
  assert.equal(h.context.getState().mobileEditorPanel, 'edit');
  assert.equal(h.context.document.activeElement, input);
  assert.equal(h.collections.get('[data-field-container]')[0], container);
  assert.equal(input.value, '仍在编辑中的最新内容');
  assert.equal(record.content.profile.summary, input.value);
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 4);
  assert.equal(h.renders.length, 0);
  assert.equal(h.context.getState().dirty, true);
});

test('手机确认并下一项继续显示下一字段原文，核对状态自动保存且不发布', async () => {
  const h = browserHarness({ mobile: true, realReviewFocus: true }), record = educationReviewFixture(), requests = [];
  h.context.setEditor(record);
  h.context.setEditorSection('education');
  const school = mountedField(h, record, 'education', 'school');
  const level = mountedField(h, record, 'education', 'level');
  h.context.setApi(async (path, options) => { requests.push({ path, ...structuredClone(options) }); return { resume: { status: 'draft' } }; });
  await clickAction(h.handlers, 'review-field', { reviewSection: 'education', reviewRecord: 'edu-second', reviewField: 'school' });
  await clickAction(h.handlers, 'confirm-next', { reviewSection: 'education', reviewRecord: 'edu-second', reviewField: 'school' });
  assert.equal(reviewHelpers.getFieldReview(record, school.selection).confirmed, true);
  assert.equal(reviewHelpers.reviewKey(h.context.getState().activeReview), reviewHelpers.reviewKey(level.selection));
  assert.equal(h.context.getState().mobileEditorPanel, 'proof');
  assert.equal(h.context.getState().proofTab, 'source');
  assert.equal(h.context.document.activeElement, h.nodes.get('.source-inspector h2'));
  assert.equal(h.domFocus.includes(level.input), false);
  h.clock.advance(1000);
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/resumes/A');
  assert.equal(requests[0].method, 'PUT');
  assert.deepEqual(requests[0].body.review.confirmations, [{ ...school.selection, value: school.input.value }]);
  assert.equal(record.status, 'draft');
});

test('跨越手机断点只更新可见工作区，保留编辑内容、字段节点和当前焦点', async () => {
  const h = browserHarness({ realReviewFocus: true }), record = resume('A');
  h.context.setEditor(record);
  const { input, container } = mountedField(h, record, 'profile', 'summary');
  input.value = '横竖屏切换期间的编辑';
  h.handlers.get('input')({ target: input });
  input.focus();
  h.resize(true);
  assert.equal(h.context.getState().mobileEditorPanel, 'edit');
  assert.equal(h.context.document.activeElement, input);
  assert.equal(h.nodes.get('.editor-shell').dataset.mobilePanel, 'edit');
  h.resize(false);
  assert.equal(h.context.document.activeElement, input);
  const sourceFocus = h.node();
  sourceFocus.closest = selector => selector === '.proof-panel' ? h.node() : null;
  sourceFocus.focus();
  h.resize(true);
  assert.equal(h.context.getState().mobileEditorPanel, 'proof', '从桌面缩窄时应保留正在阅读的核对面板');
  assert.equal(h.context.document.activeElement, sourceFocus);
  h.resize(false);
  assert.equal(h.context.document.activeElement, sourceFocus);
  assert.equal(record.content.profile.summary, input.value);
  assert.equal(h.collections.get('[data-field-container]')[0], container);
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 4);
  assert.equal(h.renders.length, 0);
  assert.equal(h.scrolls.length, 0);
  assert.equal(h.context.getState().dirty, true);
});

test('手机切换条获得焦点后放大至桌面，将焦点移到仍可见的编辑标题', () => {
  const h = browserHarness({ mobile: true, realReviewFocus: true });
  h.context.setEditor(resume('A'));
  const switchButton = h.node();
  switchButton.closest = selector => selector === '.editor-pane-switch' ? h.node() : null;
  switchButton.focus();
  h.resize(false);
  assert.equal(h.context.document.activeElement, h.nodes.get('.editor-section-header h1'));
  assert.equal(h.renders.length, 0);
});

function publicChapterFixture({ mobile = true, scrollHeight = 2400 } = {}) {
  const h = browserHarness({ mobile });
  const scrollRoot = { scrollTop: 0, clientHeight: 844, scrollHeight };
  const positions = { education: 240, projects: 760, skills: 1400 };
  const nav = h.node();
  Object.assign(nav, {
    clientWidth: 300,
    scrollWidth: mobile ? 600 : 300,
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0, right: 300 }),
    parentElement: { getBoundingClientRect: () => ({ bottom: 64 }) },
  });
  const links = ['top', 'education', 'projects', 'skills'].map((chapter, index) => {
    const link = h.node(), classes = new Set(index ? [] : ['active']);
    link.parentElement = nav;
    link.getAttribute = name => name === 'href' ? `#resume-${chapter}` : link.attributes[name];
    link.removeAttribute = name => { delete link.attributes[name]; };
    link.getBoundingClientRect = () => ({ left: index * 108 - nav.scrollLeft, right: index * 108 + 100 - nav.scrollLeft });
    link.classList = {
      contains: name => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    };
    const section = h.node();
    section.getBoundingClientRect = () => ({ top: chapter === 'top' ? 0 : positions[chapter] });
    h.nodes.set(`#resume-${chapter}`, section);
    return link;
  });
  nav.querySelectorAll = selector => selector === 'a' ? links : [];
  h.nodes.set('.public-sidebar nav', nav);
  h.context.document.scrollingElement = scrollRoot;
  h.context.document.documentElement = scrollRoot;
  h.context.window.innerWidth = mobile ? 390 : 1280;
  h.context.window.innerHeight = scrollRoot.clientHeight;
  const scroll = () => h.windowHandlers.get('scroll')();
  const selected = () => links.filter(link => link.classList.contains('active')).map(link => link.getAttribute('href'));
  return { ...h, scrollRoot, positions, nav, links, scroll, selected };
}

for (const mobile of [true, false]) {
  test(`${mobile ? '手机' : '桌面'}公开简历普通滚动按当前章节更新导航，并清除旧章节的读屏标记`, () => {
    const h = publicChapterFixture({ mobile });
    h.positions.education = mobile ? 70 : 120;
    h.scrollRoot.scrollTop = 200;
    h.scroll();
    assert.deepEqual(h.selected(), ['#resume-education']);
    assert.equal(h.links[1].attributes['aria-current'], 'location');
    h.positions.education = -400;
    h.positions.projects = mobile ? 70 : 120;
    h.positions.skills = 500;
    h.scrollRoot.scrollTop = 900;
    h.scroll();
    assert.deepEqual(h.selected(), ['#resume-projects']);
    assert.equal(h.links[1].attributes['aria-current'], undefined);
    assert.equal(h.links[2].attributes['aria-current'], 'location');
    h.positions.education = 240;
    h.positions.projects = 760;
    h.scrollRoot.scrollTop = 0;
    h.scroll();
    assert.deepEqual(h.selected(), ['#resume-top']);
    assert.equal(h.links[0].attributes['aria-current'], 'location');
    assert.equal(h.links[2].attributes['aria-current'], undefined);
  });

  test(`${mobile ? '手机' : '桌面'}滚到文档底部时选中较短的最后一节，而不是退回前一节`, () => {
    const h = publicChapterFixture({ mobile });
    Object.assign(h.positions, { education: -900, projects: -200, skills: 480 });
    h.scrollRoot.scrollTop = h.scrollRoot.scrollHeight - h.scrollRoot.clientHeight - 3;
    h.scroll();
    assert.deepEqual(h.selected(), ['#resume-projects'], '尚未到底且末节未到阅读起点时仍显示当前章节');
    h.scrollRoot.scrollTop = h.scrollRoot.scrollHeight - h.scrollRoot.clientHeight;
    h.scroll();
    assert.deepEqual(h.selected(), ['#resume-skills'], '末节在视口下半部也应在滚到底时成为当前章节');
    assert.equal(h.links[3].attributes['aria-current'], 'location');
    assert.equal(h.links[2].attributes['aria-current'], undefined);
    if (mobile) assert.ok(h.nav.scrollLeft > 0, '短末节选中后应露出横向导航中的对应标签');
  });
}

test('不足一屏的公开简历不会因同时位于文档底部而直接选中末节', () => {
  const h = publicChapterFixture({ scrollHeight: 844 });
  Object.assign(h.positions, { education: 240, projects: 460, skills: 680 });
  h.scroll();
  assert.deepEqual(h.selected(), ['#resume-top']);
});

test('公开简历滚到底部只选实际存在的末节，忽略没有内容节点的章节链接', () => {
  const h = publicChapterFixture();
  Object.assign(h.positions, { education: -400, projects: 480 });
  h.nodes.set('#resume-skills', null);
  h.scrollRoot.scrollTop = h.scrollRoot.scrollHeight - h.scrollRoot.clientHeight;
  h.scroll();
  assert.deepEqual(h.selected(), ['#resume-projects']);
  assert.equal(h.links[2].attributes['aria-current'], 'location');
});

for (const reducedMotion of [false, true]) {
  test(`点击公开简历章节仅替换 hash 并${reducedMotion ? '直接' : '平滑'}滚动，不重新挂载页面`, async () => {
    const h = publicChapterFixture(), replacements = [], renders = [];
    const chapter = h.links[2], section = h.nodes.get('#resume-projects');
    h.context.history.replaceState = (_state, _unused, path) => replacements.push(path);
    h.context.history.pushState = () => assert.fail('章节跳转不应新增 SPA 导航历史');
    h.context.renderRoute = () => renders.push(true);
    h.context.window.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion });
    let prevented = false;
    await h.handlers.get('click')({
      target: { closest: selector => selector === '.public-sidebar nav a' ? chapter : null },
      button: 0,
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true, '必须阻止原生 hash 导航，否则 popstate 会重建页面并丢失滚动位置');
    assert.deepEqual(replacements, ['#resume-projects']);
    assert.deepEqual(h.navigations, [], '章节不是 SPA 路由导航');
    assert.deepEqual(renders, [], '章节跳转不能重新渲染当前简历');
    assert.equal(h.scrolls.length, 1);
    assert.equal(h.scrolls[0].node, section, '必须滚动到点击的实际章节');
    assert.deepEqual(structuredClone(h.scrolls[0].options), { block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    assert.deepEqual(h.selected(), ['#resume-projects']);
    assert.equal(chapter.attributes['aria-current'], 'location');
  });
}

for (const [label, modifiers] of [
  ['Ctrl', { ctrlKey: true }],
  ['Meta', { metaKey: true }],
  ['Shift', { shiftKey: true }],
  ['鼠标中键', { button: 1 }],
]) {
  test(`${label} 点击章节保留浏览器默认行为，不修改当前页面的 URL、滚动或选择`, async () => {
    const h = publicChapterFixture(), historyCalls = [], renders = [];
    h.context.history.replaceState = (...args) => historyCalls.push(args);
    h.context.history.pushState = (...args) => historyCalls.push(args);
    h.context.renderRoute = () => renders.push(true);
    let prevented = false;
    await h.handlers.get('click')({
      target: { closest: selector => selector === '.public-sidebar nav a' ? h.links[2] : null },
      button: 0,
      ...modifiers,
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, false);
    assert.deepEqual(historyCalls, []);
    assert.deepEqual(h.navigations, []);
    assert.deepEqual(renders, []);
    assert.deepEqual(h.scrolls, []);
    assert.deepEqual(h.selected(), ['#resume-top']);
  });
}
