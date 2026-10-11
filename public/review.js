import { fields, sections } from './data.js';
import { esc } from './resume.js';

export const reviewKey = ({section,recordId,field}) => JSON.stringify([section,recordId,field]);
export function fieldRecord(editor,selection) {
  if(!selection)return null;
  return selection.section==='profile' ? editor.content.profile : editor.content[selection.section]?.find(row=>row.id===selection.recordId);
}
export function getFieldReview(editor,selection) {
  const record=fieldRecord(editor,selection);
  const definition=fields[selection?.section]?.find(([key])=>key===selection.field);
  if(!record||!definition)return null;
  const key=reviewKey(selection),value=String(record[selection.field]??'');
  const evidence=editor.review?.fields?.find(item=>reviewKey(item)===key);
  const confirmed=Boolean(editor.review?.confirmations?.some(item=>reviewKey(item)===key&&item.value===value));
  const warnings=(editor.warnings||[]).filter(w=>w.section===selection.section&&w.field===selection.field&&(!w.recordId||w.recordId===selection.recordId));
  const changed=Boolean(evidence&&evidence.value!==value);
  const ranges=(evidence?.ranges||[]).filter(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=(editor.sourceText||'').length);
  const state=confirmed?'confirmed':changed?'changed':warnings.length?'warning':ranges.length?'pending':!value.trim()&&!evidence?'empty':'unmatched';
  const labels={confirmed:'已核对',changed:'修改后待核对',warning:'需检查',pending:'待核对',unmatched:'未定位原文',empty:'未填写'};
  return {...selection,key,label:definition[1],value,evidence,confirmed,changed,ranges,warnings,state,stateLabel:labels[state],entryTitle:selection.section==='profile'?'个人信息':record.school||record.company||record.name||record.category||sections[selection.section].label};
}
export function getReviewItems(editor) {
  if(!editor?.sourceText)return [];
  const items=[];
  for(const section of Object.keys(fields)) {
    const records=section==='profile'?[editor.content.profile]:(editor.content[section]||[]);
    for(const record of records)for(const [field] of fields[section]) {
      const item=getFieldReview(editor,{section,recordId:section==='profile'?'profile':record.id,field});
      if(item&&(item.value.trim()||item.evidence||item.warnings.length||item.confirmed))items.push(item);
    }
  }
  return items;
}
function matchesReviewFilter(item,filter) {
  if(filter==='warning')return item.warnings.length>0;
  if(filter==='changed')return item.changed;
  if(filter==='unmatched')return item.ranges.length===0;
  return true;
}
export function getPendingReviewItems(editor,filter='all') {
  return getReviewItems(editor).filter(item=>!item.confirmed&&matchesReviewFilter(item,filter));
}
export function getNextReviewItem(editor,currentSelection,filter='all') {
  // Keep the current field as an anchor even after confirmation removes it from the queue.
  const items=getReviewItems(editor);
  const currentKey=currentSelection?reviewKey(currentSelection):null;
  const start=items.findIndex(item=>item.key===currentKey);
  for(let step=1;step<=items.length;step++) {
    const item=items[(start+step)%items.length];
    if(!item.confirmed&&matchesReviewFilter(item,filter))return item;
  }
  return null;
}
export function getRecordReviewCandidates(editor,{section,recordId}) {
  const candidates={eligible:[],skipped:[],alreadyConfirmed:[]};
  for(const item of getReviewItems(editor)) {
    if(item.section!==section||item.recordId!==recordId)continue;
    if(item.confirmed)candidates.alreadyConfirmed.push(item);
    else if(!item.changed&&!item.warnings.length&&item.ranges.length)candidates.eligible.push(item);
    else candidates.skipped.push(item);
  }
  return candidates;
}
export function confirmRecord(editor,selection) {
  const candidates=getRecordReviewCandidates(editor,selection);
  for(const item of candidates.eligible)confirmField(editor,item);
  return {confirmed:candidates.eligible.length,skipped:candidates.skipped.length,alreadyConfirmed:candidates.alreadyConfirmed.length};
}
export function confirmField(editor,selection,confirmed=true) {
  const item=getFieldReview(editor,selection);if(!item)return false;
  editor.review ||= {version:1,fields:[],confirmations:[]};
  editor.review.confirmations=(editor.review.confirmations||[]).filter(entry=>reviewKey(entry)!==item.key);
  if(confirmed)editor.review.confirmations.push({section:item.section,recordId:item.recordId,field:item.field,value:item.value});
  return true;
}
export function invalidateField(editor,selection) {
  if(editor.review)editor.review.confirmations=(editor.review.confirmations||[]).filter(item=>reviewKey(item)!==reviewKey(selection));
}
export function pruneReview(editor) {
  if(!editor.review)return;
  editor.review.confirmations=(editor.review.confirmations||[]).filter(item=>{
    const record=fieldRecord(editor,item);return record&&String(record[item.field]??'')===item.value;
  });
}

// Only mark validated source offsets; escaping happens before any HTML is emitted.
export function renderSourceText(text,ranges=[]) {
  const valid=ranges.filter(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=text.length).sort((a,b)=>a.start-b.start);
  const merged=[];
  for(const range of valid){const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});}
  let offset=0;
  return text.split('\n').map((line,index)=>{
    const start=offset,end=start+line.length;offset=end+1;
    const hits=merged.filter(r=>r.start<end&&r.end>start);
    let cursor=start,html='';
    for(const range of hits){const a=Math.max(start,range.start),b=Math.min(end,range.end);html+=esc(text.slice(cursor,a))+`<mark data-source-hit>${esc(text.slice(a,b))}</mark>`;cursor=b;}
    html+=esc(text.slice(cursor,end));
    return `<div class="source-line${hits.length?' has-source-hit':''}"><span class="source-line-number" aria-hidden="true">${index+1}</span><span class="source-line-text">${html||'&#8203;'}</span></div>`;
  }).join('');
}
