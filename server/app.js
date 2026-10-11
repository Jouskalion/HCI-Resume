import express from 'express';
import multer from 'multer';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openStore } from './store.js';
import { credentials, resumeInput, publicContent, httpError, textField, MAX_SOURCE_LENGTH, normalizeContent, normalizeWarnings } from './validation.js';
import { parseResume, emptyResume } from './parser.js';
import { extractDocument } from './extract.js';
import { buildReview, reconcileReview } from './provenance.js';

const scrypt = promisify(scryptCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE = 'jianxu_session';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const tokenHash = token => createHash('sha256').update(token).digest('hex');

function readCookie(req) {
  const raw = (req.headers.cookie ?? '').split(';').find(part => part.trim().startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const value = raw.trim().slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, expected] = (stored ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const key = await scrypt(password, salt, 64);
  const bytes = Buffer.from(expected, 'hex');
  return bytes.length === key.length && timingSafeEqual(bytes, key) && Boolean(stored);
}

function rateLimit(max, windowMs, identify = req => req.ip) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 10_000) for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const key = identify(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 20_000) return next(httpError(429, '请求较多，请稍后再试。'));
      bucket = { count: 0, until: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
      return next(httpError(429, '操作过于频繁，请稍后再试。'));
    }
    next();
  };
}

export function createApp({ dataDir = resolve(ROOT, 'data'), publicBaseUrl = '', secureCookies = false } = {}) {
  let configuredBase = publicBaseUrl.trim().replace(/\/+$/, '');
  if (configuredBase) {
    const url = new URL(configuredBase);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('PUBLIC_BASE_URL 必须是完整的 HTTP(S) 网站地址，不包含路径、账号或参数。');
    }
    configuredBase = url.origin;
  }
  const app = express();
  const store = openStore(dataDir);
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.locals.close = () => store.close();
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };
  const aiAvailable = () => ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'].every(key => Boolean(process.env[key]?.trim()));

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const currentOrigin = `${req.protocol}://${req.get('host')}`;
      if ((origin && origin !== currentOrigin && origin !== configuredBase) || req.get('sec-fetch-site') === 'cross-site') {
        return next(httpError(403, '请求来源不受信任，请从本站页面重新操作。'));
      }
    }
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api', (req, res, next) => {
    const token = readCookie(req);
    req.sessionToken = token;
    req.user = token ? store.sessionUser(tokenHash(token)) : null;
    next();
  });

  const requireUser = (req, res, next) => req.user ? next() : next(httpError(401, '请先登录，再进行此操作。'));
  const ownedResume = (req, res, next) => {
    req.resumeRecord = store.get(req.params.id, req.user.id);
    req.resumeRecord ? next() : next(httpError(404, '简历不存在或你没有访问权限。'));
  };
  const baseUrl = req => configuredBase || `${req.protocol}://${req.get('host')}`;
  const privateResume = (record, req) => {
    const { ownerId, published, ...resume } = record;
    resume.hasUnpublishedChanges = Boolean(published) && JSON.stringify({ title: resume.title, content: resume.content }) !== JSON.stringify(published);
    resume.shareUrl = resume.status === 'published' ? `${baseUrl(req)}/r/${resume.slug}` : null;
    return resume;
  };
  const beginSession = (req, res, user) => {
    if (req.sessionToken) store.deleteSession(tokenHash(req.sessionToken));
    const token = randomBytes(32).toString('hex');
    store.createSession(tokenHash(token), user.id, Date.now() + SESSION_MS);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
  };

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => res.json({ aiAvailable: aiAvailable(), maxUploadMB: 8 }));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/register', rateLimit(10, 60 * 60 * 1000), async (req, res) => {
    const input = credentials(req.body, true);
    if (store.findUser(input.email)) throw httpError(409, '这个邮箱已经注册，请直接登录。');
    const hashed = await passwordHash(input.password);
    let user;
    try { user = store.createUser({ ...input, passwordHash: hashed }); }
    catch (error) {
      if (String(error.code).includes('CONSTRAINT') || store.findUser(input.email)) throw httpError(409, '这个邮箱已经注册，请直接登录。');
      throw error;
    }
    beginSession(req, res, user);
    res.status(201).json({ user });
  });
  app.post('/api/auth/login', rateLimit(20, 15 * 60 * 1000), async (req, res) => {
    const input = credentials(req.body);
    const stored = store.findUser(input.email);
    if (!(await verifyPassword(input.password, stored?.password_hash))) throw httpError(401, '邮箱或密码不正确。');
    const user = { id: stored.id, email: stored.email, name: stored.name };
    beginSession(req, res, user);
    res.json({ user });
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) store.deleteSession(tokenHash(req.sessionToken));
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  app.get('/api/resumes', requireUser, (req, res) => {
    const resumes = store.list(req.user.id).map(record => {
      const { id, title, status, slug, updatedAt, publishedAt, hasUnpublishedChanges, shareUrl } = privateResume(record, req);
      return { id, title, status, slug, updatedAt, publishedAt, hasUnpublishedChanges, shareUrl };
    });
    res.json({ resumes });
  });
  app.post('/api/resumes', requireUser, (req, res) => {
    if (req.body?.expectedUserId !== undefined) {
      const expectedUserId = textField(req.body.expectedUserId, '导入账号标识', 100, { required: true });
      if (expectedUserId !== req.user.id) throw httpError(409, '登录账号已变化，请在当前账号下重新导入简历。');
    }
    if (store.count(req.user.id) >= 100) throw httpError(400, '每个账号最多保存 100 份简历，请先删除不需要的草稿。');
    const input = resumeInput(req.body, null, emptyResume());
    input.review = reconcileReview(null, input);
    const record = store.create(req.user.id, input);
    res.status(201).json({ resume: privateResume(record, req) });
  });
  app.get('/api/resumes/:id', requireUser, ownedResume, (req, res) => res.json({ resume: privateResume(req.resumeRecord, req) }));
  app.put('/api/resumes/:id', requireUser, ownedResume, (req, res) => {
    const input = resumeInput(req.body, req.resumeRecord);
    input.review = reconcileReview(req.resumeRecord, input);
    const record = store.save(req.params.id, req.user.id, input);
    res.json({ resume: privateResume(record, req) });
  });
  app.delete('/api/resumes/:id', requireUser, ownedResume, (req, res) => {
    store.remove(req.params.id, req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/resumes/:id/publish', requireUser, ownedResume, (req, res) => {
    if (!req.resumeRecord.content.profile.name.trim()) throw httpError(400, '发布前请填写求职者姓名。');
    res.json({ resume: privateResume(store.publish(req.params.id, req.user.id), req) });
  });
  app.post('/api/resumes/:id/unpublish', requireUser, ownedResume, (req, res) => {
    res.json({ resume: privateResume(store.unpublish(req.params.id, req.user.id), req) });
  });
  app.get('/api/public/:slug', (req, res) => {
    if (!/^[A-Za-z0-9_-]{16}$/.test(req.params.slug)) throw httpError(404, '这份简历尚未发布、已下架或链接不正确。');
    const published = store.published(req.params.slug);
    if (!published) throw httpError(404, '这份简历尚未发布、已下架或链接不正确。');
    res.json({ resume: { title: published.title, content: publicContent(published.content), publishedAt: published.publishedAt } });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, fieldSize: 100, parts: 3 },
    fileFilter(req, file, callback) {
      if (!['.pdf', '.docx', '.txt'].includes(extname(file.originalname).toLowerCase())) return callback(httpError(400, '请上传 PDF、DOCX 或 TXT 格式的简历。'));
      callback(null, true);
    },
  }).single('file');
  let activeImports = 0;
  const reserveImport = (req, res, next) => {
    if (activeImports >= 4) return next(httpError(429, '目前正在解析的简历较多，请稍后重新导入。'));
    activeImports += 1;
    let released = false;
    req.releaseImport = () => {
      if (!released) { released = true; activeImports -= 1; }
    };
    res.once('finish', req.releaseImport);
    res.once('close', () => {
      // An aborted upload releases its slot; a running parser retains it until it finishes.
      if (!req.importProcessing) req.releaseImport();
    });
    next();
  };
  app.post('/api/import', requireUser, rateLimit(20, 10 * 60 * 1000, req => req.user.id), reserveImport, upload, async (req, res) => {
    if (res.destroyed) { req.releaseImport(); return; }
    req.importProcessing = true;
    try {
      const aiFlag = req.body?.useAI;
      if (![undefined, false, true, 'false', 'true'].includes(aiFlag)) throw httpError(400, 'AI 解析选项格式不正确。');
      const useAI = aiFlag === true || aiFlag === 'true';
      let sourceText;
      if (req.file) sourceText = await extractDocument(req.file.buffer, req.file.originalname);
      else sourceText = textField(req.body?.text, '简历文字', MAX_SOURCE_LENGTH, { required: true });
      sourceText = textField(sourceText, '简历文字', MAX_SOURCE_LENGTH, { required: true });
      if (sourceText.trim().length < 10) throw httpError(400, '识别到的文字过少，请粘贴完整简历，或上传包含可选择文字的 PDF/DOCX。');
      const result = await parseResume(sourceText, { useAI });
      if (!res.destroyed) {
        const content = normalizeContent(result.content);
        const original = textField(result.sourceText ?? sourceText, '原简历文字', MAX_SOURCE_LENGTH);
        res.json({ content, sourceText: original, review: buildReview(content, original), warnings: normalizeWarnings(result.warnings), method: result.method });
      }
    } finally {
      req.importProcessing = false;
      req.releaseImport();
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use(express.static(resolve(ROOT, 'public'), { index: false, dotfiles: 'deny' }));
  app.use((req, res) => {
    if (['GET', 'HEAD'].includes(req.method) && /^(\/$|\/auth\/?$|\/dashboard\/?$|\/demo\/?$|\/editor\/[^/]+\/?$|\/r\/[^/]+\/?$)/.test(req.path)) {
      const indexPath = resolve(ROOT, 'public', 'index.html');
      if (existsSync(indexPath)) return res.sendFile(indexPath);
    }
    res.status(404).json({ error: '页面不存在。' });
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 8 MB。' : '上传内容不符合要求，请选择一个简历文件重试。';
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '提交内容过大，请缩短文字或减少简历条目。' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '提交的数据不是有效的 JSON。' });
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status === 500) console.error('[简序服务错误]', error.message);
    res.status(status).json({ error: status === 500 ? '服务暂时无法完成操作，请稍后重试。' : error.message });
  });
  return app;
}
