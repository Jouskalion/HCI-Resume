# 简序 V1 实现约定

本地可运行的多用户简历解析与展示平台。前端原生 HTML/CSS/JS，后端 Node 24 + Express，数据库 SQLite。所有 UI 中文，示例数据明确标记为演示。

## 数据结构

所有字段默认空字符串；所有列表默认空数组。每条列表记录带字符串 id。

```json
{
  "profile": {"name":"","headline":"","email":"","phone":"","location":"","summary":"","website":""},
  "education": [{"id":"","school":"","major":"","level":"","degree":"","startDate":"","endDate":"","status":"","gpa":"","ranking":"","courses":""}],
  "experience": [{"id":"","company":"","department":"","position":"","type":"internship","startDate":"","endDate":"","location":"","responsibilities":"","achievements":"","technologies":""}],
  "awards": [{"id":"","name":"","date":"","level":"","prize":"","issuer":"","contribution":""}],
  "projects": [{"id":"","name":"","role":"","startDate":"","endDate":"","summary":"","responsibilities":"","achievements":"","technologies":"","url":""}],
  "skills": [{"id":"","category":"","items":""}],
  "settings": {"order":["education","experience","awards","projects","skills"],"hidden":[],"showEmail":true,"showPhone":false,"theme":"cobalt"}
}
```

responsibilities、achievements、technologies、courses、items 都是字符串，允许换行。学历 level 与学位 degree 分开，原文没有的信息不猜测。教育和实习各段必须保持对应关系。公开接口根据 settings 隐藏电话/邮箱/模块；sourceText、warnings 不公开。

## HTTP API

错误统一为 HTTP 4xx/5xx + `{ "error": "中文可读错误" }`。

- GET /api/health -> {ok:true}
- POST /api/auth/register {name,email,password} -> {user}; 自动登录
- POST /api/auth/login {email,password} -> {user}
- POST /api/auth/logout -> {ok:true}
- GET /api/auth/me -> {user} 或 {user:null}
- GET /api/resumes -> {resumes:[{id,title,status,slug,updatedAt,publishedAt,hasUnpublishedChanges,shareUrl}]}
- POST /api/resumes {title,content?,sourceText?,warnings?,expectedUserId?} -> {resume}
- GET /api/resumes/:id -> {resume}
- PUT /api/resumes/:id {title,content,sourceText?,warnings?} -> {resume}
- DELETE /api/resumes/:id -> {ok:true}
- POST /api/resumes/:id/publish -> {resume}; 已保存草稿建立公开快照，原有 slug 保持不变
- POST /api/resumes/:id/unpublish -> {resume}; 公共链接立即404
- GET /api/public/:slug -> {resume:{title,content,publishedAt}}; 不返回用户身份、原文、解析提示或草稿
- POST /api/import：登录后使用；multipart 字段 file（PDF/DOCX/TXT，<=8MB），或 JSON {text}。可额外传 useAI=true，默认 false；服务配置且用户明确选择才调用外部模型。返回 {content,sourceText,warnings,method}。解析不自动创建或发布简历。
- GET /api/config -> {aiAvailable:boolean, maxUploadMB:8}

完整私有 resume 含 id、title、status、slug、content、sourceText、warnings、createdAt、updatedAt、publishedAt、hasUnpublishedChanges、shareUrl。

前端 URL：首页 /，账号 /auth，工作台 /dashboard，编辑器 /editor/:id，公开简历 /r/:slug，示例 /demo。SPA 路由均返回 public/index.html。公开页面与示例可打印导出 PDF。源简历文字只供所有者核对。

## 模块划分

- 前端：public/ 全部文件。
- 后端：server/app.js、server/store.js、server/index.js、server/validation.js、tests/api.test.js。
- 解析器：server/parser.js、server/extract.js、tests/parser.test.js、samples/。
- 集成：package.json、README.md、docs/、其余集成测试与交付打包。

解析器入口：export async function parseResume(text, {useAI=false}={}) 返回 {content,sourceText,warnings,method}；export function emptyResume()。extract.js 导出 async extractDocument(buffer, filename) 返回字符串。警告格式 [{section,field,message,recordId?}]。解析器尽可能完整保留原文并标记需要核对的内容。AI 不可用或失败时返回规则结果并提示，绝不伪称调用成功。

服务入口：export function createApp({dataDir, publicBaseUrl, secureCookies=false}={}) 返回 Express app，并在 app.locals.close() 关闭 SQLite，便于测试。import 解析函数前保持上述约定即可。

导入后创建草稿时，前端携带发起导入时的 expectedUserId，服务端与当前账号核对，账号切换时拒绝写入。原文上限 60,000 字符，单文件 8 MB，PDF 最多 12 页。
