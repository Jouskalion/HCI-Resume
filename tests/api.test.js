import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { emptyResume } from '../server/parser.js';

const sampleText = `林同学\nJava 后端开发\n邮箱：lin@example.com\n电话：13800138000\n教育背景\n2022.09 - 2026.06 示例大学 计算机科学与技术 本科\n实习经历\n2025.07 - 2025.09 示例科技有限公司 Java 后端开发实习生\n负责订单查询接口开发，使用 Spring Boot 和 MySQL。\n优化查询，将响应时间从 800ms 降低至 300ms。\n荣誉奖项\n2025.05 软件设计大赛 省级一等奖\n项目经历\n2025.01 - 2025.04 校园预约系统\n负责后端预约接口、身份验证和数据库设计。`;

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'jianxu-api-'));
  const app = createApp({ dataDir, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const isForm = body instanceof FormData;
    const response = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
    });
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, headers: response.headers, data: type.includes('application/json') ? await response.json() : await response.text() };
  };
  const register = async (email = 'owner@example.com') => {
    const response = await request('/api/auth/register', { method: 'POST', body: { name: '测试用户', email, password: 'a-secure-password' } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    return { cookie: setCookie.split(';')[0], user: response.data.user };
  };
  return { app, server, dataDir, base, request, register };
}

test('完整流程：注册、导入、核对、发布快照、更新、下架、复用链接与删除', async t => {
  const { request, register, base } = await fixture(t);
  const health = await request('/api/health');
  assert.deepEqual(health.data, { ok: true });
  assert.match(health.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(health.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal((await request('/api/config')).data.maxUploadMB, 8);
  assert.deepEqual((await request('/api/auth/me')).data, { user: null });
  assert.equal((await request('/api/resumes')).status, 401);
  assert.equal((await request('/api/import', { method: 'POST', body: { text: sampleText } })).status, 401);
  const { cookie, user } = await register();
  assert.equal(user.email, 'owner@example.com');
  assert.equal('password_hash' in user, false);
  assert.deepEqual((await request('/api/auth/me', { cookie })).data.user, user);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: '重复', email: user.email, password: 'a-secure-password' } })).status, 409);

  const imported = await request('/api/import', { method: 'POST', cookie, body: { text: sampleText } });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(typeof imported.data.method, 'string');
  assert.match(imported.data.sourceText, /800ms/);
  assert.ok(Array.isArray(imported.data.content.education));
  assert.ok(Array.isArray(imported.data.warnings));
  assert.equal((await request('/api/resumes', { cookie })).data.resumes.length, 0, '导入本身不能创建或发布');

  const content = imported.data.content;
  content.profile.name = '林同学';
  content.profile.phone = '13800138000';
  content.profile.email = 'lin@example.com';
  content.profile.summary = '我的最初简介';
  content.awards = [{ id: 'award-1', name: '未公开奖项', date: '2025', level: '省级', prize: '一等奖', issuer: '', contribution: '' }];
  content.settings.hidden = ['awards'];
  content.settings.showPhone = false;
  content.settings.showEmail = false;
  const publishedOrder = [...content.settings.order];
  const created = await request('/api/resumes', { method: 'POST', cookie, body: { title: 'Java 开发简历', content, sourceText: sampleText, warnings: [{ section: 'profile', field: 'name', message: '请核对姓名' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.resume.id;
  assert.equal(created.data.resume.status, 'draft');
  assert.equal(created.data.resume.hasUnpublishedChanges, false);
  assert.equal(created.data.resume.shareUrl, null);

  const published = await request(`/api/resumes/${id}/publish`, { method: 'POST', cookie });
  assert.equal(published.status, 200);
  const slug = published.data.resume.slug;
  assert.equal(published.data.resume.status, 'published');
  assert.equal(published.data.resume.shareUrl, `${base}/r/${slug}`);
  assert.equal(published.data.resume.hasUnpublishedChanges, false);
  const publicVersion = await request(`/api/public/${slug}`);
  assert.equal(publicVersion.status, 200);
  assert.deepEqual(Object.keys(publicVersion.data.resume).sort(), ['content', 'publishedAt', 'title']);
  assert.equal(publicVersion.data.resume.content.profile.phone, '');
  assert.equal(publicVersion.data.resume.content.profile.email, '');
  assert.deepEqual(publicVersion.data.resume.content.awards, []);
  assert.deepEqual(publicVersion.data.resume.content.settings.order, publishedOrder);
  assert.equal(JSON.stringify(publicVersion.data).includes('未公开奖项'), false);
  assert.equal(JSON.stringify(publicVersion.data).includes('请核对姓名'), false);

  content.profile.summary = '修改中的简介';
  const revisedOrder = ['projects', 'education', 'experience', 'awards', 'skills'];
  content.settings.order = revisedOrder;
  let saved = await request(`/api/resumes/${id}`, { method: 'PUT', cookie, body: { title: '更新后的名称', content } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.resume.hasUnpublishedChanges, true);
  assert.equal(saved.data.resume.sourceText, sampleText, '未提交原文应保留');
  assert.equal((await request(`/api/public/${slug}`)).data.resume.content.profile.summary, '我的最初简介');
  assert.deepEqual((await request(`/api/public/${slug}`)).data.resume.content.settings.order, publishedOrder, '草稿排序不能提前改变 HR 看到的顺序');
  assert.deepEqual(saved.data.resume.content.settings.hidden, ['awards'], '排序不能改变隐藏模块的选择');
  assert.equal((await request('/api/resumes', { cookie })).data.resumes[0].hasUnpublishedChanges, true);
  content.profile.summary = '我的最初简介';
  content.settings.order = publishedOrder;
  saved = await request(`/api/resumes/${id}`, { method: 'PUT', cookie, body: { title: 'Java 开发简历', content } });
  assert.equal(saved.data.resume.hasUnpublishedChanges, false, '恢复成发布版时不应再提示未发布修改');

  content.profile.summary = '已核对的新简介';
  content.settings.order = revisedOrder;
  await request(`/api/resumes/${id}`, { method: 'PUT', cookie, body: { title: 'Java 开发简历', content } });
  const updated = await request(`/api/resumes/${id}/publish`, { method: 'POST', cookie });
  assert.equal(updated.data.resume.slug, slug);
  assert.equal(updated.data.resume.hasUnpublishedChanges, false);
  assert.equal((await request(`/api/public/${slug}`)).data.resume.content.profile.summary, '已核对的新简介');
  assert.deepEqual((await request(`/api/public/${slug}`)).data.resume.content.settings.order, revisedOrder, '重新发布后才同步新顺序');
  const unpublished = await request(`/api/resumes/${id}/unpublish`, { method: 'POST', cookie });
  assert.equal(unpublished.data.resume.status, 'draft');
  assert.equal(unpublished.data.resume.slug, slug);
  assert.equal(unpublished.data.resume.shareUrl, null);
  assert.equal((await request(`/api/public/${slug}`)).status, 404);
  assert.equal((await request(`/api/resumes/${id}/publish`, { method: 'POST', cookie })).data.resume.slug, slug);
  assert.equal((await request(`/api/resumes/${id}`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await request(`/api/public/${slug}`)).status, 404);
  assert.equal((await request(`/api/resumes/${id}`, { cookie })).status, 404);
});

test('账号隔离、登录密码验证、session 注销和私有数据保护', async t => {
  const { request, register } = await fixture(t);
  const owner = await register();
  const other = await register('other@example.com');
  const content = emptyResume();
  content.profile.name = '仅所有者可编辑';
  const created = await request('/api/resumes', { method: 'POST', cookie: owner.cookie, body: { content, sourceText: '私人原文', expectedUserId: owner.user.id } });
  assert.equal(created.status, 201);
  const id = created.data.resume.id;
  assert.deepEqual((await request('/api/resumes', { cookie: other.cookie })).data.resumes, []);
  const changedAccount = await request('/api/resumes', { method: 'POST', cookie: other.cookie, body: { content, sourceText: '不应转移到其他账号的导入原文', expectedUserId: owner.user.id } });
  assert.equal(changedAccount.status, 409, '异步导入期间其他标签页切换账号后，不应将原账号的简历存到新账号');
  assert.deepEqual((await request('/api/resumes', { cookie: other.cookie })).data.resumes, []);
  for (const [method, suffix] of [['GET', ''], ['PUT', ''], ['DELETE', ''], ['POST', '/publish'], ['POST', '/unpublish']]) {
    const response = await request(`/api/resumes/${id}${suffix}`, { method, cookie: other.cookie, ...(method === 'PUT' ? { body: { title: '非法修改', content } } : {}) });
    assert.equal(response.status, 404, method + suffix);
    assert.equal(JSON.stringify(response.data).includes('私人原文'), false);
  }
  assert.equal((await request(`/api/resumes/${id}`, { cookie: owner.cookie })).data.resume.content.profile.name, '仅所有者可编辑');
  const loginWrong = await request('/api/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: 'wrong-password' } });
  assert.equal(loginWrong.status, 401);
  const missingUser = await request('/api/auth/login', { method: 'POST', body: { email: 'missing@example.com', password: 'wrong-password' } });
  assert.equal(missingUser.status, 401);
  assert.equal(missingUser.data.error, loginWrong.data.error);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'OWNER@EXAMPLE.COM', password: 'a-secure-password' } });
  assert.equal(login.status, 200);
  const newCookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/auth/me', { cookie: newCookie })).data.user.id, owner.user.id);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: newCookie })).status, 200);
  assert.equal((await request('/api/auth/me', { cookie: newCookie })).data.user, null);
  assert.equal((await request('/api/resumes', { cookie: newCookie })).status, 401);
});

test('表单文件导入、输入验证、错误格式和跨站请求保护', async t => {
  const { request, register, base } = await fixture(t);
  const { cookie } = await register();
  const textForm = new FormData();
  textForm.append('file', new Blob([sampleText], { type: 'text/plain' }), 'resume.txt');
  const fileImport = await request('/api/import', { method: 'POST', cookie, body: textForm });
  assert.equal(fileImport.status, 200, JSON.stringify(fileImport.data));
  assert.match(fileImport.data.sourceText, /订单查询/);
  const badForm = new FormData();
  badForm.append('file', new Blob(['bad file']), 'resume.exe');
  assert.equal((await request('/api/import', { method: 'POST', cookie, body: badForm })).status, 400);
  const invalidPdf = new FormData();
  invalidPdf.append('file', new Blob(['this is not a PDF document']), 'invalid.pdf');
  const invalidResult = await request('/api/import', { method: 'POST', cookie, body: invalidPdf });
  assert.equal(invalidResult.status, 422, JSON.stringify(invalidResult.data));
  assert.equal(typeof invalidResult.data.error, 'string');
  const tooLarge = new FormData();
  tooLarge.append('file', new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]), 'big.txt');
  assert.equal((await request('/api/import', { method: 'POST', cookie, body: tooLarge })).status, 413);
  for (const body of [{ text: '' }, { text: 'abc' }, { text: [] }, { text: '中'.repeat(100_001) }, { text: sampleText, useAI: 'yes' }]) {
    assert.equal((await request('/api/import', { method: 'POST', cookie, body })).status, 400);
  }
  const malformedJson = await fetch(base + '/api/resumes', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(malformedJson.status, 400);
  assert.equal(typeof (await malformedJson.json()).error, 'string');
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { title: '跨站创建' }, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { title: '本站创建' }, headers: { Origin: base } })).status, 201);
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { title: { x: 1 } } })).status, 400);
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { content: { profile: { name: 123 } } } })).status, 400);
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { content: { settings: { showPhone: 'false' } } } })).status, 400);
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { content: { settings: { order: ['unknown'] } } } })).status, 400);
  assert.equal((await request('/api/resumes', { method: 'POST', cookie, body: { content: { experience: [{ type: 'invalid' }] } } })).status, 400);
  const unnamed = (await request('/api/resumes', { method: 'POST', cookie, body: {} })).data.resume;
  assert.equal((await request(`/api/resumes/${unnamed.id}/publish`, { method: 'POST', cookie })).status, 400);
  assert.equal((await request('/api/no-such-endpoint')).status, 404);
  assert.equal((await request('/api/public/unknown')).status, 404);
});

test('配置分享域名、Secure Cookie 和数据库重启持久化', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jianxu-persistence-'));
  const options = { dataDir, publicBaseUrl: 'https://resume.example.com', secureCookies: true };
  let app = createApp(options);
  let server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '持久化用户', email: 'persist@example.com', password: 'a-secure-password' }) });
  assert.equal(registration.status, 201);
  const setCookie = registration.headers.get('set-cookie');
  assert.match(setCookie, /; Secure/i);
  const cookie = setCookie.split(';')[0];
  const content = emptyResume();
  content.profile.name = '持久化姓名';
  const created = await fetch(base + '/api/resumes', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '持久化简历', content }) });
  const { resume } = await created.json();
  const published = await fetch(base + `/api/resumes/${resume.id}/publish`, { method: 'POST', headers: { Cookie: cookie } });
  const record = (await published.json()).resume;
  assert.equal(record.shareUrl, `https://resume.example.com/r/${record.slug}`);
  await new Promise(resolve => server.close(resolve));
  app.locals.close();
  app = createApp(options);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const restored = await fetch(base + `/api/resumes/${resume.id}`, { headers: { Cookie: cookie } });
  assert.equal(restored.status, 200, '登录会话与简历应跨重启保留');
  assert.equal((await restored.json()).resume.content.profile.name, '持久化姓名');
  const publicRestored = await fetch(base + `/api/public/${record.slug}`);
  assert.equal((await publicRestored.json()).resume.title, '持久化简历');
});

test('连续登录失败触发基础限流', async t => {
  const { request } = await fixture(t);
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'invalid-password' } })).status, 401);
  }
  const blocked = await request('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'invalid-password' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('中文 DOCX/PDF 经真实上传后提取学历与实习记录', async t => {
  const { request, register } = await fixture(t);
  const { cookie } = await register();
  for (const extension of ['docx', 'pdf']) {
    const bytes = await readFile(new URL(`./fixtures/resume-zh.${extension}`, import.meta.url));
    const body = new FormData();
    body.append('file', new Blob([bytes]), `resume-zh.${extension}`);
    const imported = await request('/api/import', { method: 'POST', cookie, body });
    assert.equal(imported.status, 200, `${extension}: ${JSON.stringify(imported.data)}`);
    assert.equal(imported.data.content.education[0].school, '示例大学', extension);
    assert.equal(imported.data.content.education[0].level, '本科', extension);
    assert.equal(imported.data.content.education[0].degree, '学士', extension);
    assert.equal(imported.data.content.experience[0].company, '示例科技有限公司', extension);
    assert.match(imported.data.content.experience[0].position, /Java.*后端.*实习/, extension);
    assert.match(imported.data.content.experience[0].achievements, /800ms.*300ms/, extension);
  }
});

test('全服务最多同时解析四份简历，完成后释放名额', async t => {
  const pendingResponses = [];
  let allReached;
  const reached = new Promise(resolve => { allReached = resolve; });
  const mockAI = createServer(async (req, res) => {
    for await (const chunk of req) { /* Consume input without retaining resume contents. */ }
    pendingResponses.push(res);
    if (pendingResponses.length === 4) allReached();
  });
  mockAI.listen(0, '127.0.0.1');
  await new Promise(resolve => mockAI.once('listening', resolve));
  t.after(async () => {
    mockAI.closeAllConnections();
    await new Promise(resolve => mockAI.close(resolve));
  });
  const keys = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const { request, register } = await fixture(t);
  const { cookie } = await register();
  let requests = [];
  let timer;
  try {
    process.env.AI_BASE_URL = `http://127.0.0.1:${mockAI.address().port}/v1`;
    process.env.AI_API_KEY = 'local-test-only';
    process.env.AI_MODEL = 'test';
    assert.equal((await request('/api/config')).data.aiAvailable, true);
    requests = Array.from({ length: 4 }, () => request('/api/import', { method: 'POST', cookie, body: { text: sampleText, useAI: true } }));
    await Promise.race([reached, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('测试解析请求未到达本地模型服务')), 5000); })]);
    clearTimeout(timer);
    const rejected = await request('/api/import', { method: 'POST', cookie, body: { text: sampleText } });
    assert.equal(rejected.status, 429);
    for (const response of pendingResponses) response.writeHead(503).end();
    const results = await Promise.all(requests);
    assert.ok(results.every(result => result.status === 200 && result.data.method === 'rules'));
    assert.equal((await request('/api/import', { method: 'POST', cookie, body: { text: sampleText } })).status, 200);
  } finally {
    clearTimeout(timer);
    for (const response of pendingResponses) if (!response.writableEnded) response.writeHead(503).end();
    mockAI.closeAllConnections();
    await Promise.allSettled(requests);
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
  }
});
