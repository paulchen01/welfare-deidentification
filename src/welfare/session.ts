import type { LoadedDocument } from '../core/types';
import { detectWelfare, proposePeople } from './engine';
import type { Person, Purpose, DocumentKind } from './types';
import type { FormatSafetyReport } from './document-safety';
import type { ShareEntry } from './export';
import { DEFAULT_PROFILE, type InstitutionProfile } from './profile';

export interface WorkspaceDocument extends ShareEntry { groupId:string; kind:DocumentKind; reviewScope?:string }
export type WorkspaceView = 'input' | 'people' | 'review' | 'export' | 'restore' | 'settings';

/** Deliberately memory-only. No persistence of raw documents, people or mappings. */
export class WorkspaceSession {
  documents:WorkspaceDocument[] = [];
  people:Person[] = [];
  purpose:Purpose = 'ai';
  kind:DocumentKind = 'record';
  profile:InstitutionProfile = structuredClone(DEFAULT_PROFILE);
  profileDraft?:InstitutionProfile;
  activeId = '';
  get active(): WorkspaceDocument | undefined { return this.documents.find((d) => d.id === this.activeId); }

  add(document:LoadedDocument, report:FormatSafetyReport):WorkspaceDocument {
    if (this.documents.length >= 10) throw new Error('每次最多處理 10 份文件，請先結束本次工作');
    if (document.text.length > 2_000_000) throw new Error('抽取文字超過 200 萬字元，請分割文件後處理');
    if (!document.text.trim()) throw new Error('未取得可檢視文字，請確認檔案內容或辨識結果');
    const id = crypto.randomUUID();
    const item:WorkspaceDocument = {id, document, report, groupId:id, kind:this.kind, findings:[], reviewConfirmed:false, mode:'text'};
    this.people.push(...proposePeople(document.text, id));
    this.documents.push(item); this.activeId = id;
    this.reanalyse(item);
    return item;
  }
  reanalyse(doc:WorkspaceDocument):void {
    const manual = doc.findings.filter((f) => f.source === 'manual' || f.source === 'field').map((f) => ({...f, reviewed:false}));
    const automatic = detectWelfare(doc.document.text, {purpose:this.purpose,groupId:doc.groupId,people:this.people.filter(p=>p.name.trim()),customRules:this.profile.rules});
    doc.findings = [...automatic.filter((f) => !manual.some((m) => f.start < m.end && f.end > m.start)), ...manual].sort((a,b) => a.start-b.start);
    doc.reviewConfirmed = false;
  }
  reanalyseAll():void { this.documents.forEach((d) => this.reanalyse(d)); }
  setPurpose(purpose:Purpose):void { this.purpose = purpose; this.reanalyseAll(); }
  remove(id:string):void {
    this.documents = this.documents.filter((d) => d.id !== id);
    const groups = new Set(this.documents.map((d) => d.groupId));
    this.people = this.people.filter((p) => groups.has(p.groupId));
    if (this.activeId === id) this.activeId = this.documents[0]?.id ?? '';
  }
  clear():void { this.documents = []; this.people = []; this.activeId = ''; this.profile=structuredClone(DEFAULT_PROFILE);this.profileDraft=undefined;this.purpose='ai';this.kind='record'; }
}
