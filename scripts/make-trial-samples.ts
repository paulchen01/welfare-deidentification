import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { PDFDocument,rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildDocx } from '../tests/helpers/docx-builder';

const lines=[
  '社福去識別化工作台｜虛構試用資料',
  '以下姓名、聯絡方式與情境均為測試用途，並非真實個案。',
  '案主：王小明。',
  '案母：陳美惠。',
  '聯絡手機：0912-345-678。',
  '服務紀錄：案主表示希望討論家庭支持與日常生活安排。',
  '陳美惠陪同參與會談，王小明願意於下次會談繼續討論。',
  '試用任務：確認兩位人物，核對電話，再匯出處理後文件。',
];
await mkdir('public/trial-assets',{recursive:true});
await writeFile('public/trial-assets/fictional-case.docx',await buildDocx({paragraphs:lines.map(x=>[x])}));
const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
const font=await pdf.embedFont(await readFile('public/fonts/NotoSansTC-Regular.ttf'),{subset:true});
const page=pdf.addPage([595.28,841.89]);
for(const [i,text]of lines.entries())page.drawText(text,{x:36,y:790-i*38,size:i===0?17:12,font,color:rgb(.09,.2,.18)});
pdf.setTitle('Fictional welfare trial sample');pdf.setAuthor('Welfare workspace');
await writeFile('public/trial-assets/fictional-case.pdf',await pdf.save());
console.log('Created two fictional trial documents.');
