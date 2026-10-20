import type { Person } from './types';
import type { WorkspaceSession } from './session';
import { PERSON_ROLES } from './policies';
export interface BulkPersonDraft { name:string; role:string; aliases:string[] }
export interface BulkPeoplePreview { text:string; groupId:string; additions:BulkPersonDraft[]; errors:{line:number;message:string}[]; duplicates:{line:number;message:string}[]; snapshot:string }
const snapshot=(people:Person[],groupId:string)=>JSON.stringify(people.filter(p=>p.groupId===groupId));
const validName=(value:string)=>Boolean(value)&&value.length<=120&&!/[\p{Cc}\p{Cf}]/u.test(value);
/** A preview is tied to this case's current roster and is never stored beyond page memory. */
export function previewBulkPeople(text:string,people:Person[],groupId:string):BulkPeoplePreview {
  const result:BulkPeoplePreview={text,groupId,additions:[],errors:[],duplicates:[],snapshot:snapshot(people,groupId)};
  const lines=text.replaceAll('\r\n','\n').split('\n');
  // A final newline terminates the last row; interior blank lines are errors.
  if(lines.length>1&&lines.at(-1)==='')lines.pop();
  if(lines.length>100){result.errors.push({line:101,message:'每次最多 100 行，請分批輸入。'});return result;}
  const names=new Set(people.filter(p=>p.groupId===groupId).map(p=>p.name));
  lines.forEach((line,i)=>{
    const fail=(message:string)=>result.errors.push({line:i+1,message});
    const columns=line.split('\t');
    if(columns.length>3){fail('最多三欄：姓名、角色、別名，請以 Tab 分隔。');return;}
    const [name,roleText='',aliasText='']=columns.map(v=>v.trim());const role=roleText||'待確認';
    const aliases=aliasText?aliasText.split(/[、,，]/u).map(v=>v.trim()):[];
    if(!validName(name)){fail('姓名不可空白，最多 120 字元，且不可含控制字元。');return;}
    if(!PERSON_ROLES.includes(role)){fail('角色須使用畫面既有清單，或留空為待確認。');return;}
    if(aliases.length>20||aliases.some(a=>!validName(a))){fail('最多 20 個別名，每個別名須有內容、最多 120 字元，且不可含控制字元。');return;}
    if(names.has(name)){result.duplicates.push({line:i+1,message:`「${name}」與同案既有人物或前行完全同名，略過；既有人物別名不變。`});return;}
    names.add(name);result.additions.push({name,role,aliases});
  });
  return result;
}
/** All rows are revalidated before any mutation; no partial imports on invalid/stale preview. */
export function importBulkPeople(session:WorkspaceSession,documentId:string,preview:BulkPeoplePreview):number {
  const doc=session.documents.find(d=>d.id===documentId);
  if(!doc||doc.groupId!==preview.groupId||snapshot(session.people,preview.groupId)!==preview.snapshot)throw new Error('人物或案件已變動，請重新預覽人物清單。');
  const current=previewBulkPeople(preview.text,session.people,doc.groupId);
  if(current.errors.length)throw new Error('請修正所有錯誤行後重新預覽，尚未加入任何人物。');
  if(JSON.stringify(current.additions)!==JSON.stringify(preview.additions))throw new Error('預覽已變動，請重新預覽人物清單。');
  if(!current.additions.length)return 0;
  const additions:Person[]=current.additions.map(p=>({...p,aliases:[...p.aliases],id:crypto.randomUUID(),groupId:doc.groupId,confirmed:false}));
  const beforePeople=session.people;
  const affected=session.documents.filter(d=>d.groupId===doc.groupId);
  const beforeDocuments=affected.map(d=>({doc:d,state:{...d}}));
  session.people=[...beforePeople,...additions];
  try{affected.forEach(d=>session.reanalyse(d));}
  catch(error){
    session.people=beforePeople;
    beforeDocuments.forEach(({doc:changed,state})=>Object.assign(changed,state));
    throw error;
  }
  return additions.length;
}
