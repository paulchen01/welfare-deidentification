// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeRecoveryDocument, restoreExactText, encryptRecovery, decryptRecovery, parseLegacyMapping } from '../../src/welfare/vault';

describe('recovery data is separate, authenticated and exact', () => {
  const source = '王小明說：小明今天沒有到校。';
  const edits = [
    { start: 0, end: 3, replacement: '[服務對象A]' },
    { start: 5, end: 7, replacement: '[服務對象A]' },
  ];
  const output = '[服務對象A]說：[服務對象A]今天沒有到校。';
  it('restores two aliases with the same display marker without losing original wording', async () => {
    const recovery = await makeRecoveryDocument('d1', '王小明家訪.txt', 'txt', source, edits);
    expect(await restoreExactText(output, recovery)).toBe(source);
  });
  it('rejects changed AI text instead of guessing who a marker means', async () => {
    const recovery = await makeRecoveryDocument('d1', '原始.txt', 'txt', source, edits);
    await expect(restoreExactText(output.replace('今天', '明天'), recovery)).rejects.toThrow(/不相符|改寫/);
  });
  it('encrypts names and authenticates password and ciphertext', async () => {
    const doc = await makeRecoveryDocument('d1', '王小明家訪.txt', 'txt', source, edits);
    const bundle = { version: 1 as const, documents: [doc] };
    const encoded = await encryptRecovery(bundle, 'only-local-測試密碼');
    expect(encoded).not.toContain('王小明');
    expect(encoded).not.toContain('服務對象');
    expect(await decryptRecovery(encoded, 'only-local-測試密碼')).toEqual(bundle);
    await expect(decryptRecovery(encoded, 'wrong-password')).rejects.toThrow(/密碼|損壞/);
    const bad = JSON.parse(encoded);
    bad.ciphertext = (bad.ciphertext[0] === 'A' ? 'B' : 'A') + bad.ciphertext.slice(1);
    await expect(decryptRecovery(JSON.stringify(bad), 'only-local-測試密碼')).rejects.toThrow(/密碼|損壞/);
  });
  it('rejects unsupported versions and abusive KDF parameters before decrypting', async () => {
    await expect(decryptRecovery(JSON.stringify({version: 99}), 'password-password')).rejects.toThrow();
    await expect(decryptRecovery(JSON.stringify({version: 1, iterations: 999999999}), 'password-password')).rejects.toThrow();
  });
  it('rejects invalid or overlapping recovery edits', async () => {
    await expect(makeRecoveryDocument('d1', 'x.txt', 'txt', source, [{start:0,end:4,replacement:'[A]'}, {start:2,end:6,replacement:'[B]'}])).rejects.toThrow();
  });
  it('validates every legacy CSV code, category and duplicate before restoration', () => {
    expect(parseLegacyMapping('code,category,original\naabbcc,姓名,虛構人名\n')).toHaveLength(1);
    expect(() => parseLegacyMapping('code,category,original\naabbcc,姓名,甲\naabbcc,姓名,乙\n')).toThrow();
    expect(() => parseLegacyMapping('code,category,original\nbad,姓名,甲\n')).toThrow();
  });
});
