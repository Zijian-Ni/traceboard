/* AURORA SKIN · Theme A「示波 / Instrument」 — traceboard effects
   Injects the mm-grid layer and the sweep scanline. Additive only. */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function boot() {
  if (!document.querySelector('.ak-grid')) {
    const grid = document.createElement('div');
    grid.className = 'ak-grid';
    grid.setAttribute('aria-hidden', 'true');
    document.body.prepend(grid);
  }
  if (!reduced && !document.querySelector('.ak-scan')) {
    const scan = document.createElement('div');
    scan.className = 'ak-scan';
    scan.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scan);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
