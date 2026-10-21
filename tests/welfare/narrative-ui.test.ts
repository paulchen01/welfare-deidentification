import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWelfareApp } from '../../src/welfare/app';

const hosts: HTMLElement[] = [];
function setup(text: string) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const app = mountWelfareApp(host); app.addText(text); return { host, app };
}
const buttonNamed = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text);

describe('narrative review aids in the workspace', () => {
  beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
  afterEach(() => { hosts.splice(0).forEach(h => h.remove()); vi.restoreAllMocks(); });

  it('suggests a role and a short-form alias but changes nothing until pressed, then requires confirmation again', () => {
    const { host, app } = setup('案主：張志明。張志明表示，志明下週再來。');
    const person = app.session.people.find(p => p.name === '張志明')!;
    expect(person.role).toBe('待確認'); expect(person.aliases).toEqual([]);
    expect(host.textContent).toContain('原文標示的角色：服務對象');
    buttonNamed(host, '角色設為服務對象')!.click();
    expect(person.role).toBe('服務對象'); expect(person.confirmed).toBe(false);
    buttonNamed(host, '加入別名「志明」')!.click();
    expect(person.aliases).toEqual(['志明']); expect(person.confirmed).toBe(false);
  });

  it('warns before review when people are unconfirmed', () => {
    const { host, app } = setup('案主：張志明。案母張王美珠陪同。');
    expect(host.textContent).toContain('還有 2 位人物未確認');
    for (const p of app.session.people) p.confirmed = true;
    app.render();
    expect(host.textContent).not.toContain('位人物未確認');
  });

  it('shows the rule notice once and offers category shortcuts for manual marks', () => {
    const { host, app } = setup('電話0912345678；電話0912345678；患有某病。');
    app.go('review');
    expect(host.textContent!.split('規則建議，請逐項覆核').length - 1).toBe(1);
    buttonNamed(host, '健康資訊')!.click();
    expect(host.querySelector<HTMLInputElement>('#review-manual-category')!.value).toBe('健康資訊');
    expect(host.querySelector('.review-quickbar')?.textContent).toContain('剩餘 2 項待核對');
  });
});
