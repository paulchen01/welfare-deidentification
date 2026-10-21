/**
 * Narrative-style hints for Taiwanese case notes. Every result is a review suggestion:
 * candidates stay unconfirmed and short forms never become aliases without a person's action.
 */

const SINGLE_SURNAMES = [...new Set([...
  '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周徐蘇葉莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董温溫唐藍石蔣古紀姚連馮歐程湯黎田康姜白汪鄒尤巫鐘涂龔嚴韓袁金童陸夏柳凌邵錢伍倪譚于單駱熊任秦葛武毛賀龍易喬尹段雷史陶章孔包甘辜粘塗艾冉',
])];
const COMPOUND_SURNAMES = ['歐陽', '司馬', '上官', '諸葛', '張簡', '范姜', '東方', '司徒', '夏侯', '皇甫', '端木', '長孫', '慕容'];
const SURNAME_SET = new Set(SINGLE_SURNAMES);
const SINGLE = SINGLE_SURNAMES.join('');
const COMPOUND = COMPOUND_SURNAMES.join('|');

/** Ordinary words that begin with a surname character; never proposed as names. */
const COMMON_WORDS = new Set<string>([
  '陳述', '陳列', '黃金', '高興', '高度', '高中', '方式', '方法', '方面', '方案', '方便', '方向', '白天', '金錢', '金額', '林業', '周末', '周遭',
  '周圍', '簡單', '簡直', '簡訊', '何時', '何處', '連續', '連絡', '紀錄', '尤其', '包括', '包含', '任何', '任務', '程度', '程序', '溫暖', '溫度',
  '嚴重', '嚴格', '單位', '單獨', '單純', '施工', '施行', '卓越', '古代', '顏色', '孫子', '孫女', '馬上', '游泳', '童年', '凌晨', '夏天', '黎明',
  '余生', '葉子', '江湖', '石頭', '田野', '康復', '毛巾', '武器', '段落', '章節', '史上', '易於', '雷同', '甘願', '龍頭', '杜絕', '唐突', '藍色',
  '曾經', '曾是', '許多', '許可', '張開', '王國', '安排', '李子', '吳語', '洪水', '邱陵', '廖', '賴床', '蘇醒', '莊重', '呂', '蕭條', '羅列',
  '潘', '朱紅', '鍾愛', '彭', '詹', '胡亂', '沈默', '沈重', '盧', '梁柱', '趙', '柯', '翁', '魏', '戴上', '范', '宋', '鄧', '傅', '侯', '曹', '薛',
  '丁點', '阮', '董事', '蔣', '姚', '馮', '歐洲', '湯匙', '田地', '康', '姜', '汪洋', '鄒', '巫', '鐘頭', '鐘點', '涂', '龔', '韓', '袁', '童話',
  '陸續', '柳', '邵', '錢包', '伍', '倪', '譚', '于是', '駱', '熊', '秦', '葛', '賀卡', '易', '喬', '尹', '陶', '孔', '包裝', '辜負', '粘', '塗抹', '艾', '冉',
].filter(word => word.length > 1));
/** Characters that mark ordinary prose rather than a given name (曾表示、林也是). */
const NOT_GIVEN = /[表示經是在說要會已也都不沒很再又就才還被把讓給對從於的了著過去來到和與及或並等請想應該需將曾]/u;

/** Relationship or role words that, in narrative notes, are often followed directly by a person's name. */
const RELATIONS = [
  '案主', '案父', '案母', '案妻', '案夫', '案兄', '案姊', '案姐', '案弟', '案妹', '案子', '案女', '案孫', '案孫女', '案祖父', '案祖母', '案外公', '案外婆',
  '案阿公', '案阿嬤', '兒子', '女兒', '長子', '次子', '三子', '長女', '次女', '三女', '么女', '孫子', '孫女', '丈夫', '妻子', '前夫', '前妻', '男友', '女友',
  '同居人', '配偶', '父親', '母親', '生父', '生母', '繼父', '繼母', '養父', '養母', '爸爸', '媽媽', '哥哥', '姊姊', '姐姐', '弟弟', '妹妹', '祖父', '祖母',
  '外公', '外婆', '阿公', '阿嬤', '奶奶', '爺爺', '叔叔', '舅舅', '姑姑', '伯伯', '阿姨', '班導', '導師', '輔導老師', '老師', '校長', '房東', '鄰居', '里長',
  '同學', '室友', '個管師', '社工', '督導', '主任', '護理師', '醫師', '醫生', '監護人', '照顧者', '看護', '通報人',
].sort((a, b) => b.length - a.length);

/** Honorifics that follow a surname: 陳老師、王媽媽、林先生. */
const HONORIFICS = [
  '老師', '先生', '小姐', '女士', '太太', '媽媽', '爸爸', '阿姨', '叔叔', '伯伯', '伯母', '阿伯', '阿嬤', '阿公', '奶奶', '爺爺', '醫師', '醫生',
  '護理師', '社工', '督導', '主任', '校長', '里長', '議員', '警員', '教官', '同學', '個管師',
].sort((a, b) => b.length - a.length);

/** Where a name usually stops in narrative prose: punctuation or a following verb or particle. */
const AFTER_NAME = '(?=[，,。．、；;：:！!？?（）()「」『』\\s]|$|表示|說|提到|提及|認為|希望|目前|今年|現年|就讀|患有|罹患|常|也|則|與|和|及|跟|的|在|於|已|未|曾|會|將|要|有|是|同意|拒絕|陪同|反映|告知|擔心|居住|住在|任職|工作|來電|到|至|前往|返回|出院|入院|離家)';

const RELATION_NAME = new RegExp(
  `(?:${RELATIONS.join('|')})((?:${COMPOUND}|[${SINGLE}][${SINGLE}]?)[\\p{Script=Han}]{1,2}?)${AFTER_NAME}`, 'gu');
const HONORIFIC_NAME = new RegExp(
  `(?<![對雙地官遠後前一大小老])((?:${COMPOUND}|[${SINGLE}])(?:${HONORIFICS.join('|')}))`, 'gu');

/** Han-only names of two to four characters that start with a known surname. */
export function looksLikeName(name: string): boolean {
  if (!/^[\p{Script=Han}]{2,4}$/u.test(name) || COMMON_WORDS.has(name)) return false;
  const compound = COMPOUND_SURNAMES.find(s => name.startsWith(s) && name.length > s.length);
  if (!compound && !SURNAME_SET.has(name[0])) return false;
  return !NOT_GIVEN.test(name.slice(compound ? compound.length : 1).replace(/^[\p{Script=Han}]/u, c => SURNAME_SET.has(c) && name.length === 4 ? '' : c));
}

/** Unlabeled names after relationship words, plus surname + honorific forms. */
export function proposeNarrativeNames(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(RELATION_NAME)) if (looksLikeName(m[1]) && !found.includes(m[1])) found.push(m[1]);
  for (const m of text.matchAll(HONORIFIC_NAME)) if (!found.includes(m[1])) found.push(m[1]);
  return found;
}

function surnameLength(name: string): number {
  const compound = COMPOUND_SURNAMES.find(s => name.startsWith(s));
  if (compound) return compound.length;
  // Married double surnames such as 張王美珠.
  if (name.length === 4 && SURNAME_SET.has(name[0]) && SURNAME_SET.has(name[1])) return 2;
  return 1;
}

/**
 * Short forms a note may use for a known full name: 張志明 → 志明、阿明、小明.
 * Only for Han names with a two-character given name; two-character names are too ambiguous.
 */
export function shortNameVariants(name: string): string[] {
  if (!/^[\p{Script=Han}]{3,4}$/u.test(name) || !looksLikeName(name)) return [];
  const given = name.slice(surnameLength(name));
  if (given.length !== 2) return [];
  const last = given[1];
  return [...new Set([given, `小${last}`, `阿${last}`])].filter(v => v !== name);
}

const LABEL_ROLES: [RegExp, string][] = [
  [/(?:案主|個案姓名|服務對象)/u, '服務對象'], [/案父/u, '父親'], [/案母/u, '母親'], [/主要照顧者/u, '主要照顧者'], [/監護人/u, '監護人'],
  [/通報人/u, '通報人'], [/社工/u, '社工'], [/督導/u, '督導'], [/(?:兒子|女兒|長子|次子|長女|次女|案子|案女)/u, '子女'],
  [/(?:丈夫|妻子|配偶|案妻|案夫)/u, '配偶'], [/(?:哥哥|姊姊|姐姐|弟弟|妹妹|案兄|案姊|案姐|案弟|案妹)/u, '手足'],
];

/**
 * The role word written right before a name (案主：張志明 → 服務對象). Shown only as a suggestion;
 * a person still chooses the role and confirms the identity.
 */
export function suggestRole(text: string, name: string): string | undefined {
  if (!name) return undefined;
  let at = text.indexOf(name);
  while (at >= 0) {
    const before = text.slice(Math.max(0, at - 8), at).replace(/[\t ]*[:：][\t ]*$/u, '');
    for (const [re, role] of LABEL_ROLES) if (new RegExp(`${re.source}$`, 'u').test(before)) return role;
    at = text.indexOf(name, at + name.length);
  }
  return undefined;
}

/** Short forms of a person's name that appear on their own in the text and are not yet aliases. */
export function suggestAliases(text: string, name: string, aliases: string[]): { alias: string; count: number }[] {
  const out: { alias: string; count: number }[] = [];
  for (const variant of shortNameVariants(name)) {
    if (aliases.includes(variant)) continue;
    let count = 0, at = text.indexOf(variant);
    while (at >= 0) {
      // Ignore the occurrence inside the full name itself.
      const insideFull = [...Array(name.length).keys()].some(offset => at - offset >= 0 && text.startsWith(name, at - offset) && at - offset + name.length >= at + variant.length);
      if (!insideFull) count++;
      at = text.indexOf(variant, at + variant.length);
    }
    if (count) out.push({ alias: variant, count });
  }
  return out;
}
