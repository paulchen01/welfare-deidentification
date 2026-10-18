import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const page = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
describe('independent welfare entry point', () => {
  it('has its own identity and no misleading canonical', () => {
    expect(page.title).toContain('社福'); expect(page.title).toContain('去識別化');
    expect(page.querySelector('meta[name=description]')?.getAttribute('content')).toContain('人工覆核');
    expect(page.querySelector('link[rel=canonical]')).toBeNull();
  });
  it('loads only local executable resources', () => {
    for (const el of page.querySelectorAll('script[src],link[rel=stylesheet]')) expect(el.getAttribute('src') ?? el.getAttribute('href')).not.toMatch(/^https?:/);
    expect(page.querySelector('html')?.getAttribute('lang')).toBe('zh-Hant');
  });
});
