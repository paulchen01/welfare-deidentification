import { isValidTaxId } from '../core/twid';
export interface LocalIdentifier { start:number; end:number; category:'車牌'|'LINE ID'|'統編'; message:string }
/** Label-scoped suggestions only; never infer an identity from an arbitrary code. */
export function detectLocalIdentifiers(text:string):LocalIdentifier[] {
  const hits:LocalIdentifier[]=[];
  const fields:[string,LocalIdentifier['category']][]=[['車牌|車號','車牌'],['LINE[\\t ]*(?:ID|帳號)','LINE ID'],['統一編號|統編','統編']];
  for(const [labels,category] of fields){
    // Read a whole token before validating, so invalid suffixes cannot become partial hits.
    const re=new RegExp(`(?<![A-Za-z0-9])(?:${labels})(?:[\\t ]*[:：][\\t ]*|[\\t ]+)([^\\s，,；;。！？、：:（）()「」『』]+)`,'giu');
    for(const m of text.matchAll(re)){
      const value=m[1];let message='';
      if(category==='車牌'){
        if(!/^(?:[A-Za-z0-9]{2,3}-\d{2,4}|\d{2,4}-[A-Za-z0-9]{2,3})$/u.test(value)||!/[A-Za-z]/u.test(value))continue;
        message='常見車牌格式候選，非完整車牌辨識保證，請核對原文。';
      }else if(category==='LINE ID'){
        if(!/^[A-Za-z0-9._-]{1,20}$/u.test(value)||!/[A-Za-z0-9]/u.test(value))continue;
        message='有標籤的 LINE ID 候選，請核對原文與帳號。';
      }else{
        if(!/^\d{8}$/u.test(value))continue;
        message=isValidTaxId(value)?'統編格式與檢核通過，仍須人工確認來源與用途。':'統編檢核未通過，可能疑似誤字；僅列候選，不代表有效證件。';
      }
      const start=m.index!+m[0].lastIndexOf(value);hits.push({start,end:start+value.length,category,message});
    }
  }
  return hits;
}
