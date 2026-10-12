import { sections, defaultOrder, fields, emptyContent, normalizeContent, newRecord, demoContent, demoSource, demoNotice } from './data.js';
import { esc, icon, renderResume, safeUrl } from './resume.js';
import { setupOrderSorting } from './order-sort.js';
import { reviewKey, fieldRecord, getFieldReview, getReviewItems, confirmField, invalidateField, pruneReview, renderSourceText, getPendingReviewItems, getNextReviewItem, getRecordReviewCandidates, confirmRecord } from './review.js';
import { createAutosave } from './autosave.js';

const app=document.querySelector('#app');
const modal=document.querySelector('#modal');
let user=null, config={aiAvailable:false,maxUploadMB:8}, routeVersion=0, editor=null, dashboardResumes=[], editorSection='profile', proofTab='source';
let importState={tab:'file',file:null,text:'',useAI:false,busy:false,error:''};
let lastFocus=null, toastTimeout, activeConfirm=null;
let orderSorter=null;
let activeReview=null;
let reviewFilter='all', autosave=null, autosaveTarget=null;
let mobileEditorPanel='edit';
const mobileEditorMedia=typeof window.matchMedia==='function'?window.matchMedia('(max-width: 1179px)'):null;
const isMobileEditor=()=>Boolean(mobileEditorMedia?.matches);

function revealNavItem(nav,item){
 if(!nav?.getBoundingClientRect||!item?.getBoundingClientRect||nav.scrollWidth<=nav.clientWidth)return;
 const bounds=nav.getBoundingClientRect(),target=item.getBoundingClientRect();
 if(target.left<bounds.left)nav.scrollLeft-=bounds.left-target.left+8;
 else if(target.right>bounds.right)nav.scrollLeft+=target.right-bounds.right+8;
}

// Keep the same fields mounted when changing panes so selection and unsaved input survive.
function syncMobileEditorPanel(){
 const shell=document.querySelector('.editor-shell');if(!shell||!editor)return;
 shell.dataset.mobilePanel=mobileEditorPanel;
 document.querySelectorAll('.editor-pane-switch [data-action="editor-pane"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.panel===mobileEditorPanel)));
 if(isMobileEditor()&&mobileEditorPanel==='edit')revealNavItem(document.querySelector('.editor-sidebar nav'),document.querySelector('.editor-sidebar nav button.selected'));
}
function setMobileEditorPanel(panel,{restoreField=false,scroll=true}={}){
 if(!editor||!['edit','proof'].includes(panel))return;
 orderSorter?.cancel(false);mobileEditorPanel=panel;syncMobileEditorPanel();
 if(!isMobileEditor())return;
 if(panel==='proof')scrollToSourceHit();
 if(restoreField&&panel==='edit'&&activeReview){
  const container=Array.from(document.querySelectorAll('[data-field-container]')).find(node=>node.dataset.fieldContainer===reviewKey(activeReview));
  if(container){container.scrollIntoView({block:'center',behavior:'instant'});container.querySelector('[data-field]')?.focus({preventScroll:true});return;}
 }
 if(scroll)document.querySelector('.editor-shell')?.scrollIntoView({block:'start',behavior:'instant'});
 const target=panel==='proof'?(document.querySelector('.source-inspector h2')||document.querySelector('.proof-tabs button.selected')):document.querySelector('.editor-section-header h1');
 target?.focus({preventScroll:true});
}
mobileEditorMedia?.addEventListener?.('change',()=>{
 if(!editor)return;
 const focused=document.activeElement;
 if(isMobileEditor()){
  if(focused?.closest?.('.proof-panel'))mobileEditorPanel='proof';
  else if(focused?.closest?.('.editor-main'))mobileEditorPanel='edit';
 }
 syncMobileEditorPanel();
 if(!isMobileEditor()&&(focused?.closest?.('.editor-pane-switch')||focused?.closest?.('.mobile-return-edit')))document.querySelector('.editor-section-header h1')?.focus({preventScroll:true});
});

function selectPublicChapter(nav,selected){
 if(!selected)return;
 nav.querySelectorAll('a').forEach(link=>{
  link.classList.toggle('active',link===selected);
  if(link===selected)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
 });
 revealNavItem(nav,selected);
}
function updatePublicChapter(){
 const nav=document.querySelector('.public-sidebar nav');if(!nav)return;
 const links=Array.from(nav.querySelectorAll('a')),sidebar=nav.parentElement;
 const threshold=window.innerWidth<=1100?Math.max(90,sidebar.getBoundingClientRect().bottom+20):140;
 let selected=links[0];
 for(const link of links.slice(1)){
  const section=document.querySelector(link.getAttribute('href'));
  if(section&&section.getBoundingClientRect().top<=threshold)selected=link;
 }
 // Short final sections cannot always reach the header before the page ends.
 const page=document.scrollingElement;
 if(page&&page.scrollHeight>page.clientHeight&&page.scrollTop+page.clientHeight>=page.scrollHeight-2){
  selected=links.slice(1).reverse().find(link=>document.querySelector(link.getAttribute('href')))||selected;
 }
 if(selected&&!selected.classList.contains('active'))selectPublicChapter(nav,selected);
}
let publicScrollFrame=false;
function queuePublicChapter(){
 if(publicScrollFrame)return;
 publicScrollFrame=true;requestAnimationFrame(()=>{publicScrollFrame=false;updatePublicChapter();});
}
window.addEventListener('scroll',queuePublicChapter,{passive:true});
window.addEventListener('resize',queuePublicChapter,{passive:true});

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
const signature=()=>editor?JSON.stringify({title:editor.title,content:editor.content,warnings:editor.warnings,confirmations:editor.review?.confirmations||[]}):'';
const dirty=()=>Boolean(editor&&signature()!==editor.savedSignature);
const saveInFlight=()=>Boolean(editor&&autosaveTarget===editor&&autosave?.state.status==='saving');
function disposeAutosave(){autosave?.dispose();autosave=null;autosaveTarget=null;}
function ensureAutosave(target=editor){
 if(!target)return null;
 if(autosaveTarget===target)return autosave;
 disposeAutosave();autosaveTarget=target;
 autosave=createAutosave({delay:1000,isDirty:()=>editor===target&&dirty(),save:options=>persistEditor(target,options),onState:state=>{target.saveState=state;if(editor===target)editorDirtyStatus();}});
 return autosave;
}
function queueAutosave(){if(editor){ensureAutosave().schedule();editorDirtyStatus();}}
async function prepareToLeave(){
 if(editor?.busy){toast('正在发布，请稍候再离开。');return false;}
 if(!dirty()&&!saveInFlight())return true;
 const target=editor;setBusy(true);
 try{await ensureAutosave().flush();return editor===target&&!dirty();}
 catch{return await confirmDialog('草稿尚未保存','保存失败，当前修改仍留在页面中。选择取消可继续编辑或重试保存；放弃离开会丢失未保存内容。','放弃修改并离开',true);}
 finally{target.busy=false;if(editor===target)setBusy(false);}
}
async function navigate(path,{force=false,replace=false}={}) {
  orderSorter?.cancel(false);
  if(editor?.busy){toast('正在保存，请稍候再离开。');return;}
  if(!force&&!await prepareToLeave())return;
  disposeAutosave();closeModal();editor=null;
  history[replace?'replaceState':'pushState']({},'',path);await renderRoute();window.scrollTo(0,0);
}
async function renderRoute(){
  orderSorter?.destroy();orderSorter=null;
  activeReview=null;
  mobileEditorPanel='edit';
  reviewFilter='all';
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
 app.innerHTML=`${header()}<main id="main"><section class="hero page-width"><div class="hero-copy"><div class="eyebrow"><span class="tiny-dot"></span> A CLEARER WAY TO PRESENT YOURSELF</div><h1>你的经历，<br>值得<span class="blue-word">清晰呈现<span class="hand-underline"></span></span>。</h1><p class="hero-description">把一份简历，变成一个好读的个人主页。<br>上传、核对、分享，让下一位阅读者看见你的价值。</p><div class="hero-actions"><a href="${user?'/dashboard':'/auth?mode=register'}" data-nav class="button button-primary button-lg">创建我的简历 ${icon('arrow')}</a><a href="/demo" data-nav class="text-link">浏览完整示例 ${icon('arrow')}</a></div><div class="hero-note">${icon('check')} 支持 PDF、Word 与文本 <span></span> 发布前由你确认</div><div class="hero-index"><span>01 / IMPORT</span><i></i><span>02 / REFINE</span><i></i><span>03 / SHARE</span></div></div>${renderHomeResume()}</section><section class="home-strip page-width"><p>让内容成为主角<br><strong>让阅读少一点寻找</strong></p><div>${icon('education')}<span>教育背景</span></div><div>${icon('briefcase')}<span>实习与工作</span></div><div>${icon('award')}<span>荣誉奖项</span></div><div>${icon('code')}<span>项目经历</span></div></section><section class="workflow page-width" id="workflow"><div class="section-heading"><div><span class="eyebrow">FROM DOCUMENT TO OPPORTUNITY</span><h2>三步，把简历整理好。</h2></div><p>系统帮你整理，表达权始终在你。<br>每次发布，都是你确认后的版本。</p></div><div class="workflow-grid"><article><span class="step-number">01</span><div class="step-illustration upload-illustration"><span class="document-chip">PDF</span>${icon('arrow')}<span class="document-chip blue-chip">简序</span></div><h3>上传已有简历</h3><p>导入 PDF、Word 或粘贴文本，自动识别教育、实习、奖项和项目经历。</p></article><article><span class="step-number">02</span><div class="step-illustration review-illustration"><span>${icon('check')} 教育背景</span><span class="review-yellow">${icon('alert')} 待核对</span></div><h3>核对，让表达更准确</h3><p>对照原文检查提取结果，补充遗漏、修正内容，调整适合你的阅读顺序。</p></article><article><span class="step-number">03</span><div class="step-illustration share-illustration">${icon('link')}<span>你的专属简历链接</span>${icon('arrow')}</div><h3>一个链接，分享你的经历</h3><p>确认后发布独立网页。在电脑和手机上清晰展示经历，更新内容也无需更换链接。</p></article></div></section><section class="home-ending page-width"><span class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h2>把下一次自我介绍，<br>准备得更好。</h2><a href="${user?'/dashboard':'/auth?mode=register'}" data-nav class="button button-primary button-lg">开始整理我的经历 ${icon('arrow')}</a><span class="ending-symbol" aria-hidden="true">↗</span></section></main>${footer()}`;
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
 openModal(`<div class="modal-header"><div><span class="eyebrow">BRING YOUR STORY</span><h2 id="modal-title">开始整理你的简历</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭" ${s.busy?'disabled':''}>${icon('close')}</button></div><p class="modal-description">先生成私人草稿，检查内容后再决定是否发布。</p><div class="segmented-control" role="tablist" aria-label="导入方式"><button role="tab" aria-selected="${s.tab==='file'}" class="${s.tab==='file'?'selected':''}" data-action="import-tab" data-tab="file" ${s.busy?'disabled':''}>上传文件</button><button role="tab" aria-selected="${s.tab==='text'}" class="${s.tab==='text'?'selected':''}" data-action="import-tab" data-tab="text" ${s.busy?'disabled':''}>粘贴文本</button></div><form id="import-form"><fieldset ${s.busy?'disabled':''}>${s.tab==='file'?`<label class="file-drop" id="file-drop"><input type="file" id="resume-file" name="file" accept=".pdf,.docx,.txt" aria-label="选择简历文件"><span class="upload-circle">${icon(s.file?'file':'upload')}</span><strong>${s.file?esc(s.file.name):'选择文件，或将简历拖到这里'}</strong><span>${s.file?'点击可重新选择':'PDF / DOCX / TXT · 最大 8 MB'}</span></label><p class="field-hint">建议上传可复制文字的简历。扫描图片型 PDF 可能无法提取，可改用粘贴文本。</p>`:`<label class="form-field"><span>简历原文</span><textarea name="text" id="import-text" rows="9" placeholder="将简历内容粘贴到这里，尽量保留标题和换行。" maxlength="60000" required>${esc(s.text)}</textarea></label>`}${config.aiAvailable?`<label class="checkbox-row ai-choice"><input type="checkbox" name="useAI" ${s.useAI?'checked':''}><span><strong>使用增强识别</strong><small>选中后会将简历文字发送给外部 AI 服务处理。默认使用本地识别，也可直接修改提取结果。</small></span></label>`:'<div class="local-note">'+icon('check')+' 默认在当前服务内提取内容。</div>'}<div class="form-error" id="import-error" role="alert">${esc(s.error)}</div><button class="button button-primary button-full" type="submit">${s.busy?'<span class="spinner small"></span> 正在提取，请稍候…':'提取并开始核对 '+icon('arrow')}</button></fieldset></form><div class="import-other"><button class="text-button" data-action="create-blank" ${s.busy?'disabled':''}>从空白简历开始</button><span>或</span><button class="text-button" data-action="create-demo" ${s.busy?'disabled':''}>使用演示内容</button></div>`,'import-modal');
}
async function createResume(kind='blank'){
 const operationVersion=routeVersion;
 const button=document.querySelector(`[data-action="create-${kind}"]`);if(button)button.disabled=true;
 try{const {resume}=await api('/api/resumes',{method:'POST',body:kind==='demo'?{title:'演示简历 · 可自由修改',content:demoContent(),sourceText:demoSource}:{title:'我的新简历',content:emptyContent()}});if(operationVersion!==routeVersion){toast('新草稿已创建，可在工作台继续编辑。');return;}closeModal();await navigate(`/editor/${resume.id}`,{force:true});toast(kind==='demo'?'已创建演示副本。人物经历为模拟内容，请替换为你的真实经历。':'已创建私人草稿，开始填写你的经历。');}
 catch(error){toast(error.message,true);if(button)button.disabled=false;}
}

function renderPublic(resume,demo=false){
 document.body.className='public-page';
 const c=normalizeContent(resume.content), visible=c.settings.order.filter(k=>!c.settings.hidden.includes(k)&&c[k].length);
 app.innerHTML=`<div class="public-topbar"><div>${brand()}<span>${demo?'演示预览':'个人简历'}</span></div><div>${demo?`<a href="${user?'/dashboard':'/auth?mode=register'}" data-nav class="button button-primary button-sm">创建我的简历 ${icon('arrow')}</a>`:''}<button class="button button-outline button-sm" data-action="print">${icon('download')} 打印 / 存为 PDF</button></div></div><main id="main" class="public-layout"><aside class="public-sidebar"><span class="eyebrow">${demo?'DEMO RESUME':'RESUME INDEX'}</span><p>${esc(c.profile.name||'个人简历')}</p><nav aria-label="简历章节"><a href="#resume-top" class="active">概览</a>${visible.map((k,i)=>`<a href="#resume-${k}"><span>${String(i+1).padStart(2,'0')}</span>${sections[k].label}</a>`).join('')}</nav><div class="sidebar-bottom">${demo?esc(demoNotice)+'。':'清晰的经历，<br>值得认真阅读。'}</div></aside><div id="resume-top">${renderResume(c,{demo})}</div></main><div class="public-bottom">${demo?'演示简历 · 人物与个人经历为模拟内容。':resume.publishedAt?`发布于 ${esc(relativeDate(resume.publishedAt))}`:''}<a href="/" data-nav>用简序创建你的个人简历 ${icon('arrow')}</a></div>`;
}

function warningSelection(w){
 if(!fields[w?.section]?.some(([key])=>key===w.field))return null;
 const recordId=w.section==='profile'?'profile':w.recordId||(editor.content[w.section]?.length===1?editor.content[w.section][0].id:null);
 return recordId?{section:w.section,recordId,field:w.field}:null;
}
function warningList(){return (editor?.warnings||[]).filter(w=>{const selection=warningSelection(w);return !selection||!getFieldReview(editor,selection)?.confirmed;});}
function reviewProgress(){const items=getReviewItems(editor);return {total:items.length,done:items.filter(item=>item.confirmed).length,pending:items.filter(item=>!item.confirmed)};}
function reviewAttributes(item){return `data-review-section="${esc(item.section)}" data-review-record="${esc(item.recordId)}" data-review-field="${esc(item.field)}"`;}
function reviewDisplayValue(item){return item.section==='experience'&&item.field==='type'?({internship:'实习',work:'工作',other:'其他实践'}[item.value]||item.value):item.value;}
function selectionFrom(element){return {section:element.dataset.reviewSection,recordId:element.dataset.reviewRecord,field:element.dataset.reviewField};}
function fieldSelection(element){const section=element.dataset.section;const row=section==='profile'?editor.content.profile:editor.content[section]?.[Number(element.dataset.index)];return row?{section,recordId:section==='profile'?'profile':row.id,field:element.dataset.field}:null;}
function renderReviewProgress(){
 const {total,done}=reviewProgress();
 return `<div class="review-progress-copy"><strong>核对提取结果</strong><span>已核对 <b>${done}</b> / ${total} 项</span></div><progress value="${done}" max="${total||1}" aria-label="字段核对进度"></progress><p>点选字段查看原文，或按经历核对。核对状态自动保存，修改内容后需重新确认。</p>`;
}
function refreshReviewStatus(){
 if(!editor?.sourceText)return;
 const progress=document.querySelector('#field-review-progress');if(progress)progress.innerHTML=renderReviewProgress();
 document.querySelectorAll('[data-review-status]').forEach(node=>{const item=getFieldReview(editor,selectionFrom(node));if(item){node.textContent=item.stateLabel;node.className=`field-review-state ${item.state}`;}});
 document.querySelectorAll('[data-field-container]').forEach(node=>node.classList.toggle('is-reviewing',Boolean(activeReview&&node.dataset.fieldContainer===reviewKey(activeReview))));
 const count=document.querySelector('#review-count');if(count)count.textContent=reviewProgress().pending.length;
}
function renderSourceInspector(){
 const item=activeReview?getFieldReview(editor,activeReview):null;
 if(!item)return `<section class="source-inspector"><span class="eyebrow">FIELD REVIEW</span><h2 tabindex="-1">点选字段，对照原文</h2><p>点击字段旁的“原文”定位对应内容。手机上可切换编辑与核对，完成检查后逐项确认。</p><button class="button button-outline button-sm" data-action="next-review">开始核对 ${icon('arrow')}</button></section>`;
 const label=reviewDisplayValue(item);
 const matched=item.ranges.length>0;
 const explanation=matched?(item.changed?'下方高亮保留修改前的来源，请核对当前值。':item.evidence?.match==='normalized'?'已定位原文，提取时统一了文字或日期格式。':'已定位对应原文。'):item.evidence?.match==='ambiguous'?'原文存在多个可能位置，暂不自动高亮。请核对上下文。':'未能可靠定位原文。请检查全文后补充，或确认此项可留空。';
 return `<section class="source-inspector"><div class="source-inspector-top"><span>${esc(sections[item.section].label)}</span><span class="field-review-state ${item.state}">${item.stateLabel}</span></div><h2 tabindex="-1">${esc(item.label)}</h2><p class="source-record-title">${esc(item.entryTitle)}</p><div class="source-current-value">${label?esc(label):'<span>尚未填写</span>'}</div><p class="source-match-explanation">${explanation}</p>${!item.confirmed&&item.warnings.length?`<div class="source-field-warning">${icon('alert')}<span>${item.warnings.map(w=>esc(w.message)).join('<br>')}</span></div>`:''}<div class="source-review-actions">${!item.confirmed?`<button class="button button-primary button-sm" data-action="confirm-next" ${reviewAttributes(item)}>${icon('check')} 确认并下一项</button>`:''}${item.confirmed?`<button class="button button-outline button-sm" data-action="confirm-field" ${reviewAttributes(item)}>取消已核对</button>`:''}<button class="button button-outline button-sm" data-action="next-review">${item.confirmed?'下一待核对项':'稍后核对'} ${icon('arrow')}</button><button class="button button-outline button-sm mobile-return-edit" data-action="editor-pane" data-panel="edit" data-restore-field="true">${icon('back')} 修改此字段</button></div></section>`;
}
const reviewFilterLabels={all:'全部待核对',warning:'需检查',changed:'修改后待核对',unmatched:'未定位原文'};
function renderReviewFilter(){return `<div class="review-filter"><label for="review-filter">核对范围</label><select id="review-filter" aria-label="筛选待核对字段">${Object.entries(reviewFilterLabels).map(([key,label])=>`<option value="${key}" ${reviewFilter===key?'selected':''}>${label} (${getPendingReviewItems(editor,key).length})</option>`).join('')}</select></div>`;}
function renderSourceProof(){
 if(!editor.sourceText)return `<div class="proof-empty"><div>${icon('file')}</div><h3>这是一份手动创建的简历</h3><p>在“编辑内容”中填写即可。也可以从工作台上传文件，创建带原文对照的新草稿。</p></div>`;
 const item=activeReview?getFieldReview(editor,activeReview):null;
 return `<div class="source-workspace">${renderReviewFilter()}${renderSourceInspector()}<div class="source-document-heading">${icon('file')} 简历原文 · 仅自己可见</div><div class="source-document" tabindex="0" aria-label="简历原文，已定位内容以高亮显示">${renderSourceText(editor.sourceText,item?.ranges||[])}</div></div>`;
}
function renderReviewQueue(){
 const {total,done}=reviewProgress();
 const pending=getPendingReviewItems(editor,reviewFilter);
 const warnings=warningList();
 const general=warnings.filter(w=>!warningSelection(w));
 return `${renderReviewFilter()}<div class="review-queue-summary"><strong>已核对 ${done} / ${total} 项</strong><p>当前范围：${reviewFilterLabels[reviewFilter]} · ${pending.length} 项。点击条目定位字段与原文。</p></div>${general.length?`<div class="review-list">${general.map(w=>`<article class="review-item"><p>${esc(w.message)}</p><button class="text-button" data-action="resolve-warning" data-index="${warnings.indexOf(w)}">我已查看此提醒 ${icon('check')}</button></article>`).join('')}</div>`:''}${pending.length?`<div class="field-review-queue">${pending.map(item=>`<button class="review-field-item" data-action="review-field" ${reviewAttributes(item)}><span class="review-field-heading"><strong>${esc(item.label)}</strong><span class="field-review-state ${item.state}">${item.stateLabel}</span></span><span class="review-field-context">${esc(item.entryTitle)}</span><span class="review-field-value">${esc(reviewDisplayValue(item)||'尚未填写')}</span>${item.warnings.length?`<span class="review-field-warning">${esc(item.warnings[0].message)}</span>`:''}</button>`).join('')}</div>`:`<div class="proof-empty"><div>${icon('check')}</div><h3>${reviewProgress().pending.length?'当前范围已核对完成':total?'已完成本次字段核对':'暂无待核对字段'}</h3><p>${reviewProgress().pending.length?'其他范围仍有待核对字段，可切换筛选继续。':total?'核对状态自动保存。之后修改内容，需要重新确认。':'可返回编辑补充内容，或查看原文检查是否有遗漏。'}</p></div>`}`;
}
function setProofTab(tab){
 proofTab=tab;document.querySelectorAll('.proof-tabs button').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===tab);b.setAttribute('aria-selected',String(b.dataset.tab===tab));});
 const panel=document.querySelector('#proof-content');if(panel){panel.innerHTML=renderProof();panel.classList.toggle('has-source-workspace',tab==='source'&&Boolean(editor?.sourceText));}
}
function scrollToSourceHit(){
 const panel=document.querySelector('.source-document'),hit=panel?.querySelector('[data-source-hit]');
 if(panel&&hit)panel.scrollTop=hit.getBoundingClientRect().top-panel.getBoundingClientRect().top+panel.scrollTop-72;
}
function focusReview(selection,{focusInput=false}={}){
 if(!editor?.sourceText||!getFieldReview(editor,selection))return;
 activeReview=selection;
 if(editorSection!==selection.section){editorSection=selection.section;proofTab='source';renderEditor();}
 else setProofTab('source');
 refreshReviewStatus();
 if(focusInput&&isMobileEditor())setMobileEditorPanel('proof');
 if(!isMobileEditor()||mobileEditorPanel==='proof')scrollToSourceHit();
 if(focusInput&&!isMobileEditor()){const container=Array.from(document.querySelectorAll('[data-field-container]')).find(node=>node.dataset.fieldContainer===reviewKey(selection));container?.scrollIntoView({block:'nearest'});container?.querySelector('[data-field]')?.focus({preventScroll:true});}
}
function nextReview(){
 const next=getNextReviewItem(editor,activeReview,reviewFilter);
 if(next)focusReview(next,{focusInput:true});else{setProofTab('review');toast(reviewProgress().pending.length?'当前筛选下已无待核对项，可切换范围继续。':'所有字段均已核对，正在自动保存。');}
}
function openRecordReview(selection){
 const {eligible,skipped,alreadyConfirmed}=getRecordReviewCandidates(editor,selection),record=fieldRecord(editor,selection);if(!record)return;
 const title=record.school||record.company||record.name||record.category||sections[selection.section].label;
 openModal(`<div class="modal-header"><div><span class="eyebrow">REVIEW THIS ENTRY</span><h2 id="modal-title">核对本段经历</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p class="batch-record-title">${esc(title)}</p><p class="modal-description">请逐行对照当前内容与原文，再确认本段的 ${eligible.length} 项。已核对 ${alreadyConfirmed.length} 项。</p>${eligible.length?`<div class="batch-review-table"><div class="batch-review-head"><span>当前内容</span><span>对应原文</span></div>${eligible.map(item=>`<div class="batch-review-row"><div><strong>${esc(item.label)}</strong><p>${esc(reviewDisplayValue(item))}</p></div><blockquote>${esc(item.ranges.map(range=>editor.sourceText.slice(range.start,range.end)).join('\n'))}</blockquote></div>`).join('')}</div>`:''}${skipped.length?`<section class="batch-review-skipped"><strong>${skipped.length} 项需单独核对，本次不会确认</strong><ul>${skipped.map(item=>`<li>${esc(item.label)}：${esc(item.stateLabel)}</li>`).join('')}</ul></section>`:''}<div class="modal-actions"><button class="button button-outline" data-action="close-modal">返回编辑</button><button class="button button-primary" data-action="confirm-record" data-review-section="${esc(selection.section)}" data-review-record="${esc(selection.recordId)}" ${eligible.length?'':'disabled'}>确认以上 ${eligible.length} 项</button></div>`,'batch-review-modal');
}
function editorDirtyStatus(){
 const changed=dirty(),state=editor?.saveState||{},target=document.querySelector('#save-state');
 if(target){const status=state.status==='saving'?'saving':state.status==='error'&&changed?'error':changed?'pending':'saved';target.className=`save-state ${status}`;target.innerHTML=status==='saving'?'<span class="spinner" aria-hidden="true"></span> 正在保存…':status==='error'?`${icon('alert')} 保存失败 <button class="text-button" data-action="retry-save">重试</button>`:status==='pending'?'<i></i> 等待自动保存':icon('check')+' 草稿已保存';target.title=status==='error'?(state.error?.message||'修改仍保留在当前页面，请重试保存。'):'';}
 const error=document.querySelector('#save-error');if(error){error.hidden=!(state.status==='error'&&changed);error.textContent=error.hidden?'':`${state.error?.message||'暂时无法保存。'} 修改仍在当前页面中，请重试保存后再关闭。`;}
 const count=document.querySelector('#review-count');if(count)count.textContent=reviewProgress().pending.length;
}
function renderEditor(){
 orderSorter?.destroy();orderSorter=null;
 document.body.className='editor-page';document.title=`编辑 ${editor.title} · 简序 JIANXU`;
 const warnings=warningList();
 pruneReview(editor);if(activeReview&&!fieldRecord(editor,activeReview))activeReview=null;
 app.innerHTML=`<header class="editor-header"><div class="editor-header-left"><a href="/dashboard" data-nav class="icon-button" aria-label="返回工作台">${icon('back')}</a>${brand()}<span class="editor-divider"></span><label class="title-input-label"><span class="sr-only">简历名称</span><input id="resume-title" value="${esc(editor.title)}" maxlength="120" placeholder="给这份简历起个名字"></label></div><div class="editor-header-actions"><span id="save-state" class="save-state" role="status" aria-live="polite" aria-atomic="true"></span><button class="button button-outline button-sm" data-action="save">${icon('save')} 保存草稿</button><button class="button button-ghost button-sm" data-action="preview">${icon('eye')}<span>预览</span></button><button class="button button-primary button-sm" data-action="publish">${editor.status==='published'?'更新发布':'发布简历'} ${icon('arrow')}</button></div></header><nav class="editor-pane-switch" aria-label="编辑工作区"><button type="button" data-action="editor-pane" data-panel="edit" aria-controls="main" aria-pressed="${mobileEditorPanel==='edit'}">${icon('file')} 编辑内容</button><button type="button" data-action="editor-pane" data-panel="proof" aria-controls="editor-proof" aria-pressed="${mobileEditorPanel==='proof'}">${icon('eye')} 原文与核对</button></nav><div class="editor-shell" data-mobile-panel="${mobileEditorPanel}"><aside class="editor-sidebar"><div class="workspace-label">编辑工作室 <span>WORKSPACE</span></div><nav aria-label="编辑模块">${Object.entries(sections).map(([k,v])=>`<button data-action="editor-section" data-section="${k}" class="${editorSection===k?'selected':''}">${icon(v.icon)}<span>${v.label}</span>${k!=='profile'&&k!=='settings'?`<small>${editor.content[k].length}</small>`:''}</button>`).join('')}</nav><div class="editor-sidebar-note"><span class="status-badge ${editor.status==='published'?'published':''}"><i></i>${editor.status==='published'?'已发布':'私人草稿'}</span><p>${editor.status==='published'?'保存只更新草稿。点击“更新发布”，才会改变他人看到的内容。':'你的内容仅自己可见。检查完成后，再发布分享。'}</p>${editor.status==='published'?`<button class="text-button" data-action="editor-share">复制公开链接 ${icon('link')}</button>`:''}</div></aside><main id="main" class="editor-main"><div class="editor-section-header"><span class="eyebrow">${String(Object.keys(sections).indexOf(editorSection)+1).padStart(2,'0')} / YOUR EXPERIENCE</span><div><h1 tabindex="-1">${sections[editorSection].label}</h1>${!['profile','settings'].includes(editorSection)?`<button class="button button-outline button-sm" data-action="add-record" data-section="${editorSection}">${icon('plus')} 添加经历</button>`:''}</div><p>${sections[editorSection].note}</p></div>${editor.sourceText&&editorSection!=='settings'?`<div id="field-review-progress" class="field-review-progress">${renderReviewProgress()}</div>`:''}<p id="save-error" class="save-error-notice" role="alert" hidden></p><div id="editor-fields">${renderEditorFields()}</div><div class="mobile-editor-note"><span class="status-badge ${editor.status==='published'?'published':''}"><i></i>${editor.status==='published'?'已发布':'私人草稿'}</span><p>${editor.status==='published'?'保存只更新草稿，更新发布后才会改变公开页面。':'草稿仅自己可见，检查后再发布分享。'}</p>${editor.status==='published'?`<button class="button button-outline button-sm" data-action="editor-share">复制公开链接 ${icon('link')}</button>`:''}</div><div class="editor-bottom-nav"><p>${icon('check')} 修改自动保存为草稿，发布前可先预览。</p><button class="text-button" data-action="next-section">${editorSection==='settings'?'预览展示效果':'继续下一项'} ${icon('arrow')}</button></div></main><aside class="proof-panel" id="editor-proof" aria-label="原文与核对"><div class="proof-tabs" role="tablist" aria-label="核对参考"><button role="tab" aria-selected="${proofTab==='source'}" class="${proofTab==='source'?'selected':''}" data-action="proof-tab" data-tab="source">原文对照</button><button role="tab" aria-selected="${proofTab==='review'}" class="${proofTab==='review'?'selected':''}" data-action="proof-tab" data-tab="review">待核对 <span id="review-count">${reviewProgress().pending.length}</span></button><button role="tab" aria-selected="${proofTab==='preview'}" class="${proofTab==='preview'?'selected':''}" data-action="proof-tab" data-tab="preview">缩略预览</button></div><div id="proof-content" class="${proofTab==='source'&&editor.sourceText?'has-source-workspace':''}">${renderProof()}</div></aside></div>`;
 mountOrderSorting();refreshReviewStatus();editorDirtyStatus();setBusy(editor.busy);syncMobileEditorPanel();
}
function renderField([key,label,type,placeholder,wide],section,record,index){
 const value=record[key]??'',id=`field-${section}-${index}-${key}`;
 const selection={section,recordId:section==='profile'?'profile':record.id,field:key};
 const review=editor.sourceText?getFieldReview(editor,selection):null;
 const attr=`id="${id}" data-field="${key}" data-section="${section}" ${section!=='profile'?`data-index="${index}"`:''}`;
 return `<div class="form-field ${wide?'field-wide':''}" data-field-container="${esc(reviewKey(selection))}"><div class="field-label-row"><label for="${id}">${esc(label)}</label>${review?`<button type="button" class="field-source-button" data-action="review-field" ${reviewAttributes(selection)} aria-label="查看${esc(label)}的原文">${icon('file')} 原文</button>`:''}</div>${type==='textarea'?`<textarea ${attr} rows="${key==='responsibilities'||key==='achievements'?4:3}" placeholder="${esc(placeholder)}" maxlength="8000">${esc(value)}</textarea>`:type==='select'?`<select ${attr}><option value="internship" ${value==='internship'?'selected':''}>实习</option><option value="work" ${value==='work'?'selected':''}>工作</option><option value="other" ${value==='other'?'selected':''}>其他实践</option></select>`:`<input ${attr} type="${type==='url'?'text':type}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${['summary','technologies'].includes(key)?8000:2000}" ${type==='url'?'inputmode="url"':''}>`}${review?`<span class="field-review-state ${review.state}" data-review-status ${reviewAttributes(selection)}>${review.stateLabel}</span>`:''}</div>`;
}
function renderEditorFields(){
 const section=editorSection,c=editor.content;
 if(section==='profile')return `<div class="edit-intro">${icon('user')}<div><strong>第一眼，认识你。</strong><span>姓名与求职方向会出现在页面最上方。联系方式的公开范围可在“展示设置”中调整。</span></div></div><div class="field-grid">${fields.profile.map(f=>renderField(f,'profile',c.profile,0)).join('')}</div>`;
 if(section==='settings')return renderSettings();
 const rows=c[section];
 return `${c.settings.hidden.includes(section)?'<div class="inline-notice">'+icon('eye')+' 本模块已隐藏，公开页面不会显示。可在展示设置中恢复。</div>':''}${rows.length?rows.map((row,i)=>`<section class="edit-record"><div class="record-heading"><div><span>${String(i+1).padStart(2,'0')}</span><h2>${esc(row.school||row.company||row.name||row.category||`第 ${i+1} 条${sections[section].label}`)}</h2></div><div><button class="icon-button" data-action="move-record" data-section="${section}" data-index="${i}" data-direction="-1" ${i===0?'disabled':''} title="上移这条经历" aria-label="上移这条经历">${icon('up')}</button><button class="icon-button" data-action="move-record" data-section="${section}" data-index="${i}" data-direction="1" ${i===rows.length-1?'disabled':''} title="下移这条经历" aria-label="下移这条经历">${icon('down')}</button><button class="icon-button danger-hover" data-action="delete-record" data-section="${section}" data-index="${i}" title="删除这条经历" aria-label="删除这条经历">${icon('trash')}</button></div></div>${editor.sourceText?`<button class="button button-outline button-sm record-review-button" data-action="review-record" data-review-section="${section}" data-review-record="${esc(row.id)}">${icon('check')} 核对本段经历</button>`:''}<div class="field-grid">${fields[section].map(f=>renderField(f,section,row,i)).join('')}</div></section>`).join(''):`<div class="empty-section"><span>${icon(sections[section].icon)}</span><h2>添加你的${sections[section].label}</h2><p>没有相关经历可以留空，空白模块不会出现在展示页中。</p><button class="button button-outline" data-action="add-record" data-section="${section}">${icon('plus')} 添加第一条</button></div>`}${rows.length?`<button class="add-record-bottom" data-action="add-record" data-section="${section}">${icon('plus')} 再添加一条${sections[section].label}</button>`:''}`;
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
function renderSettings(){const s=editor.content.settings;return `<section class="settings-block"><h2>阅读顺序与模块显示</h2><p class="order-help" id="order-help">长按左侧六点把手约 0.15 秒，再上下拖动排序。也可用“更多”指定位置。键盘：把手上按空格或回车开始，上下键移动，再次确认；Esc 取消。</p><p>取消勾选可隐藏模块，内容仍保留在草稿中。顺序修改需更新发布后才对 HR 生效。</p><div class="order-list" role="list" aria-label="简历展示模块顺序">${renderOrderRows()}</div><p class="order-sort-status sr-only" role="status" aria-live="polite" aria-atomic="true"></p></section><section class="settings-block"><h2>联系方式公开范围</h2><p>选择阅读者可以看到的联系方式，发布后生效。</p><label class="checkbox-row privacy-row"><input type="checkbox" data-setting="showEmail" ${s.showEmail?'checked':''}><span><strong>公开邮箱</strong><small>${esc(editor.content.profile.email||'尚未填写邮箱')}</small></span></label><label class="checkbox-row privacy-row"><input type="checkbox" data-setting="showPhone" ${s.showPhone?'checked':''}><span><strong>公开电话</strong><small>${esc(editor.content.profile.phone||'尚未填写电话')}</small></span></label></section><section class="settings-block"><h2>简约蓝 · 当前展示样式</h2><p>清晰的标题层级、适当的留白和克制的色彩，让经历成为阅读重点。页面会根据电脑、平板和手机的屏幕宽度调整布局。</p><div class="theme-preview"><span></span><span></span><span></span><strong>JIANXU / COBALT</strong>${icon('check')}</div></section>`;}
function renderProof(){
 if(proofTab==='preview')return `<div class="proof-preview-info"><span>缩略预览随修改实时更新。</span><button class="button button-outline button-sm" data-action="preview">放大阅读 ${icon('arrow')}</button></div><div class="live-preview">${renderResume(editor.content,{compact:true,anchorPrefix:'live'})}</div>`;
 if(proofTab==='review')return renderReviewQueue();
 return renderSourceProof();
}
function refreshProof(){
 const target=document.querySelector('#proof-content');
 if(target&&(proofTab==='preview'||proofTab==='review'))target.innerHTML=renderProof();
 else if(target&&proofTab==='source'&&editor.sourceText){const inspector=target.querySelector('.source-inspector');if(inspector)inspector.outerHTML=renderSourceInspector();const filter=target.querySelector('.review-filter');if(filter)filter.outerHTML=renderReviewFilter();}
 refreshReviewStatus();queueAutosave();
}
function setBusy(busy){if(busy)orderSorter?.cancel(false);if(editor)editor.busy=busy;document.querySelectorAll('#resume-title,[data-field],[data-setting],[data-order-position],.editor-shell button,.editor-header button').forEach(el=>{if(busy){if(el.dataset.wasDisabled===undefined)el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}});}
async function persistEditor(target,{automatic=false,publishing=false}={}){
 if(editor!==target)throw new Error('编辑对象已切换，请在当前页面保存。');
 const id=target.id;if(publishing)setBusy(true);
 try{
   target.title=target.title.trim()||(target.content.profile.name?`${target.content.profile.name}的简历`:'我的简历');
   const snapshot={title:target.title,content:structuredClone(target.content),sourceText:target.sourceText||'',warnings:structuredClone(target.warnings||[]),review:{version:1,confirmations:structuredClone(target.review?.confirmations||[])}};
   const savedSig=JSON.stringify({title:snapshot.title,content:snapshot.content,warnings:snapshot.warnings,confirmations:snapshot.review.confirmations});
   let {resume}=await api(`/api/resumes/${encodeURIComponent(id)}`,{method:'PUT',body:snapshot});
   Object.assign(target,{status:resume.status,slug:resume.slug,shareUrl:resume.shareUrl,updatedAt:resume.updatedAt,publishedAt:resume.publishedAt,hasUnpublishedChanges:resume.hasUnpublishedChanges,savedSignature:savedSig});
   if(resume.review){target.review ||= {version:1,fields:[],confirmations:[]};target.review.fields=resume.review.fields;}
   if(publishing&&editor===target){({resume}=await api(`/api/resumes/${encodeURIComponent(id)}/publish`,{method:'POST'}));Object.assign(target,{status:resume.status,slug:resume.slug,shareUrl:resume.shareUrl,publishedAt:resume.publishedAt,hasUnpublishedChanges:resume.hasUnpublishedChanges});}
   if(editor!==target)return;
   if(publishing){renderEditor();showPublishSuccess();}else{const titleInput=document.querySelector('#resume-title');if(titleInput&&document.activeElement!==titleInput)titleInput.value=target.title;if(!automatic)toast('草稿已保存。公开页面不会随草稿修改。');}
 }finally{if(publishing){target.busy=false;if(editor===target)setBusy(false);}}
}
async function saveEditor(publishing=false){
 if(!editor||editor.busy)return;
 const target=editor;if(publishing)setBusy(true);
 try{await ensureAutosave().flush({publishing,force:true});}catch(error){if(editor===target)toast(error.message,true);}finally{if(publishing){target.busy=false;if(editor===target)setBusy(false);}}
}
function shareLink(resume){return safeUrl(resume?.shareUrl)|| (resume?.slug?`${location.origin}/r/${encodeURIComponent(resume.slug)}`:'');}
function showPublishSuccess(){const link=shareLink(editor);openModal(`<div class="publish-success-icon">${icon('check')}</div><span class="eyebrow">READY TO BE SEEN</span><h2 id="modal-title">你的经历，已准备好分享。</h2><p>阅读者无需登录即可查看。之后更新发布，仍使用这个链接。</p><label class="form-field"><span>独立展示链接</span><input id="share-url" value="${esc(link)}" readonly></label><div class="modal-actions"><button class="button button-outline" data-action="copy-published">${icon('copy')} 复制链接</button><a class="button button-primary" href="${esc(link)}" target="_blank" rel="noopener">打开展示页 ${icon('arrow')}</a></div><button class="text-button done-button" data-action="close-modal">返回编辑</button>`,'publish-modal');}
async function copyLink(link){if(!link){toast('请先发布简历，再分享链接。',true);return;}try{await navigator.clipboard.writeText(link);toast('分享链接已复制。');}catch{openModal(`<div class="modal-header"><h2 id="modal-title">复制分享链接</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p class="modal-description">手机可长按下方链接并选择“复制”；电脑可按 Ctrl+C（Mac 使用 ⌘C）复制。</p><input class="copy-fallback" value="${esc(link)}" readonly aria-label="分享链接">`,'confirm-modal');modal.querySelector('input').select();}}

document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-nav]');
 if(nav&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0){event.preventDefault();await navigate(nav.getAttribute('href'));return;}
 const chapter=event.target.closest('.public-sidebar nav a');
 if(chapter&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0){
  const hash=chapter.getAttribute('href'),section=document.querySelector(hash);
  if(section){
   // Native hash history also fires popstate, which would remount the SPA page.
   event.preventDefault();history.replaceState({},'',hash);selectPublicChapter(chapter.parentElement,chapter);
   section.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  return;
 }
 const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
 const action=target.dataset.action;
 try{
 switch(action){
  case 'auth-mode':renderAuth(target.dataset.mode);history.replaceState({},'',`/auth${target.dataset.mode==='register'?'?mode=register':''}`);break;
  case 'account':openModal(`<div class="modal-header"><h2 id="modal-title">我的账号</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p class="account-name">${esc(user.name||'简序用户')}</p><p class="modal-description">${esc(user.email)}</p><button class="button button-outline button-full" data-action="logout">${icon('logout')} 退出登录</button>`,'confirm-modal');break;
  case 'logout':if(!await prepareToLeave())break;disposeAutosave();await api('/api/auth/logout',{method:'POST'});user=null;editor=null;await navigate('/',{force:true});toast('已退出登录。');break;
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
  case 'editor-pane':setMobileEditorPanel(target.dataset.panel,{restoreField:target.dataset.panel==='edit'});break;
  case 'editor-section':activeReview=null;editorSection=target.dataset.section;mobileEditorPanel='edit';renderEditor();document.querySelector('.editor-main')?.scrollTo(0,0);if(isMobileEditor())setMobileEditorPanel('edit');break;
  case 'next-section':{const list=Object.keys(sections),index=list.indexOf(editorSection);if(index===list.length-1){showPreview();}else{activeReview=null;editorSection=list[index+1];mobileEditorPanel='edit';renderEditor();document.querySelector('.editor-main')?.scrollTo(0,0);if(isMobileEditor())setMobileEditorPanel('edit');}break;}
  case 'proof-tab':setProofTab(target.dataset.tab);break;
  case 'review-field':focusReview(selectionFrom(target),{focusInput:true});break;
  case 'next-review':nextReview();break;
  case 'confirm-next':{if(editor.busy)break;const selection=selectionFrom(target);activeReview=selection;confirmField(editor,selection,true);refreshProof();nextReview();break;}
  case 'review-record':openRecordReview(selectionFrom(target));break;
  case 'confirm-record':{if(editor.busy)break;const result=confirmRecord(editor,selectionFrom(target));closeModal();refreshProof();toast(`已确认 ${result.confirmed} 项${result.skipped?`，${result.skipped} 项仍需单独核对`:''}，将自动保存。`);break;}
  case 'confirm-field':{if(editor.busy)break;const selection=selectionFrom(target),item=getFieldReview(editor,selection);if(!item)break;confirmField(editor,selection,!item.confirmed);refreshProof();document.querySelector('.source-review-actions [data-action="confirm-next"], .source-review-actions [data-action="confirm-field"]')?.focus({preventScroll:true});break;}
  case 'add-record':{const key=target.dataset.section;editor.content[key].push(newRecord(key));queueAutosave();renderEditor();const inputs=document.querySelectorAll(`[data-section="${key}"][data-field]`);const first=inputs[inputs.length-fields[key].length];first?.focus();break;}
  case 'delete-record':{const section=target.dataset.section,index=Number(target.dataset.index);if(await confirmDialog('删除这条经历？','删除后会自动保存到草稿；已发布页面需更新发布后才会改变。','删除经历',true)){const [removed]=editor.content[section].splice(index,1);editor.warnings=editor.warnings.filter(w=>w.section!==section||w.recordId!==removed.id);pruneReview(editor);queueAutosave();renderEditor();}break;}
  case 'move-record':{const rows=editor.content[target.dataset.section],i=Number(target.dataset.index),j=i+Number(target.dataset.direction);if(j>=0&&j<rows.length){[rows[i],rows[j]]=[rows[j],rows[i]];queueAutosave();renderEditor();}break;}
  case 'resolve-warning':{const warning=warningList()[Number(target.dataset.index)];const index=editor.warnings.indexOf(warning);if(index>=0)editor.warnings.splice(index,1);refreshProof();toast('已记录，将自动保存到草稿。');break;}
  case 'save':case 'retry-save':await saveEditor();break;
  case 'publish':if(!editor.content.profile.name.trim()){editorSection='profile';mobileEditorPanel='edit';renderEditor();document.querySelector('[data-field="name"]')?.focus();toast('请先填写姓名，再发布简历。',true);break;}if(await confirmDialog(editor.status==='published'?'更新公开简历？':'准备好发布简历了吗？',`将保存当前内容并${editor.status==='published'?'更新':'发布'}展示页。${warningList().length?`还有 ${warningList().length} 条识别提示，请确保已核对学历、经历和成果。`:'请确认内容准确，并检查联系方式的公开范围。'}`,editor.status==='published'?'保存并更新发布':'保存并发布'))await saveEditor(true);break;
  case 'preview':showPreview();break;
  case 'editor-share':case 'copy-published':await copyLink(shareLink(editor));break;
 }
 }catch(error){toast(error.message,true);}
});
function showPreview(){openModal(`<div class="preview-modal-header"><div><h2 id="modal-title">展示预览</h2><span>正在预览当前编辑内容，尚未改变公开页面。</span></div><button class="icon-button" data-action="close-modal" aria-label="关闭预览">${icon('close')}</button></div><div class="full-preview">${renderResume(editor.content,{anchorPrefix:'preview'})}</div>`,'preview-modal');}

document.addEventListener('focusin',event=>{const el=event.target;if(editor?.sourceText&&el.dataset.field){const selection=fieldSelection(el);if(selection&&(!activeReview||reviewKey(selection)!==reviewKey(activeReview)||proofTab!=='source'))focusReview(selection);}});

document.addEventListener('input',event=>{
 const el=event.target;
 if(el.id==='resume-title'&&editor){editor.title=el.value;queueAutosave();return;}
 if(el.dataset.field&&editor){const row=el.dataset.section==='profile'?editor.content.profile:editor.content[el.dataset.section][Number(el.dataset.index)];if(row[el.dataset.field]!==el.value)invalidateField(editor,fieldSelection(el));row[el.dataset.field]=el.value;refreshProof();return;}
 if(el.id==='import-text')importState.text=el.value;
});
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.id==='review-filter'&&editor){reviewFilter=Object.hasOwn(reviewFilterLabels,el.value)?el.value:'all';setProofTab('review');return;}
 if(el.id==='resume-file'){setImportFile(el.files?.[0]);return;}
 if(el.name==='useAI')importState.useAI=el.checked;
 if(el.dataset.setting&&editor){const key=el.dataset.setting;if(key==='module'){const hidden=editor.content.settings.hidden;editor.content.settings.hidden=el.checked?hidden.filter(k=>k!==el.dataset.section):[...new Set([...hidden,el.dataset.section])];}else editor.content.settings[key]=el.checked;refreshProof();}
 if(el.tagName==='SELECT'&&el.dataset.field&&editor){const row=editor.content[el.dataset.section][Number(el.dataset.index)];if(row[el.dataset.field]!==el.value)invalidateField(editor,fieldSelection(el));row[el.dataset.field]=el.value;refreshProof();}
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
   try{const result=await api('/api/import',{method:'POST',body});if(user?.id!==operationUserId)throw new Error('账号已切换，请在当前账号重新导入。');const title=(result.content.profile?.name?`${result.content.profile.name}的简历`:operationState.file?.name.replace(/\.[^.]+$/,'')||'我的简历').slice(0,120);const {resume}=await api('/api/resumes',{method:'POST',body:{title,content:result.content,sourceText:result.sourceText,warnings:result.warnings,review:result.review,expectedUserId:operationUserId}});operationState.busy=false;if(operationVersion!==routeVersion||operationState!==importState){toast('简历已导入为私人草稿，可在工作台继续核对。');return;}closeModal();await navigate(`/editor/${resume.id}`,{force:true});if(editor?.id===resume.id){proofTab=result.warnings?.length?'review':'source';renderEditor();}toast('已生成私人草稿。请对照原文检查提取内容。');}catch(error){operationState.busy=false;if(operationVersion===routeVersion&&operationState===importState){importState.error=error.message;renderImport();}else toast(`导入未完成：${error.message}`,true);}
 }
});
modal.addEventListener('cancel',event=>{if(importState.busy&&modal.classList.contains('import-modal')){event.preventDefault();return;}if(activeConfirm){activeConfirm(false);activeConfirm=null;}});
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){if(!(importState.busy&&modal.classList.contains('import-modal')))closeModal();}}});
window.addEventListener('beforeunload',event=>{if(dirty()||saveInFlight()){event.preventDefault();event.returnValue='';}});
window.addEventListener('popstate',async()=>{const destination=location.pathname+location.search;if(editor){history.pushState({},'',`/editor/${editor.id}`);if(await prepareToLeave())await navigate(destination,{force:true,replace:true});}else{disposeAutosave();closeModal();await renderRoute();}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&editor){event.preventDefault();saveEditor();}});

loading('正在打开简序…');
const initial=await Promise.allSettled([api('/api/auth/me'),api('/api/config')]);
if(initial[0].status==='fulfilled')user=initial[0].value.user;
if(initial[1].status==='fulfilled')config=initial[1].value;
await renderRoute();
