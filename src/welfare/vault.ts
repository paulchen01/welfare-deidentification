import type { DocFormat, MappingEntry, TextEdit } from '../core/types';
import { applyEdits } from '../core/redactor';
import { parseMapping } from '../core/csv';

export interface RecoveryOccurrence { start: number; end: number; marker: string; original: string }
export interface RecoveryDocument {
  id: string;
  originalFileName: string;
  format: DocFormat;
  redactedTextHash: string;
  occurrences: RecoveryOccurrence[];
}
export interface RecoveryBundle { version: 1; documents: RecoveryDocument[] }
const ITERATIONS = 310_000;
const MAX_SIZE = 20 * 1024 * 1024;
const encoder = new TextEncoder();
const FORMATS: string[] = ['txt', 'md', 'docx', 'xlsx', 'pdf'];

export async function textHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Offsets refer to the exported text, so different aliases may share a readable marker. */
export async function makeRecoveryDocument(id: string, originalFileName: string, format: DocFormat,
  source: string, edits: TextEdit[]): Promise<RecoveryDocument> {
  let cursor = 0;
  let delta = 0;
  const occurrences = [...edits].sort((a, b) => a.start - b.start).map((e) => {
    if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < cursor || e.end <= e.start || e.end > source.length) {
      throw new Error('還原範圍無效或重疊');
    }
    cursor = e.end;
    const start = e.start + delta;
    const item = { start, end: start + e.replacement.length, marker: e.replacement, original: source.slice(e.start, e.end) };
    delta += e.replacement.length - (e.end - e.start);
    return item;
  });
  return { id, originalFileName, format, redactedTextHash: await textHash(applyEdits(source, edits)), occurrences };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateRecovery(value: unknown): RecoveryBundle {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.documents) || value.documents.length > 10 || value.documents.length === 0) {
    throw new Error('不支援的還原檔版本或文件數量');
  }
  const ids = new Set<string>();
  for (const doc of value.documents) {
    if (!isRecord(doc) || typeof doc.id !== 'string' || ids.has(doc.id) ||
      typeof doc.originalFileName !== 'string' || doc.originalFileName.length > 512 || !FORMATS.includes(String(doc.format)) ||
      typeof doc.redactedTextHash !== 'string' || !/^[a-f0-9]{64}$/.test(doc.redactedTextHash) ||
      !Array.isArray(doc.occurrences) || doc.occurrences.length > 100_000) throw new Error('還原檔結構無效');
    ids.add(doc.id);
    let previous = 0;
    for (const o of doc.occurrences) {
      if (!isRecord(o) || !Number.isSafeInteger(o.start) || !Number.isSafeInteger(o.end) ||
        (o.start as number) < previous || (o.end as number) < (o.start as number) ||
        typeof o.original !== 'string' || typeof o.marker !== 'string' ||
        (o.end as number) - (o.start as number) !== o.marker.length) throw new Error('還原位置資料無效');
      previous = o.end as number;
    }
  }
  return value as unknown as RecoveryBundle;
}

export async function restoreExactText(text: string, doc: RecoveryDocument): Promise<string> {
  validateRecovery({ version: 1, documents: [doc] });
  if (await textHash(text) !== doc.redactedTextHash) throw new Error('文字與匯出版本不相符；改寫或增刪後不能逐字還原');
  const edits = doc.occurrences.map((o) => {
    if (text.slice(o.start, o.end) !== o.marker) throw new Error('還原標記不相符');
    return { start: o.start, end: o.end, replacement: o.original };
  });
  return applyEdits(text, edits);
}

function toBase64(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(str);
}
function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > MAX_SIZE * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('還原檔編碼無效');
  try { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
  catch { throw new Error('還原檔編碼無效'); }
}
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, usages: KeyUsage[]): Promise<CryptoKey> {
  if (password.length < 8 || password.length > 1024) throw new Error('還原密碼至少需要 8 個字元，最多 1024 個字元');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256'}, material,
    {name:'AES-GCM', length:256}, false, usages);
}
export async function encryptRecovery(bundle: RecoveryBundle, password: string): Promise<string> {
  validateRecovery(bundle);
  const plaintext = encoder.encode(JSON.stringify(bundle));
  if (plaintext.byteLength > MAX_SIZE) throw new Error('還原資料超過 20 MB，請分批處理');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode('welfare-vault-v1')}, key, plaintext);
  return JSON.stringify({format:'welfare-vault', version:1, kdf:'PBKDF2-SHA256', iterations:ITERATIONS,
    cipher:'AES-256-GCM', salt:toBase64(salt), iv:toBase64(iv), ciphertext:toBase64(new Uint8Array(ciphertext))});
}
export async function decryptRecovery(encoded: string, password: string): Promise<RecoveryBundle> {
  if (encoded.length > MAX_SIZE * 2) throw new Error('還原檔過大');
  let v: unknown;
  try { v = JSON.parse(encoded); } catch { throw new Error('還原檔不是有效的 JSON'); }
  if (!isRecord(v) || v.format !== 'welfare-vault' || v.version !== 1 || v.kdf !== 'PBKDF2-SHA256' ||
    v.iterations !== ITERATIONS || v.cipher !== 'AES-256-GCM') throw new Error('不支援的還原檔版本或加密參數');
  const salt = fromBase64(v.salt), iv = fromBase64(v.iv), ciphertext = fromBase64(v.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('還原檔結構無效');
  const key = await deriveKey(password, salt, ['decrypt']);
  let decrypted: ArrayBuffer;
  try { decrypted = await crypto.subtle.decrypt({name:'AES-GCM', iv, additionalData:encoder.encode('welfare-vault-v1')}, key, ciphertext); }
  catch { throw new Error('密碼錯誤或還原檔已損壞'); }
  try { return validateRecovery(JSON.parse(new TextDecoder().decode(decrypted))); }
  catch { throw new Error('還原檔內容或版本無效'); }
}

/** Compatibility import is explicit; this table never goes into a share archive. */
export function parseLegacyMapping(text: string): MappingEntry[] {
  if (text.length > MAX_SIZE) throw new Error('CSV 對照表過大');
  const result = parseMapping(text);
  if (result.errors.length || !result.entries.length || result.entries.length > 100_000 || result.entries.some((e) =>
    !/^[0-9a-f]{6}$/.test(e.code) || !/^[^\[\]:\r\n]{1,10}$/.test(e.category) || e.original.length > 100_000)) {
    throw new Error('CSV 對照表欄位、編碼或重複資料無效');
  }
  return result.entries;
}
