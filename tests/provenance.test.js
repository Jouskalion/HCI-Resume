import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildReview, reconcileReview } from '../server/provenance.js';
import { normalizeContent, resumeInput } from '../server/validation.js';
import { openStore } from '../server/store.js';
import { parseResume } from '../server/parser.js';

const field = (review, section, recordId, name) => review.fields.find(item => item.section === section && item.recordId === recordId && item.field === name);
const evidenceText = (review, section, recordId, name, source) => field(review, section, recordId, name).ranges.map(range => source.slice(range.start, range.end));

test('证据范围使用原文 UTF-16 偏移，规范化日期与多行职责仍对应原文', () => {
  const source = '📄 周予安\r\n求职意向：Java 后端开发\r\n教育背景\r\n杭州电子科技大学 | 软件工程 | 本科\r\n2022年9月—2026年6月\r\n实习经历\r\n恒生电子股份有限公司 | Java 开发实习生 | 2025年7月—2025年10月\r\n职责：开发订单接口\r\n• 编写接口测试\r\n';
  const content = normalizeContent({
    profile: { name: '周予安', headline: 'Java 后端开发' },
    education: [{ id: 'edu', school: '杭州电子科技大学', major: '软件工程', level: '本科', startDate: '2022.09', endDate: '2026.06' }],
    experience: [{ id: 'job', company: '恒生电子股份有限公司', position: 'Java 开发实习生', startDate: '2025.07', endDate: '2025.10', responsibilities: '开发订单接口\n编写接口测试' }],
  });
  const review = buildReview(content, source);
  assert.deepEqual(field(review, 'profile', 'profile', 'name').ranges, [{ start: source.indexOf('周予安'), end: source.indexOf('周予安') + 3 }]);
  assert.equal(field(review, 'experience', 'job', 'endDate').match, 'normalized');
  assert.deepEqual(evidenceText(review, 'experience', 'job', 'endDate', source), ['2025年10月']);
  assert.deepEqual(evidenceText(review, 'education', 'edu', 'startDate', source), ['2022年9月']);
  assert.deepEqual(evidenceText(review, 'experience', 'job', 'responsibilities', source), ['开发订单接口', '编写接口测试']);
  for (const item of review.fields) for (const range of item.ranges) assert.ok(range.start >= 0 && range.end > range.start && range.end <= source.length);
});

test('重复学校和公司按各自日期及岗位定位，不取全篇第一个相同字段', () => {
  const source = `教育背景\n2020.09—2024.06 杭州电子科技大学 软件工程 本科\n专业排名：18/156\n2024.09—2027.06 杭州电子科技大学 软件工程 硕士\n专业排名：3/40\n实习经历\n2024.07—2024.09 恒生电子股份有限公司 测试实习生\n负责接口回归测试\n2025.10—2025.12 恒生电子股份有限公司 Java 开发实习生\n负责支付接口开发\n`;
  const content = normalizeContent({
    education: [
      { id: 'bachelor', school: '杭州电子科技大学', major: '软件工程', level: '本科', startDate: '2020.09', endDate: '2024.06', ranking: '18/156' },
      { id: 'master', school: '杭州电子科技大学', major: '软件工程', level: '硕士', startDate: '2024.09', endDate: '2027.06', ranking: '3/40' },
    ],
    experience: [
      { id: 'qa', company: '恒生电子股份有限公司', position: '测试实习生', startDate: '2024.07', endDate: '2024.09', responsibilities: '负责接口回归测试' },
      { id: 'dev', company: '恒生电子股份有限公司', position: 'Java 开发实习生', startDate: '2025.10', endDate: '2025.12', responsibilities: '负责支付接口开发' },
    ],
  });
  const review = buildReview(content, source);
  assert.equal(field(review, 'education', 'master', 'school').ranges[0].start, source.lastIndexOf('杭州电子科技大学'));
  assert.equal(field(review, 'experience', 'dev', 'company').ranges[0].start, source.lastIndexOf('恒生电子股份有限公司'));
  assert.deepEqual(evidenceText(review, 'experience', 'dev', 'endDate', source), ['2025.12']);
  assert.deepEqual(evidenceText(review, 'education', 'bachelor', 'ranking', source), ['18/156']);
  content.experience[1].responsibilities = '负责接口回归测试';
  assert.equal(field(buildReview(content, source), 'experience', 'dev', 'responsibilities').match, 'unmatched', '同公司另一段职责不能成为该字段证据');
});

test('日期单独位于公司前一行时归入正确经历', () => {
  const source = '实习经历\n2024年7月—2024年9月\n恒生电子股份有限公司\n测试实习生\n负责测试\n2025年7月—2025年9月\n恒生电子股份有限公司\nJava 开发实习生\n负责开发';
  const content = normalizeContent({ experience: [
    { id: 'a', company: '恒生电子股份有限公司', position: '测试实习生', startDate: '2024.07', endDate: '2024.09' },
    { id: 'b', company: '恒生电子股份有限公司', position: 'Java 开发实习生', startDate: '2025.07', endDate: '2025.09' },
  ] });
  const review = buildReview(content, source);
  assert.deepEqual(evidenceText(review, 'experience', 'b', 'startDate', source), ['2025年7月']);
  assert.deepEqual(evidenceText(review, 'experience', 'a', 'endDate', source), ['2024年9月']);
});

test('无法区分的重复记录、重复字段和原文缺失的声称不会生成误导范围', () => {
  const source = '教育背景\n杭州电子科技大学 本科\n课程：数据库\n杭州电子科技大学 本科\n课程：数据库\n实习经历\n恒生电子股份有限公司 Java 实习生\n使用 Java 和 Java\n开发接口';
  const content = normalizeContent({
    education: [{ id: 'edu', school: '杭州电子科技大学', level: '本科' }],
    experience: [{ id: 'job', company: '恒生电子股份有限公司', technologies: 'Java', responsibilities: '开发接口\n效率提升50%' }],
  });
  const review = buildReview(content, source);
  assert.equal(field(review, 'education', 'edu', 'school').match, 'ambiguous');
  assert.deepEqual(field(review, 'education', 'edu', 'school').ranges, []);
  assert.equal(field(review, 'experience', 'job', 'technologies').match, 'ambiguous');
  assert.equal(field(review, 'experience', 'job', 'responsibilities').match, 'unmatched');
  assert.deepEqual(field(review, 'experience', 'job', 'responsibilities').ranges, []);
});

test('普通排版规范化保存原文范围，不生成摘要、推断及其他章节的证据', () => {
  const source = '周予安\n教育背景\n杭州电子科技大学\n软件 工程\n本科\n实习经历\n恒生电子股份有限公司\n使用 Spring Boot、MySQL\n项目经历\n校园系统\n响应时间降低50%';
  const content = normalizeContent({
    profile: { name: '周予安', summary: '优秀的工程师' },
    education: [{ id: 'e', school: '杭州电子科技大学', major: '软件工程' }],
    experience: [{ id: 'j', company: '恒生电子股份有限公司', technologies: 'Spring Boot, MySQL', achievements: '响应时间降低50%' }],
  });
  const review = buildReview(content, source);
  assert.equal(field(review, 'education', 'e', 'major').match, 'normalized');
  assert.deepEqual(evidenceText(review, 'education', 'e', 'major', source), ['软件 工程']);
  assert.equal(field(review, 'experience', 'j', 'technologies').match, 'normalized');
  assert.deepEqual(evidenceText(review, 'experience', 'j', 'technologies', source), ['Spring Boot、MySQL']);
  assert.equal(field(review, 'experience', 'j', 'achievements').match, 'unmatched');
  assert.equal(field(review, 'profile', 'profile', 'summary').match, 'unmatched');
  const duplicated = source.replace('软件 工程', '软件 工程 / 软件工程');
  assert.equal(field(buildReview(content, duplicated), 'education', 'e', 'major').match, 'ambiguous', '不能因为其中一处为精确拼写就忽略另一处等价的排版写法');
});

test('同一处句末标点的精确与规范化匹配不构成歧义', () => {
  const source = '实习经历\n恒生电子股份有限公司\n工作内容：维护接口回归用例。\n协助复现异常输入问题。\n成果：补充 24 条回归用例。';
  const content = normalizeContent({ experience: [{ id: 'job', company: '恒生电子股份有限公司', responsibilities: '维护接口回归用例。\n协助复现异常输入问题。', achievements: '补充 24 条回归用例。' }] });
  const review = buildReview(content, source);
  assert.equal(field(review, 'experience', 'job', 'responsibilities').match, 'exact');
  assert.deepEqual(evidenceText(review, 'experience', 'job', 'responsibilities', source), ['维护接口回归用例。', '协助复现异常输入问题。']);
  assert.deepEqual(evidenceText(review, 'experience', 'job', 'achievements', source), ['补充 24 条回归用例。']);
});

test('V2 陈知行样本：同校同公司各段日期、岗位与多行职责分别定位', async () => {
  const source = await readFile(new URL('../samples/陈知行-V2核对测试.txt', import.meta.url), 'utf8');
  const parsed = await parseResume(source);
  const review = buildReview(parsed.content, parsed.sourceText);
  const [master, bachelor] = parsed.content.education;
  const [developer, tester, unnamed] = parsed.content.experience;
  assert.deepEqual(evidenceText(review, 'education', master.id, 'startDate', parsed.sourceText), ['2026年9月']);
  assert.deepEqual(evidenceText(review, 'education', master.id, 'endDate', parsed.sourceText), ['至今']);
  assert.deepEqual(evidenceText(review, 'education', bachelor.id, 'startDate', parsed.sourceText), ['2022/09']);
  assert.deepEqual(evidenceText(review, 'education', bachelor.id, 'endDate', parsed.sourceText), ['2026/06']);
  assert.ok(field(review, 'education', master.id, 'school').ranges[0].start < field(review, 'education', bachelor.id, 'school').ranges[0].start);
  assert.deepEqual(evidenceText(review, 'experience', developer.id, 'startDate', parsed.sourceText), ['2025/07']);
  assert.deepEqual(evidenceText(review, 'experience', developer.id, 'endDate', parsed.sourceText), ['2025/09']);
  assert.deepEqual(evidenceText(review, 'experience', developer.id, 'position', parsed.sourceText), ['Java 开发实习生']);
  assert.deepEqual(evidenceText(review, 'experience', tester.id, 'startDate', parsed.sourceText), ['2024年7月']);
  assert.deepEqual(evidenceText(review, 'experience', tester.id, 'endDate', parsed.sourceText), ['2024年9月']);
  assert.deepEqual(evidenceText(review, 'experience', tester.id, 'position', parsed.sourceText), ['软件测试实习生']);
  assert.deepEqual(evidenceText(review, 'experience', tester.id, 'responsibilities', parsed.sourceText), ['维护接口回归用例。', '协助开发人员复现异常输入问题。']);
  assert.deepEqual(evidenceText(review, 'experience', unnamed.id, 'startDate', parsed.sourceText), ['2023.10']);
  assert.deepEqual(evidenceText(review, 'experience', unnamed.id, 'endDate', parsed.sourceText), ['2023.12']);
  assert.equal(unnamed.position, '');
  assert.ok(review.fields.filter(item => ['education', 'experience'].includes(item.section)).every(item => ['exact', 'normalized'].includes(item.match)), '非空字段均有属于本条记录的原文证据');
});

test('确认使用字段值快照：修改失效、未改保留、删除清理、更换原文清空', () => {
  const sourceText = '周予安\n教育背景\n杭州电子科技大学 软件工程 本科';
  const content = normalizeContent({ profile: { name: '周予安' }, education: [{ id: 'edu', school: '杭州电子科技大学', major: '软件工程' }] });
  const review = buildReview(content, sourceText);
  review.confirmations = [
    { section: 'profile', recordId: 'profile', field: 'name', value: '周予安' },
    { section: 'education', recordId: 'edu', field: 'school', value: '杭州电子科技大学' },
  ];
  const current = { title: '简历', sourceText, content, review, warnings: [] };
  const modified = structuredClone(content); modified.profile.name = '周予宁';
  let next = reconcileReview(current, resumeInput({ title: '简历', content: modified }, current));
  assert.equal(next.confirmations.length, 1);
  assert.equal(next.confirmations[0].field, 'school');
  assert.deepEqual(next.fields, review.fields, '正文编辑保留提取当时的值和来源，前端可以判断已修改');
  modified.education = [];
  next = reconcileReview(current, resumeInput({ title: '简历', content: modified }, current));
  assert.ok(next.fields.every(item => item.section !== 'education'));
  assert.deepEqual(next.confirmations, []);
  next = reconcileReview(current, resumeInput({ title: '简历', content, sourceText: '周予安\n教育背景\n杭州电子科技大学 软件工程 本科\n新增一行', review: { confirmations: review.confirmations } }, current));
  assert.deepEqual(next.confirmations, [], '源文变化时不能沿用旧的人工确认');
  assert.throws(() => resumeInput({ title: '简历', content, review: { confirmations: [{ section: '__proto__', recordId: 'x', field: 'name', value: 'x' }] } }, current), /未知字段/);
  assert.throws(() => resumeInput({ title: '简历', content, review: { confirmations: {} } }, current), /核对记录/);
});

test('旧数据库增加独立 review_json，读取回填不改正文和发布快照；确认跨重启保留', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jianxu-review-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = normalizeContent({ profile: { name: '周予安' } });
  const originalJson = JSON.stringify(content);
  const publishedJson = JSON.stringify({ title: '旧简历', content });
  const db = new DatabaseSync(join(directory, 'jianxu.sqlite'));
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE resumes (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,content_json TEXT NOT NULL,source_text TEXT NOT NULL,warnings_json TEXT NOT NULL,slug TEXT UNIQUE,published_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT);`);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u', 'legacy@example.com', '旧用户', 'unused', '2025-01-01');
  db.prepare('INSERT INTO resumes VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('r', 'u', '旧简历', originalJson, '周予安', '[]', 'abcdefghijklmnop', publishedJson, '2025-01-01', '2025-01-01', '2025-01-01');
  db.close();
  let store = openStore(directory);
  let restored = store.get('r', 'u');
  assert.equal(restored.review.version, 1);
  assert.equal(field(restored.review, 'profile', 'profile', 'name').match, 'exact');
  const confirmation = { section: 'profile', recordId: 'profile', field: 'name', value: '周予安' };
  const input = resumeInput({ title: '旧简历', content, review: { confirmations: [confirmation] } }, restored);
  input.review = reconcileReview(restored, input);
  store.save('r', 'u', input); store.close();
  store = openStore(directory);
  try {
    restored = store.get('r', 'u');
    assert.deepEqual(restored.review.confirmations, [confirmation]);
    assert.equal(JSON.stringify(restored.content), originalJson);
    assert.equal(JSON.stringify(restored.published), publishedJson);
    assert.equal('review' in store.published('abcdefghijklmnop'), false);
  } finally { store.close(); }
});
