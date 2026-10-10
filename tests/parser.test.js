import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { emptyResume, parseResume } from '../server/parser.js';

const sample = await readFile(new URL('../samples/林知远-虚构测试简历.txt', import.meta.url), 'utf8');

test('中文标准简历准确分组：两段教育、两段实习、三个奖项、两个项目', async () => {
  const { content: c, sourceText, method } = await parseResume(sample);
  assert.equal(method, 'rules');
  assert.equal(sourceText, sample.trim());
  assert.equal(c.profile.name, '林知远');
  assert.equal(c.profile.email, 'lin.zhiyuan@example.com');
  assert.equal(c.profile.headline, 'Java 后端开发实习生');
  assert.equal(c.education.length, 2);
  assert.equal(c.education[0].school, '示例理工大学');
  assert.equal(c.education[0].level, '硕士研究生');
  assert.equal(c.education[0].status, '在读');
  assert.equal(c.education[0].degree, '');
  assert.equal(c.education[1].degree, '工学学士');
  assert.equal(c.education[1].gpa, '3.78/4.0');
  assert.equal(c.education[1].ranking, '8/120');
  assert.equal(c.experience.length, 2);
  assert.equal(c.experience[0].company, '示例云帆科技有限公司');
  assert.equal(c.experience[0].position, 'Java 后端开发实习生');
  assert.equal(c.experience[0].startDate, '2026.03');
  assert.equal(c.experience[0].department, '业务研发部');
  assert.match(c.experience[0].responsibilities, /订单查询接口/);
  assert.match(c.experience[0].achievements, /800ms.*300ms/);
  assert.doesNotMatch(c.experience[0].responsibilities, /工单/);
  assert.equal(c.experience[1].company, '示例青禾信息有限公司');
  assert.equal(c.experience[1].position, '软件开发实习生');
  assert.equal(c.experience[1].startDate, '2025.07');
  assert.match(c.experience[1].responsibilities, /工单平台/);
  assert.equal(c.awards.length, 3);
  assert.equal(c.awards[0].level, '省级');
  assert.equal(c.awards[0].prize, '二等奖');
  assert.match(c.awards[0].contribution, /团队成员/);
  assert.equal(c.awards[2].level, '');
  assert.equal(c.projects.length, 2);
  assert.equal(c.projects[0].name, '校园图书借阅系统');
  assert.equal(c.projects[0].role, '后端负责人');
  assert.match(c.projects[0].responsibilities, /幂等处理/);
  assert.equal(c.projects[1].name, '轻量任务协作平台');
  assert.match(c.projects[1].responsibilities, /角色访问控制/);
  assert.equal(c.skills.length, 4);
  assert.equal(c.settings.showPhone, false);
});

test('空白/超长输入给出可行动错误；缺失经历不编造', async () => {
  await assert.rejects(parseResume('  '), /粘贴/);
  await assert.rejects(parseResume('字'.repeat(60001)), /60,000/);
  const { content, warnings } = await parseResume('姓名：李安\n邮箱：li@example.com\n求职意向：后端开发');
  for (const key of ['education', 'experience', 'awards', 'projects', 'skills']) assert.deepEqual(content[key], []);
  assert.equal(content.profile.phone, '');
  assert(warnings.some(x => /没有识别到经历/.test(x.message)));
});

test('同义标题、日期独立一行、无公司后缀和缺失学位', async () => {
  const text = `姓名：王华\n学习经历\n2023年9月 至 2027年6月\n示例大学 | 计算机科学与技术 | 本科在读\n实习经验\n2025.06-2025.09 字节示例 Java后端开发实习生\n负责搜索接口开发。\n2026.06-2026.09\n示例星河有限公司 | 数据分析实习生\n工作内容：分析日志。\n获奖情况\n2025年 示例算法比赛 一等奖\n项目经验\n项目名称：示例平台\n角色：后端负责人\n项目简介：课程系统。\n个人职责：实现登录。`;
  const { content: c } = await parseResume(text);
  assert.equal(c.education[0].school, '示例大学');
  assert.equal(c.education[0].startDate, '2023.09');
  assert.equal(c.education[0].endDate, '2027.06');
  assert.equal(c.education[0].degree, '');
  assert.equal(c.experience.length, 2);
  assert.equal(c.experience[0].company, '字节示例');
  assert.equal(c.experience[1].startDate, '2026.06');
  assert.equal(c.experience[0].endDate, '2025.09');
  assert.equal(c.awards[0].name, '示例算法比赛 一等奖');
  assert.equal(c.awards[0].level, '');
  assert.equal(c.projects[0].role, '后端负责人');
});

test('学历、实习缺项保留并给出字段警告，混合工作和实习保留类型', async () => {
  const { content: c, warnings } = await parseResume('姓名：孙明\n教育背景\n学校：示例大学\n专业：数学\n工作经历\n2020.06-2022.06 示例甲有限公司 | 软件工程师\n工作内容：维护服务。\n实习经历\n示例乙有限公司\n负责接口测试。');
  assert.equal(c.experience[0].type, 'work');
  assert.equal(c.experience[1].type, 'internship');
  assert.equal(c.experience[1].position, '');
  assert(warnings.some(w => w.section === 'education' && w.field === 'level'));
  assert(warnings.some(w => w.section === 'experience' && w.field === 'position' && w.recordId === c.experience[1].id));
});

test('原始数字和项目范围原样保留，未知文本仍存在于sourceText', async () => {
  const text = '姓名：赵乐\n个人简介\n热爱编程。\n其他补充：这里没有标准栏目。\n实习经历\n示例公司 | Java 开发实习生 | 2024.01-2024.03\n成果：某查询接口平均响应时间从800ms降低至300ms。';
  const result = await parseResume(text);
  assert.equal(result.sourceText, text);
  assert.match(result.content.profile.summary, /热爱编程/);
  assert.equal(result.content.experience[0].achievements, '某查询接口平均响应时间从800ms降低至300ms。');
  assert.equal(result.content.experience[0].startDate, '2024.01');
});

test('同校不同学历、同公司不同周期不会合并，独立奖项日期能对应', async () => {
  const { content: c } = await parseResume('姓名：郑雨\n教育背景\n2022年-2026年 示例大学 软件工程 本科\n2026年-2029年 示例大学 计算机技术 硕士研究生 在读\n实习经历\n2024.07-2024.09 示例公司 Java开发实习生\n负责接口测试。\n2025.07-2025.09 示例公司 Java开发实习生\n负责消息队列。\n荣誉奖项\n示例程序设计赛\n2024.06 校级 一等奖');
  assert.equal(c.education.length, 2);
  assert.equal(c.education[0].startDate, '2022');
  assert.equal(c.education[1].level, '硕士研究生');
  assert.equal(c.experience.length, 2);
  assert.doesNotMatch(c.experience[0].responsibilities, /消息队列/);
  assert.match(c.experience[1].responsibilities, /消息队列/);
  assert.equal(c.awards.length, 1);
  assert.equal(c.awards[0].date, '2024.06');
});

test('AI 必须用户显式选择：没有配置回退，配置后默认不发送，失败回退，成功白名单过滤', async () => {
  const envKeys = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let requestCount = 0; let mode = 'error'; let received;
  const server = createServer(async (req, res) => {
    requestCount++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks));
    if (mode === 'error') { res.writeHead(503); return res.end('{}'); }
    const c = emptyResume();
    c.profile.name = '林知远';
    c.education = [{ school: '示例理工大学', major: '计算机技术', level: '硕士研究生', degree: '', startDate: '2026.09', endDate: '2029.06', status: '在读', gpa: '', ranking: '', courses: '', evil: 'ignored' }];
    c.settings.showPhone = true;
    c.profile.email = 'invented@example.com';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(c) } }] }));
  });
  try {
    envKeys.forEach(key => delete process.env[key]);
    const unavailable = await parseResume(sample, { useAI: true });
    assert.equal(unavailable.method, 'rules');
    assert(unavailable.warnings.some(w => /没有发送/.test(w.message)));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    process.env.AI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    process.env.AI_API_KEY = 'local-test-only'; process.env.AI_MODEL = 'mock';
    await parseResume(sample);
    await parseResume(sample, { useAI: 'true' });
    assert.equal(requestCount, 0);
    const failed = await parseResume(sample, { useAI: true });
    assert.equal(failed.method, 'rules');
    assert.equal(failed.content.education.length, 2);
    assert(failed.warnings.some(w => /回退/.test(w.message)));
    mode = 'success';
    const succeeded = await parseResume(sample, { useAI: true });
    assert.equal(succeeded.method, 'ai');
    assert.equal(succeeded.content.profile.email, '');
    assert.equal(succeeded.content.education.length, 2);
    assert.equal(succeeded.content.experience.length, 2);
    assert(succeeded.warnings.some(w => /条目少于/.test(w.message)));
    assert.equal(succeeded.content.settings.showPhone, false);
    assert.equal(succeeded.content.education[0].evil, undefined);
    assert.equal(JSON.parse(received.messages[1].content).sourceText, sample.trim());
    assert.match(received.messages[0].content, /不可信/);
    assert.equal(requestCount, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    envKeys.forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]);
  }
});
