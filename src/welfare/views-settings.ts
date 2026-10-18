import type { UIContext } from './ui-context';
import { node,button,title,card,field,input,select } from './ui-kit';
import { parseProfile,serializeProfile } from './profile';
import { downloadBlob } from './export';
import { PURPOSES } from './policies';
import type { Purpose } from './types';
export function settingsView(ctx:UIContext):HTMLElement {
  const root=node('div','view');root.append(title('機構範本','把規則留下，把個案帶走。','範本只匯出用途與個案號規則，不匯出原文、人物或還原對照。請勿在範本名稱與規則標籤填入個案資料。'));
  const config=card('通用設定');const profile=ctx.session.profileDraft??=structuredClone(ctx.session.profile);
  const name=input(profile.name);name.onchange=()=>{profile.name=name.value;};
  const purpose=select(PURPOSES.map(p=>({value:p.id,label:p.label})),profile.purpose);purpose.onchange=()=>{profile.purpose=purpose.value as Purpose;};
  config.append(field('範本名稱',name),field('預設用途',purpose));root.append(config);
  const rules=card('機構個案號規則');rules.append(node('p','muted','輸入固定英數前綴及後接數字長度。例如 SW- 加上 6 位數字，可辨識 SW-123456。'));
  for(const rule of profile.rules){const row=node('div','rule-row');const label=input(rule.label);const prefix=input(rule.prefix);const min=input(String(rule.minDigits));min.type='number';min.min='2';min.max='20';const max=input(String(rule.maxDigits));max.type='number';max.min='2';max.max='20';
    const update=()=>{rule.label=label.value;rule.prefix=prefix.value;rule.minDigits=Number(min.value);rule.maxDigits=Number(max.value);};label.onchange=update;prefix.onchange=update;min.onchange=update;max.onchange=update;
    row.append(field('標籤',label),field('前綴',prefix),field('最少位數',min),field('最多位數',max),button('移除',()=>{profile.rules=profile.rules.filter(r=>r.id!==rule.id);ctx.render();},'button text-button'));rules.append(row);
  }
  rules.append(button('＋ 新增個案號規則',()=>{if(profile.rules.length>=30){ctx.notify('最多 30 條規則');return;}profile.rules.push({id:crypto.randomUUID(),label:'個案號',prefix:'SW-',minDigits:6,maxDigits:6});ctx.render();}));root.append(rules);
  const transfer=card('套用與移轉');
  transfer.append(button('套用設定並重新檢查文件',()=>ctx.run(async()=>{ctx.session.profile=parseProfile(serializeProfile(profile));ctx.session.setPurpose(profile.purpose);ctx.notify('已套用設定；文件需重新覆核');ctx.render();}),'button primary'),button('下載機構範本',()=>ctx.run(async()=>downloadBlob(new Blob([serializeProfile(profile)],{type:'application/json'}),'機構去識別化範本.json'))));
  const file=node('input','control');file.type='file';file.accept='.json';file.onchange=()=>ctx.run(async(signal)=>{const f=file.files?.[0];if(!f)return;if(f.size>50_000)throw new Error('範本過大');const imported=parseProfile(await f.text());if(signal.aborted)return;ctx.session.profile=imported;ctx.session.profileDraft=structuredClone(imported);ctx.session.setPurpose(imported.purpose);ctx.notify('已匯入範本；文件需重新覆核');ctx.render();});
  transfer.append(field('匯入範本',file));root.append(transfer);return root;
}
