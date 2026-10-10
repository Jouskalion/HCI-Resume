import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';

export const MAX_TEXT_LENGTH = 60000;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_PAGES = 12;

function failure(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

export function validateText(value) {
  if (typeof value !== 'string') throw failure('请粘贴简历文字，或上传 PDF、DOCX、TXT 文件。', 400);
  const text = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!text) throw failure('未读取到文字。请上传包含可选中文字的简历，或直接粘贴简历内容。');
  if (text.length > MAX_TEXT_LENGTH) throw failure('简历文字超过 60,000 字符，请删去附件或缩短内容后重试。', 413);
  return text;
}

// Reject oversized ZIP entries before mammoth decompresses a DOCX. No files are written.
function validateDocxZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw failure('DOCX 文件不完整。请用 Word 重新另存为 .docx 后上传。');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff || count > 2000) throw failure('DOCX 包含过多内容，请移除图片附件后重新保存。', 413);
  let total = 0;
  let hasDocument = false;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw failure('DOCX 文件结构损坏，请重新保存后上传。');
    if (buffer.readUInt16LE(offset + 8) & 1) throw failure('文件已加密，请移除文档密码后上传。');
    total += buffer.readUInt32LE(offset + 24);
    if (total > 24 * 1024 * 1024) throw failure('DOCX 解压后内容过大，请移除大型图片或附件后重试。', 413);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === 'word/document.xml') hasDocument = true;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!hasDocument) throw failure('文件不是有效的 Word DOCX，请重新另存为 .docx 后上传。');
}

function textRows(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find(candidate => Math.abs(candidate.y - item.y) < Math.max(2.5, Math.min(item.height, candidate.height) * 0.35));
    if (!row) { row = { y: item.y, height: item.height, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    let result = ''; let end = -Infinity;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const gap = item.x - end;
      // Large horizontal gaps retain field boundaries in table-style resumes.
      if (result && gap > 25) result += ' | ';
      else if (result && gap > 2) result += ' ';
      result += item.text;
      end = item.x + item.width;
    }
    return result.trim();
  }).filter(Boolean).join('\n');
}

function orderPageText(content, width) {
  const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => ({
    text: item.str, x: item.transform[4], y: item.transform[5], width: item.width,
    height: item.height || Math.abs(item.transform[3]) || 10,
  }));
  if (items.length < 16) return textRows(items);
  // Detect a sustained central gutter. Full-width titles above columns stay first.
  // If the page is ambiguous, use ordinary top-to-bottom rows and preserve gaps.
  for (const fraction of [0.5, 0.4, 0.6]) {
    const cut = width * fraction;
    const crossing = items.filter(item => item.x < cut - 8 && item.x + item.width > cut + 8);
    const left = items.filter(item => item.x + item.width <= cut - 8);
    const right = items.filter(item => item.x >= cut + 8);
    if (left.length < 8 || right.length < 8) continue;
    const bodyTop = Math.min(Math.max(...left.map(x => x.y)), Math.max(...right.map(x => x.y)));
    if (crossing.some(item => item.y < bodyTop - 20)) continue;
    const leftRows = new Set(left.map(item => Math.round(item.y / 10))).size;
    const rightRows = new Set(right.map(item => Math.round(item.y / 10))).size;
    if (leftRows < 6 || rightRows < 6) continue;
    // A right column consisting only of dates is a table, not an independent column.
    const rightBody = right.filter(item => !/^[\d\s.年月日至今\-/–—]+$/.test(item.text));
    if (rightBody.length < 6) continue;
    const bodyStart = crossing.length ? Math.min(...crossing.map(x => x.y)) : Infinity;
    const top = items.filter(item => item.y >= bodyStart);
    return [textRows(top), textRows(left.filter(x => x.y < bodyStart)), textRows(right.filter(x => x.y < bodyStart))].filter(Boolean).join('\n\n');
  }
  return textRows(items);
}

async function extractPdf(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const loading = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: true, stopAtErrors: true, cMapUrl: path.join(pdfRoot, 'cmaps').replace(/\\/g, '/') + '/', cMapPacked: true, standardFontDataUrl: path.join(pdfRoot, 'standard_fonts').replace(/\\/g, '/') + '/' });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { loading.destroy(); reject(failure('PDF 读取超时，请重新导出较简单的文本型 PDF，或粘贴文字。')); }, 20000); });
  try {
    return await Promise.race([timeout, (async () => {
      const pdf = await loading.promise;
      if (pdf.numPages > MAX_PAGES) throw failure(`简历超过 ${MAX_PAGES} 页，请移除附件后重试。`, 413);
      const pages = [];
      let length = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = orderPageText(content, page.getViewport({ scale: 1 }).width);
        length += text.length;
        if (length > MAX_TEXT_LENGTH) throw failure('PDF 文字超过 60,000 字符，请缩短内容后重试。', 413);
        pages.push(text);
        page.cleanup();
      }
      const text = pages.join('\n\n').trim();
      if (text.replace(/\s/g, '').length < 10) throw failure('这份 PDF 没有足够的可选中文字，可能是扫描件。请先用 OCR 转为文字，上传 Word 简历，或粘贴文字。');
      return text;
    })()]);
  } catch (error) {
    if (error.status) throw error;
    if (error.name === 'PasswordException') throw failure('PDF 已加密，请移除密码后再上传。');
    throw failure('PDF 无法读取，可能损坏或格式不兼容。请重新导出文本型 PDF，或上传 DOCX / 粘贴文字。');
  } finally {
    clearTimeout(timer);
    await loading.destroy().catch(() => {});
  }
}

export async function extractDocument(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw failure('上传的文件为空，请重新选择。', 400);
  if (buffer.length > MAX_FILE_SIZE) throw failure('文件超过 8 MB，请压缩或移除附件后重试。', 413);
  const extension = path.extname(String(filename)).toLowerCase();
  if (!['.pdf', '.docx', '.txt'].includes(extension)) throw failure('仅支持 PDF、DOCX 和 UTF-8 TXT 文件；旧版 .doc 请先另存为 .docx。', 415);
  if (extension === '.txt') {
    try { return validateText(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch (error) { if (error.status) throw error; throw failure('TXT 不是 UTF-8 编码，请另存为 UTF-8，或直接粘贴简历文字。'); }
  }
  if (extension === '.pdf') {
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw failure('文件内容不是有效 PDF，请检查文件后重新上传。');
    return validateText(await extractPdf(buffer));
  }
  validateDocxZip(buffer);
  try { return validateText((await mammoth.extractRawText({ buffer })).value); }
  catch (error) { if (error.status) throw error; throw failure('DOCX 无法读取，请用 Word 重新保存，或直接粘贴文字。'); }
}
