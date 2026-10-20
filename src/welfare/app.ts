import { WorkspaceSession,type WorkspaceView } from './session';
import type { UIContext } from './ui-context';
import { node,button,pill } from './ui-kit';
import { inputView,peopleView } from './views-input';
import { reviewView } from './views-review';
import { exportView,restoreView,emptyRestore } from './views-output';
import { settingsView } from './views-settings';
import { PURPOSES } from './policies';

export function mountWelfareApp(host:HTMLElement):UIContext {
  let restore=emptyRestore();let status='';let abort:AbortController|undefined;let generation=0;
  const session=new WorkspaceSession();
  const ctx:UIContext={
    session,view:'input',busy:false,rawInput:'',
    notify(message){status=message;const out=host.querySelector('.status-line');if(out)out.textContent=message;},
    go(view){if(ctx.busy)return;ctx.view=view;status='';ctx.render();window.scrollTo?.({top:0});},
    run(work){if(ctx.busy)return;ctx.busy=true;abort=new AbortController();const signal=abort.signal;const current=generation;
      // Capture selections and form values before replacing their DOM nodes.
      const pending=work(signal);ctx.render();
      void pending.catch((error:unknown)=>{if(current===generation)ctx.notify(error instanceof Error?error.message:'處理失敗，請檢查內容後重試');})
        .finally(()=>{if(current===generation){abort=undefined;ctx.busy=false;ctx.render();}});
    },
    invalidate(){session.reanalyseAll();ctx.render();},
    clear(){generation++;abort?.abort();abort=undefined;session.clear();ctx.rawInput='';restore=emptyRestore();ctx.busy=false;ctx.view='input';status='已清除本頁工作資料。已下載的檔案需自行管理。';ctx.render();},
    addText(text){
      session.add({fileName:'貼上文字.txt',format:'txt',text,handle:null},{nativeAllowed:true,issues:[]});ctx.rawInput='';ctx.view='people';ctx.render();
    },
    useSample(sample){
      const doc=session.add({fileName:'虛構範例.txt',format:'txt',text:sample.text,handle:null},{nativeAllowed:true,issues:[]});
      if(sample.people.length){session.people=session.people.filter(p=>p.groupId!==doc.groupId);session.people.push(...sample.people.map(p=>({...p,id:crypto.randomUUID(),groupId:doc.groupId,aliases:[...p.aliases],confirmed:false})));session.reanalyse(doc);}
      ctx.view='people';ctx.render();
    },
    addFiles(files){ctx.run(async(signal)=>{
      if(files.length+session.documents.length>10)throw new Error('每批最多 10 份文件，請減少選取數量');
      const {parseSafeDocument}=await import('./document-safety');let added=0;
      for(const file of files){
        if(signal.aborted)break;
        ctx.notify(`正在讀取第 ${added+1} / ${files.length} 份文件……`);
        const result=await parseSafeDocument(file,{ocr:{signal,onProgress:p=>ctx.notify(`PDF 辨識 · 第 ${p.page} / ${p.pages} 頁 · ${Math.round(p.progress*100)}%`)}});
        if(signal.aborted)break;session.add(result.document,result.report);added++;
      }
      if(!signal.aborted){ctx.view='people';ctx.notify(`已加入 ${added} 份文件`);}
    });},
    render(){
      const shell=node('div','workspace');const sidebar=node('aside','sidebar');
      const brand=node('div','brand');brand.append(node('span','brand-symbol','守'),node('div','brand-name','社福去識別化'),node('small','','工作流程版 · 0.1'));
      brand.append(node('p','brand-credit','飽螺的社工甘苦便條紙 製作'));
      const nav=node('nav','workflow-nav');nav.setAttribute('aria-label','工作流程');
      const views:[WorkspaceView,string,string][]=[['input','01','加入資料'],['people','02','人物與規則'],['review','03','人工覆核'],['export','04','匯出文件']];
      for(const [id,num,label]of views){const b=button('',()=>ctx.go(id),`nav-item ${ctx.view===id?'active':''}`);b.append(node('span','nav-number',num),node('span','',label));b.disabled=ctx.busy;if(id===ctx.view)b.setAttribute('aria-current','step');nav.append(b);}
      const secondary=node('div','secondary-nav');secondary.append(button('還原文字',()=>ctx.go('restore'),`nav-item ${ctx.view==='restore'?'active':''}`),button('機構範本',()=>ctx.go('settings'),`nav-item ${ctx.view==='settings'?'active':''}`));
      const trial=node('a','nav-item','社工試用說明 ↗');trial.href=`${import.meta.env.BASE_URL}trial.html`;trial.target='_blank';trial.rel='noopener noreferrer';secondary.append(trial);
      const note=node('div','sidebar-note');note.append(pill('本機處理','success'),node('p','','免登入，個案檔案不上傳。'),node('small','','資料只保留於本頁記憶體；重新整理或關閉頁面會失去本次工作。'));
      sidebar.append(brand,nav,secondary,note);
      const main=node('main','main');const top=node('header','topbar');
      top.append(node('span','workspace-label','個案資料工作台'),pill(PURPOSES.find(p=>p.id===session.purpose)?.label??''),node('span','document-count',`${session.documents.length} 份文件`),button('結束並清除',()=>ctx.clear(),'button text-button'));
      const statusLine=node('div','status-line',status);statusLine.setAttribute('role','status');statusLine.setAttribute('aria-live','polite');
      const content=ctx.view==='input'?inputView(ctx):ctx.view==='people'?peopleView(ctx):ctx.view==='review'?reviewView(ctx):ctx.view==='export'?exportView(ctx):ctx.view==='restore'?restoreView(ctx,restore):settingsView(ctx);
      if(ctx.busy)content.setAttribute('inert','');
      const footer=node('footer','footer');footer.append(node('span','','輔助辨識與覆核，不代表已達完全匿名。'),node('span','','衍生自 Dean Lin 原版；校園工作流參考 chuoneone。'));
      const license=node('a','','來源與授權');license.href=`${import.meta.env.BASE_URL}licenses/index.html`;license.target='_blank';license.rel='noopener';footer.append(license);
      main.append(top,statusLine,content,footer);shell.append(sidebar,main);
      if(ctx.busy){const busy=node('div','busy-panel');busy.setAttribute('role','status');busy.append(node('span','spinner'),node('strong','','本機處理中'),button('取消並清除本次工作',()=>ctx.clear(),'button secondary'));shell.append(busy);}
      host.replaceChildren(shell);
    },
  };
  window.addEventListener('beforeunload',event=>{if(session.documents.length||restore.encoded){event.preventDefault();event.returnValue='';}});
  ctx.render();return ctx;
}
