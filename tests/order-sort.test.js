import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSection, setupOrderSorting } from '../public/order-sort.js';

test('模块排序支持跨越多个位置，保留其他模块相对顺序和原始草稿数组', () => {
  const original = ['education', 'experience', 'awards', 'projects', 'skills'];
  assert.deepEqual(moveSection(original, 'projects', 0), ['projects', 'education', 'experience', 'awards', 'skills']);
  assert.deepEqual(moveSection(original, 'education', 4), ['experience', 'awards', 'projects', 'skills', 'education']);
  assert.deepEqual(moveSection(original, 'skills', 2), ['education', 'experience', 'skills', 'awards', 'projects']);
  assert.deepEqual(original, ['education', 'experience', 'awards', 'projects', 'skills']);
});

// Stub event delivery and layout only; the production controller owns all state,
// timers, tentative positions, cancellation, and commits.
function sortingHarness(t, { scrollMode } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const surface = () => {
    const listeners = new Map();
    return {
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      fire(type, values = {}) {
        const event = { preventDefault() {}, stopPropagation() {}, ...values };
        for (const listener of listeners.get(type) ?? []) listener(event);
      },
    };
  };
  const classes = () => {
    const names = new Set();
    return { add: (...items) => items.forEach(name => names.add(name)), remove: (...items) => items.forEach(name => names.delete(name)), contains: name => names.has(name) };
  };
  const order = ['education', 'experience', 'awards', 'projects', 'skills'];
  const ghosts = new Set(), commits = [], status = { textContent: '' };
  const view = { ...surface(), innerWidth: 1200, innerHeight: 800 };
  const doc = { ...surface(), defaultView: view, body: { append: ghost => ghosts.add(ghost) }, createElement: () => ({ style: {}, offsetWidth: 240, offsetHeight: 40, setAttribute() {}, remove() { ghosts.delete(this); } }) };
  const rows = order.map((section, index) => ({ dataset: { orderSection: section }, classList: classes(), getBoundingClientRect: () => ({ top: index * 60, height: 60 }) }));
  const list = {
    ...surface(), ownerDocument: doc, isConnected: true, classList: classes(),
    querySelectorAll: selector => selector === '[data-order-section]' ? rows : [],
    contains: target => target.list === list,
    getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300 }),
  };
  const frames = new Map();
  let frameId = 0, scrollRoot, scrollPane;
  if (scrollMode) {
    const scroller = (clientHeight, scrollHeight) => {
      let top = 0;
      return { clientHeight, scrollHeight, get scrollTop() { return top; }, set scrollTop(value) { top = Math.max(0, Math.min(value, scrollHeight - clientHeight)); } };
    };
    view.innerWidth = 390;
    view.innerHeight = 200;
    view.requestAnimationFrame = callback => { const id = ++frameId; frames.set(id, callback); return id; };
    view.cancelAnimationFrame = id => frames.delete(id);
    scrollRoot = scroller(200, 800);
    scrollPane = scroller(scrollMode === 'pane' ? 180 : 300, 300);
    scrollPane.parentElement = doc.body;
    scrollPane.getBoundingClientRect = () => ({ left: 0, right: 390, top: 20, bottom: 200 });
    doc.body.parentElement = scrollRoot;
    doc.documentElement = doc.scrollingElement = scrollRoot;
    list.parentElement = scrollPane;
    view.getComputedStyle = element => ({ overflowY: element === scrollPane && scrollMode === 'pane' ? 'auto' : 'visible' });
    const listTop = () => (scrollMode === 'pane' ? 20 : 0) - scrollRoot.scrollTop - scrollPane.scrollTop;
    list.getBoundingClientRect = () => ({ left: 0, right: 390, top: listTop(), bottom: listTop() + 300, width: 390, height: 300 });
    rows.forEach((row, index) => { row.getBoundingClientRect = () => ({ top: listTop() + index * 60, height: 60 }); });
  }
  const handles = rows.map(row => ({ list, attributes: {}, focus() {}, setAttribute(name, value) { this.attributes[name] = value; }, closest(selector) { return selector === '.order-handle' ? this : selector === '[data-order-section]' ? row : null; } }));
  let disabled = false;
  const controller = setupOrderSorting(list, { status, isDisabled: () => disabled, onCommit: (next, info) => commits.push({ next, info }) });
  t.after(() => controller.destroy());
  const pointer = (type, index, y, extras = {}) => (type === 'pointerdown' ? list : doc).fire(type, { target: handles[index], pointerId: 1, button: 0, clientX: 100, clientY: y, ...extras });
  const key = (index, value) => (value === 'Escape' ? doc : list).fire('keydown', { target: handles[index], key: value });
  const position = (section, value) => {
    const target = { list, dataset: { orderPosition: section }, value, closest(selector) { return selector === '[data-order-position]' ? this : null; } };
    list.fire('change', { target });
  };
  const frame = () => {
    const next = frames.entries().next().value;
    if (!next) return;
    frames.delete(next[0]);
    next[1]();
  };
  return { controller, list, doc, rows, handles, ghosts, commits, status, pointer, key, position, frame, frames, scrollRoot, scrollPane, disable: () => { disabled = true; } };
}

test('短按或长按完成前移动不会改变顺序，也不会在松手后延迟进入拖动', t => {
  const h = sortingHarness(t);
  h.pointer('pointerdown', 3, 210);
  t.mock.timers.tick(149);
  h.pointer('pointerup', 3, 15);
  t.mock.timers.tick(1000);
  assert.deepEqual(h.commits, []);
  assert.equal(h.list.classList.contains('is-sorting'), false);
  assert.equal(h.ghosts.size, 0);

  h.pointer('pointerdown', 3, 210);
  h.pointer('pointermove', 3, 199);
  t.mock.timers.tick(150);
  h.pointer('pointerup', 3, 15);
  assert.deepEqual(h.commits, []);
  assert.equal(h.ghosts.size, 0);
});

test('长按149ms不触发、满150ms后跨位拖动，只在松手时提交完整顺序并清理拖动状态', t => {
  const h = sortingHarness(t);
  h.pointer('pointerdown', 4, 270);
  t.mock.timers.tick(149);
  assert.equal(h.list.classList.contains('is-sorting'), false);
  assert.equal(h.ghosts.size, 0);
  t.mock.timers.tick(1);
  assert.equal(h.list.classList.contains('is-sorting'), true);
  assert.equal(h.handles[4].attributes['aria-pressed'], 'true');
  assert.equal(h.ghosts.size, 1);
  h.pointer('pointermove', 4, 15);
  assert.deepEqual(h.commits, [], '拖动中的目标位置不能先写入草稿');
  assert.equal(h.rows[0].classList.contains('drop-before'), true);
  h.pointer('pointerup', 4, 15);
  assert.deepEqual(h.commits, [{ next: ['skills', 'education', 'experience', 'awards', 'projects'], info: { section: 'skills', method: 'pointer' } }]);
  assert.equal(h.list.classList.contains('is-sorting'), false);
  assert.equal(h.handles[4].attributes['aria-pressed'], 'false');
  assert.equal(h.ghosts.size, 0);
});

test('拖动中的Esc、区域外松手和保存禁用都取消本次排序', t => {
  const h = sortingHarness(t);
  h.pointer('pointerdown', 3, 210);
  t.mock.timers.tick(150);
  h.pointer('pointermove', 3, 15);
  h.key(3, 'Escape');
  h.pointer('pointerup', 3, 15);
  assert.deepEqual(h.commits, []);
  assert.equal(h.ghosts.size, 0);

  h.pointer('pointerdown', 3, 210);
  t.mock.timers.tick(150);
  h.pointer('pointerup', 3, 15, { clientX: 600 });
  assert.deepEqual(h.commits, []);

  h.pointer('pointerdown', 3, 210);
  t.mock.timers.tick(150);
  h.disable();
  h.pointer('pointerup', 3, 15);
  assert.deepEqual(h.commits, []);
  assert.equal(h.ghosts.size, 0);
});

test('键盘拾取与方向键不会提前提交，Esc还原，回车确认新位置', t => {
  const h = sortingHarness(t);
  h.key(3, ' ');
  h.key(3, 'ArrowUp');
  assert.deepEqual(h.commits, []);
  h.key(3, 'Escape');
  assert.equal(h.list.classList.contains('is-sorting'), false);
  assert.deepEqual(h.commits, []);

  h.key(3, 'Enter');
  h.key(3, 'ArrowUp');
  h.key(3, 'ArrowUp');
  h.key(3, 'Enter');
  assert.deepEqual(h.commits, [{ next: ['education', 'projects', 'experience', 'awards', 'skills'], info: { section: 'projects', method: 'keyboard' } }]);
});

test('显示勾选框不会触发排序，点击位置替代控件可以跨位移动', t => {
  const h = sortingHarness(t);
  h.list.fire('change', { target: { dataset: { setting: 'module', section: 'awards' }, checked: false, closest: () => null } });
  assert.deepEqual(h.commits, []);
  h.position('projects', '0');
  assert.deepEqual(h.commits, [{ next: ['projects', 'education', 'experience', 'awards', 'skills'], info: { section: 'projects', method: 'position' } }]);
});

test('触摸长按期间或抓取后被系统取消，都不提交且不会延迟重启', t => {
  const h = sortingHarness(t);
  h.pointer('pointerdown', 4, 270, { pointerType: 'touch' });
  t.mock.timers.tick(100);
  h.pointer('pointercancel', 4, 270, { pointerType: 'touch' });
  t.mock.timers.tick(1000);
  assert.equal(h.ghosts.size, 0);
  assert.equal(h.list.classList.contains('is-sorting'), false);

  h.pointer('pointerdown', 4, 270, { pointerType: 'touch' });
  t.mock.timers.tick(150);
  h.pointer('pointermove', 4, 15, { pointerType: 'touch' });
  assert.equal(h.rows[0].classList.contains('drop-before'), true);
  h.pointer('pointercancel', 4, 15, { pointerType: 'touch' });
  h.pointer('pointerup', 4, 15, { pointerType: 'touch' });
  assert.deepEqual(h.commits, []);
  assert.equal(h.ghosts.size, 0);
  assert.equal(h.handles[4].attributes['aria-pressed'], 'false');
  assert.equal(h.rows[0].classList.contains('drop-before'), false);
});

test('第二个触点不能接管已抓取的模块或提前提交，主触点松手才生效', t => {
  const h = sortingHarness(t);
  h.pointer('pointerdown', 4, 270, { pointerType: 'touch' });
  t.mock.timers.tick(150);
  h.pointer('pointerdown', 2, 150, { pointerType: 'touch', pointerId: 2, isPrimary: false });
  h.pointer('pointermove', 2, 15, { pointerType: 'touch', pointerId: 2 });
  h.pointer('pointerup', 2, 15, { pointerType: 'touch', pointerId: 2 });
  assert.deepEqual(h.commits, []);
  assert.equal(h.handles[4].attributes['aria-pressed'], 'true');
  h.pointer('pointerup', 4, 15, { pointerType: 'touch' });
  assert.deepEqual(h.commits[0].next, ['skills', 'education', 'experience', 'awards', 'projects']);
});

for (const scrollMode of ['pane', 'document']) {
  test(`${scrollMode === 'pane' ? '桌面编辑面板' : '手机页面'}在拖动至下缘时自动滚动并按滚动后的行位置提交`, t => {
    const h = sortingHarness(t, { scrollMode });
    h.pointer('pointerdown', 0, scrollMode === 'pane' ? 50 : 30, { pointerType: 'touch' });
    t.mock.timers.tick(150);
    h.pointer('pointermove', 0, 190, { pointerType: 'touch' });
    assert.equal(h.rows[3].classList.contains('drop-before'), true);
    for (let i = 0; i < 5; i++) h.frame();
    assert.equal(h.scrollPane.scrollTop, scrollMode === 'pane' ? 60 : 0);
    assert.equal(h.scrollRoot.scrollTop, scrollMode === 'document' ? 60 : 0);
    assert.equal(h.rows[4].classList.contains('drop-before'), true, '自动滚动后必须重新计算插入位置');
    assert.deepEqual(h.commits, []);
    h.pointer('pointerup', 0, 190, { pointerType: 'touch' });
    assert.deepEqual(h.commits, [{ next: ['experience', 'awards', 'projects', 'education', 'skills'], info: { section: 'education', method: 'pointer' } }]);
    assert.equal(h.frames.size, 0, '松手后应停止自动滚动');
  });
}

test('手机页面向上自动滚动，移出排序区域或取消后停止滚动', t => {
  const h = sortingHarness(t, { scrollMode: 'document' });
  h.scrollRoot.scrollTop = 60;
  h.pointer('pointerdown', 4, 190, { pointerType: 'touch' });
  t.mock.timers.tick(150);
  h.pointer('pointermove', 4, 10, { pointerType: 'touch' });
  h.frame();
  assert.equal(h.scrollRoot.scrollTop, 48);
  h.pointer('pointermove', 4, 10, { pointerType: 'touch', clientX: 450 });
  h.frame();
  assert.equal(h.scrollRoot.scrollTop, 48);
  h.pointer('pointercancel', 4, 10, { pointerType: 'touch' });
  assert.equal(h.frames.size, 0);
  h.frame();
  assert.equal(h.scrollRoot.scrollTop, 48);
  assert.deepEqual(h.commits, []);
});

test('手机拖动向上滚动的触发区避开顶部粘性切换条，未吸顶或隐藏时不预留遮挡', t => {
  const h = sortingHarness(t, { scrollMode: 'document' });
  const switcher = { getBoundingClientRect: () => ({ top: 0, bottom: 60, left: 0, right: 390 }) };
  h.doc.querySelector = selector => selector === '.editor-pane-switch' ? switcher : null;
  const computedStyle = h.doc.defaultView.getComputedStyle;
  let switcherDisplay = 'grid';
  h.doc.defaultView.getComputedStyle = element => element === switcher ? { position: 'sticky', display: switcherDisplay, visibility: 'visible' } : computedStyle(element);
  h.scrollRoot.scrollTop = 60;
  h.pointer('pointerdown', 4, 190, { pointerType: 'touch' });
  t.mock.timers.tick(150);
  h.pointer('pointermove', 4, 70, { pointerType: 'touch' });
  h.frame();
  assert.equal(h.scrollRoot.scrollTop, 48, '手指在粘性条下方应能继续向上拖动滚动');
  switcher.getBoundingClientRect = () => ({ top: 100, bottom: 160, left: 0, right: 390 });
  h.frame();
  assert.equal(h.scrollRoot.scrollTop, 48, '未吸顶的切换条不应改变视口边缘');
  switcher.getBoundingClientRect = () => ({ top: 0, bottom: 60, left: 0, right: 390 });
  switcherDisplay = 'none';
  h.frame();
  assert.equal(h.scrollRoot.scrollTop, 48, '隐藏的桌面切换条不应预留滚动区');
  h.pointer('pointercancel', 4, 70, { pointerType: 'touch' });
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.commits, []);
});
