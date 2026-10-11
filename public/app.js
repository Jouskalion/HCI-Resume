import { sections, defaultOrder, fields, emptyContent, normalizeContent, newRecord, demoContent, demoSource, demoNotice } from './data.js';
import { esc, icon, renderResume, safeUrl } from './resume.js';
import { setupOrderSorting } from './order-sort.js';

const app=document.querySelector('#app');
const modal=document.querySelector('#modal');
let user=null, config={aiAvailable:false,maxUploadMB:8}, routeVersion=0, editor=null, dashboardResumes=[], editorSection='profile', proofTab='source';
let importState={tab:'file',file:null,text:'',useAI:false,busy:false,error:''};
let lastFocus=null, toastTimeout, activeConfirm=null;
let orderSorter=null;

async function api(path,{body,...options}={}) {
  const headers={...(options.headers||{})};
  if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  let response;
  try{response=await fetch(path,{credentials:'same-origin',...options,headers,body});}catch{throw new Error('暂时无法连接，请检查网络后重试。');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'操作未完成，请稍后重试。');error.status=response.status;throw error;}
  return data;
}
function toast(message,error=false) {
  clearTimeout(toastTimeout); const target=document.querySelector('#toast-region');
  target.innerHTML=`<div class="toast ${error?'toast-error':''}">${icon(error?'alert':'check')}<span>${esc(message)}</span></div>`;
  toastTimeout=setTimeout(()=>target.innerHTML='',5000);
}
const brand=()=>'<a class="brand" href="/" data-nav aria-label="简序 首页"><span class="brand-mark"><i></i><b></b></span><span>简序<small>JIANXU</small></span></a>';
function header({simple=false}={}) {
  return `<header class="site-header"><div class="header-inner">${brand()}<nav aria-label="主导航">${!simple?'<a href="/demo" data-nav class="nav-link">看看示例 '+icon('arrow')+'</a>':''}${user?`<a href="/dashboard" data-nav class="${location.pathname==='/dashboard'?'nav-link active':'button button-dark button-sm'}">我的工作台</a><button class="avatar-button" data-action="account" title="账号与退出" aria-label="账号与退出">${esc((user.name||user.email||'我').slice(0,1))}</button>`:`<a href="/auth" data-nav class="nav-link">登录</a><a href="/auth?mode=register" data-nav class="button button-dark button-sm">开始创建 ${icon('arrow')}</a>`}</nav></div></header>`;
}
const footer=()=>`<footer class="site-footer"><div>${brand()}<span>让每一段经历，清晰可见。</span></div><p>用清晰表达，连接下一个机会。<span>© ${new Date().getFullYear()} 简序</span></p></footer>`;
function loading(label='正在整理页面…'){app.innerHTML=`${header({simple:true})}<main id="main" class="state-page"><span class="spinner"></span><p>${esc(label)}</p></main>`;}
function errorPage(message,status){app.innerHTML=`${header({simple:true})}<main id="main" class="state-page"><div class="state-icon">${icon(status===404?'file':'alert')}</div><span class="eyebrow">${status===404?'PAGE NOT AVAILABLE':'SOMETHING WENT WRONG'}</span><h1>${status===404?'这份简历暂时无法查看':'页面暂时无法打开'}</h1><p>${esc(status===404?'链接可能已失效，或简历所有者已将它下架。':message)}</p><a class="button button-primary" href="/" data-nav>返回首页 ${icon('arrow')}</a></main>`;}
const signature=()=>editor?JSON.stringify({title:editor.title,content:editor.content,warnings:editor.warnings}):'';
const dirty=()=>Boolean(editor&&signature()!==editor.savedSignature);
async function navigate(path,{force=false,replace=false}={}) {
  orderSorter?.cancel(false);
  if(editor?.busy){toast('正在保存，请稍候再离开。');return;}
  if(!force&&dirty()&&!await confirmDialog('离开前保存了吗？','当前有尚未保存的修改。离开后，这些修改将不会保留。','放弃修改并离开',true))return;
  closeModal();editor=null;
  history[replace?'replaceState':'pushState']({},'',path);await renderRoute();window.scrollTo(0,0);
}
async function renderRoute(){
  orderSorter?.destroy();orderSorter=null;
  const version=++routeVersion, path=location.pathname;
  document.body.className=''; document.title='简序 JIANXU · 让经历，清晰可见';
  try{
    if(path==='/'){renderHome();return;}
    if(path==='/auth'){if(user){await navigate('/dashboard',{force:true,replace:true});return;}renderAuth();return;}
    if(path==='/demo'){document.title='演示简历 · 简序 JIANXU';renderPublic({title:'演示简历',content:demoContent()},true);return;}
    if(path.startsWith('/r/')){loading('正在打开简历…');const {resume}=await api(`/api/public/${encodeURIComponent(path.split('/')[2])}`);if(version!==routeVersion)return;document.title=`${resume.content.profile?.name||resume.title} · 个人简历`;renderPublic(resume);return;}
    if(path==='/dashboard'||path.startsWith('/editor/')){
      if(!user){await navigate('/auth',{force:true,replace:true});return;}
      loading(path==='/dashboard'?'正在打开工作台…':'正在打开简历草稿…');
      if(path==='/dashboard'){const {resumes}=await api('/api/resumes');if(version!==routeVersion)return;dashboardResumes=resumes;renderDashboard();}
      else {const {resume}=await api(`/api/resumes/${encodeURIComponent(path.split('/')[2])}`);if(version!==routeVersion)return;editor={...resume,content:normalizeContent(resume.content),warnings:resume.warnings||[],busy:false};editor.savedSignature=signature();editorSection='profile';proofTab=editor.sourceText?'source':'preview';renderEditor();}
      return;
    }
    errorPage('',404);
  }catch(error){if(version===routeVersion){if(error.status===401){user=null;editor=null;await navigate('/auth',{force:true,replace:true});toast('登录已过期，请重新登录。',true);}else errorPage(error.message,error.status);}}
}

function renderHomeResume(){
 const c=demoContent(),p=c.profile,e=c.education[0],work=c.experience[0],award=c.awards[0];
 return `<div class="hero-visual" aria-label="周予安简历展示预览">
   <div class="paper-browser">
     <div class="browser-toolbar"><div class="browser-dots" aria-hidden="true"><i></i><i></i><i></i></div><span>${icon('link')} jianxu / r / zhou-yuan</span><span>展示预览</span></div>
     <div class="hero-paper">
       <div class="mini-label">PERSONAL RESUME <span>演示内容</span></div>
       <div class="hero-paper-name">${esc(p.name)}<span>.</span></div>
       <p class="mini-headline">${esc(p.headline)}</p>
       <div class="mini-contact">${esc(p.location)} <span>·</span> ${esc(p.email)}</div>
       <div class="mini-rule"></div>
       <div class="mini-section"><span>01</span><strong>教育背景</strong></div>
       <div class="mini-entry">
         <div class="mini-entry-heading"><strong>${esc(e.school)}</strong><small>${esc(e.startDate)} — ${esc(e.endDate)}</small></div>
         <p>${esc(e.major)} · ${esc(e.level)} · ${esc(e.degree)}</p>
         <div class="mini-tags"><span>专业排名 ${esc(e.ranking)}</span><span>${esc(e.status)}</span></div>
       </div>
       <div class="mini-section"><span>02</span><strong>实习与工作</strong></div>
       <div class="mini-entry">
         <div class="mini-entry-heading"><strong>${esc(work.company)}</strong><small>${esc(work.startDate)} — ${esc(work.endDate)}</small></div>
         <p>${esc(work.position)}</p>
         <p class="mini-responsibility">${esc(work.responsibilities.split('\n')[0])}</p>
         <div class="mini-result">${esc(work.achievements)}</div>
       </div>
       <div class="mini-section"><span>03</span><strong>荣誉奖项</strong></div>
       <div class="mini-award">${icon('award')}<div><strong>${esc(award.name)}</strong><small>${esc(award.date)} · ${esc(award.level)}${esc(award.prize)} · Java 大学 B 组</small></div></div>
     </div>
   </div>
   <div class="visual-caption">${esc(demoNotice)}。</div>
 </div>`;
}
function renderHome(){
 app.innerHTML=`${header()}<main id="main"><section class="hero page-width"><div class="hero-copy"><div class="eyebrow"><span class="tiny-dot"></span> A CLEARER WAY TO PRESENT YOURSELF</div><h1>你的经历，<br>值得<span class="blue-word">清晰呈现<span class="hand-underline"></span></span>。</h1><p class="hero-description">把一份简历，变成一个好读的个人主页。<br>上传、核对、分享，让下一位阅读者看见你的价值。</p><div class="hero-actions"><a href="${user?'/dashboard':'/auth?mode=register'}" data-nav class="button button-primary button-lg">创建我的简历 ${icon('arrow')}</a><a href="/demo" data-nav class="text-link">浏览完整示例 ${icon('arrow')}</a></div><div class="hero-note">${icon('check')} 支持 PDF、Word 与文本 <span></span> 发布前由你确认</div><div class="hero-index"><span>01 / IMPORT</span><i></i><span>02 / REFINE</span><i></i><span>03 / SHARE</span></div></div>${renderHomeResume()}</section><section class="home-strip page-width"><p>让内容成为主角<br><strong>让阅读少一点寻找</strong></p><div>${icon('education')}<span>教育背景</span></div><div>${icon('briefcase')}<span>实习与工作</span></div><div>${icon('award')}<span>荣誉奖项</span></div><div>${icon('code')}<span>项目经历</span></div></section><section class="workflow page-width" id="workflow"><div class="section-heading"><div><span class="eyebrow">FROM DOCUMENT TO OPPORTUNITY</span><h2>三步，把简历整理好。</h2></div><p>系统帮你整理，表达权始终在你。<br>每次发布，都是你确认后的版本。</p></div><div class="workflow-grid"><article><span class="step-number">01</span><div class="step-illustration upload-illustration"><span class="document-chip">PDF</span>${icon('arrow')}<span class="document-chip blue-chip">简序</span></div><h3>上传已有简历</h3><p>导入 PDF、Word 或粘贴文本，自动识别教育、实习、奖项和项目经历。</p></article><article><span class="step-number">02</span><div class="step-illustration review-illustration"><span>${icon('check')} 教育背景</span><span class="review-yellow">${icon('alert')} 待核对</span></div><h3>核对，让表达更准确</h3><p>对照原文检查提取结果，补充遗漏、修正内容，调整适合你的阅读顺序。</p></article><article><span class="step-number">03</span><div class="step-illustration share-illustration">${icon('link')}<span>你的专属简历链接</span>${icon('arrow')}</div><h3>一个链接，分享你的经历</h3><p>确认后发布独立网页。在电脑上清晰展示经历，更新内容也无需更换链接。</p></article></div></section><section class="home-ending page-width"><span class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h2>把下一次自我介绍，<br>准备得更好。</h2><a href="${user?'/dashboard':'/auth?mode=register'}" data-nav class="button button-primary button-lg">开始整理我的经历 ${icon('arrow')}</a><span class="ending-symbol" aria-hidden="true">↗</span></section></main>${footer()}`;
}

function renderAuth(mode=new URLSearchParams(location.search).get('mode')==='register'?'register':'login'){
 const register=mode==='register';
 app.innerHTML=`${header({simple:true})}<main id="main" class="auth-layout page-width"><aside class="auth-story"><span class="eyebrow">YOUR STORY, WELL PRESENTED.</span><h1>好经历，<br>从这里<br><span>被看见。</span></h1><p>整理你的故事。<br>分享给下一个机会。</p><div class="auth-decoration" aria-hidden="true"><span></span><span></span><span></span><b>J.</b></div></aside><section class="auth-panel"><div class="auth-form-wrap"><span class="eyebrow">${register?'START YOUR STORY':'WELCOME BACK'}</span><h2>${register?'创建你的简序账号':'欢迎回来'}</h2><p>${register?'保存你的简历，管理每一次发布。':'继续打磨你的下一次自我介绍。'}</p><form id="auth-form" data-mode="${mode}">${register?'<label class="form-field"><span>你的称呼</span><input name="name" autocomplete="name" placeholder="我们该怎么称呼你" required maxlength="80"></label>':''}<label class="form-field"><span>邮箱</span><input name="email" type="email" autocomplete="email" placeholder="hello@example.com" required maxlength="254"></label><label class="form-field"><span>密码</span><input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" placeholder="${register?'至少 8 位字符':'输入你的密码'}" required minlength="${register?8:1}" maxlength="128"></label>${register?'<p class="field-hint">账号用于保护你的私人草稿，HR 查看公开简历无需登录。</p>':''}<div class="form-error" id="auth-error" role="alert"></div><button class="button button-primary button-full button-lg" type="submit">${register?'创建账号':'登录'} ${icon('arrow')}</button></form><p class="auth-switch">${register?'已有账号？':'还没有账号？'}<button class="text-button" data-action="auth-mode" data-mode="${register?'login':'register'}">${register?'直接登录':'创建账号'}</button></p><a href="/demo" data-nav class="auth-demo">先看看简历展示效果 ${icon('arrow')}</a></div></section></main>`;
}

function relativeDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'刚刚':date.toLocaleDateString('zh-CN',{month:'short',day:'numeric'})+' '+date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
function renderDashboard(){
 document.title='我的工作台 · 简序 JIANXU';
 app.innerHTML=`${header()}<main id="main" class="dashboard page-width"><div class="dashboard-top"><div><span class="eyebrow">MY RESUME WORKSPACE</span><h1>${esc(user.name||'你好')}，把经历整理好<span class="blue-text">。</span></h1><p>在这里打磨内容，决定何时与世界分享。</p></div><button class="button button-primary" data-action="import">${icon('plus')} 创建简历</button></div><section class="start-banner"><div class="banner-art" aria-hidden="true">${icon('file')}<span>${icon('spark')}</span></div><div><span class="eyebrow">从你已有的简历开始</span><h2>少一点填写，多一点表达。</h2><p>导入文件或粘贴文本，自动整理为可编辑的简历草稿。</p></div><button class="button button-outline" data-action="import">导入简历 ${icon('upload')}</button></section><div class="list-heading"><h2>我的简历 <span>${dashboardResumes.length}</span></h2><p>草稿仅你可见 · 确认后再发布</p></div>${dashboardResumes.length?`<div class="resume-list">${dashboardResumes.map((r,i)=>`<article class="resume-row"><div class="resume-thumb" aria-hidden="true"><span>${String(i+1).padStart(2,'0')}</span><i></i><i></i><i></i></div><div class="resume-row-info"><div><h3><a href="/editor/${encodeURIComponent(r.id)}" data-nav>${esc(r.title||'未命名简历')}</a></h3><span class="status-badge ${r.status==='published'?'published':''}"><i></i>${r.status==='published'?'已发布':'私人草稿'}</span>${r.hasUnpublishedChanges?'<span class="pending-label">有未发布修改</span>':''}</div><p>更新于 ${esc(relativeDate(r.updatedAt))}${r.status==='published'?' · 分享链接保持不变':''}</p></div><div class="row-actions"><a href="/editor/${encodeURIComponent(r.id)}" data-nav class="button button-outline button-sm">编辑简历 ${icon('arrow')}</a>${r.status==='published'?`<button class="icon-button" data-action="share" data-id="${esc(r.id)}" title="复制分享链接" aria-label="复制 ${esc(r.title)} 的分享链接">${icon('link')}</button><a class="icon-button" href="/r/${encodeURIComponent(r.slug)}" target="_blank" rel="noopener" title="查看公开页面" aria-label="查看 ${esc(r.title)} 的公开页面">${icon('eye')}</a><button class="icon-button" data-action="unpublish" data-id="${esc(r.id)}" title="下架简历" aria-label="下架 ${esc(r.title)}">${icon('download')}</button>`:''}<button class="icon-button danger-hover" data-action="delete-resume" data-id="${esc(r.id)}" title="删除简历" aria-label="删除 ${esc(r.title)}">${icon('trash')}</button></div></article>`).join('')}</div>`:`<section class="empty-workspace"><div class="empty-paper" aria-hidden="true">${icon('file')}<i></i><i></i></div><h3>你的下一段故事，从第一份简历开始</h3><p>上传已有简历，或先用演示内容熟悉编辑流程。</p><div><button class="button button-primary" data-action="import">导入我的简历 ${icon('upload')}</button><button class="button button-ghost" data-action="create-demo">使用演示内容</button></div></section>`}<div class="dashboard-footnote">${icon('eye')} 只有你点击“发布”，他人才可以通过链接查看简历。<a href="/demo" data-nav>浏览展示示例 ${icon('arrow')}</a></div></main>${footer()}`;
}

function openModal(html,kind='') {orderSorter?.cancel(false);lastFocus=document.activeElement;modal.className=kind;modal.innerHTML=html;if(!modal.open)modal.showModal();requestAnimationFrame(()=>modal.querySelector('[autofocus], input:not([type=checkbox]), button')?.focus());}
function closeModal(){if(modal.open)modal.close();if(activeConfirm){activeConfirm(false);activeConfirm=null;}lastFocus?.focus?.();}
function confirmDialog(title,description,button='确认',danger=false){
 return new Promise(resolve=>{activeConfirm=resolve;openModal(`<div class="modal-header"><div><span class="eyebrow">请确认这次操作</span><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p class="confirm-description">${esc(description)}</p><div class="modal-actions"><button class="button button-outline" data-action="close-modal">取消</button><button class="button ${danger?'button-danger':'button-primary'}" data-action="confirm-yes">${esc(button)}</button></div>`,'confirm-modal');});
}
function renderImport(){
 const s=importState;
 openModal(`<div class="modal-header"><div><span class="eyebrow">BRING YOUR STORY</span><h2 id="modal-title">开始整理你的简历</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭" ${s.busy?'disabled':''}>${icon('close')}</button></div><p class="modal-description">先生成私人草稿，检查内容后再决定是否发布。</p><div class="segmented-control" role="tablist" aria-label="导入方式"><button role="tab" aria-selected="${s.tab==='file'}" class="${s.tab==='file'?'selected':''}" data-action="import-tab" data-tab="file" ${s.busy?'disabled':''}>上传文件</button><button role="tab" aria-selected="${s.tab==='text'}" class="${s.tab==='text'?'selected':''}" data-action="import-tab" data-tab="text" ${s.busy?'disabled':''}>粘贴文本</button></div><form id="import-form"><fieldset ${s.busy?'disabled':''}>${s.tab==='file'?`<label class="file-drop" id="file-drop"><input type="file" id="resume-file" name="file" accept=".pdf,.docx,.txt" aria-label="选择简历文件"><span class="upload-circle">${icon(s.file?'file':'upload')}</span><strong>${s.file?esc(s.file.name):'选择文件，或将简历拖到这里'}</strong><span>${s.file?'点击可重新选择':'PDF / DOCX / TXT · 最大 8 MB'}</span></label><p class="field-hint">建议上传可复制文字的简历。扫描图片型 PDF 可能无法提取，可改用粘贴文本。</p>`:`<label class="form-field"><span>简历原文</span><textarea name="text" id="import-text" rows="9" placeholder="将简历内容粘贴到这里，尽量保留标题和换行。" maxlength="60000" required>${esc(s.text)}</textarea></label>`}${config.aiAvailable?`<label class="checkbox-row ai-choice"><input type="checkbox" name="useAI" ${s.useAI?'checked':''}><span><strong>使用增强识别</strong><small>选中后会将简历文字发送给外部 AI 服务处理。默认使用本地识别，也可直接修改提取结果。</small></span></label>`:'<div class="local-note">'+icon('check')+' 默认在当前服务内提取内容，无需外部 AI。</div>'}<div class="form-error" id="import-error" role="alert">${esc(s.error)}</div><button class="button button-primary button-full" type="submit">${s.busy?'<span class="spinner small"></span> 正在提取，请稍候…':'提取并开始核对 '+icon('arrow')}</button></fieldset></form><div class="import-other"><button class="text-button" data-action="create-blank" ${s.busy?'disabled':''}>从空白简历开始</button><span>或</span><button class="text-button" data-action="create-demo" ${s.busy?'disabled':''}>使用演示内容</button></div>`,'import-modal');
}
async function createResume(kind='blank'){
 const operationVersion=routeVersion;
 const button=document.querySelector(`[data-action="create-${kind}"]`);if(button)button.disabled=true;
 try{const {resume}=await api('/api/resumes',{method:'POST',body:kind==='demo'?{title:'演示简历 · 可自由修改',content:demoContent(),sourceText:demoSource}:{title:'我的新简历',content:emptyContent()}});if(operationVersion!==routeVersion){toast('新草稿已创建，可在工作台继续编辑。');return;}closeModal();await navigate(`/editor/${resume.id}`,{force:true});toast(kind==='demo'?'已创建演示副本。示例信息均为虚构，请替换为你的真实经历。':'已创建私人草稿，开始填写你的经历。');}
 catch(error){toast(error.message,true);if(button)button.disabled=false;}
}

function renderPublic(resume,demo=false){
 document.body.className='public-page';
 const c=normalizeContent(resume.content), visible=c.settings.order.filter(k=>!c.settings.hidden.includes(k)&&c[k].length);
 app.innerHTML=`<div class="public-topbar"><div>${brand()}<span>${demo?'演示预览':'个人简历'}</span></div><div>${demo?`<a href="${user?'/dashboard':'/auth?mode=register'}" data-nav class="button button-primary button-sm">创建我的简历 ${icon('arrow')}</a>`:''}<button class="button button-outline button-sm" data-action="print">${icon('download')} 打印 / 存为 PDF</button></div></div><main id="main" class="public-layout"><aside class="public-sidebar"><span class="eyebrow">${demo?'DEMO RESUME':'RESUME INDEX'}</span><p>${esc(c.profile.name||'个人简历')}</p><nav aria-label="简历章节"><a href="#resume-top" class="active">概览</a>${visible.map((k,i)=>`<a href="#resume-${k}"><span>${String(i+1).padStart(2,'0')}</span>${sections[k].label}</a>`).join('')}</nav><div class="sidebar-bottom">${demo?esc(demoNotice)+'。':'清晰的经历，<br>值得认真阅读。'}</div></aside><div id="resume-top">${renderResume(c,{demo})}</div></main><div class="public-bottom">${demo?'演示简历 · 人物与个人经历为模拟内容。':resume.publishedAt?`发布于 ${esc(relativeDate(resume.publishedAt))}`:''}<a href="/" data-nav>用简序创建你的个人简历 ${icon('arrow')}</a></div>`;
}

function warningList(){return Array.isArray(editor?.warnings)?editor.warnings:[];}
function editorDirtyStatus(){const changed=dirty();const target=document.querySelector('#save-state');if(target){target.className=changed?'save-state unsaved':'save-state';target.innerHTML=changed?'<i></i> 有未保存修改':icon('check')+' 草稿已保存';}const count=document.querySelector('#review-count');if(count)count.textContent=warningList().length;}
function renderEditor(){
 orderSorter?.destroy();orderSorter=null;
 document.body.className='editor-page';document.title=`编辑 ${editor.title} · 简序 JIANXU`;
 const warnings=warningList();
 app.innerHTML=`<header class="editor-header"><div class="editor-header-left"><a href="/dashboard" data-nav class="icon-button" aria-label="返回工作台">${icon('back')}</a>${brand()}<span class="editor-divider"></span><label class="title-input-label"><span class="sr-only">简历名称</span><input id="resume-title" value="${esc(editor.title)}" maxlength="120" placeholder="给这份简历起个名字"></label></div><div class="editor-header-actions"><span id="save-state" class="save-state"></span><button class="button button-outline button-sm" data-action="save">${icon('save')} 保存草稿</button><button class="button button-ghost button-sm" data-action="preview">${icon('eye')}<span>预览</span></button><button class="button button-primary button-sm" data-action="publish">${editor.status==='published'?'更新发布':'发布简历'} ${icon('arrow')}</button></div></header><div class="editor-shell"><aside class="editor-sidebar"><div class="workspace-label">编辑工作室 <span>WORKSPACE</span></div><nav aria-label="编辑模块">${Object.entries(sections).map(([k,v])=>`<button data-action="editor-section" data-section="${k}" class="${editorSection===k?'selected':''}">${icon(v.icon)}<span>${v.label}</span>${k!=='profile'&&k!=='settings'?`<small>${editor.content[k].length}</small>`:''}</button>`).join('')}</nav><div class="editor-sidebar-note"><span class="status-badge ${editor.status==='published'?'published':''}"><i></i>${editor.status==='published'?'已发布':'私人草稿'}</span><p>${editor.status==='published'?'保存只更新草稿。点击“更新发布”，才会改变他人看到的内容。':'你的内容仅自己可见。检查完成后，再发布分享。'}</p>${editor.status==='published'?`<button class="text-button" data-action="editor-share">复制公开链接 ${icon('link')}</button>`:''}</div></aside><main id="main" class="editor-main"><div class="editor-section-header"><span class="eyebrow">${String(Object.keys(sections).indexOf(editorSection)+1).padStart(2,'0')} / YOUR EXPERIENCE</span><div><h1>${sections[editorSection].label}</h1>${!['profile','settings'].includes(editorSection)?`<button class="button button-outline button-sm" data-action="add-record" data-section="${editorSection}">${icon('plus')} 添加经历</button>`:''}</div><p>${sections[editorSection].note}</p></div><div id="editor-fields">${renderEditorFields()}</div><div class="editor-bottom-nav"><p>${icon('check')} 修改后请保存，发布前可先预览。</p><button class="text-button" data-action="next-section">${editorSection==='settings'?'预览展示效果':'继续下一项'} ${icon('arrow')}</button></div></main><aside class="proof-panel"><div class="proof-tabs" role="tablist" aria-label="核对参考"><button role="tab" aria-selected="${proofTab==='source'}" class="${proofTab==='source'?'selected':''}" data-action="proof-tab" data-tab="source">原文对照</button><button role="tab" aria-selected="${proofTab==='review'}" class="${proofTab==='review'?'selected':''}" data-action="proof-tab" data-tab="review">待核对 <span id="review-count">${warnings.length}</span></button><button role="tab" aria-selected="${proofTab==='preview'}" class="${proofTab==='preview'?'selected':''}" data-action="proof-tab" data-tab="preview">缩略预览</button></div><div id="proof-content">${renderProof()}</div></aside></div>`;
 mountOrderSorting();editorDirtyStatus();setBusy(editor.busy);
}
function renderField([key,label,type,placeholder,wide],section,record,index){
 const value=record[key]??'',id=`field-${section}-${index}-${key}`;
 const attr=`id="${id}" data-field="${key}" data-section="${section}" ${section!=='profile'?`data-index="${index}"`:''}`;
 return `<label class="form-field ${wide?'field-wide':''}" for="${id}"><span>${esc(label)}</span>${type==='textarea'?`<textarea ${attr} rows="${key==='responsibilities'||key==='achievements'?4:3}" placeholder="${esc(placeholder)}" maxlength="8000">${esc(value)}</textarea>`:type==='select'?`<select ${attr}><option value="internship" ${value==='internship'?'selected':''}>实习</option><option value="work" ${value==='work'?'selected':''}>工作</option><option value="other" ${value==='other'?'selected':''}>其他实践</option></select>`:`<input ${attr} type="${type==='url'?'text':type}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${['summary','technologies'].includes(key)?8000:2000}" ${type==='url'?'inputmode="url"':''}>`}</label>`;
}
function renderEditorFields(){
 const section=editorSection,c=editor.content;
 if(section==='profile')return `<div class="edit-intro">${icon('user')}<div><strong>第一眼，认识你。</strong><span>姓名与求职方向会出现在页面最上方。联系方式的公开范围可在“展示设置”中调整。</span></div></div><div class="field-grid">${fields.profile.map(f=>renderField(f,'profile',c.profile,0)).join('')}</div>`;
 if(section==='settings')return renderSettings();
 const rows=c[section];
 return `${c.settings.hidden.includes(section)?'<div class="inline-notice">'+icon('eye')+' 本模块已隐藏，公开页面不会显示。可在展示设置中恢复。</div>':''}${rows.length?rows.map((row,i)=>`<section class="edit-record"><div class="record-heading"><div><span>${String(i+1).padStart(2,'0')}</span><h2>${esc(row.school||row.company||row.name||row.category||`第 ${i+1} 条${sections[section].label}`)}</h2></div><div><button class="icon-button" data-action="move-record" data-section="${section}" data-index="${i}" data-direction="-1" ${i===0?'disabled':''} title="上移这条经历" aria-label="上移这条经历">${icon('up')}</button><button class="icon-button" data-action="move-record" data-section="${section}" data-index="${i}" data-direction="1" ${i===rows.length-1?'disabled':''} title="下移这条经历" aria-label="下移这条经历">${icon('down')}</button><button class="icon-button danger-hover" data-action="delete-record" data-section="${section}" data-index="${i}" title="删除这条经历" aria-label="删除这条经历">${icon('trash')}</button></div></div><div class="field-grid">${fields[section].map(f=>renderField(f,section,row,i)).join('')}</div></section>`).join(''):`<div class="empty-section"><span>${icon(sections[section].icon)}</span><h2>添加你的${sections[section].label}</h2><p>没有相关经历可以留空，空白模块不会出现在展示页中。</p><button class="button button-outline" data-action="add-record" data-section="${section}">${icon('plus')} 添加第一条</button></div>`}${rows.length?`<button class="add-record-bottom" data-action="add-record" data-section="${section}">${icon('plus')} 再添加一条${sections[section].label}</button>`:''}`;
}
function renderOrderRows(){
 const s=editor.content.settings;
 const grip='<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor"><circle cx="8" cy="5" r="1.8"/><circle cx="16" cy="5" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="19" r="1.8"/><circle cx="16" cy="19" r="1.8"/></svg>';
 return s.order.map((key,index)=>`<div class="order-row" data-order-section="${key}" role="listitem"><button type="button" class="order-handle" aria-label="调整${sections[key].label}顺序，当前第 ${index+1} 位" aria-pressed="false" aria-describedby="order-help" title="长按把手拖动；空格或回车开始键盘排序">${grip}</button><span class="order-num" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><label class="checkbox-row"><input type="checkbox" data-setting="module" data-section="${key}" ${s.hidden.includes(key)?'':'checked'}><span>${sections[key].label}<small class="order-move-confirmation" aria-hidden="true"></small></span></label><details class="order-position-details"><summary aria-label="调整${sections[key].label}的位置">更多</summary><label><span>移到第几位</span><select data-order-position="${key}" aria-label="${sections[key].label}移到第几位">${s.order.map((_,i)=>`<option value="${i}" ${i===index?'selected':''}>第 ${i+1} 位</option>`).join('')}</select></label></details></div>`).join('');
}
function mountOrderSorting(){
 const list=document.querySelector('.order-list');
 if(!list||!editor)return;
 const target=editor;
 orderSorter=setupOrderSorting(list,{
   isDisabled:()=>editor!==target||target.busy||editorSection!=='settings',
   labelFor:key=>sections[key].label,
   status:document.querySelector('.order-sort-status'),
   onCommit:(order,{section,method})=>{
     if(editor!==target||target.busy)return;
     orderSorter?.destroy();orderSorter=null;
     target.content.settings.order=order;
     list.innerHTML=renderOrderRows();mountOrderSorting();refreshProof();
     const row=Array.from(list.querySelectorAll('[data-order-section]')).find(item=>item.dataset.orderSection===section);
     if(row){
       row.classList.add('is-reordered');
       const confirmation=row.querySelector('.order-move-confirmation');
       confirmation.textContent=`✓ 已移至第 ${order.indexOf(section)+1} 位`;
       setTimeout(()=>{row.classList.remove('is-reordered');confirmation.textContent='';},3000);
     }
     if(method==='position'){const details=row?.querySelector('details');if(details)details.open=true;row?.querySelector('select')?.focus({preventScroll:true});}
     else row?.querySelector('.order-handle')?.focus({preventScroll:true});
   }
 });
}
function renderSettings(){const s=editor.content.settings;return `<section class="settings-block"><h2>阅读顺序与模块显示</h2><p class="order-help" id="order-help">长按左侧六点把手约 0.15 秒，再上下拖动排序。也可用“更多”指定位置。键盘：把手上按空格或回车开始，上下键移动，再次确认；Esc 取消。</p><p>取消勾选可隐藏模块，内容仍保留在草稿中。顺序修改需更新发布后才对 HR 生效。</p><div class="order-list" role="list" aria-label="简历展示模块顺序">${renderOrderRows()}</div><p class="order-sort-status sr-only" role="status" aria-live="polite" aria-atomic="true"></p></section><section class="settings-block"><h2>联系方式公开范围</h2><p>选择阅读者可以看到的联系方式，发布后生效。</p><label class="checkbox-row privacy-row"><input type="checkbox" data-setting="showEmail" ${s.showEmail?'checked':''}><span><strong>公开邮箱</strong><small>${esc(editor.content.profile.email||'尚未填写邮箱')}</small></span></label><label class="checkbox-row privacy-row"><input type="checkbox" data-setting="showPhone" ${s.showPhone?'checked':''}><span><strong>公开电话</strong><small>${esc(editor.content.profile.phone||'尚未填写电话')}</small></span></label></section><section class="settings-block"><h2>简约蓝 · 当前展示样式</h2><p>清晰的标题层级、适当的留白和克制的色彩，让经历成为阅读重点。页面采用桌面浏览器布局。</p><div class="theme-preview"><span></span><span></span><span></span><strong>JIANXU / COBALT</strong>${icon('check')}</div></section>`;}
function renderProof(){
 if(proofTab==='preview')return `<div class="proof-preview-info"><span>缩略预览随修改实时更新。</span><button class="button button-outline button-sm" data-action="preview">放大阅读 ${icon('arrow')}</button></div><div class="live-preview">${renderResume(editor.content,{compact:true,anchorPrefix:'live'})}</div>`;
 if(proofTab==='review'){const warnings=warningList();return `<div class="proof-description">自动提取可能遗漏或归错内容。请对照原文核对，确认后可标记完成。</div>${warnings.length?`<div class="review-list">${warnings.map((w,i)=>`<article class="review-item"><div><span>${icon('alert')}${esc(sections[w.section]?.label||'简历内容')}</span><button class="text-button" data-action="resolve-warning" data-index="${i}">已核对 ${icon('check')}</button></div><p>${esc(typeof w==='string'?w:w.message||'请对照原文核对这部分内容。')}</p>${sections[w.section]?`<button class="review-go" data-action="editor-section" data-section="${esc(w.section)}">查看这一模块 ${icon('arrow')}</button>`:''}</article>`).join('')}</div>`:`<div class="proof-empty"><div>${icon('check')}</div><h3>没有待处理的识别提示</h3><p>仍建议检查学历、时间、岗位和成果数字，确保内容与你的真实经历一致。</p></div>`}`;}
 return `<div class="proof-description">${icon('file')} 上传简历的文字内容，仅你可见。</div>${editor.sourceText?`<pre class="source-text">${esc(editor.sourceText)}</pre>`:`<div class="proof-empty"><div>${icon('file')}</div><h3>这是一份手动创建的简历</h3><p>填写左侧内容即可。也可以从工作台上传文件，创建带原文对照的新草稿。</p></div>`}`;
}
function refreshProof(){const target=document.querySelector('#proof-content');if(target&&(proofTab==='preview'||proofTab==='review'))target.innerHTML=renderProof();editorDirtyStatus();}
function setBusy(busy){if(busy)orderSorter?.cancel(false);if(editor)editor.busy=busy;document.querySelectorAll('#resume-title,[data-field],[data-setting],[data-order-position],.editor-shell button,.editor-header button').forEach(el=>{if(busy){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}});}
async function saveEditor(publishing=false){
 if(!editor||editor.busy)return;const target=editor,id=target.id;setBusy(true);
 try{
   target.title=target.title.trim()||(target.content.profile.name?`${target.content.profile.name}的简历`:'我的简历');
   const snapshot={title:target.title,content:structuredClone(target.content),sourceText:target.sourceText||'',warnings:structuredClone(target.warnings||[])};
   const savedSig=JSON.stringify({title:snapshot.title,content:snapshot.content,warnings:snapshot.warnings});
   let {resume}=await api(`/api/resumes/${encodeURIComponent(id)}`,{method:'PUT',body:snapshot});
   Object.assign(target,{status:resume.status,slug:resume.slug,shareUrl:resume.shareUrl,updatedAt:resume.updatedAt,publishedAt:resume.publishedAt,hasUnpublishedChanges:resume.hasUnpublishedChanges,savedSignature:savedSig});
   if(publishing){({resume}=await api(`/api/resumes/${encodeURIComponent(id)}/publish`,{method:'POST'}));Object.assign(target,{status:resume.status,slug:resume.slug,shareUrl:resume.shareUrl,publishedAt:resume.publishedAt,hasUnpublishedChanges:resume.hasUnpublishedChanges});}
   if(editor!==target)return;
   if(publishing){renderEditor();showPublishSuccess();}else{const titleInput=document.querySelector('#resume-title');if(titleInput)titleInput.value=target.title;editorDirtyStatus();toast('草稿已保存。公开页面不会随草稿修改。');}
 }catch(error){if(editor===target){editorDirtyStatus();toast(error.message,true);}}finally{target.busy=false;if(editor===target)setBusy(false);}
}
function shareLink(resume){return safeUrl(resume?.shareUrl)|| (resume?.slug?`${location.origin}/r/${encodeURIComponent(resume.slug)}`:'');}
function showPublishSuccess(){const link=shareLink(editor);openModal(`<div class="publish-success-icon">${icon('check')}</div><span class="eyebrow">READY TO BE SEEN</span><h2 id="modal-title">你的经历，已准备好分享。</h2><p>阅读者无需登录即可查看。之后更新发布，仍使用这个链接。</p><label class="form-field"><span>独立展示链接</span><input id="share-url" value="${esc(link)}" readonly></label><div class="modal-actions"><button class="button button-outline" data-action="copy-published">${icon('copy')} 复制链接</button><a class="button button-primary" href="${esc(link)}" target="_blank" rel="noopener">打开展示页 ${icon('arrow')}</a></div><button class="text-button done-button" data-action="close-modal">返回编辑</button>`,'publish-modal');}
async function copyLink(link){if(!link){toast('请先发布简历，再分享链接。',true);return;}try{await navigator.clipboard.writeText(link);toast('分享链接已复制。');}catch{openModal(`<div class="modal-header"><h2 id="modal-title">复制分享链接</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p class="modal-description">请选中下方链接，按 Ctrl+C（Mac 使用 ⌘C）复制。</p><input class="copy-fallback" value="${esc(link)}" readonly aria-label="分享链接">`,'confirm-modal');modal.querySelector('input').select();}}

document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-nav]');
 if(nav&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0){event.preventDefault();await navigate(nav.getAttribute('href'));return;}
 const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
 const action=target.dataset.action;
 try{
 switch(action){
  case 'auth-mode':renderAuth(target.dataset.mode);history.replaceState({},'',`/auth${target.dataset.mode==='register'?'?mode=register':''}`);break;
  case 'account':openModal(`<div class="modal-header"><h2 id="modal-title">我的账号</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p class="account-name">${esc(user.name||'简序用户')}</p><p class="modal-description">${esc(user.email)}</p><button class="button button-outline button-full" data-action="logout">${icon('logout')} 退出登录</button>`,'confirm-modal');break;
  case 'logout':if(editor?.busy){toast('正在保存，请稍候再退出。');break;}if(dirty()&&!await confirmDialog('退出前保存了吗？','当前还有尚未保存的修改。退出登录后，这些修改将不会保留。','放弃修改并退出',true))break;await api('/api/auth/logout',{method:'POST'});user=null;editor=null;await navigate('/',{force:true});toast('已退出登录。');break;
  case 'close-modal':if(importState.busy&&modal.classList.contains('import-modal'))break;closeModal();break;
  case 'confirm-yes':{const resolve=activeConfirm;activeConfirm=null;closeModal();resolve?.(true);break;}
  case 'import':importState={tab:'file',file:null,text:'',useAI:false,busy:false,error:''};renderImport();break;
  case 'import-tab':importState.tab=target.dataset.tab;importState.error='';renderImport();break;
  case 'create-blank':await createResume();break;
  case 'create-demo':await createResume('demo');break;
  case 'print':window.print();break;
  case 'share':{const r=dashboardResumes.find(r=>r.id===target.dataset.id);await copyLink(shareLink(r));break;}
  case 'unpublish':{const r=dashboardResumes.find(r=>r.id===target.dataset.id);if(await confirmDialog('将这份简历下架？','下架后，其他人将无法通过分享链接查看。草稿仍然保留，你可以随时重新发布。','确认下架')){await api(`/api/resumes/${encodeURIComponent(r.id)}/unpublish`,{method:'POST'});await renderRoute();toast('简历已下架，草稿已保留。');}break;}
  case 'delete-resume':{const r=dashboardResumes.find(r=>r.id===target.dataset.id);if(await confirmDialog('删除这份简历？',`“${r.title}”将被永久删除，公开链接也会失效。此操作无法撤销。`,'删除简历',true)){await api(`/api/resumes/${encodeURIComponent(r.id)}`,{method:'DELETE'});await renderRoute();toast('简历已删除。');}break;}
  case 'editor-section':editorSection=target.dataset.section;renderEditor();document.querySelector('.editor-main')?.scrollTo(0,0);break;
  case 'next-section':{const list=Object.keys(sections),index=list.indexOf(editorSection);if(index===list.length-1){showPreview();}else{editorSection=list[index+1];renderEditor();document.querySelector('.editor-main')?.scrollTo(0,0);}break;}
  case 'proof-tab':proofTab=target.dataset.tab;document.querySelectorAll('.proof-tabs button').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===proofTab);b.setAttribute('aria-selected',String(b.dataset.tab===proofTab));});document.querySelector('#proof-content').innerHTML=renderProof();break;
  case 'add-record':{const key=target.dataset.section;editor.content[key].push(newRecord(key));renderEditor();const inputs=document.querySelectorAll(`[data-section="${key}"][data-field]`);const first=inputs[inputs.length-fields[key].length];first?.focus();break;}
  case 'delete-record':{const section=target.dataset.section,index=Number(target.dataset.index);if(await confirmDialog('删除这条经历？','删除后请保存草稿，才能保留这次修改。','删除经历',true)){editor.content[section].splice(index,1);renderEditor();}break;}
  case 'move-record':{const rows=editor.content[target.dataset.section],i=Number(target.dataset.index),j=i+Number(target.dataset.direction);if(j>=0&&j<rows.length){[rows[i],rows[j]]=[rows[j],rows[i]];renderEditor();}break;}
  case 'resolve-warning':editor.warnings.splice(Number(target.dataset.index),1);refreshProof();toast('已标记为核对完成，请保存草稿。');break;
  case 'save':await saveEditor();break;
  case 'publish':if(!editor.content.profile.name.trim()){editorSection='profile';renderEditor();document.querySelector('[data-field="name"]')?.focus();toast('请先填写姓名，再发布简历。',true);break;}if(await confirmDialog(editor.status==='published'?'更新公开简历？':'准备好发布简历了吗？',`将保存当前内容并${editor.status==='published'?'更新':'发布'}展示页。${warningList().length?`还有 ${warningList().length} 条识别提示，请确保已核对学历、经历和成果。`:'请确认内容准确，并检查联系方式的公开范围。'}`,editor.status==='published'?'保存并更新发布':'保存并发布'))await saveEditor(true);break;
  case 'preview':showPreview();break;
  case 'editor-share':case 'copy-published':await copyLink(shareLink(editor));break;
 }
 }catch(error){toast(error.message,true);}
});
function showPreview(){openModal(`<div class="preview-modal-header"><div><h2 id="modal-title">展示预览</h2><span>正在预览当前编辑内容，尚未改变公开页面。</span></div><button class="icon-button" data-action="close-modal" aria-label="关闭预览">${icon('close')}</button></div><div class="full-preview">${renderResume(editor.content,{anchorPrefix:'preview'})}</div>`,'preview-modal');}

document.addEventListener('input',event=>{
 const el=event.target;
 if(el.id==='resume-title'&&editor){editor.title=el.value;editorDirtyStatus();return;}
 if(el.dataset.field&&editor){const row=el.dataset.section==='profile'?editor.content.profile:editor.content[el.dataset.section][Number(el.dataset.index)];row[el.dataset.field]=el.value;refreshProof();return;}
 if(el.id==='import-text')importState.text=el.value;
});
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.id==='resume-file'){setImportFile(el.files?.[0]);return;}
 if(el.name==='useAI')importState.useAI=el.checked;
 if(el.dataset.setting&&editor){const key=el.dataset.setting;if(key==='module'){const hidden=editor.content.settings.hidden;editor.content.settings.hidden=el.checked?hidden.filter(k=>k!==el.dataset.section):[...new Set([...hidden,el.dataset.section])];}else editor.content.settings[key]=el.checked;refreshProof();}
 if(el.tagName==='SELECT'&&el.dataset.field&&editor){const row=editor.content[el.dataset.section][Number(el.dataset.index)];row[el.dataset.field]=el.value;refreshProof();}
});
function setImportFile(file){if(!file)return;if(file.size>8*1024*1024){importState.error='文件超过 8 MB，请压缩后重新选择，或粘贴简历文本。';importState.file=null;}else if(!/\.(pdf|docx|txt)$/i.test(file.name)){importState.error='请选择 PDF、DOCX 或 TXT 文件。旧版 DOC 文件请先另存为 DOCX。';importState.file=null;}else{importState.file=file;importState.error='';}renderImport();}
document.addEventListener('dragover',event=>{const drop=event.target.closest('#file-drop');if(drop){event.preventDefault();drop.classList.add('dragging');}});
document.addEventListener('dragleave',event=>event.target.closest('#file-drop')?.classList.remove('dragging'));
document.addEventListener('drop',event=>{const drop=event.target.closest('#file-drop');if(drop){event.preventDefault();drop.classList.remove('dragging');if(!importState.busy)setImportFile(event.dataTransfer.files[0]);}});
document.addEventListener('submit',async event=>{
 if(event.target.id==='auth-form'){
   event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]'),mode=form.dataset.mode;button.disabled=true;document.querySelector('#auth-error').textContent='';
   try{const body=Object.fromEntries(new FormData(form));({user}=await api(`/api/auth/${mode}`,{method:'POST',body}));await navigate('/dashboard',{force:true});toast(mode==='register'?'账号已创建，开始整理你的第一份简历吧。':'欢迎回来。');}catch(error){document.querySelector('#auth-error').textContent=error.message;button.disabled=false;}
 }
 if(event.target.id==='import-form'){
   event.preventDefault();if(importState.busy)return;
   const operationVersion=routeVersion,operationState=importState,operationUserId=user?.id;
   if(importState.tab==='file'&&!importState.file){importState.error='请先选择一份简历文件。';renderImport();return;}
   if(importState.tab==='text'&&!importState.text.trim()){importState.error='请先粘贴简历内容。';renderImport();return;}
   let body;if(importState.tab==='file'){body=new FormData();body.append('file',importState.file);body.append('useAI',String(importState.useAI));}else body={text:importState.text,useAI:importState.useAI};
   importState.busy=true;importState.error='';renderImport();
   try{const result=await api('/api/import',{method:'POST',body});if(user?.id!==operationUserId)throw new Error('账号已切换，请在当前账号重新导入。');const title=(result.content.profile?.name?`${result.content.profile.name}的简历`:operationState.file?.name.replace(/\.[^.]+$/,'')||'我的简历').slice(0,120);const {resume}=await api('/api/resumes',{method:'POST',body:{title,content:result.content,sourceText:result.sourceText,warnings:result.warnings,expectedUserId:operationUserId}});operationState.busy=false;if(operationVersion!==routeVersion||operationState!==importState){toast('简历已导入为私人草稿，可在工作台继续核对。');return;}closeModal();await navigate(`/editor/${resume.id}`,{force:true});if(editor?.id===resume.id){proofTab=result.warnings?.length?'review':'source';renderEditor();}toast('已生成私人草稿。请对照原文检查提取内容。');}catch(error){operationState.busy=false;if(operationVersion===routeVersion&&operationState===importState){importState.error=error.message;renderImport();}else toast(`导入未完成：${error.message}`,true);}
 }
});
modal.addEventListener('cancel',event=>{if(importState.busy&&modal.classList.contains('import-modal')){event.preventDefault();return;}if(activeConfirm){activeConfirm(false);activeConfirm=null;}});
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){if(!(importState.busy&&modal.classList.contains('import-modal')))closeModal();}}});
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
window.addEventListener('popstate',async()=>{const destination=location.pathname+location.search;if(editor?.busy){history.pushState({},'',`/editor/${editor.id}`);toast('正在保存，请稍候再离开。');return;}if(dirty()){history.pushState({},'',`/editor/${editor.id}`);if(await confirmDialog('离开前保存了吗？','当前有尚未保存的修改。离开后将不再保留。','放弃修改并离开',true))await navigate(destination,{force:true});}else{editor=null;closeModal();await renderRoute();}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&editor){event.preventDefault();saveEditor();}});

loading('正在打开简序…');
const initial=await Promise.allSettled([api('/api/auth/me'),api('/api/config')]);
if(initial[0].status==='fulfilled')user=initial[0].value.user;
if(initial[1].status==='fulfilled')config=initial[1].value;
await renderRoute();
