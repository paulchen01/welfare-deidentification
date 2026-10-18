import type { UIContext } from './ui-context';
import { node,button,title,card,field,input,select,pill } from './ui-kit';
import { buildShareArchive,buildRecoveryBundle,createShareDocument,downloadBlob } from './export';
import { encryptRecovery,decryptRecovery,restoreExactText,parseLegacyMapping,type RecoveryBundle } from './vault';
import { parseMarkers } from '../core/codes';
import { applyEdits } from '../core/redactor';

export function exportView(ctx:UIContext):HTMLElement {
  const root=node('div','view');root.append(title('04 / 匯出','只把需要的內容交出去。','分享文件與還原對照分開下載。每份文件都必須完成項目核對與全文覆核，才可匯出或複製。'));
  if(!ctx.session.documents.length){root.append(card('請先加入資料'));return root;}
  const docs=card('本次匯出內容');
  for(const [i,doc] of ctx.session.documents.entries()){
    const row=node('div','export-row');const complete=doc.reviewConfirmed&&doc.findings.every(f=>f.reviewed);
    const info=node('div');info.append(node('h3','',`文件 ${i+1}`),pill(complete?'已覆核':'待覆核',complete?'success':'warning'),node('p','muted',`${doc.findings.filter(f=>f.action!=='keep').length} 處處理 · ${doc.findings.filter(f=>f.action==='keep').length} 處保留`));
    const options=[{value:'text',label:'純文字 TXT（建議）'}];
    if(doc.report.nativeAllowed&&doc.document.format!=='txt')options.push({value:'native',label:`${doc.document.format.toUpperCase()} 原格式`});
    const mode=select(options,doc.mode);mode.onchange=()=>{doc.mode=mode.value as 'native'|'text';};
    row.append(info,field('輸出格式',mode),button('檢查這份文件',()=>{ctx.session.activeId=doc.id;ctx.go('review');},'button secondary'));
    docs.append(row);
  }
  root.append(docs);
  const ready=ctx.session.documents.every(d=>d.reviewConfirmed&&d.findings.every(f=>f.reviewed));
  const share=card('分享文件');share.append(node('p','muted','下載包只有處理後文件與不含原值的處理摘要，不含還原對照。純文字只包含畫面可見的抽取內容。'));
  const shareButton=button('下載分享包',()=>ctx.run(async(signal)=>{const blob=await buildShareArchive(ctx.session.documents,ctx.session.purpose);if(!signal.aborted)downloadBlob(blob,'社福分享文件.zip');}),'button primary');shareButton.disabled=!ready||ctx.busy;
  const copy=button('複製目前文件',()=>ctx.run(async(signal)=>{
    const doc=ctx.session.active!;const data=await createShareDocument({...doc,mode:'text'},ctx.session.documents.indexOf(doc)+1);
    if(signal.aborted)return;await navigator.clipboard.writeText(data.text);ctx.notify('已複製處理後文字');
  }));copy.disabled=!ready||ctx.busy;
  const actions=node('div','action-row');actions.append(shareButton,copy);share.append(actions);
  if(!ready)share.append(node('p','notice-inline','尚有未完成覆核的文件。請回到人工覆核確認全文與格式限制。'));
  root.append(share);
  const vault=card('另存還原對照（選用）');vault.append(node('p','muted','對照檔含可還原的原值與原檔名，請獨立保管。使用 AES-256-GCM 加密；密碼無法找回。請保留相同版本的純文字匯出，供之後逐字還原。'));
  const password=input('','至少 8 個字元，建議使用較長密語');password.type='password';password.autocomplete='new-password';
  const confirm=input('','再次輸入密碼');confirm.type='password';confirm.autocomplete='new-password';
  vault.append(field('還原密碼',password),field('確認密碼',confirm));
  const save=button('下載加密對照檔',()=>{
    const secret=password.value;const repeated=confirm.value;password.value='';confirm.value='';
    ctx.run(async(signal)=>{if(secret!==repeated)throw new Error('兩次輸入的密碼不相同');
      const encoded=await encryptRecovery(await buildRecoveryBundle(ctx.session.documents),secret);
      if(!signal.aborted)downloadBlob(new Blob([encoded],{type:'application/json'}),'社福還原對照.encrypted.json');
    });
  });save.disabled=!ready||ctx.busy;vault.append(save);root.append(vault);return root;
}

export interface RestoreState { encoded:string; bundle?:RecoveryBundle; text:string; result:string; documentId:string; legacy:string }
export function emptyRestore():RestoreState {return {encoded:'',text:'',result:'',documentId:'',legacy:''};}
export function restoreView(ctx:UIContext,state:RestoreState):HTMLElement {
  const root=node('div','view');root.append(title('文字還原','在本機開啟還原對照。','新版對照只能還原完全相符的匯出文字。還原的是文字內容，不會重建 Word、Excel 或 PDF 原本的版面。'));
  const source=card('1. 開啟加密對照');const upload=node('input','control');upload.type='file';upload.accept='.json';
  upload.onchange=()=>ctx.run(async()=>{const f=upload.files?.[0];if(!f)return;if(f.size>40*1024*1024)throw new Error('對照檔過大');state.encoded=await f.text();state.bundle=undefined;state.result='';ctx.notify('已載入對照檔，請輸入密碼');ctx.render();});
  const secret=input('','輸入還原密碼');secret.type='password';secret.autocomplete='current-password';
  source.append(field('加密對照檔',upload),node('small','muted',state.encoded?'已載入一份加密檔':'尚未選擇對照檔'),field('密碼',secret),button('解密對照',()=>{const password=secret.value;secret.value='';ctx.run(async()=>{
    const bundle=await decryptRecovery(state.encoded,password);state.bundle=bundle;state.documentId=bundle.documents[0].id;state.result='';ctx.render();
  });}));root.append(source);
  if(state.bundle){
    const content=card('2. 選擇文件並載入匯出文字');
    const choose=select(state.bundle.documents.map((d,i)=>({value:d.id,label:`文件 ${i+1} · ${d.format.toUpperCase()}`})),state.documentId);
    choose.onchange=()=>{state.documentId=choose.value;state.result='';ctx.render();};content.append(field('對應文件',choose));
    const txt=node('input','control');txt.type='file';txt.accept='.txt,.md';
    txt.onchange=()=>ctx.run(async()=>{const f=txt.files?.[0];if(!f)return;if(f.size>20*1024*1024)throw new Error('文字檔過大');state.text=await f.text();state.result='';ctx.render();});
    const text=node('textarea','control source-input');text.value=state.text;text.setAttribute('aria-label','待還原文字');text.oninput=()=>{state.text=text.value;state.result='';};
    content.append(field('原封不動的匯出文字檔（可避免貼上改變換行）',txt),field('或貼上待還原文字',text),button('核對並還原文字',()=>ctx.run(async()=>{
      state.result=await restoreExactText(state.text,state.bundle!.documents.find(d=>d.id===state.documentId)!);ctx.render();
    }),'button primary'));root.append(content);
  }
  const legacy=node('details','card');legacy.append(node('summary','','相容原版 CSV 對照表'));
  legacy.append(node('p','muted','僅供原版「[類別:六位代碼]」格式使用。舊版 CSV 沒有版本雜湊，無法核對整份文字來源；請自行核對每項結果。CSV 對照檔未加密，請妥善保管。'));
  const csv=node('input','control');csv.type='file';csv.accept='.csv';csv.onchange=()=>ctx.run(async()=>{const f=csv.files?.[0];if(!f)return;if(f.size>20*1024*1024)throw new Error('CSV 過大');state.legacy=await f.text();ctx.notify('已載入舊版 CSV');});
  const oldText=node('textarea','control source-input');oldText.setAttribute('aria-label','舊版待還原文字');
  legacy.append(field('原版 CSV',csv),field('原版待還原文字',oldText),button('依舊版標記還原',()=>{const value=oldText.value;ctx.run(async()=>{
    const map=parseLegacyMapping(state.legacy);const edits=parseMarkers(value).map(marker=>{
      const entry=map.find(e=>e.code===marker.code&&e.category===marker.category);if(!entry)throw new Error('有標記找不到相同類別的對照，已停止還原');
      return {start:marker.start,end:marker.end,replacement:entry.original};
    });if(!edits.length)throw new Error('未找到原版格式標記');state.result=applyEdits(value,edits);ctx.render();
  });}));root.append(legacy);
  if(state.result){const result=card('還原結果 · 含原始敏感資料');result.append(node('pre','document-text',state.result),button('下載還原文字',()=>downloadBlob(new Blob([state.result],{type:'text/plain;charset=utf-8'}),'還原文字.txt')));root.append(result);}
  return root;
}
