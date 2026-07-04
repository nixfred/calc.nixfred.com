/* The teach layer (Fred, 2026-07-03): a glowing popover behind an (i) on
   every advanced input. Teaches what the input is, why it exists, exactly
   where it lands in the math, and where to go deeper with real outside
   sources. Content lives in teach.json, written by the content fleet and
   link-verified before shipping. */

import TEACH from '../../data/tokenops/teach.json';

const byKey = new Map((TEACH.entries ?? []).map((e) => [e.key, e]));

export function getTeach(key) { return byKey.get(key) ?? null; }
export function hasTeach(key) { return byKey.has(key); }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function infoButton(key) {
  return hasTeach(key)
    ? `<button type="button" class="info-btn" data-teach="${esc(key)}" aria-label="Explain this input" title="What is this? The math, the why, and where to learn more">i</button>`
    : '';
}

export function openTeach(key) {
  const e = getTeach(key);
  if (!e) return;
  closeTeach();
  const overlay = document.createElement('div');
  overlay.id = 'teach-overlay';
  overlay.innerHTML = `
    <div class="teach-pop" role="dialog" aria-modal="true" aria-label="${esc(e.title)}">
      <button type="button" class="teach-close" aria-label="Close">&times;</button>
      <h3 class="teach-title">${esc(e.title)}</h3>
      <span class="teach-k">what this is</span>
      <p>${esc(e.what)}</p>
      <span class="teach-k">why it is an input</span>
      <p>${esc(e.why)}</p>
      <span class="teach-k">the math it drives</span>
      <p>${esc(e.math)}</p>
      ${e.related?.length ? `<span class="teach-k">go deeper</span>
      <div class="teach-links">${e.related.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`).join('')}</div>` : ''}
    </div>`;
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest('.teach-close')) closeTeach();
  });
  document.addEventListener('keydown', escListener);
  document.body.appendChild(overlay);
  overlay.querySelector('.teach-close').focus();
}

function escListener(ev) { if (ev.key === 'Escape') closeTeach(); }

export function closeTeach() {
  document.getElementById('teach-overlay')?.remove();
  document.removeEventListener('keydown', escListener);
}
