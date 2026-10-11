import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyContent } from '../public/data.js';
import { reviewKey, getFieldReview, getReviewItems, getPendingReviewItems, getNextReviewItem, getRecordReviewCandidates, confirmRecord, confirmField, invalidateField, pruneReview, renderSourceText } from '../public/review.js';

const selection = (recordId, field = 'level', section = 'education') => ({ section, recordId, field });

function editorFixture() {
  const content = emptyContent();
  content.profile.name = '周予安';
  content.education = [
    { id: 'edu-1', school: '杭州电子科技大学', level: '本科', degree: '' },
    { id: 'edu-2', school: '浙江大学', level: '硕士研究生', degree: '' },
  ];
  content.experience = [{ id: 'exp-1', company: '恒生电子股份有限公司', position: 'Java 开发实习生' }];
  const sourceText = '周予安\n杭州电子科技大学 本科\n浙江大学 硕士研究生\n恒生电子股份有限公司 Java 开发实习生';
  const evidence = (recordId, value) => ({ ...selection(recordId), value, ranges: [{ start: sourceText.indexOf(value), end: sourceText.indexOf(value) + value.length }] });
  return { content, sourceText, warnings: [], review: { version: 1, fields: [evidence('edu-1', '本科'), evidence('edu-2', '硕士研究生')], confirmations: [] } };
}

test('核对以模块、经历 ID 和字段定位，两段教育不会共享确认或原文', () => {
  const editor = editorFixture();
  assert.notEqual(reviewKey(selection('edu-1')), reviewKey(selection('edu-2')));
  assert.notEqual(reviewKey(selection('edu-1')), reviewKey(selection('edu-1', 'level', 'awards')));
  assert.equal(confirmField(editor, selection('edu-1')), true);
  assert.equal(getFieldReview(editor, selection('edu-1')).state, 'confirmed');
  const second = getFieldReview(editor, selection('edu-2'));
  assert.equal(second.state, 'pending');
  assert.equal(editor.sourceText.slice(second.ranges[0].start, second.ranges[0].end), '硕士研究生');
  editor.content.education.reverse();
  assert.equal(getFieldReview(editor, selection('edu-1')).confirmed, true, '确认应随经历 ID 保留，不依赖数组位置');
  assert.equal(getFieldReview(editor, selection('missing')), null);
  assert.equal(getFieldReview(editor, selection('edu-1', 'unknown')), null);
  assert.equal(confirmField(editor, selection('missing')), false);
});

test('修改已确认值会失效，显式作废后恢复旧值也必须重新核对', () => {
  const editor = editorFixture(), target = selection('edu-1');
  confirmField(editor, target);
  confirmField(editor, target);
  assert.equal(editor.review.confirmations.length, 1, '重复确认不增加重复条目');
  editor.content.education[0].level = '专科';
  assert.equal(getFieldReview(editor, target).confirmed, false, '旧值的确认不得覆盖新值');
  assert.equal(getFieldReview(editor, target).state, 'changed');
  invalidateField(editor, target);
  editor.content.education[0].level = '本科';
  assert.equal(getFieldReview(editor, target).state, 'pending', '改回原值不能重新激活旧确认');
  confirmField(editor, target);
  confirmField(editor, target, false);
  assert.equal(getFieldReview(editor, target).confirmed, false);
});

test('缺失字段的定向提醒可以确认，且不会影响另一段同名字段', () => {
  const editor = editorFixture(), target = selection('edu-1', 'degree');
  editor.warnings = [{ ...target, message: '原文未明确学位，请核对后填写或保留空白。' }];
  const missing = getReviewItems(editor).find(item => item.key === reviewKey(target));
  assert.equal(missing.value, '');
  assert.equal(missing.state, 'warning');
  assert.equal(getFieldReview(editor, selection('edu-2', 'degree')).warnings.length, 0);
  assert.equal(confirmField(editor, target), true);
  assert.equal(getFieldReview(editor, target).state, 'confirmed');
  assert.equal(editor.review.confirmations[0].value, '');
  assert.equal(editor.warnings.length, 1, '核对状态不应破坏原始识别提示');
});

test('核对清单只展示有值、证据、提醒或确认的字段，无原文时不创建清单', () => {
  const editor = editorFixture();
  assert.equal(getFieldReview(editor, selection('exp-1', 'position', 'experience')).state, 'unmatched');
  assert.ok(getReviewItems(editor).some(item => item.section === 'profile' && item.field === 'name'));
  assert.ok(!getReviewItems(editor).some(item => item.section === 'profile' && item.field === 'phone'));
  editor.sourceText = '';
  assert.deepEqual(getReviewItems(editor), []);
});

test('空白且无识别提醒的可选字段显示未填写，不占用待核对清单', () => {
  const editor = editorFixture(), target = selection('edu-1', 'degree');
  const item = getFieldReview(editor, target);
  assert.equal(item.state, 'empty');
  assert.equal(item.stateLabel, '未填写');
  assert.equal(getReviewItems(editor).some(entry => entry.key === item.key), false);
});

test('清理核对状态只保留仍存在且值相同的字段，删除经历不留下确认', () => {
  const editor = editorFixture();
  confirmField(editor, selection('edu-1'));
  confirmField(editor, selection('edu-2'));
  confirmField(editor, selection('exp-1', 'position', 'experience'));
  editor.content.education = editor.content.education.filter(row => row.id !== 'edu-1');
  editor.content.experience[0].position = '后端工程师';
  pruneReview(editor);
  assert.deepEqual(editor.review.confirmations, [{ ...selection('edu-2'), value: '硕士研究生' }]);
  assert.equal(getReviewItems(editor).some(item => item.recordId === 'edu-1'), false);
});

test('筛选只包含待核对项，提醒、修改和未定位可重叠，修改不会掩盖提醒', () => {
  const editor = editorFixture(), first = selection('edu-1'), second = selection('edu-2');
  editor.warnings = [{ ...first, message: '学历需要检查' }, { ...selection('edu-2', 'degree'), message: '学位缺失' }];
  editor.content.education[0].level = '专科';
  assert.equal(getFieldReview(editor, first).state, 'changed');
  assert.deepEqual(getPendingReviewItems(editor, 'warning').map(item => item.key), [reviewKey(first), reviewKey(selection('edu-2', 'degree'))]);
  assert.deepEqual(getPendingReviewItems(editor, 'changed').map(item => item.key), [reviewKey(first)]);
  assert.ok(getPendingReviewItems(editor, 'unmatched').some(item => item.key === reviewKey(selection('edu-2', 'degree'))));
  assert.ok(!getPendingReviewItems(editor, 'unmatched').some(item => item.key === reviewKey(first)), '修改字段仍有可用原文，不应归为未定位');
  confirmField(editor, first);
  confirmField(editor, second);
  assert.ok(getPendingReviewItems(editor).every(item => !item.confirmed));
  assert.equal(getPendingReviewItems(editor, 'changed').length, 0);
  assert.equal(getPendingReviewItems(editor, 'warning').length, 1);
});

test('确认并下一项以稳定字段顺序定位，不会因当前项从清单移除而跳过紧邻字段', () => {
  const editor = editorFixture();
  const queue = getPendingReviewItems(editor);
  const current = queue[2], expected = queue[3];
  assert.ok(expected);
  confirmField(editor, current);
  assert.equal(getNextReviewItem(editor, current).key, expected.key);
  assert.equal(getNextReviewItem(editor, queue.at(-1)).key, queue[0].key, '末项之后循环回首项');
  assert.equal(getNextReviewItem(editor, null).key, queue[0].key);
  assert.equal(getNextReviewItem(editor, selection('removed')).key, queue[0].key);
  for(const item of getPendingReviewItems(editor))confirmField(editor, item);
  assert.equal(getNextReviewItem(editor, current), null);
});

test('下一项遵循当前筛选，即使锚点已确认或属于另一筛选，且只剩一项时可定位自身', () => {
  const editor = editorFixture(), first = selection('edu-1'), second = selection('edu-2');
  editor.warnings = [{ ...first, message: '提醒一' }, { ...second, message: '提醒二' }];
  assert.equal(getNextReviewItem(editor, selection('profile', 'name', 'profile'), 'warning').key, reviewKey(first));
  confirmField(editor, first);
  assert.equal(getNextReviewItem(editor, first, 'warning').key, reviewKey(second));
  assert.equal(getNextReviewItem(editor, second, 'warning').key, reviewKey(second));
  confirmField(editor, second);
  assert.equal(getNextReviewItem(editor, second, 'warning'), null);
  assert.ok(getNextReviewItem(editor, second), '筛选为空不影响其他类别待核对项');
});

test('整段确认只确认可靠且未修改的字段，提醒、修改、无原文和非法范围继续单独核对', () => {
  const editor = editorFixture(), row = editor.content.education[0];
  row.major = '软件工程';
  row.degree = '工学学士';
  row.gpa = '3.8';
  row.startDate = '2022.09';
  const evidence = (field, value, ranges = [{ start: 0, end: 3 }]) => ({ ...selection(row.id, field), value, ranges });
  editor.review.fields.push(
    evidence('school', row.school),
    evidence('major', '计算机科学与技术'),
    evidence('degree', row.degree),
    evidence('startDate', row.startDate, [{ start: -1, end: 2 }]),
  );
  editor.warnings = [{ ...selection(row.id, 'degree'), message: '学位信息有歧义' }];
  const candidates = getRecordReviewCandidates(editor, selection(row.id));
  assert.deepEqual(candidates.eligible.map(item => item.field), ['school', 'level']);
  assert.deepEqual(new Set(candidates.skipped.map(item => item.field)), new Set(['major', 'degree', 'gpa', 'startDate']));
  assert.deepEqual(candidates.alreadyConfirmed, []);
  assert.deepEqual(confirmRecord(editor, selection(row.id)), { confirmed: 2, skipped: 4, alreadyConfirmed: 0 });
  assert.deepEqual(confirmRecord(editor, selection(row.id)), { confirmed: 0, skipped: 4, alreadyConfirmed: 2 }, '重复点击不重复确认');
  for(const item of candidates.skipped)assert.equal(getFieldReview(editor, item).confirmed, false);
});

test('整段核对按模块和经历 ID 隔离，修改整段确认过的字段立即失效', () => {
  const editor = editorFixture();
  editor.content.experience[0].id = 'edu-1';
  editor.review.fields.push({ ...selection('edu-1', 'position', 'experience'), value: 'Java 开发实习生', ranges: [{ start: 36, end: 45 }] });
  assert.deepEqual(confirmRecord(editor, selection('edu-1')), { confirmed: 1, skipped: 1, alreadyConfirmed: 0 });
  assert.equal(getFieldReview(editor, selection('edu-2')).confirmed, false);
  assert.equal(getFieldReview(editor, selection('edu-1', 'position', 'experience')).confirmed, false);
  editor.content.education[0].level = '专科';
  assert.equal(getFieldReview(editor, selection('edu-1')).state, 'changed');
  assert.deepEqual(confirmRecord(editor, selection('edu-1')), { confirmed: 0, skipped: 2, alreadyConfirmed: 0 });
  invalidateField(editor, selection('edu-1'));
  editor.content.education[0].level = '本科';
  assert.equal(getFieldReview(editor, selection('edu-1')).confirmed, false, '恢复原值仍需要用户重新核对');
});

test('无原文或不存在的记录没有批量候选或下一项，不会生成确认', () => {
  const editor = editorFixture();
  assert.deepEqual(confirmRecord(editor, selection('missing')), { confirmed: 0, skipped: 0, alreadyConfirmed: 0 });
  editor.sourceText = '';
  assert.deepEqual(getPendingReviewItems(editor), []);
  assert.deepEqual(getRecordReviewCandidates(editor, selection('edu-1')), { eligible: [], skipped: [], alreadyConfirmed: [] });
  assert.deepEqual(confirmRecord(editor, selection('edu-1')), { confirmed: 0, skipped: 0, alreadyConfirmed: 0 });
  assert.equal(getNextReviewItem(editor, selection('edu-1')), null);
  assert.deepEqual(editor.review.confirmations, []);
});

test('原文使用 UTF-16 偏移，高亮中文和 emoji 并对所有内容转义', () => {
  const text = '简历😀<script>alert("x")</script>\nJava & SQL';
  const start = text.indexOf('<script>'), end = text.indexOf('\n');
  const html = renderSourceText(text, [{ start: 2, end: 4 }, { start, end }]);
  assert.match(html, /<mark data-source-hit>😀&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;<\/mark>/);
  assert.match(html, /Java &amp; SQL/);
  assert.doesNotMatch(html, /<script>|<\/script>/);
  assert.equal((html.match(/class="source-line(?: has-source-hit)?"/g) || []).length, 2);
});

test('重叠和相邻范围合并，跨行范围逐行高亮，输入范围不会被修改', () => {
  const text = 'ABCDEF\nGHIJ\nKLM';
  const ranges = [{ start: 8, end: 10 }, { start: 1, end: 4 }, { start: 3, end: 8 }, { start: 12, end: 14 }];
  const original = structuredClone(ranges);
  const html = renderSourceText(text, ranges);
  assert.match(html, />A<mark data-source-hit>BCDEF<\/mark>/);
  assert.match(html, /<mark data-source-hit>GHI<\/mark>J/);
  assert.match(html, /<mark data-source-hit>KL<\/mark>M/);
  assert.equal((html.match(/<mark data-source-hit>/g) || []).length, 3);
  assert.deepEqual(ranges, original);
});

test('非法偏移不产生高亮，空行和空原文保留可见行结构', () => {
  const text = '本科\n\n末行';
  const invalid = [{ start: -1, end: 2 }, { start: 0, end: 999 }, { start: 2, end: 2 }, { start: 3, end: 1 }, { start: 0.5, end: 2 }, { start: '0', end: 2 }, { start: 0, end: NaN }];
  const html = renderSourceText(text, invalid);
  assert.doesNotMatch(html, /<mark/);
  assert.match(html, /aria-hidden="true">2<\/span><span class="source-line-text">&#8203;<\/span>/);
  assert.match(renderSourceText(''), /aria-hidden="true">1<\/span><span class="source-line-text">&#8203;<\/span>/);
  const editor = editorFixture();
  editor.review.fields[0].ranges = invalid;
  assert.equal(getFieldReview(editor, selection('edu-1')).state, 'unmatched');
});
