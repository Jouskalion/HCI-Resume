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
function sortingHarness(t) {
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
  return { controller, list, doc, rows, handles, ghosts, commits, status, pointer, key, position, disable: () => { disabled = true; } };
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
