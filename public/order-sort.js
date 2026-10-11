const HOLD_MS=150;
const MOVE_TOLERANCE=8;

export function moveSection(order,section,toIndex){
  const next=[...order],from=next.indexOf(section);
  if(from<0||!Number.isInteger(toIndex)||toIndex<0||toIndex>=next.length)return next;
  next.splice(from,1);
  next.splice(toIndex,0,section);
  return next;
}

// Keep tentative moves in this controller; the editor receives only confirmed orders.
export function setupOrderSorting(list,{onCommit,isDisabled=()=>false,labelFor=key=>key,status}={}){
  const doc=list.ownerDocument,view=doc.defaultView;
  const listeners=[];
  let active=null,suppressClickUntil=0;
  const rows=()=>Array.from(list.querySelectorAll('[data-order-section]'));
  const say=message=>{if(status)status.textContent=message;};
  const listen=(target,type,handler,options)=>{
    target.addEventListener(type,handler,options);
    listeners.push(()=>target.removeEventListener(type,handler,options));
  };
  function clearMarkers(){rows().forEach(row=>row.classList.remove('drop-before','drop-after'));}
  function cleanUp(){
    const previous=active;
    active=null;
    if(!previous)return;
    clearTimeout(previous.timer);
    if(previous.frame)view.cancelAnimationFrame?.(previous.frame);
    previous.ghost?.remove();
    previous.row.classList.remove('is-pressing','is-dragging','is-keyboard-dragging');
    previous.handle.setAttribute('aria-pressed','false');
    list.classList.remove('is-sorting');
    clearMarkers();
    if(previous.pointerId!==undefined){
      try{previous.handle.releasePointerCapture?.(previous.pointerId);}catch{}
    }
    return previous;
  }
  function cancel(announce=true){
    const previous=cleanUp();
    if(previous&&announce)say('已取消排序，顺序未改变。');
  }
  function begin(handle,mode,event){
    cancel(false);
    const row=handle.closest('[data-order-section]'),section=row.dataset.orderSection;
    const order=rows().map(item=>item.dataset.orderSection);
    active={handle,row,section,order,mode,index:order.indexOf(section),valid:true};
    if(event){Object.assign(active,{pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY});}
    return active;
  }
  function showPosition(){
    if(!active)return;
    clearMarkers();
    if(!active.valid)return;
    const others=rows().filter(row=>row!==active.row);
    if(others[active.index])others[active.index].classList.add('drop-before');
    else others.at(-1)?.classList.add('drop-after');
  }
  function announcePosition(){say(`${labelFor(active.section)}，目标位置第 ${active.index+1} 位，共 ${active.order.length} 个模块。${active.mode==='keyboard'?'按空格或回车确认，Esc 取消。':'松开把手完成排序，Esc 取消。'}`);}
  function autoScroll(){
    if(!active||active.mode!=='pointer')return;
    const scroller=list.closest('.editor-main');
    if(scroller){
      const rect=scroller.getBoundingClientRect(),edge=40;
      if(active.x>=rect.left&&active.x<=rect.right&&active.y>=rect.top&&active.y<=rect.bottom){
        const delta=active.y<rect.top+edge?-12:active.y>rect.bottom-edge?12:0;
        if(delta){
          const previous=scroller.scrollTop;
          scroller.scrollTop+=delta;
          if(scroller.scrollTop!==previous)updatePointerPosition({clientX:active.x,clientY:active.y});
        }
      }
    }
    if(active?.mode==='pointer'&&view.requestAnimationFrame)active.frame=view.requestAnimationFrame(autoScroll);
  }
  function updatePointerPosition(event){
    if(!active||active.mode!=='pointer')return;
    if(isDisabled()||!list.isConnected){cancel();return;}
    active.x=event.clientX;active.y=event.clientY;
    const rect=list.getBoundingClientRect();
    const previousIndex=active.index,wasValid=active.valid;
    const pointed=doc.elementFromPoint?.(event.clientX,event.clientY);
    active.valid=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom&&(!pointed||list.contains(pointed));
    if(active.valid){
      const others=rows().filter(row=>row!==active.row);
      active.index=others.filter(row=>{const box=row.getBoundingClientRect();return event.clientY>box.top+box.height/2;}).length;
    }
    if(active.ghost){
      active.ghost.style.left=`${Math.max(8,Math.min(event.clientX+16,view.innerWidth-active.ghost.offsetWidth-8))}px`;
      active.ghost.style.top=`${Math.max(8,Math.min(event.clientY+14,view.innerHeight-active.ghost.offsetHeight-8))}px`;
    }
    showPosition();
    if(active.valid&&(previousIndex!==active.index||!wasValid))announcePosition();
    else if(!active.valid&&wasValid)say('已移出排序区域，松开将取消本次排序。');
  }
  function finish(){
    if(!active)return;
    if(isDisabled()||!list.isConnected||!active.valid){cancel();return;}
    const previous=cleanUp();
    const next=moveSection(previous.order,previous.section,previous.index);
    if(next.every((key,index)=>key===previous.order[index])){say('顺序未改变。');return;}
    onCommit(next,{section:previous.section,method:previous.mode});
    say(`已将${labelFor(previous.section)}移到第 ${previous.index+1} 位。请保存草稿，更新发布后对 HR 生效。`);
  }
  function pointerDown(event){
    const handle=event.target.closest('.order-handle');
    if(!handle||!list.contains(handle)||handle.disabled||event.button!==0||event.isPrimary===false||isDisabled())return;
    event.preventDefault();
    handle.focus({preventScroll:true});
    const pending=begin(handle,'pending',event);
    pending.row.classList.add('is-pressing');
    say('继续按住把手约 0.15 秒，然后上下拖动。');
    try{handle.setPointerCapture?.(event.pointerId);}catch{}
    pending.timer=setTimeout(()=>{
      if(active!==pending||isDisabled()||!list.isConnected){cancel(false);return;}
      pending.mode='pointer';
      pending.row.classList.remove('is-pressing');
      pending.row.classList.add('is-dragging');
      handle.setAttribute('aria-pressed','true');
      list.classList.add('is-sorting');
      list.querySelectorAll('.order-position-details[open]').forEach(details=>details.open=false);
      const ghost=doc.createElement('div');
      ghost.className='order-drag-ghost';
      ghost.textContent=labelFor(pending.section);
      ghost.setAttribute('aria-hidden','true');
      ghost.style.width=`${Math.min(240,list.getBoundingClientRect().width)}px`;
      doc.body.append(ghost);pending.ghost=ghost;
      updatePointerPosition({clientX:pending.x,clientY:pending.y});
      announcePosition();
      if(view.requestAnimationFrame)pending.frame=view.requestAnimationFrame(autoScroll);
    },HOLD_MS);
  }
  function pointerMove(event){
    if(!active||event.pointerId!==active.pointerId)return;
    if(active.mode==='pending'){
      active.x=event.clientX;active.y=event.clientY;
      if(Math.hypot(event.clientX-active.startX,event.clientY-active.startY)>MOVE_TOLERANCE){cancel(false);say('请先长按把手约 0.15 秒，再开始拖动。');}
      return;
    }
    event.preventDefault();updatePointerPosition(event);
  }
  function pointerUp(event){
    if(!active||event.pointerId!==active.pointerId)return;
    suppressClickUntil=Date.now()+400;
    if(active.mode==='pending'){cancel(false);say('长按把手约 0.15 秒后可拖动排序。');return;}
    updatePointerPosition(event);finish();
  }
  function keyDown(event){
    const handle=event.target.closest('.order-handle');
    if(!handle||!list.contains(handle)||handle.disabled||isDisabled())return;
    if(event.key===' '||event.key==='Enter'){
      event.preventDefault();
      if(event.repeat)return;
      if(active?.mode==='keyboard'&&active.handle===handle){finish();return;}
      const current=begin(handle,'keyboard');
      current.row.classList.add('is-keyboard-dragging');
      handle.setAttribute('aria-pressed','true');list.classList.add('is-sorting');
      showPosition();announcePosition();return;
    }
    if(active?.mode!=='keyboard'||active.handle!==handle)return;
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){
      event.preventDefault();
      active.index=Math.max(0,Math.min(active.order.length-1,active.index+(event.key==='ArrowUp'?-1:1)));
      showPosition();announcePosition();
      const others=rows().filter(row=>row!==active.row);
      (others[active.index]||others.at(-1))?.scrollIntoView?.({block:'nearest'});
    }
  }
  listen(list,'pointerdown',pointerDown);
  listen(doc,'pointermove',pointerMove,{passive:false});
  listen(doc,'pointerup',pointerUp);
  listen(doc,'pointercancel',event=>{if(active&&event.pointerId===active.pointerId)cancel();});
  listen(list,'lostpointercapture',event=>{if(active&&event.pointerId===active.pointerId)cancel();});
  listen(list,'keydown',keyDown);
  listen(doc,'keydown',event=>{if(event.key==='Escape'&&active){event.preventDefault();cancel();}});
  listen(list,'focusout',event=>{if(active&&event.target===active.handle&&event.relatedTarget!==active.handle)cancel();});
  listen(view,'blur',()=>cancel());
  listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel();});
  listen(list,'click',event=>{
    if(event.target.closest('.order-handle')){
      event.preventDefault();
      if(Date.now()<suppressClickUntil)event.stopPropagation();
    }
  });
  listen(list,'dragstart',event=>{if(event.target.closest('.order-handle'))event.preventDefault();});
  listen(list,'contextmenu',event=>{if(event.target.closest('.order-handle')&&active)event.preventDefault();});
  listen(list,'change',event=>{
    const select=event.target.closest('[data-order-position]');
    if(!select||!list.contains(select)||isDisabled()||select.disabled)return;
    cancel(false);
    const order=rows().map(row=>row.dataset.orderSection),section=select.dataset.orderPosition,index=Number(select.value);
    if(!Number.isInteger(index)||index<0||index>=order.length)return;
    const next=moveSection(order,section,index);
    if(next.every((key,i)=>key===order[i]))return;
    onCommit(next,{section,method:'position'});
    say(`已将${labelFor(section)}移到第 ${index+1} 位。请保存草稿，更新发布后对 HR 生效。`);
  });
  return {cancel,destroy(){cancel(false);listeners.forEach(remove=>remove());}};
}
