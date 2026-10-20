import type { UIContext } from './ui-context';
import type { WorkspaceDocument } from './session';
import { node,button,title,card,field,input,select,checkbox,pill } from './ui-kit';
import { renderText } from './engine';
import { documentPicker } from './views-input';
import type { WelfareFinding,FindingAction } from './types';
import { addManualRanges,applySameWord,changeFinding,confirmFullReview,previewSameWord,REVIEW_PAGE_SIZE,reviewPage,reviewState,setReviewed,undoReview,type SameWordPreview } from './review-actions';

const ACTIONS=[{value:'mask',label:'遮罩'},{value:'generalize',label:'概括'},{value:'keep',label:'保留原文'}];
interface ReviewUI {
  ctx:UIContext; doc:WorkspaceDocument;
  refresh:(focusId?:string)=>void;
  attempt:(work:()=>void,focusId?:string)=>void;
  locate:(id:string)=>void;
}
const rowId=(id:string)=>`finding-${id}`;

export function reviewView(ctx:UIContext):HTMLElement {
  const root=node('div','view wide review-view');root.append(title('03 / 人工覆核','逐處判斷，再讀一次全文。','自動辨識可能漏掉關係、事件與少見名稱。檢查遮罩結果是否仍能辨識個案，並手動標記遺漏處。'));
  const doc=ctx.session.active;if(!doc){root.append(card('請先加入資料'));return root;}
  root.append(documentPicker(ctx));const state=reviewState(doc);let tabTargetId:string|undefined;
  const refresh=(focusId?:string)=>{
    const id=tabTargetId??focusId??(document.activeElement instanceof HTMLElement?document.activeElement.id:'');
    ctx.render();
    if(id){
      const requested=document.getElementById(id);
      const available=requested&&!requested.matches(':disabled')?requested:undefined;
      const selected=state.selectedId?document.getElementById(rowId(state.selectedId)):undefined;
      const target=available??selected??document.querySelector<HTMLElement>('.review-view [data-finding-id]')??document.getElementById('review-toolbar');target?.focus({preventScroll:true});
      // A native Tab/blur action can finish after onchange removes its old DOM target.
      // Restore only a lost focus, after that action; never override a valid native destination.
      const restoreLostFocus=()=>{if(ctx.view==='review'&&target?.isConnected&&document.activeElement===document.body)target.focus({preventScroll:true});};
      queueMicrotask(restoreLostFocus);window.requestAnimationFrame(restoreLostFocus);
    }
  };
  const attempt=(work:()=>void,focusId?:string)=>{try{work();refresh(focusId);}catch(error){ctx.notify(error instanceof Error?error.message:'請檢查設定後重試');}};
  const [startOffset,endOffset]=scopePicker(root,doc,()=>refresh('review-scope'));
  const page=reviewPage(doc,startOffset,endOffset);
  const locate=(id:string)=>{
    let f=page.filtered.find(f=>f.id===id);
    if(!f){f=page.scoped.find(f=>f.id===id);if(!f)return;state.filter='all';}
    const candidates=reviewPage(doc,startOffset,endOffset).filtered;
    state.selectedId=id;state.page=Math.floor(candidates.findIndex(f=>f.id===id)/REVIEW_PAGE_SIZE);
    refresh(rowId(id));document.getElementById(rowId(id))?.scrollIntoView?.({block:'center',behavior:'smooth'});
    ctx.notify(`全文第 ${doc.findings.findIndex(f=>f.id===id)+1} / ${doc.findings.length} 項，${f.category}，${f.reviewed?'已核對':'待核對'}`);
  };
  const ui:ReviewUI={ctx,doc,refresh,attempt,locate};root.append(reviewToolbar(ui,startOffset,endOffset));
  if(doc.report.issues.length){
    const warnings=card('這份文件的處理範圍');warnings.classList.add('notice');
    for(const issue of doc.report.issues)warnings.append(node('p','',issue.message));
    warnings.append(pill(doc.report.nativeAllowed?'可選原格式，仍須覆核':'僅提供已抽取文字','warning'));root.append(warnings);
  }
  const panels=node('div','review-columns');const left=card('原文');const right=card('處理後文字');
  const source=sourceText(doc,page.scoped,startOffset,endOffset,locate);
  let preview:string;
  try{preview=renderText(doc.document.text.slice(startOffset,endOffset),page.scoped.map(f=>({...f,start:f.start-startOffset,end:f.end-startOffset})));}catch(error){preview=error instanceof Error?`請修正設定後再預覽：${error.message}`:'請修正處理設定';}
  left.append(source);right.append(node('pre','document-text result-text',preview));panels.append(left,right);root.append(panels);
  root.append(manualEditor(ui,source,startOffset));if(doc.document.layout?.kind==='xlsx')root.append(columnEditor(ui));
  const findings=card(`本範圍核對項目 · ${page.scoped.filter(f=>f.reviewed).length} / ${page.scoped.length}（全文 ${page.total} 項）`);
  findings.id='review-findings';findings.dataset.reviewKeyboard='';findings.tabIndex=-1;
  findings.append(node('p','review-page-summary',`第 ${state.page+1} / ${page.pages} 批，顯示 ${page.shown.length} 項；篩選後 ${page.filtered.length} 項。每批最多 ${REVIEW_PAGE_SIZE} 項。`));
  if(!page.shown.length)findings.append(node('p','empty','目前篩選範圍沒有項目。這不代表已無個資，請檢查全文。'));
  for(const f of page.shown)findings.append(findingEditor(ui,f));
  const paging=node('div','action-row');
  const previous=button('上一批',()=>{state.page--;refresh('review-previous-page');});previous.id='review-previous-page';previous.disabled=state.page===0;
  const next=button('下一批',()=>{state.page++;refresh('review-next-page');});next.id='review-next-page';next.disabled=state.page>=page.pages-1;
  paging.append(previous,next,button('核對本批顯示的項目',()=>{setReviewed(doc,page.shown.map(f=>f.id),true);refresh('review-findings');}));findings.append(paging);root.append(findings);
  const confirm=card('全文覆核');
  // Only displayed editors may be approved in a batch; the full-document gate still checks every finding.
  confirm.append(checkbox('我已逐項核對此檢視範圍（本批顯示項目）的處理方式，標記為已核對',page.shown.length>0&&page.shown.every(f=>f.reviewed),checked=>{setReviewed(doc,page.shown.map(f=>f.id),checked);refresh('review-range-confirm');}));
  confirm.lastElementChild!.querySelector('input')!.id='review-range-confirm';
  confirm.append(checkbox('我已重讀處理後全文、理解格式限制，並確認適合目前分享用途',doc.reviewConfirmed,checked=>{
    try{confirmFullReview(doc,checked);}catch(error){ctx.notify(error instanceof Error?error.message:'請先核對所有項目');}refresh('review-full-confirm');
  }));confirm.lastElementChild!.querySelector('input')!.id='review-full-confirm';
  confirm.append(button('前往匯出 →',()=>ctx.go('export'),'button primary'));root.append(confirm);
  const focusSelector='button,input,select,textarea,summary,a[href],[tabindex="0"]';
  root.querySelectorAll<HTMLElement>(focusSelector).forEach((control,index)=>{if(!control.id)control.id=`review-control-${index}`;});
  root.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
    const controls=[...root.querySelectorAll<HTMLElement>(focusSelector)].filter(control=>{
      const closed=control.closest('details:not([open])');return !control.matches(':disabled,[type="hidden"]')&&(!closed||control===closed.querySelector('summary'));
    });
    const index=controls.indexOf(event.target as HTMLElement);tabTargetId=controls[index+(event.shiftKey?-1:1)]?.id;
    window.setTimeout(()=>{tabTargetId=undefined;},0);
  },true);
  root.onkeydown=event=>handleShortcut(event,ui,startOffset,endOffset);return root;
}

function scopePicker(root:HTMLElement,doc:WorkspaceDocument,changed:()=>void):[number,number] {
  let start=0,end=doc.document.text.length;const layout=doc.document.layout;
  if(layout?.kind!=='pdf'&&layout?.kind!=='xlsx')return [start,end];
  const sections=layout.kind==='pdf'?layout.pages.map(p=>p.items):layout.sheets.map(s=>s.cells);
  const picker=select([{value:'all',label:'顯示全文'},...sections.map((_,i)=>({value:String(i),label:layout.kind==='pdf'?`第 ${i+1} 頁`:`工作表 ${i+1}`}))],doc.reviewScope??'all');picker.id='review-scope';
  picker.onchange=()=>{doc.reviewScope=picker.value;reviewState(doc).page=0;changed();};root.append(field('覆核範圍',picker));
  if(doc.reviewScope&&doc.reviewScope!=='all'){
    const items=sections[Number(doc.reviewScope)]??[];start=items.length?Math.min(...items.map(i=>i.start)):0;end=items.length?Math.max(...items.map(i=>i.end)):0;
    for(const f of doc.findings)if(f.start<end&&f.end>start){start=Math.min(start,f.start);end=Math.max(end,f.end);}
  }return [start,end];
}

function sourceText(doc:WorkspaceDocument,findings:WelfareFinding[],start:number,end:number,locate:(id:string)=>void):HTMLElement {
  const source=node('pre','document-text');source.setAttribute('aria-label','原文內容');let cursor=start;
  for(const f of findings){
    source.append(document.createTextNode(doc.document.text.slice(cursor,f.start)));
    const mark=node('mark',f.reviewed?'reviewed':'',doc.document.text.slice(f.start,f.end));mark.tabIndex=0;mark.setAttribute('role','button');
    // Metadata never introduces text nodes: manual selection offsets depend on Range.toString().
    mark.setAttribute('aria-label',`${f.category}，${f.reviewed?'已核對':'待核對'}，${f.original}；定位核對項目`);
    mark.onclick=()=>{if(window.getSelection()?.isCollapsed!==false)locate(f.id);};mark.onkeydown=event=>{if(!event.isComposing&&(event.key==='Enter'||event.key===' ')){event.preventDefault();locate(f.id);}};
    source.append(mark);cursor=f.end;
  }source.append(document.createTextNode(doc.document.text.slice(cursor,end)));return source;
}

function reviewToolbar(ui:ReviewUI,start:number,end:number):HTMLElement {
  const {doc,refresh,locate}=ui;const state=reviewState(doc);const page=reviewPage(doc,start,end);
  const toolbar=card();toolbar.classList.add('review-toolbar');toolbar.dataset.reviewKeyboard='';toolbar.tabIndex=0;toolbar.id='review-toolbar';toolbar.setAttribute('aria-label','覆核工具列');
  toolbar.append(node('h2','',`剩餘 ${page.pending} 項待核對`),node('p','muted',`目前文件全文 ${page.total} 項。篩選與分批不會減少匯出前需核對的項目。`));
  const filter=select([{value:'all',label:'全部項目'},{value:'pending',label:'未核對項目'}],state.filter);filter.id='review-filter';filter.setAttribute('aria-label','核對項目篩選');
  filter.onchange=()=>{state.filter=filter.value as 'all'|'pending';state.page=0;refresh('review-filter');};toolbar.append(field('顯示核對項目',filter));
  const actions=node('div','action-row');
  actions.append(button('上一項',()=>moveFinding(ui,start,end,-1)),button('下一項',()=>moveFinding(ui,start,end,1)),button('下一個未核對項',()=>{
    const pending=page.scoped.filter(f=>!f.reviewed);const index=doc.findings.findIndex(f=>f.id===state.selectedId);
    const target=pending.find(f=>doc.findings.indexOf(f)>index)??pending[0];if(target)locate(target.id);else ui.ctx.notify('本範圍已沒有未核對項目，請確認全文剩餘數。');
  }));
  const undo=button('復原最近操作',()=>{undoReview(doc);refresh('review-undo');});undo.id='review-undo';undo.disabled=!doc.reviewHistory?.length;actions.append(undo);toolbar.append(actions);
  toolbar.append(node('p','keyboard-help','工具列或項目內：↑ 上一項、↓ 下一項、R 切換核對、Ctrl／⌘ + Z 復原。輸入欄位與選單保留正常鍵盤操作。'));return toolbar;
}
function moveFinding(ui:ReviewUI,start:number,end:number,direction:number):void {
  const list=reviewPage(ui.doc,start,end).filtered;const selected=reviewState(ui.doc).selectedId;
  const index=list.findIndex(f=>f.id===selected);const next=index<0?(direction>0?0:list.length-1):Math.max(0,Math.min(list.length-1,index+direction));if(list[next])ui.locate(list[next].id);
}
function handleShortcut(event:KeyboardEvent,ui:ReviewUI,start:number,end:number):void {
  const target=event.target;if(!(target instanceof HTMLElement)||!target.closest('[data-review-keyboard]')||target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"])')||event.isComposing||event.keyCode===229||event.altKey)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.shiftKey){event.preventDefault();undoReview(ui.doc);ui.refresh(target.id||'review-toolbar');return;}
  if(event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();moveFinding(ui,start,end,event.key==='ArrowUp'?-1:1);}
  else if(event.key.toLowerCase()==='r'){
    const id=target.closest<HTMLElement>('[data-finding-id]')?.dataset.findingId??reviewState(ui.doc).selectedId;const f=ui.doc.findings.find(f=>f.id===id);
    if(f){event.preventDefault();setReviewed(ui.doc,[f.id],!f.reviewed);ui.refresh(rowId(f.id));}
  }
}

function manualEditor(ui:ReviewUI,source:HTMLElement,startOffset:number):HTMLElement {
  const {doc,attempt}=ui;const manual=card('補上自動辨識遺漏的內容');
  const value=input('','輸入原文中的完整字詞，或在上方原文反白選取');value.setAttribute('aria-label','要遮罩的原文');value.id='review-manual-value';
  const category=input('人工標記','標記類別');category.id='review-manual-category';
  manual.append(field('要遮罩的原文',value),field('類別',category));const actions=node('div','action-row');
  actions.append(button('標記全部相同文字',()=>attempt(()=>{
    const term=value.value;if(!term.trim())throw new Error('請輸入要標記的原文');let at=0;const ranges:{start:number;end:number}[]=[];
    while((at=doc.document.text.indexOf(term,at))>=0){if(!doc.findings.some(f=>at<f.end&&at+term.length>f.start))ranges.push({start:at,end:at+term.length});at+=term.length;}
    addManualRanges(doc,ranges,category.value.trim()||'人工標記');
  },'review-manual-value')),button('標記反白範圍',()=>attempt(()=>{
    const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed)throw new Error('請先在「原文」欄反白選取文字');
    const range=selection.getRangeAt(0);if(!source.contains(range.startContainer)||!source.contains(range.endContainer))throw new Error('請在「原文」欄內選取文字');
    const before=range.cloneRange();before.selectNodeContents(source);before.setEnd(range.startContainer,range.startOffset);
    const start=startOffset+before.toString().length;addManualRanges(doc,[{start,end:start+range.toString().length}],category.value.trim()||'人工標記');selection.removeAllRanges();
  },'review-manual-value')));manual.append(actions);return manual;
}
function columnEditor(ui:ReviewUI):HTMLElement {
  const columns=card('Excel 整欄遮罩');const {doc,attempt}=ui;const layout=doc.document.layout;if(layout?.kind!=='xlsx')return columns;
  const opts=layout.sheets.flatMap((sheet,si)=>[...new Set(sheet.cells.map(c=>c.col))].map(col=>({value:`${si}:${col}`,label:`工作表 ${si+1}／第 ${col} 欄`})));const choose=select(opts,opts[0]?.value??'');choose.id='review-column';
  columns.append(field('已抽取文字的欄位',choose,'只適用於已抽取的文字儲存格。數值、公式與隱藏內容的限制請見上方說明。'),button('遮罩這一欄的文字',()=>attempt(()=>{
    const [si,col]=choose.value.split(':').map(Number);const ranges=(layout.sheets[si]?.cells??[]).filter(c=>c.col===col&&c.end>c.start);
    const count=addManualRanges(doc,ranges,'欄位','field');ui.ctx.notify(`已標記 ${count} 格`);
  },'review-column')));return columns;
}

function findingEditor(ui:ReviewUI,f:WelfareFinding):HTMLElement {
  const {doc,attempt,refresh}=ui;const row=node('div','finding');row.id=rowId(f.id);row.dataset.findingId=f.id;row.tabIndex=-1;
  row.setAttribute('aria-label',`全文第 ${doc.findings.indexOf(f)+1} 項，${f.category}，${f.reviewed?'已核對':'待核對'}`);row.addEventListener('focusin',()=>{reviewState(doc).selectedId=f.id;});
  const excerpt=node('div','finding-value');excerpt.append(node('strong','',f.original),pill({rule:'規則建議',person:f.personId?'已確認人物':'姓名候選',manual:'人工標記',field:'人工欄位'}[f.source]),node('span',`review-status ${f.reviewed?'done':''}`,f.reviewed?'已核對':'待核對'),node('small','muted',f.message??''));
  const category=input(f.category);category.id=`category-${f.id}`;category.maxLength=40;category.setAttribute('aria-label','標記分類');category.onchange=()=>attempt(()=>changeFinding(doc,f.id,{category:category.value.trim()}),category.id);
  const action=select(ACTIONS,f.action);action.id=`action-${f.id}`;action.setAttribute('aria-label',`${f.category}的處理方式`);action.onchange=()=>attempt(()=>changeFinding(doc,f.id,{action:action.value as FindingAction}),action.id);
  row.append(excerpt,field('分類',category),field('處理方式',action));
  if(f.action==='generalize'){
    const general=input(f.generalized??'','請輸入不會辨識個案的概括內容');general.id=`general-${f.id}`;general.setAttribute('aria-label','概括內容');general.onchange=()=>attempt(()=>changeFinding(doc,f.id,{generalized:general.value}),general.id);row.append(field('概括內容',general));
  }else row.append(node('code','replacement',f.action==='keep'?'原文保留':f.replacement));
  row.append(checkbox('已核對',f.reviewed,checked=>{setReviewed(doc,[f.id],checked);refresh(`checked-${f.id}`);}));row.lastElementChild!.querySelector('input')!.id=`checked-${f.id}`;
  row.append(batchEditor(ui,f));return row;
}
function batchEditor(ui:ReviewUI,f:WelfareFinding):HTMLElement {
  const details=node('details','batch-editor');details.append(node('summary','','同詞批次套用設定'));
  details.append(node('p','muted','僅限目前文件、原文完全相同、原分類相同且人物識別相同的項目。先填設定並預覽，再確認套用。'));
  const action=select(ACTIONS,f.action);action.setAttribute('aria-label','批次處理方式');const category=input(f.category);category.maxLength=40;category.setAttribute('aria-label','批次標記分類');
  const general=input(f.generalized??'','概括內容');general.setAttribute('aria-label','批次概括內容');
  const output=node('div','batch-preview');output.setAttribute('aria-live','polite');let preview:SameWordPreview|undefined;
  const apply=button('確認套用同詞設定',()=>ui.attempt(()=>applySameWord(ui.doc,preview),rowId(f.id)),'button primary');apply.disabled=true;
  const invalidate=()=>{preview=undefined;apply.disabled=true;output.replaceChildren(node('p','','設定已修改，請重新預覽。'));};
  for(const control of [action,category,general]){control.oninput=invalidate;control.onchange=invalidate;}
  const inspect=button('預覽同詞影響',()=>{
    try{
      preview=previewSameWord(ui.doc,f.id,{action:action.value as FindingAction,category:category.value.trim(),...(action.value==='generalize'?{generalized:general.value}: {})});
      output.replaceChildren(node('p','',`目前文件：影響 ${preview.ids.length} 項；排除歧義 ${preview.excluded} 項。`),node('p','',`原分類「${preview.originalCategory}」→「${preview.change.category}」；處理方式：${ACTIONS.find(a=>a.value===preview!.change.action)?.label}。${preview.change.action==='generalize'?`概括文字：${preview.change.generalized}`:''}`));apply.disabled=false;
    }catch(error){invalidate();ui.ctx.notify(error instanceof Error?error.message:'請檢查設定');}
  });details.append(field('批次分類',category),field('批次處理方式',action),field('批次概括文字（選概括時必填）',general),inspect,output,apply);return details;
}
