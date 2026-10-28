// ============================================================
// Knot & Thread Tales — Header "Shop" dropdown (desktop nav)
// Standalone: app.js fills the category links into .nav-cats;
// this file only handles opening / closing the menu.
// ============================================================
(function () {
  'use strict';

  function init() {
    var wrap = document.querySelector('.nav-shop');
    if (!wrap) return;
    var btn = wrap.querySelector('.nav-shop__btn');
    var closeTimer = null;
    var openedByHover = false;   // mouse hover already opened it → the click that follows must not close it again

    function isOpen() { return wrap.classList.contains('is-open'); }
    function open()  { clearTimeout(closeTimer); wrap.classList.add('is-open');  btn.setAttribute('aria-expanded', 'true'); }
    function close() { clearTimeout(closeTimer); wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }

    // Click / tap toggles (works on touch tablets, where hover doesn't exist)
    btn.addEventListener('click', function () {
      if (openedByHover) { openedByHover = false; open(); return; }
      isOpen() ? close() : open();
    });

    // Mouse hover opens it too, with a short delay on leave so it doesn't flicker
    wrap.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      if (!isOpen()) openedByHover = true;
      open();
    });
    wrap.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      openedByHover = false;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(close, 140);
    });

    // Close: Escape, click outside, focus leaves the menu, any link clicked, route change
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { close(); btn.focus(); }
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    wrap.addEventListener('focusout', function (e) {
      if (!e.relatedTarget || !wrap.contains(e.relatedTarget)) close();
    });
    wrap.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });

    // Highlight "Shop" while the visitor is on a products / category page
    function syncActive() {
      btn.classList.toggle('active', /^#\/(products|category)/.test(location.hash));
      close();
    }
    window.addEventListener('hashchange', syncActive);
    syncActive();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
