import type { UIContext } from './ui-context';
import { node,button,title,card,field,input,select,checkbox,pill } from './ui-kit';
import { PURPOSES,DOCUMENT_KINDS,PERSON_ROLES } from './policies';
import { WELFARE_SAMPLES } from './samples';
import type { Person, DocumentKind } from './types';
import { suggestAliases, suggestRole } from './narrative';
import { previewBulkPeople, importBulkPeople, type BulkPeoplePreview } from './bulk-people';

export function documentPicker(ctx:UIContext):HTMLElement {
  const row=node('div','document-picker');
  const picker=select(ctx.session.documents.map((d,i)=>({value:d.id,label:`文件 ${i+1} · ${d.document.format.toUpperCase()} · ${d.document.text.length.toLocaleString()} 字元`})),ctx.session.activeId);
  picker.setAttribute('aria-label','目前文件');
  picker.onchange=()=>{ctx.session.activeId=picker.value;ctx.render();};
  row.append(picker,pill(`${ctx.session.documents.length} 份文件`));return row;
}
// Fixed inline icons (no external assets): building, sparkle, globe, upload.
const ICONS:Record<string,string>={
  internal:'<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M8 8h3M8 12h3M8 16h3M3 21h18"/>',
  ai:'<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
  public:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
};
function icon(name:string,className:string):HTMLElement {
  const wrap=node('span',className);wrap.setAttribute('aria-hidden','true');
  wrap.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;return wrap;
}
export function inputView(ctx:UIContext):HTMLElement {
  const root=node('div','view');
  root.append(title('01 / 準備資料','分享之前，先保護個案。','選擇用途，加入資料，再確認人物與敏感內容。所有處理都在這部電腦的瀏覽器內完成。'));
  root.append(node('p','trust-note','個案檔案不上傳；開啟網站需下載程式資源。個案、人物與對照只保留在本頁記憶體。'));
  const purposes=node('div','purpose-grid');
  for(const purpose of PURPOSES){
    const b=button('',()=>{ctx.session.setPurpose(purpose.id);ctx.render();},`purpose ${ctx.session.purpose===purpose.id?'selected':''}`);
    b.setAttribute('aria-pressed',String(ctx.session.purpose===purpose.id));
    const head=node('span','purpose-head');head.append(icon(purpose.id,'purpose-icon'),node('span','purpose-title',purpose.label));
    if(purpose.id==='ai')head.append(node('span','purpose-badge','最常用'));
    b.append(head,node('span','muted',purpose.description));purposes.append(b);
  }
  root.append(purposes);
  const entry=card('加入文件');
  const kind=select(DOCUMENT_KINDS.map(k=>({value:k.id,label:k.label})),ctx.session.kind);
  kind.onchange=()=>{ctx.session.kind=kind.value as DocumentKind;};
  entry.append(field('文件種類',kind));
  // The drop zone is a label for the file input: click anywhere to choose, or drop files onto it.
  const files=node('input');files.type='file';files.multiple=true;files.accept='.txt,.md,.docx,.xlsx,.pdf';files.className='file-input';files.setAttribute('aria-label','選擇文件');files.disabled=ctx.busy;
  files.onchange=()=>{if(files.files)ctx.addFiles(Array.from(files.files));files.value='';};
  const drop=node('label','drop-zone');
  drop.append(icon('upload','drop-icon'),node('strong','','把 Word、PDF、Excel 或文字檔拖到這裡'),node('span','muted','TXT、MD、DOCX、XLSX、PDF · 每批最多 10 份 · 每份 100 MB'),node('span','drop-cta','選擇檔案'),files);
  drop.ondragover=event=>{event.preventDefault();drop.classList.add('dragging');};
  drop.ondragleave=()=>drop.classList.remove('dragging');
  drop.ondrop=event=>{event.preventDefault();drop.classList.remove('dragging');const list=Array.from(event.dataTransfer?.files??[]);if(list.length&&!ctx.busy)ctx.addFiles(list);};
  entry.append(drop,node('p','fine','舊版 Word（.doc）請先在 Word 另存為 .docx。掃描 PDF 首次辨識可能需要較久；圖片、簽名及未支援的隱藏內容會列入格式限制。'));
  entry.append(node('div','or-divider','或直接貼上文字'));
  const text=node('textarea','control source-input');text.value=ctx.rawInput;text.placeholder='貼上服務紀錄、訪談逐字稿或會議紀錄……';
  text.setAttribute('aria-label','貼上待處理文字');text.oninput=()=>{ctx.rawInput=text.value;};
  entry.append(text);
  const bar=node('div','action-row');
  const add=button('加入這段文字',()=>ctx.run(async()=>ctx.addText(text.value)),'button primary');add.disabled=ctx.busy;
  bar.append(add);entry.append(bar);
  root.append(entry);
  if(ctx.session.documents.length){
    const loaded=card('本次資料');
    ctx.session.documents.forEach((d,i)=>{
      const row=node('div','file-row');row.append(node('strong','',`文件 ${i+1}`),pill(d.document.format.toUpperCase()),node('span','muted',`${d.document.fileName} · ${d.document.text.length.toLocaleString()} 字元 · ${d.findings.length} 處待檢視`),button('移除',()=>{ctx.session.remove(d.id);ctx.render();},'button text-button'));
      loaded.append(row);
    });
    loaded.append(button('前往人物與規則 →',()=>ctx.go('people'),'button primary'));root.append(loaded);
  }
  const demos=card('先用虛構資料試一次');
  demos.append(node('p','muted','範例皆為合成資料。可用來熟悉流程，不需先放入真實個案。'));
  const domains=[...new Set(WELFARE_SAMPLES.map(s=>s.domain))];const choices=node('div','sample-grid');
  for(const domain of domains){const sample=WELFARE_SAMPLES.find(s=>s.domain===domain)!;choices.append(button(domain,()=>ctx.run(async()=>ctx.useSample(sample)),'sample-button'));}
  demos.append(choices);root.append(demos);return root;
}

export function peopleView(ctx:UIContext):HTMLElement {
  const root=node('div','view');root.append(title('02 / 人物與規則','先確認誰是誰。','候選姓名需要你確認。只在相同案件組內建立人物關聯，別名不會自動跨案合併。'));
  if(!ctx.session.active){root.append(card('請先加入資料'));return root;}
  root.append(documentPicker(ctx));const doc=ctx.session.active;
  const grouping=card('案件分組');
  const otherGroups=ctx.session.documents.filter(d=>d.id!==doc.id);
  const groups=select([{value:'__new__',label:'獨立案件'},...otherGroups.map((d)=>({value:d.groupId,label:`與文件 ${ctx.session.documents.indexOf(d)+1} 同案`}))],otherGroups.some(d=>d.groupId===doc.groupId)?doc.groupId:'__new__');
  groups.onchange=()=>{
    const old=doc.groupId;doc.groupId=groups.value==='__new__'?crypto.randomUUID():groups.value;
    if(old!==doc.groupId){
      const oldStillUsed=ctx.session.documents.some(d=>d.id!==doc.id&&d.groupId===old);
      const migrating=ctx.session.people.filter(p=>p.groupId===old).map(p=>({...p,id:crypto.randomUUID(),groupId:doc.groupId,aliases:[...p.aliases],confirmed:false}));
      if(!oldStillUsed)ctx.session.people=ctx.session.people.filter(p=>p.groupId!==old);
      for(const p of migrating)if(!ctx.session.people.some(x=>x.groupId===p.groupId&&x.name===p.name))ctx.session.people.push(p);
      ctx.invalidate();
    }
  };
  grouping.append(field('這份文件屬於',groups,'只有你明確選擇同案，人物名稱才會共用標記。'));
  root.append(grouping);
  const people=card('人物與稱謂');
  people.append(node('p','muted','逐一核對姓名、角色與別名。確認後，所有完全相同的寫法會使用同一標記。一般稱謂如「媽媽」需你自行判斷是否會指向多個人。'));
  people.append(node('p','fine','合併同一人：將另一名稱加到別名，再移除多餘人物。拆開人物：移除該別名並另加人物。相同名字指向不同人時會標示歧義，請分段或拆成不同文件處理。'));
  for(const person of ctx.session.people.filter(p=>p.groupId===doc.groupId)) people.append(personEditor(ctx,person,doc.document.text));
  if(!ctx.session.people.some(p=>p.groupId===doc.groupId))people.append(node('p','empty','尚未找到候選姓名。可手動加入，再檢查全文。'));
  people.append(button('＋ 新增人物',()=>{
    ctx.session.people.push({id:crypto.randomUUID(),groupId:doc.groupId,name:'',aliases:[],role:PERSON_ROLES[0]??'案主',confirmed:false});ctx.render();
  }));root.append(people);
  root.append(bulkPeopleEditor(ctx));
  const source=card('原文參考');source.append(node('pre','source-preview',doc.document.text));root.append(source);
  const unconfirmed=ctx.session.people.filter(p=>p.groupId===doc.groupId&&p.name.trim()&&!p.confirmed);
  if(unconfirmed.length){
    // Not a gate: unconfirmed names stay masked, but every one becomes the same [姓名].
    const warn=node('div','notice-block');warn.setAttribute('role','note');
    warn.append(node('strong','',`還有 ${unconfirmed.length} 位人物未確認`),node('p','',`未確認的人物一律顯示為 [姓名]，送給 AI 時無法分辨誰是誰（例如案主和照顧者）。建議先確認：${unconfirmed.slice(0,5).map(p=>p.name).join('、')}${unconfirmed.length>5?' 等':''}。`));
    root.append(warn);
  }
  root.append(button('前往人工覆核 →',()=>ctx.go('review'),'button primary'));return root;
}

function personEditor(ctx:UIContext,person:Person,text:string):HTMLElement {
  const row=node('div','person-editor');
  const name=input(person.name,'完整姓名');const alias=input(person.aliases.join('、'),'以「、」分隔，例如陳女士、小安');
  const role=select(PERSON_ROLES.map(r=>({value:r,label:r})),person.role);
  const changed=()=>{person.name=name.value.trim();person.aliases=[...new Set(alias.value.split(/[、,，\n]/).map(v=>v.trim()).filter(Boolean))];person.role=role.value;person.confirmed=false;ctx.invalidate();};
  name.onchange=changed;alias.onchange=changed;role.onchange=changed;
  row.append(field('姓名',name),field('角色',role),field('別名／稱謂',alias));
  // Suggestions from the text; nothing changes until the person presses a button and confirms.
  const hints=node('div','person-hints');
  const suggested=person.role==='待確認'?suggestRole(text,person.name):undefined;
  if(suggested&&PERSON_ROLES.includes(suggested))hints.append(node('span','',`原文標示的角色：${suggested}`),button(`角色設為${suggested}`,()=>{person.role=suggested;person.confirmed=false;ctx.invalidate();},'button chip'));
  for(const s of suggestAliases(text,person.name,person.aliases))hints.append(node('span','',`文中另有「${s.alias}」${s.count} 處，可能是同一人`),button(`加入別名「${s.alias}」`,()=>{person.aliases=[...person.aliases,s.alias];person.confirmed=false;ctx.invalidate();},'button chip'));
  if(hints.childElementCount)row.append(hints);
  row.append(checkbox('確認此人物（姓名、角色與別名都正確）',person.confirmed,checked=>{
    if(checked&&!person.name.trim()){ctx.notify('請先填寫人物姓名');ctx.render();return;}
    person.confirmed=checked;ctx.invalidate();
  }),button('移除',()=>{ctx.session.people=ctx.session.people.filter(p=>p.id!==person.id||p.groupId!==person.groupId);ctx.invalidate();},'button text-button'));
  return row;
}

function bulkPeopleEditor(ctx:UIContext):HTMLElement {
  const panel=card('批次加入人物');const doc=ctx.session.active!;const groupId=doc.groupId;
  panel.append(node('p','muted','一行一人，可只填姓名，或貼上以 Tab 分隔的「姓名、角色、別名」。別名以「、」分隔。先預覽並修正錯誤，再確認加入；新人物與別名均須逐一人工確認。'));
  panel.append(node('p','fine',`最多 100 行；姓名及每個別名最多 120 字元，每人最多 20 個別名。角色可留空為「待確認」，或使用：${PERSON_ROLES.join('、')}。只保留在本次頁面記憶體，重新整理或清除後即消失。`));
  panel.append(node('pre','source-preview','王怡安\n陳美惠\t母親\t小惠、陳女士'));
  const text=node('textarea','control');text.rows=5;text.setAttribute('aria-label','批次人物清單');text.placeholder='每行一人；可從試算表複製姓名、角色、別名三欄。';
  const output=node('div');output.setAttribute('aria-live','polite');let preview:BulkPeoplePreview|undefined;
  const add=button('確認加入人物',()=>{
    if(!preview)return;
    if(ctx.session.active!==doc||doc.groupId!==groupId){ctx.notify('目前文件或案件已變動，請重新預覽。');return;}
    try{const count=importBulkPeople(ctx.session,doc.id,preview);ctx.notify(`已加入 ${count} 位未確認人物，請逐一核對。`);ctx.render();}
    catch(error){preview=undefined;add.disabled=true;ctx.notify(error instanceof Error?error.message:'加入失敗，請重新預覽。');}
  },'button primary');add.disabled=true;
  text.oninput=()=>{preview=undefined;add.disabled=true;output.replaceChildren(node('p','muted','清單已修改，請重新預覽。'));};
  const inspect=button('預覽人物清單',()=>{
    preview=previewBulkPeople(text.value,ctx.session.people,doc.groupId);output.replaceChildren();
    output.append(node('p','',`預計新增 ${preview.additions.length} 人；略過重複 ${preview.duplicates.length} 行；錯誤 ${preview.errors.length} 行。`));
    for(const draft of preview.additions)output.append(node('p','fine',`${draft.name} · ${draft.role} · 別名：${draft.aliases.join('、')||'無'} · 未確認`));
    for(const issue of [...preview.duplicates,...preview.errors])output.append(node('p','fine',`第 ${issue.line} 行：${issue.message}`));
    if(preview.errors.length)output.append(node('p','', '請修正全部錯誤後重新預覽；本次不會部分加入。'));
    add.disabled=Boolean(preview.errors.length)||!preview.additions.length;
  });
  panel.append(field('貼上人物清單',text),inspect,output,add);return panel;
}
