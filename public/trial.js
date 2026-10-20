const form=document.querySelector('#feedback-form');
form.addEventListener('submit',event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const data=new FormData(form);
  const fields=[['職務','role'],['瀏覽器與裝置','device'],['測試格式','format'],['花費時間','time'],['完成狀態','completed'],['漏抓、誤抓或操作疑問','observations'],['最需要改善的事','improvements']];
  const text=['社福去識別化工作台｜試用回饋',`填寫日期：${new Date().toISOString().slice(0,10)}`,'確認：未包含真實個案資料。','',...fields.map(([label,key])=>`${label}：\n${data.get(key)||'（未填）'}\n`)].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='社福工作台-試用回饋.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  document.querySelector('#status').textContent='已啟動下載。回饋沒有自動送出，請將文字檔交給邀請你的人。';
});
