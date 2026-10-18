// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseProfile, serializeProfile, DEFAULT_PROFILE } from '../../src/welfare/profile';

describe('institution templates contain settings, never session data', () => {
  it('roundtrips the small allowlisted policy schema', () => {
    expect(parseProfile(serializeProfile(DEFAULT_PROFILE))).toEqual(DEFAULT_PROFILE);
  });
  it('rejects files with embedded case data rather than silently persisting it', () => {
    expect(() => parseProfile(JSON.stringify({...DEFAULT_PROFILE, people: [{name:'王小明'}]}))).toThrow(/個案|欄位/);
  });
  it('rejects unsafe regex-like case prefixes and out-of-bound digit lengths', () => {
    const bad = {...DEFAULT_PROFILE, rules:[{id:'x',label:'案件號',prefix:'(a+)+',minDigits:1,maxDigits:999}]};
    expect(() => parseProfile(JSON.stringify(bad))).toThrow();
  });
  it('rejects invalid or unknown default purposes', () => {
    expect(() => parseProfile(JSON.stringify({...DEFAULT_PROFILE, purpose:'send-cloud'}))).toThrow();
  });
});
