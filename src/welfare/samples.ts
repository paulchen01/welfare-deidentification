import type { WelfareSample } from './types';
/** Templated synthetic corpus, not real clients or independent human annotations. */
const domains = [
  ['family', '家庭服務', '家庭會談以溝通需求與資源連結為主，持續追蹤家庭支持。'],
  ['child', '兒少服務', '兒少會談以安全感與就學適應為主，持續追蹤照顧安排。'],
  ['elderly', '老人服務', '訪視確認生活照顧需求，與服務對象討論社區支持。'],
  ['disability', '身心障礙服務', '會談討論自主生活與支持需求，尊重服務對象的選擇。'],
  ['mental', '心理健康服務', '會談討論情緒調適與支持網絡，安排後續關懷。'],
  ['protection', '保護服務', '會談先確認安全需求，與服務對象共同擬定支持計畫。'],
];
const names = ['林怡安', '陳映竹', '黃佳穎', '歐陽志明', '李恩慈', '王淑芬', '阿美娜・海依', 'Maria Santos', '張子晴', '許文傑'];
const caregivers = ['吳秀蘭', '劉玉梅', '蔡美玲', '楊秀英', '鄭惠文', '謝芳瑜', '洪慧娟', '郭麗華', '曾雅雯', '周美真'];
export const WELFARE_SAMPLES: WelfareSample[] = domains.flatMap(([domainId, domain, context], d) => Array.from({ length: 10 }, (_, i) => {
  const id = `${domainId}-${i + 1}`, groupId = `synthetic-${id}`;
  const name = names[i], caregiver = caregivers[(i + d) % 10];
  const date = i % 2 ? `民國115年${i + 1}月${i + 11}日` : `2026-${String(i + 1).padStart(2, '0')}-${String(i + 2).padStart(2, '0')}`;
  const digits = `09${d + 1}${i}567890`;
  const phone = i % 3 === 0 ? `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : i % 3 === 1 ? digits : `+886-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  const caseId = `${['SW', 'CH', 'EL', 'DS', 'MH', 'PT'][d]}-2026-${String(i + 1).padStart(5, '0')}`;
  const institution = `${['晨光', '向陽', '松柏', '自立', '安心', '守護'][d]}服務中心`;
  const clinical = ['高血壓需定期追蹤', '氣喘需備妥藥物', '睡眠困擾持續追蹤', '慢性疼痛影響生活', '情緒困擾需支持', '身體不適已安排就醫'][d];
  const text = `【虛構${domain}範例${i + 1}】\n案號：${caseId}；案主：${name}；主要照顧者：${caregiver}。\n聯絡電話：${phone}；電子郵件：case${d}${i}@example.org。\n訪視日期：${date}；年齡：${d === 2 ? 70 + i : d === 1 ? 6 + i : 30 + i}歲。機構：${institution}；健康狀況：${clinical}。\n${context}`;
  return { id, title: `${domain}・虛構案例 ${i + 1}`, domain, text,
    people: [{ id: `${id}-client`, groupId, name, aliases: [], role: '服務對象', confirmed: true }, { id: `${id}-caregiver`, groupId, name: caregiver, aliases: [], role: '主要照顧者', confirmed: true }],
    expectedSensitive: [caseId, name, caregiver, phone, `case${d}${i}@example.org`, date, institution, clinical],
  };
}));
