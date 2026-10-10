import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDocument } from '../server/extract.js';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));

for (const extension of ['txt', 'docx', 'pdf']) {
  test(`真实中文 ${extension.toUpperCase()} 文本提取保留学历、岗位和成果`, async () => {
    const name = `resume-zh.${extension}`;
    const text = await extractDocument(await fixture(name), name);
    assert.equal(typeof text, 'string');
    assert.match(text, /示例大学/);
    assert.match(text, /本科/);
    assert.match(text, /示例科技有限公司/);
    assert.match(text, /实习生/);
    assert.match(text, /800ms/);
    assert.match(text, /300ms/);
    assert.match(text, /省级二等奖/);
  });
}

test('没有文本层的 PDF 返回明确错误，而非空白解析成功', async () => {
  const buffer = await fixture('no-text.pdf');
  await assert.rejects(() => extractDocument(buffer, 'no-text.pdf'), /扫描|文字|文本/);
});

test('加密 PDF 拒绝并提示处理方式', async () => {
  await assert.rejects(() => fixture('encrypted.pdf').then(buffer => extractDocument(buffer, 'encrypted.pdf')), /密码|加密/);
});

test('损坏的 PDF 和错误后缀不会被当作普通简历', async () => {
  await assert.rejects(() => extractDocument(Buffer.from('this is not a pdf'), 'bad.pdf'));
  await assert.rejects(() => extractDocument(Buffer.from('hello'), 'resume.exe'));
});
