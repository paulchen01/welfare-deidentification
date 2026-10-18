import type { UIContext } from './ui-context';
import { node,button,title,card,field,input,select,checkbox,pill } from './ui-kit';
import { createManualFinding,renderText } from './engine';
import { documentPicker } from './views-input';
import type { WelfareFinding, FindingAction } from './types';

export function reviewView(ctx:UIContext):HTMLElement {
  const root=node('div','view wide');root.append(title('03 / 人工覆核','逐處判斷，再讀一次全文。','自動辨識可能漏掉關係、事件與少見名稱。檢查遮罩結果是否仍能辨識個案，並手動標記遺漏處。'));
  const doc=ctx.session.active;if(!doc){root.append(card('請先加入資料'));return root;}
  root.append(documentPicker(ctx));
  const layout=doc.document.layout;
  let startOffset=0,endOffset=doc.document.text.length;
  if(layout?.kind==='pdf'||layout?.kind==='xlsx'){
    const sections=layout.kind==='pdf'?layout.pages.map(p=>p.items):layout.sheets.map(s=>s.cells);
    const picker=select([{value:'all',label:'顯示全文'},...sections.map((_,i)=>({value:String(i),label:layout.kind==='pdf'?`第 ${i+1} 頁`:`工作表 ${i+1}`}))],doc.reviewScope??'all');
    picker.onchange=()=>{doc.reviewScope=picker.value;ctx.render();};root.append(field('覆核範圍',picker));
    if(doc.reviewScope&&doc.reviewScope!=='all'){
      const items=sections[Number(doc.reviewScope)]??[];startOffset=items.length?Math.min(...items.map(i=>i.start)):0;endOffset=items.length?Math.max(...items.map(i=>i.end)):0;
      // Include complete findings that straddle a layout boundary.
      for(const f of doc.findings)if(f.start<endOffset&&f.end>startOffset){startOffset=Math.min(startOffset,f.start);endOffset=Math.max(endOffset,f.end);}
    }
  }
  const visible=doc.findings.filter(f=>f.start>=startOffset&&f.end<=endOffset);
  if(doc.report.issues.length){
    const warnings=card('這份文件的處理範圍');warnings.classList.add('notice');
    for(const issue of doc.report.issues)warnings.append(node('p','',issue.message));
    warnings.append(pill(doc.report.nativeAllowed?'可選原格式，仍須覆核':'僅提供已抽取文字','warning'));root.append(warnings);
  }
  const panels=node('div','review-columns');const left=card('原文');const right=card('處理後文字');
  const source=node('pre','document-text');source.setAttribute('aria-label','原文內容');
  let cursor=startOffset;
  for(const f of [...visible].sort((a,b)=>a.start-b.start)){
    source.append(document.createTextNode(doc.document.text.slice(cursor,f.start)));
    const mark=node('mark',f.reviewed?'reviewed':'',doc.document.text.slice(f.start,f.end));mark.tabIndex=0;
    mark.onclick=()=>document.getElementById(`finding-${f.id}`)?.scrollIntoView({block:'center',behavior:'smooth'});
    mark.onkeydown=e=>{if(e.key==='Enter')mark.click();};source.append(mark);cursor=f.end;
  }
  source.append(document.createTextNode(doc.document.text.slice(cursor,endOffset)));
  let preview:string;
  try{preview=renderText(doc.document.text.slice(startOffset,endOffset),visible.map(f=>({...f,start:f.start-startOffset,end:f.end-startOffset})));}catch(error){preview=error instanceof Error?`請修正設定後再預覽：${error.message}`:'請修正處理設定';}
  left.append(source);right.append(node('pre','document-text result-text',preview));
  panels.append(left,right);root.append(panels);
  const manual=card('補上自動辨識遺漏的內容');
  const value=input('','輸入原文中的完整字詞，或在上方原文反白選取');const category=input('人工標記','標記類別');
  const markRange=(start:number,end:number)=>{
    const f=createManualFinding(doc.document.text,start,end,category.value.trim()||'人工標記',doc.findings);
    doc.findings.push(f);doc.findings.sort((a,b)=>a.start-b.start);doc.reviewConfirmed=false;
  };
  manual.append(field('要遮罩的原文',value),field('類別',category));
  const actions=node('div','action-row');
  actions.append(button('標記全部相同文字',()=>ctx.run(async()=>{
    const term=value.value;if(!term.trim())throw new Error('請輸入要標記的原文');
    let at=0,count=0;
    while((at=doc.document.text.indexOf(term,at))>=0){
      if(!doc.findings.some(f=>at<f.end&&at+term.length>f.start)){markRange(at,at+term.length);count++;}at+=term.length;
    }
    if(!count)throw new Error('找不到尚未標記的相同文字');ctx.render();
  })),button('標記反白範圍',()=>ctx.run(async()=>{
    const selection=window.getSelection();
    if(!selection?.rangeCount||selection.isCollapsed)throw new Error('請先在「原文」欄反白選取文字');
    const range=selection.getRangeAt(0);
    if(!source.contains(range.startContainer)||!source.contains(range.endContainer))throw new Error('請在「原文」欄內選取文字');
    const before=range.cloneRange();before.selectNodeContents(source);before.setEnd(range.startContainer,range.startOffset);
    const start=startOffset+before.toString().length;markRange(start,start+range.toString().length);ctx.render();
  })));
  manual.append(actions);root.append(manual);
  if(doc.document.layout?.kind==='xlsx'){
    const columns=card('Excel 整欄遮罩');
    const opts=doc.document.layout.sheets.flatMap((sheet,si)=>[...new Set(sheet.cells.map(c=>c.col))].map(col=>({value:`${si}:${col}`,label:`工作表 ${si+1}／第 ${col} 欄`})));const choose=select(opts,opts[0]?.value??'');
    columns.append(field('已抽取文字的欄位',choose,'只適用於已抽取的文字儲存格。數值、公式與隱藏內容的限制請見上方說明。'),button('遮罩這一欄的文字',()=>ctx.run(async()=>{
      if(doc.document.layout?.kind!=='xlsx')return;const [si,col]=choose.value.split(':').map(Number);let count=0;
      for(const cell of doc.document.layout.sheets[si]?.cells??[]){if(cell.col!==col||cell.end<=cell.start)continue;
        doc.findings=doc.findings.filter(f=>!(cell.start<f.end&&cell.end>f.start));
        const f=createManualFinding(doc.document.text,cell.start,cell.end,'欄位',doc.findings);f.source='field';doc.findings.push(f);count++;
      }
      doc.findings.sort((a,b)=>a.start-b.start);doc.reviewConfirmed=false;ctx.notify(`已標記 ${count} 格`);ctx.render();
    })));root.append(columns);
  }
  const findings=card(`本範圍核對項目 · ${visible.filter(f=>f.reviewed).length} / ${visible.length}（全文 ${doc.findings.length} 項）`);
  if(!visible.length)findings.append(node('p','empty','本範圍未找到規則符合項目。這不代表已無個資，請檢查全文。'));
  for(const f of visible)findings.append(findingEditor(ctx,f));
  root.append(findings);
  const confirm=card('全文覆核');
  confirm.append(checkbox('我已逐項核對此檢視範圍的處理方式，標記為已核對',visible.length>0&&visible.every(f=>f.reviewed),checked=>{visible.forEach(f=>f.reviewed=checked);doc.reviewConfirmed=false;ctx.render();}));
  confirm.append(checkbox('我已重讀處理後全文、理解格式限制，並確認適合目前分享用途',doc.reviewConfirmed,checked=>{
    if(checked&&doc.findings.some(f=>!f.reviewed)){ctx.notify('請先核對所有項目');ctx.render();return;}doc.reviewConfirmed=checked;ctx.render();
  }));
  confirm.append(button('前往匯出 →',()=>ctx.go('export'),'button primary'));root.append(confirm);return root;
}

function findingEditor(ctx:UIContext,f:WelfareFinding):HTMLElement {
  const doc=ctx.session.active!;const row=node('div','finding');row.id=`finding-${f.id}`;
  const excerpt=node('div','finding-value');excerpt.append(pill(f.category),node('strong','',f.original),pill({rule:'規則建議',person:f.personId?'已確認人物':'姓名候選',manual:'人工標記',field:'人工欄位'}[f.source]),node('small','muted',f.message??''));
  const action=select([{value:'mask',label:'遮罩'},{value:'generalize',label:'概括'},{value:'keep',label:'保留原文'}],f.action);
  action.setAttribute('aria-label',`${f.category}的處理方式`);
  action.onchange=()=>{f.action=action.value as FindingAction;if(f.action==='generalize')f.generalized=f.generalized||'（已概括）';f.reviewed=false;doc.reviewConfirmed=false;ctx.render();};
  row.append(excerpt,action);
  if(f.action==='generalize'){
    const general=input(f.generalized??'','請輸入不會辨識個案的概括內容');general.setAttribute('aria-label','概括內容');
    general.onchange=()=>{f.generalized=general.value;f.reviewed=false;doc.reviewConfirmed=false;ctx.render();};row.append(general);
  }else row.append(node('code','replacement',f.action==='keep'?'原文保留':f.replacement));
  row.append(checkbox('已核對',f.reviewed,checked=>{f.reviewed=checked;doc.reviewConfirmed=false;ctx.render();}));return row;
}
