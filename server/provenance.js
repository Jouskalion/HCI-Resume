import { RESUME_FIELDS, normalizeConfirmations } from './validation.js';

const PRIMARY = { education: 'school', experience: 'company', awards: 'name', projects: 'name', skills: 'category' };
const HEADINGS = {
  education: /^(?:教育背景|教育经历|学习经历|学历信息|教育信息|学业情况|教育|education|academic background)$/i,
  experience: /^(?:实习与工作(?:经历)?|工作及实习经历|工作与实习经历|实习工作经历|工作经历|实习经历|职业经历|工作经验|实习经验|实践经历|专业实践|experience|work experience|internship experience|internships|employment)$/i,
  awards: /^(?:荣誉与奖项|荣誉奖项|竞赛奖项|荣誉奖励|获奖情况|获奖经历|竞赛获奖|荣誉证书|奖项荣誉|奖励情况|奖项|荣誉|awards|honors|honours|honors and awards)$/i,
  projects: /^(?:项目经历|项目经验|科研经历|科研项目|作品经历|项目实践|个人项目|项目成果|projects|project experience|research experience|portfolio)$/i,
  skills: /^(?:专业技能|技术能力|技术技能|技能清单|技能特长|相关技能|职业技能|掌握技能|个人技能|技能|skills|technical skills)$/i,
  profile: /^(?:个人信息|基本信息|联系方式|个人简介|自我介绍|求职意向|自我评价|个人优势|profile|contact|summary|objective)$/i,
};
const DATE_TOKEN = /(?:19|20)\d{2}(?:\s*[.／/年-]\s*(?:1[0-2]|0?[1-9])(?!\d)(?:\s*月)?|\s*年)?|至今|现在|present|current/gi;
const keyOf = entry => JSON.stringify([entry.section, entry.recordId, entry.field]);

function linesOf(text) {
  const lines = []; let offset = 0;
  for (const line of text.split('\n')) {
    const title = line.trim().replace(/^[•●▪◆◇★☆\-*#>\d一二三四五六七八九十、.（）()\s]+/, '').replace(/[【】\[\]:：]/g, '').trim();
    const section = Object.entries(HEADINGS).find(([, pattern]) => pattern.test(title))?.[0] ?? null;
    lines.push({ text: line, start: offset, end: offset + line.length, section });
    offset += line.length + 1;
  }
  return lines;
}

// Keep a map for every normalized UTF-16 code unit, including non-BMP characters.
// Evidence offsets always address the original, unchanged sourceText.
function folded(text, offset = 0) {
  let value = ''; const starts = []; const ends = [];
  for (let index = 0; index < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(index));
    const part = char.normalize('NFKC').toLowerCase();
    if (!/^[\s，,。;；:：|｜•●▪◆◇★☆、]+$/u.test(part)) {
      value += part;
      for (let i = 0; i < part.length; i += 1) { starts.push(offset + index); ends.push(offset + index + char.length); }
    }
    index += char.length;
  }
  return { value, starts, ends };
}

function occurrences(value, text, start, end) {
  if (!value.trim()) return [];
  const haystack = text.slice(start, end); const matches = [];
  let index = haystack.indexOf(value);
  while (index !== -1) {
    matches.push({ start: start + index, end: start + index + value.length, match: 'exact' });
    index = haystack.indexOf(value, index + Math.max(1, value.length));
  }
  const needle = folded(value).value; const normalized = folded(haystack, start);
  if (!needle) return matches;
  index = normalized.value.indexOf(needle);
  while (index !== -1) {
    const range = { start: normalized.starts[index], end: normalized.ends[index + needle.length - 1], match: 'normalized' };
    // Folding can trim punctuation from an exact occurrence's edges. These are
    // two representations of one location, not two competing source passages.
    if (!matches.some(item => (item.start <= range.start && item.end >= range.end) || (range.start <= item.start && range.end >= item.end))) matches.push(range);
    index = normalized.value.indexOf(needle, index + Math.max(1, needle.length));
  }
  return matches.sort((a, b) => a.start - b.start);
}

function dateValue(value) {
  if (/^(?:至今|现在|present|current)$/i.test(value.trim())) return '至今';
  const match = value.trim().match(/^((?:19|20)\d{2})(?:\s*[.／/年-]\s*(\d{1,2})\s*月?|\s*年)?$/);
  return match ? `${match[1]}${match[2] ? '.' + match[2].padStart(2, '0') : ''}` : null;
}

function dateOccurrences(value, text, start, end) {
  const normalized = dateValue(value);
  if (!normalized) return occurrences(value, text, start, end);
  const found = [];
  for (const match of text.slice(start, end).matchAll(DATE_TOKEN)) {
    if (dateValue(match[0]) === normalized) found.push({ start: start + match.index, end: start + match.index + match[0].length, match: match[0] === value ? 'exact' : 'normalized' });
  }
  return found;
}

function fieldOccurrences(field, value, text, start, end) {
  if (['startDate', 'endDate', 'date'].includes(field)) return dateOccurrences(value, text, start, end);
  if (field === 'type') {
    const term = { internship: '实习', work: '工作' }[value];
    return term ? occurrences(term, text, start, end).map(item => ({ ...item, match: 'normalized' })) : [];
  }
  return occurrences(value, text, start, end);
}

function sectionContexts(section, content, source, lines) {
  const headings = lines.filter(line => line.section);
  let regions = headings.filter(line => line.section === section).map(line => ({
    start: line.end, end: headings.find(next => next.start > line.start)?.start ?? source.length,
  }));
  // A heading-less source still supports record anchoring; a different explicit
  // section must not supply a missing record's evidence.
  if (!regions.length) regions = headings.some(line => line.section !== 'profile') ? [] : [{ start: 0, end: source.length }];
  const blocks = [];
  for (const region of regions) {
    const regionLines = lines.filter(line => line.start >= region.start && line.start < region.end);
    const anchors = regionLines.filter(line => {
      if (/^\s*(?:负责|参与|协助|完成|优化|项目职责|职责|成果|技术栈)[：:\s]/.test(line.text)) return false;
      return content[section].some(entry => entry[PRIMARY[section]] && occurrences(entry[PRIMARY[section]], source, line.start, line.end).length);
    });
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      let start = anchor.start;
      const previous = regionLines[regionLines.indexOf(anchor) - 1];
      if (previous && /^\s*(?:时间[：:]\s*)?(?:19|20)\d{2}[^\p{L}]*$/u.test(previous.text.replace(/年|月|至|到|今|现在/g, ''))) start = previous.start;
      const next = anchors[i + 1];
      let end = next?.start ?? region.end;
      const beforeNext = next ? regionLines[regionLines.indexOf(next) - 1] : null;
      if (beforeNext && beforeNext.start > anchor.start && /^\s*(?:19|20)\d{2}[^\p{L}]*$/u.test(beforeNext.text.replace(/年|月|至|到|今|现在/g, ''))) end = beforeNext.start;
      blocks.push({ start, end, anchor });
    }
  }
  return { regions, blocks };
}

function chooseContext(section, row, content, source, contexts) {
  const primary = row[PRIMARY[section]];
  const { regions, blocks } = contexts;
  const candidates = [];
  for (const { start, end, anchor } of blocks) {
    if (!primary || !occurrences(primary, source, anchor.start, anchor.end).length) continue;
    let score = 0;
    for (const field of RESUME_FIELDS[section]) {
      if (!row[field] || field === PRIMARY[section] || ['type', 'responsibilities', 'achievements', 'summary', 'contribution'].includes(field)) continue;
      if (fieldOccurrences(field, row[field], source, start, end).length) score += /Date$|^date$/.test(field) ? 6 : ['level', 'position', 'major', 'role', 'prize'].includes(field) ? 4 : 1;
    }
    candidates.push({ start, end, score });
  }
  if (!candidates.length) {
    if (content[section].length === 1 && regions.length === 1) return { ...regions[0], match: 'context' };
    return { match: 'unmatched' };
  }
  const best = Math.max(...candidates.map(item => item.score));
  const winners = candidates.filter(item => item.score === best);
  return winners.length === 1 ? { ...winners[0], match: 'context' } : { match: 'ambiguous' };
}

function evidence(field, value, source, context) {
  if (context.match !== 'context') return { ranges: [], match: context.match };
  const parts = value.split(/\r?\n/).map(part => part.trim()).filter(Boolean);
  const ranges = []; let normalized = false; let missing = false; let ambiguous = false;
  for (const part of parts) {
    const matches = fieldOccurrences(field, part, source, context.start, context.end);
    if (!matches.length) { missing = true; continue; }
    if (matches.length > 1) { ambiguous = true; continue; }
    const found = matches[0]; normalized ||= found.match === 'normalized';
    ranges.push({ start: found.start, end: found.end });
  }
  // Partial matches must not look like complete verification of a longer claim.
  if (ambiguous || missing || !ranges.length) return { ranges: [], match: ambiguous ? 'ambiguous' : 'unmatched' };
  return { ranges, match: normalized ? 'normalized' : 'exact' };
}

export function buildReview(content, sourceText) {
  const source = String(sourceText ?? ''); const lines = linesOf(source); const fields = [];
  const firstSection = lines.find(line => line.section && line.section !== 'profile');
  const profileContext = { start: 0, end: firstSection?.start ?? source.length, match: 'context' };
  for (const [section, fieldNames] of Object.entries(RESUME_FIELDS)) {
    const rows = section === 'profile' ? [{ ...content.profile, id: 'profile' }] : content[section];
    const contexts = section === 'profile' || !rows.length ? null : sectionContexts(section, content, source, lines);
    for (const row of rows) {
      const context = section === 'profile' ? profileContext : chooseContext(section, row, content, source, contexts);
      for (const field of fieldNames) {
        const value = row[field];
        if (typeof value !== 'string' || !value.trim()) continue;
        fields.push({ section, recordId: row.id, field, value, ...evidence(field, value, source, context) });
      }
    }
  }
  return { version: 1, fields, confirmations: [] };
}

export function reconcileReview(current, input) {
  const sourceChanged = !current || current.sourceText !== input.sourceText;
  const original = sourceChanged ? buildReview(input.content, input.sourceText) : (current.review ?? buildReview(current.content, current.sourceText));
  const valid = new Set();
  for (const [section, fields] of Object.entries(RESUME_FIELDS)) {
    for (const row of section === 'profile' ? [{ ...input.content.profile, id: 'profile' }] : input.content[section]) {
      for (const field of fields) valid.add(keyOf({ section, recordId: row.id, field }));
    }
  }
  return {
    version: 1,
    fields: original.fields.filter(entry => valid.has(keyOf(entry))),
    confirmations: sourceChanged ? [] : normalizeConfirmations(input.confirmations ?? original.confirmations ?? [], input.content),
  };
}
