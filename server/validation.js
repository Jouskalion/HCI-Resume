import { randomUUID } from 'node:crypto';

export const SECTIONS = ['education', 'experience', 'awards', 'projects', 'skills'];
export const MAX_SOURCE_LENGTH = 60_000;

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, `${label}格式不正确。`);
  }
  return value;
}

export function textField(value, label, maxLength, { required = false, trim = false } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw httpError(400, `${label}必须是文字。`);
  const result = trim ? value.trim() : value;
  if (required && !result.trim()) throw httpError(400, `请填写${label}。`);
  if (result.length > maxLength) throw httpError(400, `${label}不能超过 ${maxLength} 个字符。`);
  return result;
}

export function credentials(body, registration = false) {
  object(body, '账号信息');
  const email = textField(body.email, '邮箱', 254, { required: true, trim: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '请输入有效的邮箱地址。');
  const password = textField(body.password, '密码', 128, { required: true });
  if (password.length < 8) throw httpError(400, '密码至少需要 8 个字符。');
  const name = registration ? textField(body.name, '昵称', 80, { required: true, trim: true }) : '';
  return { email, password, name };
}

export const RESUME_FIELDS = {
  profile: ['name', 'headline', 'email', 'phone', 'location', 'summary', 'website'],
  education: ['school', 'major', 'level', 'degree', 'startDate', 'endDate', 'status', 'gpa', 'ranking', 'courses'],
  experience: ['company', 'department', 'position', 'type', 'startDate', 'endDate', 'location', 'responsibilities', 'achievements', 'technologies'],
  awards: ['name', 'date', 'level', 'prize', 'issuer', 'contribution'],
  projects: ['name', 'role', 'startDate', 'endDate', 'summary', 'responsibilities', 'achievements', 'technologies', 'url'],
  skills: ['category', 'items'],
};

function normalizeFields(value, section) {
  const input = object(value, '简历内容');
  const result = {};
  for (const field of RESUME_FIELDS[section]) {
    const max = ['responsibilities', 'achievements', 'summary', 'contribution', 'items', 'courses', 'technologies'].includes(field) ? 8000 : 2000;
    result[field] = textField(input[field], `${section}.${field}`, max);
  }
  if (section === 'experience' && !result.type) result.type = 'internship';
  if (section === 'experience' && !['internship', 'work', 'other'].includes(result.type)) {
    throw httpError(400, '经历类型必须为实习、工作或其他。');
  }
  return result;
}

export function normalizeContent(value) {
  const input = object(value, '简历');
  const content = { profile: normalizeFields(input.profile ?? {}, 'profile') };
  for (const section of SECTIONS) {
    const rows = input[section] ?? [];
    if (!Array.isArray(rows) || rows.length > 100) throw httpError(400, `${section}最多支持 100 条记录。`);
    const ids = new Set();
    content[section] = rows.map(row => {
      const normalized = normalizeFields(row, section);
      const id = row.id === undefined || row.id === '' ? randomUUID() : textField(row.id, '记录编号', 100, { required: true });
      if (ids.has(id)) throw httpError(400, '同一模块中的记录编号不能重复。');
      ids.add(id);
      return { id, ...normalized };
    });
  }
  const settings = object(input.settings ?? {}, '展示设置');
  const order = settings.order ?? SECTIONS;
  const hidden = settings.hidden ?? [];
  for (const [label, list] of [['模块顺序', order], ['隐藏模块', hidden]]) {
    if (!Array.isArray(list) || list.length > SECTIONS.length || list.some(item => !SECTIONS.includes(item)) || new Set(list).size !== list.length) {
      throw httpError(400, `${label}包含无效或重复的模块。`);
    }
  }
  for (const field of ['showEmail', 'showPhone']) {
    if (settings[field] !== undefined && typeof settings[field] !== 'boolean') throw httpError(400, '联系方式的公开设置必须为布尔值。');
  }
  const theme = textField(settings.theme ?? 'cobalt', '配色主题', 30);
  if (!['cobalt', 'forest', 'ink'].includes(theme)) throw httpError(400, '不支持此配色主题。');
  content.settings = {
    order: [...order, ...SECTIONS.filter(section => !order.includes(section))],
    hidden: [...hidden],
    showEmail: settings.showEmail ?? true,
    showPhone: settings.showPhone ?? false,
    theme,
  };
  return content;
}

export function normalizeWarnings(input = []) {
  if (!Array.isArray(input) || input.length > 500) throw httpError(400, '解析提示格式不正确或数量过多。');
  return input.map(value => {
    const warning = object(value, '解析提示');
    const result = {
      section: textField(warning.section, '提示模块', 100),
      field: textField(warning.field, '提示字段', 100),
      message: textField(warning.message, '提示内容', 2000, { required: true }),
    };
    if (warning.recordId !== undefined) result.recordId = textField(warning.recordId, '提示记录编号', 100);
    return result;
  });
}

export function resumeInput(body, current = null, blankContent = null) {
  object(body, '简历内容');
  if (current && body.content === undefined) throw httpError(400, '保存时请提交完整简历内容。');
  const input = {
    title: textField(body.title ?? (current ? undefined : '我的简历'), '简历名称', 120, { required: true, trim: true }),
    content: normalizeContent(body.content ?? blankContent),
    sourceText: body.sourceText === undefined ? (current?.sourceText ?? '') : textField(body.sourceText, '原简历文字', MAX_SOURCE_LENGTH),
    warnings: body.warnings === undefined ? (current?.warnings ?? []) : normalizeWarnings(body.warnings),
  };
  if (body.review !== undefined) {
    const review = object(body.review, '核对记录');
    if (review.confirmations !== undefined) input.confirmations = normalizeConfirmations(review.confirmations, input.content);
  }
  return input;
}

export function normalizeConfirmations(input, content) {
  if (!Array.isArray(input) || input.length > 6000) throw httpError(400, '核对记录格式不正确或数量过多。');
  const seen = new Set();
  return input.map(value => {
    const entry = object(value, '核对记录');
    const section = textField(entry.section, '核对模块', 30, { required: true });
    const field = textField(entry.field, '核对字段', 40, { required: true });
    const recordId = textField(entry.recordId, '核对记录编号', 100, { required: true });
    if (!Object.hasOwn(RESUME_FIELDS, section) || !RESUME_FIELDS[section].includes(field)) throw httpError(400, '核对记录包含未知字段。');
    const snapshot = textField(entry.value, '核对字段值', 8000);
    const row = section === 'profile' ? (recordId === 'profile' ? content.profile : null) : content[section].find(item => item.id === recordId);
    const key = JSON.stringify([section, recordId, field]);
    if (!row || row[field] !== snapshot || seen.has(key)) return null;
    seen.add(key);
    return { section, recordId, field, value: snapshot };
  }).filter(Boolean);
}

export function publicContent(input) {
  const content = structuredClone(input);
  if (!content.settings.showEmail) content.profile.email = '';
  if (!content.settings.showPhone) content.profile.phone = '';
  for (const section of content.settings.hidden) content[section] = [];
  return content;
}
