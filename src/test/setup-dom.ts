// jsdom lacks a few browser APIs the app uses. These are minimal, behaviour-preserving stand-ins.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
}
// jsdom has no PointerEvent: a minimal MouseEvent subclass so drag handlers can be exercised.
(globalThis as any).PointerEvent ??= class PointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: any = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } };
class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as any).IntersectionObserver ??= IO;
// jsdom has no CSS media evaluation: implement just min-width / max-width against window.innerWidth (default 1024 → "desktop").
const evalQuery = (q: string) => [...q.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)].every(([, k, px]) => (k === 'min' ? window.innerWidth >= Number(px) : window.innerWidth <= Number(px)));
window.matchMedia = ((q: string) => {
  const l = new Set<() => void>();
  window.addEventListener('resize', () => l.forEach((f) => f()));
  return { get matches() { return evalQuery(q); }, media: q, addEventListener: (_: string, f: () => void) => l.add(f), removeEventListener: (_: string, f: () => void) => l.delete(f), addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false };
}) as any;
Element.prototype.scrollIntoView ??= function () {};
Element.prototype.scrollTo ??= function () {} as any;

import { expect } from 'vitest';
expect.extend({
  toBeInTheDocumentLike(el: Element | null) { const pass = !!el && document.body.contains(el); return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be in the document` }; },
  toHaveAttribute(el: Element, name: string, value?: string) { const has = el.hasAttribute(name); const pass = has && (value === undefined || el.getAttribute(name) === value); return { pass, message: () => `expected ${name}=${value ?? '*'} but got ${el.getAttribute(name)}` }; },
  toBeChecked(el: HTMLInputElement) { return { pass: el.checked, message: () => `expected checked=${!el.checked ? 'true' : 'false'}` }; },
  toHaveValue(el: HTMLInputElement, v: string) { return { pass: el.value === v, message: () => `expected value "${v}" but got "${el.value}"` }; },
  toBeDisabled(el: HTMLButtonElement) { return { pass: el.disabled, message: () => 'expected disabled' }; },
  toBeEnabled(el: HTMLButtonElement) { return { pass: !el.disabled, message: () => 'expected enabled' }; },
});
declare module 'vitest' { interface Assertion<T = any> { toBeInTheDocumentLike(): T; toHaveAttribute(n: string, v?: string): T; toBeChecked(): T; toHaveValue(v: string): T; toBeDisabled(): T; toBeEnabled(): T } }
