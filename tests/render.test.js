import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume, safeUrl } from '../public/resume.js';
import { emptyContent } from '../public/data.js';

test('公开简历渲染转义用户内容，链接不执行脚本', () => {
  const content = emptyContent();
  content.profile.name = '<img src=x onerror=alert(1)>';
  content.profile.summary = '<script>alert(1)</script>';
  content.profile.website = 'javascript:alert(1)';
  content.projects = [{ id: 'p', name: 'Project', responsibilities: '<svg onload=alert(1)>', url: 'data:text/html,<script>alert(1)</script>' }];
  const html = renderResume(content);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;svg'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('href="data:'));
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://example.com/project'), 'https://example.com/project');
});

test('展示顺序和隐藏设置生效，缺省联系方式不外露', () => {
  const content = emptyContent();
  content.profile.name = '虚构测试';
  content.profile.email = 'hidden-email@example.com';
  content.profile.phone = '13800000000';
  content.settings.showEmail = false;
  content.settings.showPhone = false;
  content.settings.order = ['projects', 'education', 'experience', 'awards', 'skills'];
  content.settings.hidden = ['awards'];
  content.projects = [{ id: 'p', name: '优先显示项目' }];
  content.education = [{ id: 'e', school: '其次显示学校' }];
  content.awards = [{ id: 'a', name: '不应出现的奖项' }];
  const html = renderResume(content);
  assert.ok(html.indexOf('优先显示项目') < html.indexOf('其次显示学校'));
  assert.ok(!html.includes('不应出现的奖项'));
  assert.ok(!html.includes('hidden-email@example.com'));
  assert.ok(!html.includes('13800000000'));
});
