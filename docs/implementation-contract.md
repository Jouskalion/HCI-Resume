# 简序 V2 实现约定

本地可运行的多用户简历解析与展示平台。前端原生 HTML/CSS/JS，后端 Node 24 + Express，数据库 SQLite。所有 UI 中文，示例数据明确标记为演示。

V2 首轮实现多段简历提取改进，以及字段与原文联动核对；当前迭代在此基础上增加自动保存草稿、核对效率改进和移动端适配。界面支持桌面、平板和手机，保留手动保存入口；不包含 OCR 或跨重启离线恢复，也不保证任意排版均可准确解析。

窄屏编辑器通过「编辑内容／原文与核对」切换同一组表单和核对面板，输入时保留当前编辑视图；主动查看原文后可返回对应字段。首页、工作台、弹窗和公开简历按屏幕宽度调整布局，HR 章节导航在小屏上横向滚动。触屏长按排序沿用 150ms 启动，并在页面边缘自动滚动；桌面仍使用编辑区域滚动。响应式样式仅作用于屏幕，打印继续使用原打印样式。

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

responsibilities、achievements、technologies、courses、items 都是字符串，允许换行。学历 level 与学位 degree 分开，原文没有的信息不猜测。教育和实习各段必须保持对应关系。公开接口根据 settings 隐藏电话/邮箱/模块；sourceText、warnings、review 不公开。

私有简历额外带 `review`，与 `content` 独立保存：

```json
{
  "version": 1,
  "fields": [{
    "section": "education", "recordId": "记录 id", "field": "school",
    "value": "杭州电子科技大学", "match": "exact",
    "ranges": [{"start": 20, "end": 28}]
  }],
  "confirmations": [{
    "section": "education", "recordId": "记录 id", "field": "school",
    "value": "杭州电子科技大学"
  }]
}
```

- `version: 1` 是核对数据结构版本，与产品 V2 无关。基本信息的 `recordId` 固定为 `profile`。
- `fields` 由服务端生成，仅包含非空提取字段。`value` 保留来源匹配时的字段值；`ranges` 是未改写 `sourceText` 的 UTF-16 半开区间 `[start,end)`，多行字段可有多个区间。
- `match` 为 `exact`（直接对应）、`normalized`（日期或标点等归一后对应）、`ambiguous`（多处候选）或 `unmatched`（未找到）。有歧义、缺失或仅部分匹配时不给出范围，避免把其他经历误当来源。
- `confirmations` 记录用户确认时的字段值。保存时校验模块、字段、记录 id 和当前值；重复或已不对应当前值的确认会移除。修改原文时重新生成来源并清空确认；删除经历时移除相关来源与确认。
- 客户端可提交确认列表，不能指定可信来源范围；服务端忽略客户端传入的 `fields`。没有提交确认列表时，沿用仍有效的已有确认。
- SQLite 自动补充独立的私有 `review_json` 列。旧草稿首次读取时可根据已有原文生成来源，原有内容和发布快照保持兼容。公开快照只含标题和简历内容。

## HTTP API

错误统一为 HTTP 4xx/5xx + `{ "error": "中文可读错误" }`。

- GET /api/health -> {ok:true}
- POST /api/auth/register {name,email,password} -> {user}; 自动登录
- POST /api/auth/login {email,password} -> {user}
- POST /api/auth/logout -> {ok:true}
- GET /api/auth/me -> {user} 或 {user:null}
- GET /api/resumes -> {resumes:[{id,title,status,slug,updatedAt,publishedAt,hasUnpublishedChanges,shareUrl}]}
- POST /api/resumes {title,content?,sourceText?,warnings?,review?,expectedUserId?} -> {resume}
- GET /api/resumes/:id -> {resume}
- PUT /api/resumes/:id {title,content,sourceText?,warnings?,review?:{confirmations:[...]}} -> {resume}
- DELETE /api/resumes/:id -> {ok:true}
- POST /api/resumes/:id/publish -> {resume}; 已保存草稿建立公开快照，原有 slug 保持不变
- POST /api/resumes/:id/unpublish -> {resume}; 公共链接立即404
- GET /api/public/:slug -> {resume:{title,content,publishedAt}}; 不返回用户身份、原文、解析提示、核对记录或草稿
- POST /api/import：登录后使用；multipart 字段 file（PDF/DOCX/TXT，<=8MB），或 JSON {text}。可额外传 useAI=true，默认 false；服务配置且用户明确选择才调用外部模型。返回 {content,sourceText,warnings,method,review}。解析不自动创建或发布简历。
- GET /api/config -> {aiAvailable:boolean, maxUploadMB:8}

完整私有 resume 含 id、title、status、slug、content、sourceText、warnings、review、createdAt、updatedAt、publishedAt、hasUnpublishedChanges、shareUrl。核对记录随创建/保存接口处理，没有独立的确认接口；前端自动保存使用同一个 PUT 接口，不会自动发布。

前端 URL：首页 /，账号 /auth，工作台 /dashboard，编辑器 /editor/:id，公开简历 /r/:slug，示例 /demo。SPA 路由均返回 public/index.html。公开页面与示例可打印导出 PDF。源简历文字只供所有者核对。

## 草稿保存与核对交互

- 修改标题、字段、经历、展示设置或核对状态后，前端等待约 1 秒无新修改再保存。未变化的草稿不重复请求；「保存草稿」仍可立即触发保存。
- 每个编辑器实例使用同一保存调度器，自动保存、手动保存与发布前保存依次执行，最多一条保存请求在途。保存时记录所提交的快照；请求期间的新修改仍保留在当前页面，并在随后保存。旧响应不会覆盖新输入，也不会把新输入误标为已保存。
- 顶部区分等待自动保存、正在保存、草稿已保存与保存失败。失败保留当前页面中的修改并提供重试，不会在后台无限重试；用户可点击「重试」或「保存草稿」。只有服务端成功返回后才表示该快照已保存。
- 站内离开编辑器时先尝试保存；失败后用户可留在当前页继续编辑或重试，也可明确放弃未保存内容离开。刷新或关闭页面时，若仍有未保存修改，触发浏览器离开提醒。没有浏览器本地的持久离线草稿，因此不能保证刷新、关闭或重启后的未保存内容恢复。
- 自动保存只写入私人草稿，不改变已发布快照。用户主动发布时先完成草稿保存，成功后才更新公开版本。
- 「确认并下一项」确认当前值后定位下一个待核对字段；顺序以完整字段列表为锚点，确认导致清单缩短时不跳过相邻项。查找到末尾后循环，当前筛选无待核对项时明确提示。
- 核对范围提供全部待核对、需检查、修改后待核对、未定位原文。筛选均排除已确认字段；有提醒、已修改、无有效原文范围可以同时成立，因此分类数量可能重叠，不能相加作为总量。
- 「核对本段经历」先展示该记录的当前字段与对应原文。只有未确认、未修改、没有字段提醒且存在有效原文范围的字段允许批量确认；有提醒、已修改或无可用原文的字段在弹窗列明并保留单独核对。已确认字段不重复处理，批量操作按模块和记录 id 隔离，不影响其他经历。
- 用户主动确认才产生确认记录，定位到原文不自动确认。确认后再修改字段使确认失效，恢复原值也须重新确认；批量确认遵循同样规则。核对状态随自动或手动保存持久化，仍仅所有者可见。

## 模块划分

- 前端：public/ 全部文件。
- 后端：server/app.js、server/store.js、server/index.js、server/validation.js、tests/api.test.js。
- 解析器：server/parser.js、server/extract.js、tests/parser.test.js、samples/。
- 来源与核对：server/provenance.js、public/review.js 及相应测试；确认输入由 server/validation.js 校验。
- 自动保存：public/autosave.js 负责延迟合并、单条在途请求、手动触发与失败重试；public/app.js 负责草稿快照、状态显示和离开保护。
- 移动端：public/mobile.css 负责公共页面与弹窗，public/mobile-editor.css 负责编辑器；public/app.js 管理面板切换和章节导航，public/order-sort.js 处理指针、键盘排序与边缘滚动。
- 集成：package.json、README.md、docs/、其余集成测试与交付打包。

解析器入口：export async function parseResume(text, {useAI=false}={}) 返回 {content,sourceText,warnings,method}；export function emptyResume()。extract.js 导出 async extractDocument(buffer, filename) 返回字符串。警告格式 [{section,field,message,recordId?}]。解析器尽可能完整保留原文并标记需要核对的内容。AI 不可用或失败时返回规则结果并提示，绝不伪称调用成功。

来源入口：`buildReview(content, sourceText)` 在 API 层生成核对数据；`reconcileReview(current, input)` 在保存时协调字段与确认。原文匹配仅说明文本对应关系，不验证经历真实性。前端点选字段后定位高亮对应原文，无法匹配时显示原因；「确认并下一项」与「稍后核对」支持逐项检查；后者仅跳过当前项，保留待核对状态，已确认字段可取消确认，也可筛选或按经历集中核对，修改字段后重新标记待核对。

解析回归样本 `samples/陈知行-V2核对测试.txt` 覆盖同校两段教育、同公司不同周期、独立日期、同行职责/成果/技术栈和多行描述。机构名称真实，人物经历为模拟内容；第三段实习故意缺少岗位，应保留空值并给字段警告。

服务入口：export function createApp({dataDir, publicBaseUrl, secureCookies=false}={}) 返回 Express app，并在 app.locals.close() 关闭 SQLite，便于测试。import 解析函数前保持上述约定即可。

导入后创建草稿时，前端携带发起导入时的 expectedUserId，服务端与当前账号核对，账号切换时拒绝写入。原文上限 60,000 字符，单文件 8 MB，PDF 最多 12 页。
