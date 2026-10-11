import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../public/autosave.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let value = '原内容', savedValue = value, running = 0, maxRunning = 0;
  const calls = [], states = [];
  const controller = createAutosave({
    isDirty: () => value !== savedValue,
    onState: state => states.push(state),
    save: async options => {
      const waiting = deferred(), snapshot = value;
      const call = { options, snapshot, ...waiting };
      calls.push(call);
      maxRunning = Math.max(maxRunning, ++running);
      try {
        await waiting.promise;
        savedValue = snapshot;
        return snapshot;
      } finally { running--; }
    },
  });
  t.after(() => controller.dispose());
  return {
    controller, calls, states,
    edit(next) { value = next; controller.schedule(); },
    tick: amount => t.mock.timers.tick(amount),
    get value() { return value; },
    get savedValue() { return savedValue; },
    get maxRunning() { return maxRunning; },
  };
}

test('输入停顿一秒才保存，连续输入重新计时且只保存最后的内容', async t => {
  const h = harness(t);
  h.edit('第一稿');
  h.tick(900);
  h.edit('第二稿');
  h.tick(999);
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.state.status, 'pending');
  h.tick(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].snapshot, '第二稿');
  assert.deepEqual(h.calls[0].options, { automatic: true });
  assert.equal(h.controller.state.status, 'saving');
  h.calls[0].resolve();
  await settle();
  assert.equal(h.savedValue, '第二稿');
  assert.equal(h.controller.state.status, 'saved');
});

test('保存期间继续输入不会并发写入，前次成功后再保存最新快照', async t => {
  const h = harness(t);
  h.edit('第一稿');
  h.tick(1000);
  h.edit('第二稿');
  h.tick(1000);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve();
  await settle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].snapshot, '第二稿');
  assert.equal(h.controller.state.status, 'saving');
  h.calls[1].resolve();
  await settle();
  assert.equal(h.maxRunning, 1);
  assert.equal(h.savedValue, '第二稿');
  assert.equal(h.controller.state.status, 'saved');
});

test('前一次保存很快完成时，后续输入仍保留剩余的停顿时间', async t => {
  const h = harness(t);
  h.edit('第一稿');
  h.tick(1000);
  h.edit('第二稿');
  h.tick(200);
  h.calls[0].resolve();
  await settle();
  assert.equal(h.controller.state.status, 'pending');
  h.tick(799);
  assert.equal(h.calls.length, 1);
  h.tick(1);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve();
  await settle();
});

test('自动保存失败后保留修改并停止重试，显式重试保存包括失败后的新编辑', async t => {
  const h = harness(t), failure = new Error('网络断开');
  h.edit('尚未保存');
  h.tick(1000);
  h.calls[0].reject(failure);
  await settle();
  assert.equal(h.controller.state.status, 'error');
  assert.equal(h.controller.state.error, failure);
  assert.equal(h.savedValue, '原内容');
  h.edit('失败后继续修改');
  h.tick(30000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.value, '失败后继续修改');
  const retry = h.controller.retry();
  assert.equal(h.calls[1].snapshot, '失败后继续修改');
  h.calls[1].resolve();
  await retry;
  assert.equal(h.savedValue, h.value);
  assert.equal(h.controller.state.status, 'saved');
});

test('手动保存立即执行并取消定时请求，已保存内容不会再次自动写入', async t => {
  const h = harness(t);
  h.edit('立即保存');
  const manual = h.controller.flush();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].options, { automatic: false });
  h.tick(1000);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve();
  assert.equal(await manual, '立即保存');
  h.tick(30000);
  assert.equal(h.calls.length, 1);
  assert.equal(await h.controller.flush(), false);
});

test('发布与自动保存共用队列，发布等待旧请求后使用最新内容且绝不并发', async t => {
  const h = harness(t);
  h.edit('自动保存版本');
  h.tick(1000);
  h.edit('准备发布版本');
  const publishing = h.controller.flush({ publishing: true, force: true });
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve();
  await settle();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].options, { publishing: true, automatic: false });
  assert.equal(h.calls[1].snapshot, '准备发布版本');
  h.calls[1].resolve();
  await publishing;
  h.tick(5000);
  assert.equal(h.maxRunning, 1);
  assert.equal(h.calls.length, 2);
});

test('没有未保存修改时仍允许明确发布，不由自动保存代替发布操作', async t => {
  const h = harness(t);
  const publishing = h.controller.flush({ publishing: true, force: true });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.publishing, true);
  h.calls[0].resolve();
  await publishing;
  assert.equal(h.controller.state.status, 'saved');
});

test('草稿已成功保存而发布失败时不重试发布，也不阻止后续修改自动保存', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let value = '准备发布内容', savedValue = '原内容', publishAttempts = 0, draftAttempts = 0;
  const failure = new Error('发布暂时失败');
  const controller = createAutosave({
    isDirty: () => value !== savedValue,
    save: async ({ publishing }) => {
      savedValue = value;
      if (publishing) { publishAttempts++; throw failure; }
      draftAttempts++;
    },
  });
  t.after(() => controller.dispose());
  await assert.rejects(controller.flush({ publishing: true, force: true }), failure);
  assert.equal(savedValue, '准备发布内容');
  assert.deepEqual(controller.state, { status: 'saved', error: null });
  t.mock.timers.tick(10000);
  assert.equal(publishAttempts, 1, '发布失败必须保留为显式失败，不后台重试');
  value = '发布失败后的新编辑';
  controller.schedule();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(savedValue, '发布失败后的新编辑');
  assert.equal(draftAttempts, 1);
  assert.equal(publishAttempts, 1);
  assert.equal(controller.state.status, 'saved');
});

test('当前请求失败会拒绝提前排队的发布，必须在看到错误后再显式重试', async t => {
  const h = harness(t), failure = new Error('保存失败');
  h.edit('第一稿');
  h.tick(1000);
  const publishing = h.controller.flush({ publishing: true, force: true });
  const rejected = assert.rejects(publishing, failure);
  h.calls[0].reject(failure);
  await rejected;
  h.tick(5000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.state.status, 'error');
});

test('离开编辑器清除未开始保存的定时器，后续编辑通知不会重新发请求', async t => {
  const h = harness(t);
  h.edit('离开前未发送');
  h.controller.dispose();
  h.tick(5000);
  h.edit('旧编辑器不再工作');
  h.tick(5000);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.controller.flush(), { name: 'AbortError' });
});

test('离开时已发送请求可以完成，但待执行发布被取消且不再通知新页面', async t => {
  const h = harness(t);
  h.edit('发送中的旧稿');
  h.tick(1000);
  h.edit('尚未发送的新稿');
  const publishing = h.controller.flush({ publishing: true, force: true });
  const cancelled = assert.rejects(publishing, { name: 'AbortError' });
  const count = h.states.length;
  h.controller.dispose();
  await cancelled;
  h.calls[0].resolve();
  await settle();
  h.tick(5000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.states.length, count);
});

test('改回已保存内容会取消尚未发送的保存，不留下虚假的未保存标记', async t => {
  const h = harness(t);
  h.edit('短暂修改');
  h.tick(300);
  h.edit('原内容');
  h.tick(5000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.state.status, 'saved');
});

test('已发送修改又被撤销时，旧请求完成后会把撤销后的内容补存到服务器', async t => {
  const h = harness(t);
  h.edit('正在保存的修改');
  h.tick(1000);
  h.edit('原内容');
  h.calls[0].resolve();
  await settle();
  assert.equal(h.savedValue, '正在保存的修改');
  assert.equal(h.value, '原内容');
  assert.equal(h.controller.state.status, 'pending');
  h.tick(1000);
  assert.equal(h.calls[1].snapshot, '原内容');
  h.calls[1].resolve();
  await settle();
  assert.equal(h.savedValue, '原内容');
  assert.equal(h.controller.state.status, 'saved');
});
