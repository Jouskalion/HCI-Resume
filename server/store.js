import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { buildReview } from './provenance.js';

function unpack(row) {
  if (!row) return null;
  const content = JSON.parse(row.content_json);
  return {
    id: row.id, ownerId: row.owner_id, title: row.title, slug: row.slug,
    status: row.published_json ? 'published' : 'draft',
    content, sourceText: row.source_text,
    review: row.review_json ? JSON.parse(row.review_json) : buildReview(content, row.source_text),
    warnings: JSON.parse(row.warnings_json), createdAt: row.created_at,
    updatedAt: row.updated_at, publishedAt: row.published_at,
    published: row.published_json ? JSON.parse(row.published_json) : null,
  };
}

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'jianxu.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, content_json TEXT NOT NULL, source_text TEXT NOT NULL,
      warnings_json TEXT NOT NULL, review_json TEXT, slug TEXT UNIQUE, published_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS resumes_owner ON resumes(owner_id, updated_at);
  `);
  if (!db.prepare('PRAGMA table_info(resumes)').all().some(column => column.name === 'review_json')) {
    db.exec('ALTER TABLE resumes ADD COLUMN review_json TEXT');
  }

  const get = (id, ownerId) => unpack(db.prepare('SELECT * FROM resumes WHERE id = ? AND owner_id = ?').get(id, ownerId));
  return {
    close() { db.close(); },
    findUser(email) { return db.prepare('SELECT * FROM users WHERE email = ?').get(email); },
    createUser({ email, name, passwordHash }) {
      const user = { id: randomUUID(), email, name };
      db.prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)')
        .run(user.id, email, name, passwordHash, new Date().toISOString());
      return user;
    },
    createSession(tokenHash, userId, expiresAt) {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash, userId, expiresAt);
    },
    sessionUser(tokenHash) {
      return db.prepare(`SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash, Date.now()) ?? null;
    },
    deleteSession(tokenHash) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); },
    get,
    list(ownerId) { return db.prepare('SELECT * FROM resumes WHERE owner_id=? ORDER BY updated_at DESC').all(ownerId).map(unpack); },
    count(ownerId) { return Number(db.prepare('SELECT COUNT(*) AS total FROM resumes WHERE owner_id=?').get(ownerId).total); },
    create(ownerId, input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO resumes (id,owner_id,title,content_json,source_text,warnings_json,review_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, ownerId, input.title, JSON.stringify(input.content), input.sourceText, JSON.stringify(input.warnings), JSON.stringify(input.review ?? buildReview(input.content, input.sourceText)), now, now);
      return get(id, ownerId);
    },
    save(id, ownerId, input) {
      db.prepare(`UPDATE resumes SET title=?,content_json=?,source_text=?,warnings_json=?,review_json=?,updated_at=? WHERE id=? AND owner_id=?`)
        .run(input.title, JSON.stringify(input.content), input.sourceText, JSON.stringify(input.warnings), JSON.stringify(input.review ?? buildReview(input.content, input.sourceText)), new Date().toISOString(), id, ownerId);
      return get(id, ownerId);
    },
    publish(id, ownerId) {
      const current = get(id, ownerId);
      const slug = current.slug || randomBytes(12).toString('base64url');
      const published = JSON.stringify({ title: current.title, content: current.content });
      const now = new Date().toISOString();
      db.prepare('UPDATE resumes SET slug=?,published_json=?,published_at=?,updated_at=? WHERE id=? AND owner_id=?')
        .run(slug, published, now, now, id, ownerId);
      return get(id, ownerId);
    },
    unpublish(id, ownerId) {
      db.prepare('UPDATE resumes SET published_json=NULL,published_at=NULL,updated_at=? WHERE id=? AND owner_id=?')
        .run(new Date().toISOString(), id, ownerId);
      return get(id, ownerId);
    },
    remove(id, ownerId) { db.prepare('DELETE FROM resumes WHERE id=? AND owner_id=?').run(id, ownerId); },
    published(slug) {
      const row = db.prepare('SELECT published_json,published_at FROM resumes WHERE slug=? AND published_json IS NOT NULL').get(slug);
      return row ? { ...JSON.parse(row.published_json), publishedAt: row.published_at } : null;
    },
  };
}
