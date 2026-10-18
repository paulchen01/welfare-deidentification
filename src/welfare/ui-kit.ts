export function node<K extends keyof HTMLElementTagNameMap>(tag:K, className='', text?:string):HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
export function button(text:string, action:()=>void, className='button secondary'):HTMLButtonElement {
  const b = node('button',className,text); b.type = 'button'; b.onclick = action; return b;
}
export function title(eyebrow:string, text:string, description:string):HTMLElement {
  const h = node('div','section-heading'); h.append(node('p','eyebrow',eyebrow),node('h1','',text),node('p','muted',description)); return h;
}
export function field(label:string, control:HTMLElement, hint?:string):HTMLLabelElement {
  const wrap = node('label','field'); wrap.append(node('span','field-label',label),control);
  if (hint) wrap.append(node('small','muted',hint)); return wrap;
}
export function input(value='', placeholder=''):HTMLInputElement {
  const el = node('input','control'); el.value=value; el.placeholder=placeholder; return el;
}
export function select(values:{value:string;label:string}[], selected:string):HTMLSelectElement {
  const el = node('select','control');
  values.forEach((v) => { const o = node('option','',v.label); o.value=v.value; el.append(o); }); el.value=selected; return el;
}
export function checkbox(text:string, checked:boolean, action:(checked:boolean)=>void):HTMLLabelElement {
  const l=node('label','check'); const c=node('input'); c.type='checkbox'; c.checked=checked; c.onchange=()=>action(c.checked);
  l.append(c,node('span','',text)); return l;
}
export function card(heading?:string):HTMLElement {
  const c=node('section','card'); if(heading)c.append(node('h2','',heading)); return c;
}
export function pill(text:string, tone=''):HTMLElement { return node('span',`pill ${tone}`,text); }
