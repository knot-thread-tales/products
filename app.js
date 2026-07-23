// ============================================================
// Knot & Thread Tales — Application Logic
// Google Drive image support · No Cloudinary dependency
// ============================================================

'use strict';

// ─── Cache Layer ──────────────────────────────────────────────
const cache = (() => {
  const store = new Map();
  return {
    get(key) {
      const item = store.get(key);
      if (!item) return null;
      if (Date.now() > item.expires) { store.delete(key); return null; }
      return item.value;
    },
    set(key, value) {
      store.set(key, { value, expires: Date.now() + CONFIG.cache.ttlMs });
    },
    clear() { store.clear(); },
  };
})();

// ─── Google Drive Image Handler ───────────────────────────────
// Accepts: full Google Drive share URL, direct URL, or empty
function driveImg(url) {
  const placeholder = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect fill='%23f0e6d9' width='400' height='400'/%3E%3Ctext x='50%25' y='50%25' font-size='56' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%B5%3C/text%3E%3C/svg%3E`;
  if (!url) return placeholder;

  // Already a thumbnail URL — pass through
  if (url.includes('drive.google.com/thumbnail')) return url;

  // Convert share/view URL → thumbnail (works without login for public files)
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (idMatch) {
    return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w800`;
  }

  // Anything else (external URL, placeholder text) — pass through / use placeholder
  if (url.startsWith('http')) return url;
  return placeholder;
}

// Thumbnail variant for cards (smaller)
function driveThumb(url) {
  if (!url) return driveImg(url);
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/) ||
                  url.match(/id=([a-zA-Z0-9_-]{20,})/);
  if (idMatch) {
    return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w480`;
  }
  return url.startsWith('http') ? url : driveImg(url);
}

// ─── Supabase REST Client ─────────────────────────────────────
const db = (() => {
  const base = CONFIG.supabase.url + '/rest/v1';
  const headers = {
    'apikey': CONFIG.supabase.anonKey,
    'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
    'Content-Type': 'application/json',
  };

  async function query(table, params = {}) {
    const url = new URL(`${base}/${table}`);
    if (params.select) url.searchParams.set('select', params.select);
    if (params.filter) {
      Object.entries(params.filter).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    if (params.order) url.searchParams.set('order', params.order);
    if (params.limit !== undefined) url.searchParams.set('limit', params.limit);
    if (params.offset !== undefined) url.searchParams.set('offset', params.offset);

    const cacheKey = url.toString();
    const cacheable = table !== 'products' && table !== 'product_images';
    if (cacheable) {
      const cached = cache.get(cacheKey);
      if (cached) return cached;
    }

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`DB ${res.status} on ${table}`);
    const data = await res.json();
    if (cacheable) cache.set(cacheKey, data);
    return data;
  }

  function makeQuery(table) {
    const q = {
      _table: table, _select: '*', _filter: {},
      _order: null, _limit: null, _offset: null,

      select(cols) { this._select = cols; return this; },
      eq(col, val) { this._filter[col] = `eq.${val}`; return this; },
      neq(col, val) { this._filter[col] = `neq.${val}`; return this; },
      ilike(col, val) { this._filter[col] = `ilike.${val}`; return this; },
      gte(col, val) { this._filter[col] = `gte.${val}`; return this; },
      lte(col, val) { this._filter[col] = `lte.${val}`; return this; },
      in(col, vals) { this._filter[col] = `in.(${vals.join(',')})`; return this; },
      order(col, { ascending = true } = {}) { this._order = `${col}.${ascending ? 'asc' : 'desc'}`; return this; },
      limit(n) { this._limit = n; return this; },
      range(from, to) { this._offset = from; this._limit = to - from + 1; return this; },
      execute() {
        return query(this._table, {
          select: this._select,
          filter: this._filter,
          order: this._order,
          limit: this._limit,
          offset: this._offset,
        });
      },
    };
    return q;
  }

  return { from: (t) => ({ select: (c = '*') => makeQuery(t).select(c) }) };
})();

// ─── Supabase Auth Client (Google Sign-In) ─────────────────────
// This is separate from the lightweight `db` REST wrapper above, which
// stays anon-key-only and read-only. The official supabase-js client
// (loaded via CDN in index.html) is used only for: (1) OAuth session
// handling, and (2) authenticated reads/writes that need RLS's
// auth.uid() — i.e. a signed-in customer's own orders. No secret keys
// are ever used client-side.
const sb = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

// ─── Image Attachment Helper ──────────────────────────────────
// Products no longer carry a main_image column — all images live
// in product_images. This batches a single query to fetch every
// product's full image set (sorted) and attaches:
//   product.main_image  → primary (or first) image URL, for cards
//   product.images       → full sorted array, for the gallery slider
async function attachImages(products) {
  if (!products?.length) return products;
  const ids = products.map(p => p.id);
  let allImages = [];
  try {
    allImages = await db.from('product_images').select('*').in('product_id', ids).order('sort_order').execute();
  } catch { allImages = []; }

  const byProduct = new Map();
  allImages.forEach(img => {
    if (!byProduct.has(img.product_id)) byProduct.set(img.product_id, []);
    byProduct.get(img.product_id).push(img);
  });

  products.forEach(p => {
    const imgs = (byProduct.get(p.id) || []).slice().sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
    p.images = imgs;
    p.main_image = imgs[0]?.image_url || null;
  });
  return products;
}


const Router = (() => {
  const routes = new Map();
  let _current = null;

  function getPath() { return location.hash.slice(1) || '/'; }
  function navigate(path) { location.hash = path; }

  function on(path, handler) { routes.set(path, handler); }

  function dispatch() {
    const raw = getPath();
    const [path, queryStr] = raw.split('?');
    const params = new URLSearchParams(queryStr || '');
    _current = path;

    if (routes.has(path)) { routes.get(path)(params); return; }

    for (const [pattern, handler] of routes) {
      const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, '([^/]+)') + '$');
      const m = path.match(regex);
      if (m) {
        const keys = [...pattern.matchAll(/:([^/]+)/g)].map(x => x[1]);
        keys.forEach((k, i) => params.set(k, m[i + 1]));
        handler(params); return;
      }
    }
    navigate('/');
  }

  window.addEventListener('hashchange', dispatch);
  return { on, navigate, dispatch, current: () => _current };
})();

// ─── State ────────────────────────────────────────────────────
const State = {
  categories: [],
  businessSettings: null,
  paymentSettings: null,
  currentProduct: null,
  user: null,
  session: null,
  isAdmin: false,
  searchQuery: '',
  filterCategory: null,
  filterBestsellerOnly: false,
  filterPriceMin: null,
  filterPriceMax: null,
  sortBy: 'created_at',
  sortAsc: false,
  page: 0,
};

// ─── Utils ────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = (str) => String(str ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const formatPrice = (p) => `${CONFIG.business.currency}${Number(p).toLocaleString('en-IN')}`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--show'));
  setTimeout(() => { t.classList.remove('toast--show'); setTimeout(() => t.remove(), 400); }, 3500);
}

function skeleton(n = 1, cls = 'skeleton-card') {
  return Array(n).fill(`<div class="${cls}"><div class="skeleton-img skeleton-shimmer"></div><div class="skeleton-line skeleton-shimmer"></div><div class="skeleton-line skeleton-shimmer" style="width:65%"></div></div>`).join('');
}

// ─── Scroll Reveal ────────────────────────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('revealed'); revealObserver.unobserve(e.target); }
  });
}, { threshold: 0.1 });

function observeReveal(el) { el.classList.add('will-reveal'); revealObserver.observe(el); }

// ─── Confetti ────────────────────────────────────────────────
function fireConfetti() {
  const colors = ['#A66E4A','#D8B89C','#E6C9A8','#4CAF50','#f59e0b','#ec4899','#a78bfa'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    c.style.cssText = `left:${Math.random()*100}vw;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*0.8}s;animation-duration:${1.2+Math.random()*1}s;width:${6+Math.random()*6}px;height:${6+Math.random()*6}px;border-radius:${Math.random()>0.5?'50%':'2px'}`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3000);
  }
}

// ─── Floating WhatsApp Button ─────────────────────────────────
function initFloatingWhatsApp() {
  const btn = document.createElement('a');
  btn.href = `https://wa.me/${CONFIG.whatsapp.number}?text=${encodeURIComponent('Hello! I visited your website and would like to know more about your handmade products 🧶')}`;
  btn.target = '_blank';
  btn.rel = 'noopener noreferrer';
  btn.className = 'fab-whatsapp';
  btn.setAttribute('aria-label', 'Chat on WhatsApp');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.893 3.488"/></svg>
    <span class="fab-whatsapp__pulse"></span>`;
  document.body.appendChild(btn);

  // Show tooltip after 4 seconds
  setTimeout(() => {
    const tip = document.createElement('div');
    tip.className = 'fab-tooltip';
    tip.textContent = 'Chat with us! 💬';
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), 4000);
  }, 4000);
}

// ─── Live Visitor Counter (simulated, resets per session) ─────
function initLiveVisitors() {
  const el = document.getElementById('liveVisitors');
  if (!el) return;
  const base = 18 + Math.floor(Math.random() * 15);
  let count = base;
  el.textContent = count;
  setInterval(() => {
    const delta = Math.random() > 0.5 ? 1 : -1;
    count = Math.max(10, Math.min(60, count + delta));
    el.textContent = count;
  }, 5000);
}

// ─── Offer Countdown Timer ────────────────────────────────────
function initCountdown() {
  const el = document.getElementById('offerCountdown');
  if (!el) return;
  // Midnight today
  const end = new Date(); end.setHours(23, 59, 59, 0);
  function tick() {
    const now = new Date();
    let diff = Math.max(0, end - now);
    const h = Math.floor(diff / 3600000); diff %= 3600000;
    const m = Math.floor(diff / 60000); diff %= 60000;
    const s = Math.floor(diff / 1000);
    el.innerHTML = `<span>${String(h).padStart(2,'0')}</span>:<span>${String(m).padStart(2,'0')}</span>:<span>${String(s).padStart(2,'0')}</span>`;
  }
  tick();
  setInterval(tick, 1000);
}

// ─── Recently Viewed Ticker ───────────────────────────────────
const recentBuys = [
  'Priya from Hyderabad ordered Crochet Flower Bouquet',
  'Ananya from Mumbai ordered Amigurumi Bear Set',
  'Sneha from Bangalore ordered Personalised Name Keychain',
  'Divya from Chennai ordered Crochet Baby Booties',
  'Kavya from Delhi ordered Macramé Wall Hanging',
  'Pooja from Pune ordered Pet Collar (Crochet)',
  'Ritu from Kolkata ordered Custom Wedding Gifting Box',
  'Meera from Jaipur ordered Embroidery Hoop Art',
];
function initBuyTicker() {
  const el = document.getElementById('buyTicker');
  if (!el) return;
  let i = 0;
  function show() {
    el.classList.remove('ticker--in');
    el.classList.add('ticker--out');
    setTimeout(() => {
      el.textContent = '🛍️ ' + recentBuys[i % recentBuys.length];
      el.classList.remove('ticker--out');
      el.classList.add('ticker--in');
      i++;
    }, 400);
  }
  show();
  setInterval(show, 4000);
}

// ─── Image Slider / Gallery Component (Google Drive) ─────────
// Professional slider: swipe support, arrow nav, dot indicators,
// thumbnail strip, pinch/scroll-wheel + click-to-zoom, and a
// fullscreen lightbox with its own nav. Used in the product modal.
function buildGallery(images, container) {
  if (!images?.length) {
    container.innerHTML = `<div class="slider slider--empty"><img src="${driveImg('')}" alt="No image available" class="slider__img"></div>`;
    return;
  }
  const urls = images.map(i => (typeof i === 'string' ? i : i.image_url || i.url || i));
  let active = 0;
  let zoomed = false;

  container.innerHTML = `
    <div class="slider" id="productSlider">
      <div class="slider__viewport" id="sliderViewport">
        <div class="slider__track" id="sliderTrack" style="transform:translateX(0%)">
          ${urls.map((u, i) => `
            <div class="slider__slide" data-idx="${i}">
              <img src="${driveImg(u)}" alt="Product image ${i + 1}" class="slider__img"
                   loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async"
                   onerror="this.src='${driveImg('')}'">
            </div>`).join('')}
        </div>
        ${urls.length > 1 ? `
        <button class="slider__arrow slider__arrow--prev" aria-label="Previous image">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="slider__arrow slider__arrow--next" aria-label="Next image">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>` : ''}
        <button class="slider__zoom-btn" aria-label="Zoom image" id="sliderZoomBtn">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button class="slider__fullscreen-btn" aria-label="View fullscreen" id="sliderFullscreenBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
        ${urls.length > 1 ? `<div class="slider__counter"><span id="sliderCounterText">1 / ${urls.length}</span></div>` : ''}
      </div>
      ${urls.length > 1 ? `
      <div class="slider__dots" id="sliderDots">
        ${urls.map((_, i) => `<button class="slider__dot${i===0?' active':''}" data-idx="${i}" aria-label="Go to image ${i+1}"></button>`).join('')}
      </div>
      <div class="slider__thumbs" id="sliderThumbs">
        ${urls.map((u, i) => `
          <button class="thumb-item${i===0?' active':''}" data-idx="${i}" aria-label="Image ${i+1}">
            <img src="${driveThumb(u)}" alt="Thumb ${i+1}" loading="lazy" onerror="this.src='${driveImg('')}'">
          </button>`).join('')}
      </div>` : ''}
    </div>`;

  const track = container.querySelector('#sliderTrack');
  const viewport = container.querySelector('#sliderViewport');
  const counterText = container.querySelector('#sliderCounterText');
  const dots = container.querySelectorAll('.slider__dot');
  const thumbs = container.querySelectorAll('.thumb-item');
  const slides = container.querySelectorAll('.slider__slide');

  function goTo(idx, animate = true) {
    active = (idx + urls.length) % urls.length;
    track.style.transition = animate ? 'transform .4s cubic-bezier(.4,0,.2,1)' : 'none';
    track.style.transform = `translateX(-${active * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === active));
    thumbs.forEach((t, i) => {
      t.classList.toggle('active', i === active);
      if (i === active) t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    if (counterText) counterText.textContent = `${active + 1} / ${urls.length}`;
    resetZoom();
  }

  function resetZoom() {
    zoomed = false;
    slides.forEach(s => { const img = s.querySelector('.slider__img'); if (img) { img.style.transform = ''; img.classList.remove('zoomed'); } });
    viewport.classList.remove('is-zoomed');
  }

  container.querySelector('.slider__arrow--prev')?.addEventListener('click', () => goTo(active - 1));
  container.querySelector('.slider__arrow--next')?.addEventListener('click', () => goTo(active - (-1)));
  dots.forEach(d => d.addEventListener('click', () => goTo(Number(d.dataset.idx))));
  thumbs.forEach(t => t.addEventListener('click', () => goTo(Number(t.dataset.idx))));

  // ── Zoom (click-to-toggle + mousemove pan on desktop, pinch-friendly on touch) ──
  function toggleZoom(e) {
    const activeSlide = slides[active];
    const img = activeSlide?.querySelector('.slider__img');
    if (!img) return;
    zoomed = !zoomed;
    viewport.classList.toggle('is-zoomed', zoomed);
    img.classList.toggle('zoomed', zoomed);
    if (!zoomed) { img.style.transform = ''; return; }
    if (e && e.clientX) positionZoom(e, img, activeSlide);
  }

  function positionZoom(e, img, slideEl) {
    const rect = slideEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    img.style.transformOrigin = `${x}% ${y}%`;
  }

  container.querySelector('#sliderZoomBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleZoom(e); });

  slides.forEach(slideEl => {
    const img = slideEl.querySelector('.slider__img');
    slideEl.addEventListener('click', (e) => { if (!zoomed) toggleZoom(e); });
    slideEl.addEventListener('mousemove', (e) => { if (zoomed) positionZoom(e, img, slideEl); });
    slideEl.addEventListener('mouseleave', () => { if (zoomed) toggleZoom(); });
  });

  // ── Swipe support (touch) ──
  let touchStartX = 0, touchDeltaX = 0, isTouching = false;
  viewport.addEventListener('touchstart', (e) => {
    if (zoomed) return;
    isTouching = true;
    touchStartX = e.touches[0].clientX;
    track.style.transition = 'none';
  }, { passive: true });
  viewport.addEventListener('touchmove', (e) => {
    if (!isTouching || zoomed) return;
    touchDeltaX = e.touches[0].clientX - touchStartX;
    const pct = (touchDeltaX / viewport.clientWidth) * 100;
    track.style.transform = `translateX(calc(-${active * 100}% + ${pct}%))`;
  }, { passive: true });
  viewport.addEventListener('touchend', () => {
    if (!isTouching || zoomed) return;
    isTouching = false;
    if (Math.abs(touchDeltaX) > viewport.clientWidth * 0.18) {
      goTo(touchDeltaX < 0 ? active + 1 : active - 1);
    } else {
      goTo(active);
    }
    touchDeltaX = 0;
  });

  // ── Keyboard nav while gallery is focused/hovered ──
  container.setAttribute('tabindex', '0');
  container.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') goTo(active - 1);
    if (e.key === 'ArrowRight') goTo(active + 1);
  });

  // ── Fullscreen lightbox ──
  function openFullscreenAt(idx) {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';
    overlay.innerHTML = `
      <button class="fullscreen-close" aria-label="Close">&times;</button>
      ${urls.length > 1 ? `
      <button class="fullscreen-nav fullscreen-prev" aria-label="Prev">&#8592;</button>
      <button class="fullscreen-nav fullscreen-next" aria-label="Next">&#8594;</button>` : ''}
      <div class="fullscreen-img-wrap" id="fsImgWrap">
        <img src="${driveImg(urls[idx])}" alt="Fullscreen view" class="fullscreen-img" id="fsImg">
      </div>
      ${urls.length > 1 ? `<div class="fullscreen-counter">${idx + 1} / ${urls.length}</div>` : ''}`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    let cur = idx, fsZoomed = false;
    const counter = overlay.querySelector('.fullscreen-counter');
    const img = overlay.querySelector('#fsImg');
    const wrap = overlay.querySelector('#fsImgWrap');

    function fsGoTo(i) {
      cur = (i + urls.length) % urls.length;
      img.src = driveImg(urls[cur]);
      if (counter) counter.textContent = `${cur + 1} / ${urls.length}`;
      fsZoomed = false; img.classList.remove('zoomed'); img.style.transform = '';
    }
    function fsToggleZoom(e) {
      fsZoomed = !fsZoomed;
      img.classList.toggle('zoomed', fsZoomed);
      if (!fsZoomed) { img.style.transform = ''; return; }
      if (e?.clientX) {
        const rect = wrap.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        img.style.transformOrigin = `${x}% ${y}%`;
      }
    }
    wrap.addEventListener('click', (e) => { if (e.target === img) fsToggleZoom(e); });
    wrap.addEventListener('mousemove', (e) => { if (fsZoomed) fsToggleZoom.call(null); if (fsZoomed && e.clientX) {
      const rect = wrap.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      img.style.transformOrigin = `${x}% ${y}%`;
    }});

    function close() { overlay.classList.remove('active'); setTimeout(() => overlay.remove(), 280); document.removeEventListener('keydown', kh); goTo(cur, false); }
    overlay.querySelector('.fullscreen-close').onclick = close;
    overlay.querySelector('.fullscreen-prev')?.addEventListener('click', () => fsGoTo(cur - 1));
    overlay.querySelector('.fullscreen-next')?.addEventListener('click', () => fsGoTo(cur + 1));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    function kh(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') fsGoTo(cur - 1);
      if (e.key === 'ArrowRight') fsGoTo(cur + 1);
    }
    document.addEventListener('keydown', kh);

    // Swipe in fullscreen too
    let fsStartX = 0, fsDeltaX = 0;
    wrap.addEventListener('touchstart', (e) => { fsStartX = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
      fsDeltaX = e.changedTouches[0].clientX - fsStartX;
      if (Math.abs(fsDeltaX) > 60) fsGoTo(fsDeltaX < 0 ? cur + 1 : cur - 1);
    }, { passive: true });
  }

  container.querySelector('#sliderFullscreenBtn')?.addEventListener('click', (e) => { e.stopPropagation(); openFullscreenAt(active); });
  window.openFullscreen = openFullscreenAt; // exposed for any external callers

  goTo(0, false);
}

// ─── Product Card ─────────────────────────────────────────────
function productCard(p) {
  const hasOffer = p.offer_price && Number(p.offer_price) < Number(p.price);
  const discount = hasOffer ? Math.round((1 - p.offer_price / p.price) * 100) : 0;
  const displayPrice = hasOffer ? p.offer_price : p.price;
  const imgs = (p.images && p.images.length) ? p.images.map(i => i.image_url) : (p.main_image ? [p.main_image] : []);
  const multi = imgs.length > 1;

  return `
    <article class="product-card" data-id="${p.id}" tabindex="0" role="button" aria-label="View ${esc(p.name)}">
      <div class="product-card__img-wrap${multi ? ' has-multi' : ''}">
        ${multi ? `
        <div class="card-mini-slider" data-idx="0">
          ${imgs.map((u, i) => `<img src="${driveThumb(u)}" alt="${esc(p.name)} photo ${i+1}" class="card-mini-slider__img${i===0?' active':''}" loading="lazy" decoding="async" data-idx="${i}" onerror="this.src='${driveImg('')}'">`).join('')}
        </div>
        <div class="card-mini-dots">
          ${imgs.map((_, i) => `<span class="card-mini-dot${i===0?' active':''}"></span>`).join('')}
        </div>
        <span class="badge-image-count">📷 ${imgs.length}</span>` : `
        <img src="${driveThumb(imgs[0] || '')}" alt="${esc(p.name)}" class="product-card__img" loading="lazy" decoding="async"
             onerror="this.src='${driveImg('')}'">`}
        <div class="product-card__badges">
          <span class="badge badge--handmade">Handmade</span>
          ${p.is_bestseller ? '<span class="badge badge--bestseller">⭐ Bestseller</span>' : ''}
          ${p.is_customizable ? '<span class="badge badge--custom">✏️ Custom</span>' : ''}
          ${hasOffer ? `<span class="badge badge--off">−${discount}%</span>` : ''}
        </div>
        ${!p.in_stock ? '<div class="product-card__oos">Out of Stock</div>' : ''}
        <div class="product-card__shine"></div>
        <div class="product-card__quick">
          <button class="quick-view-btn" data-id="${p.id}" aria-label="Quick view">👁 Quick View</button>
        </div>
      </div>
      <div class="product-card__body">
        <p class="product-card__code">${esc(p.product_code || 'KTT-' + p.id)}</p>
        <h3 class="product-card__name">${esc(p.name)}</h3>
        <div class="product-card__pricing">
          <span class="product-card__price">${formatPrice(displayPrice)}</span>
          ${hasOffer ? `<span class="product-card__orig">${formatPrice(p.price)}</span>` : ''}
        </div>
        <button class="btn btn--primary btn--sm product-card__order ${!p.in_stock ? 'btn--disabled' : ''}"
                data-id="${p.id}" ${!p.in_stock ? 'disabled aria-disabled="true"' : ''}>
          💬 ${p.in_stock ? 'Order via WhatsApp' : 'Out of Stock'}
        </button>
      </div>
    </article>`;
}

// Auto-advance the mini image slider on card hover (desktop) — gives
// a quick multi-photo preview without opening the full product modal.
function initCardMiniSliders(scope = document) {
  scope.querySelectorAll('.card-mini-slider').forEach(slider => {
    const card = slider.closest('.product-card');
    const imgs = slider.querySelectorAll('.card-mini-slider__img');
    const dots = card.querySelectorAll('.card-mini-dot');
    if (imgs.length < 2) return;
    let idx = 0, timer = null;

    function show(i) {
      idx = i;
      imgs.forEach((im, k) => im.classList.toggle('active', k === idx));
      dots.forEach((d, k) => d.classList.toggle('active', k === idx));
    }
    card.addEventListener('mouseenter', () => {
      timer = setInterval(() => show((idx + 1) % imgs.length), 900);
    });
    card.addEventListener('mouseleave', () => {
      clearInterval(timer);
      show(0);
    });
  });
}



// ─── WhatsApp Order Modal ─────────────────────────────────────
function openOrderModal(product) {
  State.currentProduct = product;
  const m = document.getElementById('orderModal');
  if (!m) return;
  m.querySelector('.order-product-name').textContent = product.name;
  m.querySelector('.order-product-code').textContent = product.product_code || 'KTT-' + product.id;
  m.querySelector('.order-product-price').textContent = formatPrice(product.offer_price || product.price);
  m.querySelector('#orderForm').reset();
  openModal('orderModal');
}

async function submitOrder(e) {
  e.preventDefault();
  const form = e.target;
  const p = State.currentProduct;
  if (!p) return;

  const name    = form.customerName.value.trim();
  const phone   = form.customerPhone.value.trim();
  const address = form.customerAddress.value.trim();
  const pincode = form.customerPincode.value.trim();
  const qty     = Number(form.customerQty.value.trim()) || 1;
  const notes   = form.customizationNotes.value.trim();
  const unitPrice = p.offer_price || p.price;
  const amount  = unitPrice * qty;
  const display = formatPrice(unitPrice);

  const msg = encodeURIComponent(
`Hello Knot & Thread Tales! 🌸

I would like to place an order.

*Product Details:*
Product Code: ${p.product_code || 'KTT-' + p.id}
Product Name: ${p.name}
Price: ${display}

*Customer Details:*
Name: ${name}
Phone: ${phone}
Address: ${address}
Pincode: ${pincode}
Quantity: ${qty}

*Customization:*
${notes || 'None'}

Please confirm availability and payment instructions. 🙏`
  );

  // Save to order history if the customer is signed in (guest checkout still
  // works via WhatsApp alone — this just adds order tracking on top).
  if (State.user) {
    try {
      await sb.from('orders').insert({
        user_id: State.user.id,
        product_id: p.id,
        product_name: p.name,
        product_code: p.product_code || 'KTT-' + p.id,
        qty, unit_price: unitPrice, total_amount: amount,
        customer_name: name, customer_phone: phone,
        customer_address: address, customer_pincode: pincode,
        customization_notes: notes,
        order_status: 'pending', payment_status: 'pending',
      });
    } catch { /* non-fatal — WhatsApp order still proceeds */ }
  }

  closeModal('orderModal');
  fireConfetti();
  showToast('Order sent! Opening WhatsApp… 🎉');

  setTimeout(() => {
    openPaymentModal(amount);
    window.open(`https://wa.me/${CONFIG.whatsapp.number}?text=${msg}`, '_blank');
  }, 700);
}

// ─── Payment Modal ────────────────────────────────────────────
async function openPaymentModal(amount) {
  let ps = State.paymentSettings;
  if (!ps) {
    try {
      const data = await db.from('payment_settings').select('*').limit(1).execute();
      ps = data[0] || { upi_id: CONFIG.upi.id, merchant_name: CONFIG.upi.name, qr_image: null };
      State.paymentSettings = ps;
    } catch {
      ps = { upi_id: CONFIG.upi.id, merchant_name: CONFIG.upi.name, qr_image: null };
    }
  }

  const m = document.getElementById('paymentModal');
  if (!m) return;
  m.querySelector('.payment-upi-id').textContent = ps.upi_id;
  m.querySelector('.payment-merchant').textContent = ps.merchant_name;

  const amtEl = m.querySelector('.payment-amount-due');
  if (amtEl) amtEl.textContent = amount ? `Amount Due: ${formatPrice(amount)}` : '';

  const amtParam = amount ? `&am=${encodeURIComponent(amount)}` : '';
  const upiUri = `upi://pay?pa=${encodeURIComponent(ps.upi_id)}&pn=${encodeURIComponent(ps.merchant_name)}${amtParam}&cu=INR&tn=${encodeURIComponent('Knot & Thread Tales order')}`;

  const qrImg = m.querySelector('.payment-qr');
  if (qrImg) {
    qrImg.src = ps.qr_image
      ? driveImg(ps.qr_image)
      : `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(upiUri)}`;
  }
  const payBtn = m.querySelector('#upiPayNowBtn');
  if (payBtn) payBtn.href = upiUri;

  openModal('paymentModal');
}

function copyUPI() {
  const upi = document.querySelector('.payment-upi-id')?.textContent;
  if (!upi) return;
  navigator.clipboard.writeText(upi)
    .then(() => showToast('✅ UPI ID copied!'))
    .catch(() => showToast('UPI: ' + upi));
}

function downloadQR() {
  const img = document.querySelector('.payment-qr');
  if (!img) return;
  const a = document.createElement('a');
  a.href = img.src; a.download = 'ktt-upi-qr.png'; a.click();
}

function shareQR() {
  if (navigator.share) {
    navigator.share({ title: 'Pay Knot & Thread Tales', text: `UPI: ${State.paymentSettings?.upi_id}`, url: location.href }).catch(() => {});
  } else { copyUPI(); }
}

// ─── Modal System ─────────────────────────────────────────────
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.setAttribute('aria-hidden', 'false');
  m.classList.add('modal--open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => m.querySelector('.modal-close')?.focus(), 100);
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.setAttribute('aria-hidden', 'true');
  m.classList.remove('modal--open');
  if (!$$('.modal--open').length) document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal--open').forEach(m => closeModal(m.id));
});

// ─── App Init ─────────────────────────────────────────────────
async function initApp() {
  try {
    State.categories = await db.from('categories').select('id,name,slug,icon,sort_order').order('sort_order').execute();
  } catch { State.categories = []; }

  try {
    const bs = await db.from('business_settings').select('*').limit(1).execute();
    State.businessSettings = bs[0] || null;
  } catch { State.businessSettings = null; }

  renderNav();
  await initAuth();

  Router.on('/', renderHome);
  Router.on('/products', renderProductsPage);
  Router.on('/best-sellers', renderBestSellersPage);
  Router.on('/my-orders', renderMyOrdersPage);
  Router.on('/admin', renderAdminPage);
  Router.on('/search', renderSearchPage);
  Router.on('/about', renderAboutPage);
  Router.on('/faq', renderFaqPage);
  Router.on('/contact', renderContactPage);
  Router.on('/reviews', renderReviewsPage);
  Router.on('/privacy', renderPrivacyPage);
  Router.on('/terms', renderTermsPage);
  Router.on('/category/:slug', renderCategoryPage);

  Router.dispatch();

  document.addEventListener('click', globalClickHandler);

  initMobileMenu();
  initSearchBar();
  initScrollHeader();
  initFloatingWhatsApp();
  initBuyTicker();
}

function globalClickHandler(e) {
  if (!e.target.closest('.auth-user')) {
    $$('.auth-user.is-open').forEach(el => el.classList.remove('is-open'));
  }

  const orderBtn = e.target.closest('.product-card__order, .btn--order');
  if (orderBtn && !orderBtn.disabled) { handleOrderClick(orderBtn.dataset.id); return; }

  const quickBtn = e.target.closest('.quick-view-btn');
  if (quickBtn) { e.stopPropagation(); openProductModal(quickBtn.dataset.id); return; }

  const card = e.target.closest('.product-card');
  if (card && !e.target.closest('button')) { openProductModal(card.dataset.id); return; }

  const modal = e.target.closest('.modal');
  if (modal && e.target === modal) { closeModal(modal.id); return; }

  const navLink = e.target.closest('[data-route]');
  if (navLink) { e.preventDefault(); Router.navigate(navLink.dataset.route); closeMobileMenu(); return; }
}

// ─── Auth (Google Sign-In via Supabase) ────────────────────────
async function initAuth() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    State.session = session;
    State.user = session?.user || null;
  } catch { State.session = null; State.user = null; }
  await refreshAdminStatus();
  renderAuthWidget();

  sb.auth.onAuthStateChange(async (_event, session) => {
    State.session = session;
    State.user = session?.user || null;
    await refreshAdminStatus();
    renderAuthWidget();
    if (Router.current() === '/my-orders') renderMyOrdersPage();
    if (Router.current() === '/admin') renderAdminPage();
  });
}

async function refreshAdminStatus() {
  if (!State.user) { State.isAdmin = false; return; }
  try {
    const { data } = await sb.from('admin_users').select('user_id').eq('user_id', State.user.id).maybeSingle();
    State.isAdmin = !!data;
  } catch { State.isAdmin = false; }
}

window.signInWithGoogle = () => {
  sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
};

window.signOut = async () => {
  await sb.auth.signOut();
  State.user = null; State.session = null;
  renderAuthWidget();
  showToast('Signed out 👋');
  Router.navigate('/');
};

function renderAuthWidget() {
  const targets = [document.getElementById('authWidget'), document.getElementById('authWidgetMobile')];
  const user = State.user;
  let html;
  if (user) {
    const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Account';
    const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
    const initial = name.charAt(0).toUpperCase();
    html = `
      <div class="auth-user" onclick="this.classList.toggle('is-open')">
        ${avatar ? `<img class="auth-user__avatar" src="${esc(avatar)}" alt="">` : `<span class="auth-user__avatar">${initial}</span>`}
        <span class="auth-user__name">${esc(name)}</span>
        <div class="auth-user__menu">
          <a href="#/my-orders" data-route="/my-orders">📦 My Orders</a>
          ${State.isAdmin ? `<a href="#/admin" data-route="/admin">🛠 Admin Panel</a>` : ''}
          <button type="button" onclick="event.stopPropagation();signOut()">🚪 Sign Out</button>
        </div>
      </div>`;
  } else {
    html = `<button class="btn btn--sm btn--outline" onclick="signInWithGoogle()">Sign in</button>`;
  }
  targets.forEach(t => { if (t) t.innerHTML = html; });
}

// ─── Page: My Orders ────────────────────────────────────────────
async function renderMyOrdersPage() {
  setPage('my-orders-page');
  const signedOutMsg = document.getElementById('myOrdersSignedOut');
  const list = document.getElementById('myOrdersList');
  if (!list) return;

  if (!State.user) {
    if (signedOutMsg) signedOutMsg.hidden = false;
    list.innerHTML = '';
    return;
  }
  if (signedOutMsg) signedOutMsg.hidden = true;

  list.innerHTML = skeleton(3);
  try {
    const { data, error } = await sb.from('orders').select('*')
      .eq('user_id', State.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    list.innerHTML = data.length
      ? data.map(orderCard).join('')
      : '<p class="empty-msg">No orders yet — once you place an order it\'ll show up here.</p>';
  } catch {
    list.innerHTML = '<p class="empty-msg">Could not load your orders. Please try again shortly.</p>';
  }
}

function orderCard(o) {
  const status = (o.order_status || 'pending').toLowerCase();
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const date = o.created_at
    ? new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return `
    <div class="order-card">
      <div class="order-card__info">
        <h3>${esc(o.product_name)}${o.qty > 1 ? ` × ${o.qty}` : ''}</h3>
        <p>${esc(o.product_code || '')} · Ordered ${esc(date)}</p>
      </div>
      <div class="order-card__meta">
        <p class="order-card__price">${formatPrice(o.total_amount)}</p>
        <span class="order-status order-status--${esc(status)}">${esc(label)}</span>
      </div>
    </div>`;
}

// ─── Admin Panel ────────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'products',   label: '🧶 Products',   render: renderAdminProducts },
  { id: 'orders',     label: '📦 Orders',      render: renderAdminOrders },
  { id: 'categories', label: '🗂 Categories',  render: () => renderGenericAdmin('categories', { title: 'Categories', orderBy: 'name' }) },
  { id: 'reviews',    label: '⭐ Reviews',     render: () => renderGenericAdmin('reviews', { title: 'Reviews', orderBy: 'created_at', orderDesc: true }) },
  { id: 'featured',   label: '✨ Featured',    render: () => renderGenericAdmin('featured_products', { title: 'Featured Products', orderBy: 'sort_order' }) },
  { id: 'faqs',       label: '❓ FAQs',        render: () => renderGenericAdmin('faqs', { title: 'FAQs', orderBy: 'sort_order' }) },
  { id: 'testimonials', label: '💬 Testimonials', render: () => renderGenericAdmin('testimonials', { title: 'Testimonials', orderBy: 'sort_order' }) },
  { id: 'payment',    label: '💳 Payment Settings', render: () => renderGenericAdmin('payment_settings', { title: 'Payment Settings', singleton: true }) },
  { id: 'business',   label: '🏢 Business Settings', render: () => renderGenericAdmin('business_settings', { title: 'Business Settings', singleton: true }) },
];
let currentAdminTab = 'products';

async function renderAdminPage() {
  setPage('admin-page');
  const restricted = document.getElementById('adminRestricted');
  const shell = document.getElementById('adminShell');
  if (!State.user || !State.isAdmin) {
    restricted.hidden = false;
    shell.hidden = true;
    return;
  }
  restricted.hidden = true;
  shell.hidden = false;
  renderAdminTabs();
  await switchAdminTab(currentAdminTab);
}

function renderAdminTabs() {
  const nav = document.getElementById('adminTabs');
  nav.innerHTML = ADMIN_TABS.map(t =>
    `<button class="admin-tab ${t.id === currentAdminTab ? 'is-active' : ''}" data-admin-tab="${t.id}">${t.label}</button>`
  ).join('');
  nav.onclick = (e) => {
    const btn = e.target.closest('[data-admin-tab]');
    if (btn) switchAdminTab(btn.dataset.adminTab);
  };
}

async function switchAdminTab(id) {
  currentAdminTab = id;
  renderAdminTabs();
  const content = document.getElementById('adminContent');
  content.innerHTML = skeleton(2);
  const tab = ADMIN_TABS.find(t => t.id === id);
  if (tab) await tab.render();
}

// ─── Generic dynamic-schema CRUD (categories, faqs, testimonials,
//     featured_products, reviews, payment_settings, business_settings) ───
// Field list is detected from the first row returned, rather than
// hardcoded — keeps this working even if the exact columns differ from
// what's assumed elsewhere, and adapts automatically if columns are
// added later in Supabase.
const READONLY_FIELDS = ['id', 'created_at', 'updated_at'];

async function renderGenericAdmin(table, opts) {
  const content = document.getElementById('adminContent');
  let rows;
  try {
    let q = sb.from(table).select('*');
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: !opts.orderDesc });
    const { data, error } = await q;
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    content.innerHTML = `<p class="admin-empty">Couldn't load ${esc(opts.title)}: ${esc(err.message || 'unknown error')}</p>`;
    return;
  }

  const fields = rows.length ? Object.keys(rows[0]).filter(k => !READONLY_FIELDS.includes(k)) : [];

  content.innerHTML = `
    <div class="admin-toolbar">
      <h2>${esc(opts.title)}</h2>
      ${(!opts.singleton || rows.length === 0) ? `<button class="btn btn--sm btn--primary" onclick="openGenericForm('${table}', null, ${JSON.stringify(fields).replace(/"/g, '&quot;')})">+ Add New</button>` : ''}
    </div>
    <div id="genericFormSlot"></div>
    ${rows.length ? `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>${fields.slice(0, 5).map(f => `<th>${esc(f)}</th>`).join('')}<th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                ${fields.slice(0, 5).map(f => `<td class="wrap">${esc(formatCellValue(r[f]))}</td>`).join('')}
                <td class="admin-row-actions">
                  <button onclick='openGenericForm(${JSON.stringify(table)}, ${JSON.stringify(r).replace(/'/g, "&#39;")}, ${JSON.stringify(fields)})'>Edit</button>
                  <button class="danger" onclick="deleteGenericRow('${table}', '${r.id}')">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<p class="admin-empty">No rows yet — click "Add New" to create the first one.</p>`}
  `;
}

function formatCellValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✅' : '—';
  const s = String(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

window.openGenericForm = (table, row, fields) => {
  const slot = document.getElementById('genericFormSlot');
  const data = row || {};
  slot.innerHTML = `
    <div class="admin-form-card">
      <h3>${row ? 'Edit' : 'Add'} ${esc(table)}</h3>
      <div class="form-row" style="grid-template-columns:1fr 1fr;">
        ${fields.map(f => {
          const val = data[f];
          if (typeof val === 'boolean' || /^(is_|active$)/.test(f)) {
            return `<div class="form-group"><label><input type="checkbox" id="gf_${f}" ${val ? 'checked' : ''}> ${esc(f)}</label></div>`;
          }
          const long = typeof val === 'string' && val.length > 60 || /description|answer|text|notes|address/.test(f);
          return `<div class="form-group"><label for="gf_${f}">${esc(f)}</label>${
            long
              ? `<textarea id="gf_${f}">${esc(val ?? '')}</textarea>`
              : `<input type="${typeof val === 'number' ? 'number' : 'text'}" id="gf_${f}" value="${esc(val ?? '')}">`
          }</div>`;
        }).join('')}
      </div>
      <div class="admin-row-actions">
        <button class="btn btn--primary btn--sm" onclick='saveGenericRow(${JSON.stringify(table)}, ${row ? `"${row.id}"` : 'null'}, ${JSON.stringify(fields)})'>Save</button>
        <button class="btn btn--outline btn--sm" onclick="document.getElementById('genericFormSlot').innerHTML=''">Cancel</button>
      </div>
    </div>`;
};

window.saveGenericRow = async (table, id, fields) => {
  const payload = {};
  fields.forEach(f => {
    const el = document.getElementById(`gf_${f}`);
    if (!el) return;
    payload[f] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
  });
  try {
    const { error } = id
      ? await sb.from(table).update(payload).eq('id', id)
      : await sb.from(table).insert(payload);
    if (error) throw error;
    cache.clear();
    showToast('Saved ✅');
    const tab = ADMIN_TABS.find(t => t.id === currentAdminTab);
    if (tab) await tab.render();
  } catch (err) {
    showToast(err.message || 'Save failed', 'error');
  }
};

window.deleteGenericRow = async (table, id) => {
  if (!confirm('Delete this row? This cannot be undone.')) return;
  try {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
    cache.clear();
    showToast('Deleted');
    const tab = ADMIN_TABS.find(t => t.id === currentAdminTab);
    if (tab) await tab.render();
  } catch (err) {
    showToast(err.message || 'Delete failed', 'error');
  }
};

// ─── Products admin (dedicated — most important table) ─────────
async function renderAdminProducts() {
  const content = document.getElementById('adminContent');
  let products;
  try {
    const { data, error } = await sb.from('products').select('*').order('name');
    if (error) throw error;
    products = data || [];
  } catch (err) {
    content.innerHTML = `<p class="admin-empty">Couldn't load products: ${esc(err.message)}</p>`;
    return;
  }

  content.innerHTML = `
    <div class="admin-toolbar">
      <h2>Products (${products.length})</h2>
      <button class="btn btn--sm btn--primary" onclick="openProductForm()">+ Add Product</button>
    </div>
    <div id="productFormSlot"></div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Code</th><th>Name</th><th>Price</th><th>Offer</th><th>Bestseller</th><th>In Stock</th><th>Actions</th></tr></thead>
        <tbody>
          ${products.map(p => `
            <tr>
              <td>${esc(p.product_code || '')}</td>
              <td class="wrap">${esc(p.name)}</td>
              <td>${formatPrice(p.price)}</td>
              <td>${p.offer_price ? formatPrice(p.offer_price) : '—'}</td>
              <td>${p.is_bestseller ? '⭐' : '—'}</td>
              <td>${p.in_stock ? '✅' : '❌'}</td>
              <td class="admin-row-actions">
                <button onclick="openProductForm(${p.id})">Edit</button>
                <button class="danger" onclick="deleteProduct(${p.id})">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

window.openProductForm = async (id) => {
  const slot = document.getElementById('productFormSlot');
  slot.innerHTML = skeleton(1);

  let product = null, images = [];
  if (id) {
    const [{ data: p }, { data: imgs }] = await Promise.all([
      sb.from('products').select('*').eq('id', id).single(),
      sb.from('product_images').select('*').eq('product_id', id).order('sort_order'),
    ]);
    product = p; images = imgs || [];
  }
  const d = product || {};
  const catOptions = State.categories.map(c => `<option value="${c.id}" ${d.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  slot.innerHTML = `
    <div class="admin-form-card">
      <h3>${id ? 'Edit' : 'Add'} Product</h3>
      <div class="form-row">
        <div class="form-group"><label>Product Code</label><input type="text" id="pf_product_code" value="${esc(d.product_code ?? '')}"></div>
        <div class="form-group"><label>Name</label><input type="text" id="pf_name" value="${esc(d.name ?? '')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Category</label><select id="pf_category_id"><option value="">— none —</option>${catOptions}</select></div>
        <div class="form-group"><label>Delivery Days (e.g. 3-5)</label><input type="text" id="pf_delivery_days" value="${esc(d.delivery_days ?? '')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Price (₹)</label><input type="number" id="pf_price" value="${esc(d.price ?? '')}"></div>
        <div class="form-group"><label>Offer Price (₹)</label><input type="number" id="pf_offer_price" value="${esc(d.offer_price ?? '')}"></div>
      </div>
      <div class="form-group"><label>Description</label><textarea id="pf_description">${esc(d.description ?? '')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Materials</label><input type="text" id="pf_materials" value="${esc(d.materials ?? '')}"></div>
        <div class="form-group"><label>Dimensions</label><input type="text" id="pf_dimensions" value="${esc(d.dimensions ?? '')}"></div>
      </div>
      <div class="form-group"><label>Wash Care</label><input type="text" id="pf_wash_care" value="${esc(d.wash_care ?? '')}"></div>
      <div class="form-row" style="grid-template-columns:repeat(3,auto);gap:24px;">
        <label><input type="checkbox" id="pf_is_bestseller" ${d.is_bestseller ? 'checked' : ''}> Bestseller</label>
        <label><input type="checkbox" id="pf_is_customizable" ${d.is_customizable ? 'checked' : ''}> Customizable</label>
        <label><input type="checkbox" id="pf_in_stock" ${d.in_stock !== false ? 'checked' : ''}> In Stock</label>
      </div>

      <h3 style="margin-top:20px;">Images</h3>
      <div id="pfImages">
        ${images.map(img => productImageRowHtml(img)).join('') || ''}
      </div>
      <button type="button" class="btn btn--outline btn--sm" onclick="addProductImageRow()">+ Add Image Row</button>

      <div class="admin-row-actions" style="margin-top:18px;">
        <button class="btn btn--primary btn--sm" onclick="saveProduct(${id ?? 'null'})">Save Product</button>
        <button class="btn btn--outline btn--sm" onclick="document.getElementById('productFormSlot').innerHTML=''">Cancel</button>
      </div>
    </div>`;
};

function productImageRowHtml(img = {}) {
  const rid = img.id || ('new_' + Math.random().toString(36).slice(2, 8));
  return `
    <div class="admin-image-row" data-image-row="${rid}" data-image-id="${img.id ?? ''}">
      <input type="text" placeholder="Google Drive image URL" class="img-url" value="${esc(img.image_url ?? '')}">
      <input type="text" placeholder="Alt text" class="img-alt" value="${esc(img.alt_text ?? '')}">
      <label style="font-size:.78rem;"><input type="checkbox" class="img-primary" ${img.is_primary ? 'checked' : ''}> Primary</label>
      <input type="number" placeholder="Order" class="img-sort" value="${esc(img.sort_order ?? 1)}">
      <button type="button" class="icon-btn" onclick="this.closest('[data-image-row]').remove()" title="Remove">✕</button>
    </div>`;
}

window.addProductImageRow = () => {
  document.getElementById('pfImages').insertAdjacentHTML('beforeend', productImageRowHtml());
};

window.saveProduct = async (id) => {
  const val = (sel) => document.getElementById(sel)?.value;
  const payload = {
    product_code: val('pf_product_code'),
    name: val('pf_name'),
    category_id: val('pf_category_id') ? Number(val('pf_category_id')) : null,
    delivery_days: val('pf_delivery_days'),
    price: Number(val('pf_price')) || 0,
    offer_price: val('pf_offer_price') ? Number(val('pf_offer_price')) : null,
    description: val('pf_description'),
    materials: val('pf_materials'),
    dimensions: val('pf_dimensions'),
    wash_care: val('pf_wash_care'),
    is_bestseller: document.getElementById('pf_is_bestseller').checked,
    is_customizable: document.getElementById('pf_is_customizable').checked,
    in_stock: document.getElementById('pf_in_stock').checked,
  };

  try {
    let productId = id;
    if (id) {
      const { error } = await sb.from('products').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('products').insert(payload).select('id').single();
      if (error) throw error;
      productId = data.id;
    }

    // Sync image rows: update existing, insert new, and delete rows removed from the form.
    const rows = [...document.querySelectorAll('[data-image-row]')];
    const keepIds = [];
    for (const row of rows) {
      const imageId = row.dataset.imageId;
      const imgPayload = {
        product_id: productId,
        image_url: row.querySelector('.img-url').value,
        alt_text: row.querySelector('.img-alt').value,
        is_primary: row.querySelector('.img-primary').checked,
        sort_order: Number(row.querySelector('.img-sort').value) || 1,
      };
      if (!imgPayload.image_url) continue;
      if (imageId) {
        await sb.from('product_images').update(imgPayload).eq('id', imageId);
        keepIds.push(imageId);
      } else {
        const { data } = await sb.from('product_images').insert(imgPayload).select('id').single();
        if (data) keepIds.push(String(data.id));
      }
    }
    if (id) {
      const { data: existing } = await sb.from('product_images').select('id').eq('product_id', productId);
      const toDelete = (existing || []).filter(r => !keepIds.includes(String(r.id))).map(r => r.id);
      if (toDelete.length) await sb.from('product_images').delete().in('id', toDelete);
    }

    showToast('Product saved ✅');
    cache.clear();
    document.getElementById('productFormSlot').innerHTML = '';
    await renderAdminProducts();
  } catch (err) {
    showToast(err.message || 'Save failed', 'error');
  }
};

window.deleteProduct = async (id) => {
  if (!confirm('Delete this product and its images? This cannot be undone.')) return;
  try {
    await sb.from('product_images').delete().eq('product_id', id);
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) throw error;
    cache.clear();
    showToast('Product deleted');
    await renderAdminProducts();
  } catch (err) {
    showToast(err.message || 'Delete failed', 'error');
  }
};

// ─── Orders admin (view all, update status) ─────────────────────
async function renderAdminOrders() {
  const content = document.getElementById('adminContent');
  let orders;
  try {
    const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    orders = data || [];
  } catch (err) {
    content.innerHTML = `<p class="admin-empty">Couldn't load orders: ${esc(err.message)}</p>`;
    return;
  }

  const statusOpts = (val, options) => options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('');

  content.innerHTML = `
    <div class="admin-toolbar"><h2>Orders (${orders.length})</h2></div>
    ${orders.length ? `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Date</th><th>Customer</th><th>Product</th><th>Amount</th><th>Order Status</th><th>Payment</th></tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td>${o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN') : ''}</td>
              <td class="wrap">${esc(o.customer_name)}<br><span style="color:var(--c-text-3);font-size:.78rem;">${esc(o.customer_phone)}</span></td>
              <td class="wrap">${esc(o.product_name)}${o.qty > 1 ? ` ×${o.qty}` : ''}</td>
              <td>${formatPrice(o.total_amount)}</td>
              <td><select onchange="updateOrderField(${o.id}, 'order_status', this.value)">${statusOpts(o.order_status, ['pending','confirmed','shipped','delivered','cancelled'])}</select></td>
              <td><select onchange="updateOrderField(${o.id}, 'payment_status', this.value)">${statusOpts(o.payment_status, ['pending','paid','failed','refunded'])}</select></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<p class="admin-empty">No orders yet.</p>`}`;
}

window.updateOrderField = async (id, field, value) => {
  try {
    const { error } = await sb.from('orders').update({ [field]: value }).eq('id', id);
    if (error) throw error;
    cache.clear();
    showToast('Order updated ✅');
  } catch (err) {
    showToast(err.message || 'Update failed', 'error');
  }
};

async function handleOrderClick(productId) {
  try {
    let p = State.currentProduct?.id == productId ? State.currentProduct : null;
    if (!p) {
      const d = await db.from('products').select('*').eq('id', productId).limit(1).execute();
      p = d[0];
    }
    if (p) openOrderModal(p);
  } catch { showToast('Could not load product. Try again.', 'error'); }
}

// ─── Nav ──────────────────────────────────────────────────────
function renderNav() {
  const nav = document.getElementById('mainNav');
  if (!nav) return;
  const cats = State.categories.slice(0, 6);
  nav.querySelector('.nav-cats').innerHTML = cats.map(c =>
    `<li><a href="#/category/${esc(c.slug)}" data-route="/category/${esc(c.slug)}" class="nav-link">${esc(c.icon || '')} ${esc(c.name)}</a></li>`
  ).join('');
}

function initMobileMenu() {
  const btn = document.getElementById('menuToggle');
  const drawer = document.getElementById('mobileDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (!btn || !drawer) return;
  btn.addEventListener('click', () => {
    const open = drawer.classList.toggle('drawer--open');
    btn.setAttribute('aria-expanded', open);
    backdrop?.classList.toggle('is-visible', open);
    document.body.style.overflow = open ? 'hidden' : '';
  });
  drawer.querySelector('.drawer-close')?.addEventListener('click', closeMobileMenu);
  // Close on outside click (clicking the dimmed backdrop)
  backdrop?.addEventListener('click', closeMobileMenu);
  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('drawer--open')) closeMobileMenu();
  });
}

function closeMobileMenu() {
  document.getElementById('mobileDrawer')?.classList.remove('drawer--open');
  document.getElementById('drawerBackdrop')?.classList.remove('is-visible');
  document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

function initScrollHeader() {
  const h = document.getElementById('siteHeader');
  if (!h) return;
  window.addEventListener('scroll', () => {
    h.classList.toggle('header--scrolled', window.scrollY > 40);
  }, { passive: true });
}

function initSearchBar() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  const go = debounce((v) => { if (v.length >= 2) Router.navigate(`/search?q=${encodeURIComponent(v)}`); }, CONFIG.search.debounceMs);
  input.addEventListener('input', e => go(e.target.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.length >= 1) Router.navigate(`/search?q=${encodeURIComponent(input.value)}`);
  });
}

// ─── Page: Home ───────────────────────────────────────────────
async function renderHome() {
  setPage('home');
  await Promise.all([
    renderHero(),
    renderFeaturedProducts(),
    renderTrendingProducts(),
    renderCategories(),
    renderTestimonials(),
    renderFAQPreview(),
  ]);
  initParallax();
  initInstagramSection();
  initLiveVisitors();
  initCountdown();
}

async function renderHero() {
  const hero = document.getElementById('hero');
  if (!hero) return;
  hero.innerHTML = `
    <div class="hero__bg"><div class="hero__particles" id="heroParticles"></div></div>
    <div class="container hero__inner">
      <div class="hero__content">
        <div class="hero-announce">
          <span class="hero-announce__dot"></span>
          <span id="buyTicker" class="ticker--in">🛍️ Loading…</span>
        </div>
        <span class="hero__eyebrow">✨ Handcrafted with Love</span>
        <h1 class="hero__title">Where Every Stitch<br>Tells a <em>Story</em></h1>
        <p class="hero__sub">Premium crochet, embroidery &amp; personalized gifts — crafted just for you, shipped pan India.</p>
        <div class="hero__offer">
          <span class="hero__offer-label">🔥 Today's offer ends in</span>
          <span id="offerCountdown" class="hero__countdown"></span>
        </div>
        <div class="hero__actions">
          <a href="#/products" data-route="/products" class="btn btn--primary btn--lg">Explore Collection</a>
          <a href="#/about" data-route="/about" class="btn btn--ghost btn--lg">Our Story</a>
        </div>
        <div class="hero__trust">
          <span>🎨 100% Handmade</span><span>✨ Customizable</span>
          <span>📦 Pan India Delivery</span>
          <span class="hero__live"><span class="live-dot"></span> <span id="liveVisitors">--</span> viewing now</span>
        </div>
      </div>
      <div class="hero__visual" aria-hidden="true">
        <div class="hero__visual-ring"></div>
        <div class="hero__visual-card">
          <div class="hero__visual-badge">🧶 New Collection 2025</div>
          <div class="hero__visual-emoji">🧶<br>🎀<br>🌸</div>
          <div class="hero__visual-stars">★★★★★ <span>4.9 / 5</span></div>
        </div>
      </div>
    </div>`;

  initHeroParticles();
  initBuyTicker();
  initCountdown();
  initLiveVisitors();

  hero.querySelectorAll('.hero__eyebrow, .hero__title, .hero__sub, .hero__offer, .hero__actions, .hero__trust').forEach((el, i) => {
    el.style.animationDelay = `${i * 0.13}s`;
    el.classList.add('hero-item-reveal');
  });
}

function initHeroParticles() {
  const c = document.getElementById('heroParticles');
  if (!c) return;
  const chars = ['🧵','🪡','✂️','🌸','⭐','💛','🎀','🌿','💎'];
  for (let i = 0; i < 20; i++) {
    const s = document.createElement('span');
    s.className = 'particle';
    s.textContent = chars[i % chars.length];
    s.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*8}s;animation-duration:${7+Math.random()*8}s;font-size:${12+Math.random()*18}px;opacity:${0.25+Math.random()*0.4}`;
    c.appendChild(s);
  }
}

function initParallax() {
  window.addEventListener('scroll', () => {
    const bg = document.querySelector('.hero__bg');
    if (bg) bg.style.transform = `translateY(${window.scrollY * 0.28}px)`;
  }, { passive: true });
}

async function renderFeaturedProducts() {
  const sec = document.getElementById('featuredProducts');
  if (!sec) return;
  const grid = sec.querySelector('.products-grid');
  grid.innerHTML = skeleton(4);
  try {
    const featured = await db.from('featured_products').select('product_id').eq('active', true).order('sort_order').limit(8).execute();
    const ids = featured.map(f => f.product_id);
    if (!ids.length) { grid.innerHTML = '<p class="empty-msg">Coming soon!</p>'; return; }
    const products = await db.from('products').select('*').in('id', ids).execute();
    await attachImages(products);
    grid.innerHTML = products.map(productCard).join('');
    grid.querySelectorAll('.product-card').forEach((el, i) => { el.style.animationDelay = `${i*0.07}s`; observeReveal(el); });
    initCardMiniSliders(grid);
  } catch { grid.innerHTML = '<p class="empty-msg">Could not load products.</p>'; }
}

async function renderTrendingProducts() {
  const sec = document.getElementById('trendingProducts');
  if (!sec) return;
  const grid = sec.querySelector('.products-grid');
  grid.innerHTML = skeleton(4);
  try {
    const products = await db.from('products').select('*').eq('in_stock', true).eq('is_bestseller', true)
      .order('created_at', { ascending: false }).limit(8).execute();
    await attachImages(products);
    grid.innerHTML = products.length ? products.map(productCard).join('') : '<p class="empty-msg">Coming soon!</p>';
    grid.querySelectorAll('.product-card').forEach((el, i) => { el.style.animationDelay = `${i*0.07}s`; observeReveal(el); });
    initCardMiniSliders(grid);
  } catch { grid.innerHTML = ''; }
}

async function renderCategories() {
  const sec = document.getElementById('categoriesSection');
  if (!sec) return;
  const grid = sec.querySelector('.categories-grid');
  const fallback = [
    { slug:'crochet', name:'Crochet', icon:'🧶' },
    { slug:'embroidery', name:'Embroidery', icon:'🎨' },
    { slug:'handmade-gifts', name:'Handmade Gifts', icon:'🎁' },
    { slug:'personalized', name:'Personalized', icon:'✨' },
    { slug:'pet-accessories', name:'Pet Accessories', icon:'🐾' },
    { slug:'home-decor', name:'Home Decor', icon:'🏡' },
    { slug:'corporate-gifts', name:'Corporate Gifts', icon:'💼' },
    { slug:'wedding', name:'Wedding', icon:'💍' },
  ];
  const cats = State.categories.length ? State.categories : fallback;
  grid.innerHTML = cats.map(c => `
    <a href="#/category/${esc(c.slug)}" data-route="/category/${esc(c.slug)}" class="cat-card" aria-label="${esc(c.name)}">
      <span class="cat-card__icon">${c.icon || '🎀'}</span>
      <span class="cat-card__name">${esc(c.name)}</span>
    </a>`).join('');
  grid.querySelectorAll('.cat-card').forEach((el, i) => { el.style.animationDelay = `${i*0.06}s`; observeReveal(el); });
}

async function renderTestimonials() {
  const sec = document.getElementById('testimonialsSection');
  if (!sec) return;
  const track = sec.querySelector('.testimonials-track');
  if (!track) return;
  try {
    const items = await db.from('testimonials').select('*').eq('active', true).order('sort_order').limit(12).execute();
    if (!items.length) { sec.style.display = 'none'; return; }
    const cards = items.map(t => `
      <div class="testimonial-card">
        <div class="testimonial-stars">${'★'.repeat(Math.min(5, t.rating||5))}</div>
        <p class="testimonial-text">"${esc(t.review || t.text || '')}"</p>
        <div class="testimonial-author">
          <span class="testimonial-avatar">${(t.customer_name||'C').charAt(0).toUpperCase()}</span>
          <div>
            <span class="testimonial-name">${esc(t.customer_name||t.name||'Customer')}</span>
            ${t.location ? `<span class="testimonial-loc">📍 ${esc(t.location)}</span>` : ''}
          </div>
        </div>
      </div>`).join('');
    track.innerHTML = cards + cards;
  } catch { sec.style.display = 'none'; }
}

async function renderFAQPreview() {
  const sec = document.getElementById('faqPreview');
  if (!sec) return;
  const list = sec.querySelector('.faq-list');
  try {
    const faqs = await db.from('faqs').select('question,answer').eq('active', true).order('sort_order').limit(5).execute();
    list.innerHTML = faqs.map((f, i) => `
      <div class="faq-item">
        <button class="faq-question" aria-expanded="false" aria-controls="fq${i}">
          ${esc(f.question)} <span class="faq-icon" aria-hidden="true">+</span>
        </button>
        <div class="faq-answer" id="fq${i}" role="region"><p>${esc(f.answer)}</p></div>
      </div>`).join('');
    initFAQ(list);
  } catch { sec.style.display = 'none'; }
}

function initFAQ(container) {
  container.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      container.querySelectorAll('.faq-question').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        b.querySelector('.faq-icon').textContent = '+';
        b.nextElementSibling.style.maxHeight = null;
      });
      if (!expanded) {
        btn.setAttribute('aria-expanded', 'true');
        btn.querySelector('.faq-icon').textContent = '−';
        btn.nextElementSibling.style.maxHeight = btn.nextElementSibling.scrollHeight + 'px';
      }
    });
  });
}

function initInstagramSection() {
  const sec = document.getElementById('instagramSection');
  if (!sec) return;
  const grid = sec.querySelector('.insta-grid');
  if (!grid) return;
  const emojis = ['🧶','🎀','🌸','✨','🪡','💛','🎁','🐾','🏡'];
  grid.innerHTML = emojis.map((em, i) => `
    <a href="${esc(CONFIG.business.instagram)}" target="_blank" rel="noopener" class="insta-item" aria-label="Instagram post ${i+1}">
      <div class="insta-placeholder"><span>${em}</span></div>
      <div class="insta-overlay">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
      </div>
    </a>`).join('');
  grid.querySelectorAll('.insta-item').forEach((el, i) => { el.style.animationDelay = `${i*0.05}s`; observeReveal(el); });
}

// ─── Page: Products ───────────────────────────────────────────
async function renderProductsPage() {
  setPage('products-page');
  State.page = 0; State.filterCategory = null; State.filterBestsellerOnly = false;
  setProductsHeading('All Products', 'Explore our collection of handmade treasures, crafted with love.');
  await loadAndRenderProducts();
}

async function renderCategoryPage(params) {
  const slug = params.get('slug');
  setPage('products-page');
  State.filterCategory = slug; State.page = 0; State.filterBestsellerOnly = false;
  const cat = State.categories.find(c => c.slug === slug);
  setProductsHeading(cat ? `${cat.icon||''} ${cat.name}` : slug, 'Explore our collection of handmade treasures, crafted with love.');
  await loadAndRenderProducts();
}

async function renderBestSellersPage() {
  setPage('products-page');
  State.page = 0; State.filterCategory = null; State.filterBestsellerOnly = true;
  setProductsHeading('⭐ Best Sellers', 'Our most-loved pieces, chosen again and again by customers like you.');
  await loadAndRenderProducts();
}

function setProductsHeading(title, subtitle) {
  const h = document.getElementById('productsHeading');
  const s = document.getElementById('productsSubheading');
  if (h) h.textContent = title;
  if (s) s.textContent = subtitle;
}

async function loadAndRenderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = skeleton(CONFIG.pagination.productsPerPage);
  try {
    const q = db.from('products').select('*');
    if (State.filterCategory) {
      const cat = State.categories.find(c => c.slug === State.filterCategory);
      if (cat) q.eq('category_id', cat.id);
    }
    if (State.filterBestsellerOnly) q.eq('is_bestseller', true);
    if (State.filterPriceMin !== null) q.gte('price', State.filterPriceMin);
    if (State.filterPriceMax !== null) q.lte('price', State.filterPriceMax);
    const offset = State.page * CONFIG.pagination.productsPerPage;
    q.order(State.sortBy, { ascending: State.sortAsc }).range(offset, offset + CONFIG.pagination.productsPerPage - 1);
    const products = await q.execute();
    await attachImages(products);
    grid.innerHTML = products.length ? products.map(productCard).join('') : '<p class="empty-msg">No products found.</p>';
    grid.querySelectorAll('.product-card').forEach((el, i) => { el.style.animationDelay = `${i*0.05}s`; observeReveal(el); });
    initCardMiniSliders(grid);
    renderPagination(products.length);
  } catch { grid.innerHTML = '<p class="empty-msg">Could not load products.</p>'; }
}

function renderPagination(count) {
  const p = document.getElementById('pagination');
  if (!p) return;
  p.innerHTML = `
    <button class="btn btn--ghost" onclick="changePage(-1)" ${State.page===0?'disabled':''}>← Prev</button>
    <span class="page-num">Page ${State.page+1}</span>
    <button class="btn btn--ghost" onclick="changePage(1)" ${count<CONFIG.pagination.productsPerPage?'disabled':''}>Next →</button>`;
}

window.changePage = (d) => {
  State.page = Math.max(0, State.page + d);
  loadAndRenderProducts();
  document.getElementById('productsGrid')?.scrollIntoView({ behavior:'smooth', block:'start' });
};

// ─── Product Detail Modal ─────────────────────────────────────
async function openProductModal(id) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  openModal('productModal');
  modal.querySelector('.product-modal-body').innerHTML = `<div style="min-height:300px;display:flex;align-items:center;justify-content:center;">${skeleton(1,'skeleton-detail')}</div>`;

  try {
    const [productArr, imagesArr, reviewsArr] = await Promise.all([
      db.from('products').select('*').eq('id', id).limit(1).execute(),
      db.from('product_images').select('*').eq('product_id', id).order('sort_order').execute().catch(() => []),
      db.from('reviews').select('*').eq('product_id', id).order('created_at', { ascending:false }).limit(5).execute().catch(() => []),
    ]);

    const p = productArr[0];
    if (!p) { modal.querySelector('.product-modal-body').innerHTML = '<p class="empty-msg">Product not found.</p>'; return; }
    State.currentProduct = p;

    const allImages = imagesArr.length ? imagesArr : [];
    const hasOffer = p.offer_price && Number(p.offer_price) < Number(p.price);
    const discount = hasOffer ? Math.round((1 - p.offer_price / p.price) * 100) : 0;

    modal.querySelector('.product-modal-body').innerHTML = `
      <div class="pmodal-grid">
        <div class="pmodal-gallery"></div>
        <div class="pmodal-info">
          <span class="pmodal-code">${esc(p.product_code||'KTT-'+p.id)}</span>
          <h2 class="pmodal-name">${esc(p.name)}</h2>
          <div class="pmodal-badges">
            <span class="badge badge--handmade">Handmade</span>
            ${p.is_bestseller ? '<span class="badge badge--bestseller">⭐ Bestseller</span>' : ''}
            ${p.is_customizable ? '<span class="badge badge--custom">✏️ Customizable</span>' : ''}
          </div>
          <div class="pmodal-pricing">
            <span class="pmodal-price">${formatPrice(p.offer_price||p.price)}</span>
            ${hasOffer ? `<span class="pmodal-orig">${formatPrice(p.price)}</span><span class="badge badge--off">−${discount}%</span>` : ''}
          </div>
          ${!p.in_stock
            ? '<div class="pmodal-oos">⚠️ Currently Out of Stock</div>'
            : '<div class="pmodal-stock">✅ In Stock — Ready to Ship</div>'}
          <div class="pmodal-desc">${p.description ? esc(p.description).replace(/\n/g,'<br>') : ''}</div>
          <div class="pmodal-meta">
            ${p.dimensions  ? `<div class="pmodal-meta-item"><span>📐 Dimensions</span><span>${esc(p.dimensions)}</span></div>` : ''}
            ${p.materials   ? `<div class="pmodal-meta-item"><span>🧵 Materials</span><span>${esc(p.materials)}</span></div>` : ''}
            ${p.colors      ? `<div class="pmodal-meta-item"><span>🎨 Colors</span><span>${esc(p.colors)}</span></div>` : ''}
            ${p.wash_care   ? `<div class="pmodal-meta-item"><span>🧺 Care</span><span>${esc(p.wash_care)}</span></div>` : ''}
            <div class="pmodal-meta-item"><span>📦 Delivery</span><span>${esc(p.delivery_days||CONFIG.business.deliveryDays)}</span></div>
          </div>
          <button class="btn btn--primary btn--lg btn--order w-full" data-id="${p.id}" ${!p.in_stock?'disabled':''}>
            💬 ${p.in_stock ? 'Order via WhatsApp' : 'Out of Stock'}
          </button>
          <p class="pmodal-assurance">🔒 Safe & Secure · ✂️ Handcrafted · 🎀 Gift-ready packaging</p>
        </div>
      </div>
      ${reviewsArr.length ? `
      <div class="pmodal-reviews">
        <h3>Customer Reviews</h3>
        <div class="reviews-list">
          ${reviewsArr.map(r => `
            <div class="review-item">
              <div class="review-header">
                <span class="review-author">${esc(r.customer_name||'Customer')}</span>
                <span class="review-stars">${'★'.repeat(Math.min(5,r.rating||5))}</span>
              </div>
              <p class="review-text">${esc(r.review_text||r.text||'')}</p>
            </div>`).join('')}
        </div>
      </div>` : ''}`;

    buildGallery(allImages.map(i => i.image_url || i), modal.querySelector('.pmodal-gallery'));
  } catch { modal.querySelector('.product-modal-body').innerHTML = '<p class="empty-msg">Could not load product details.</p>'; }
}

// ─── Page: Search ─────────────────────────────────────────────
async function renderSearchPage(params) {
  setPage('search-page');
  const q = params.get('q') || '';
  State.searchQuery = q; State.page = 0;
  const h = document.getElementById('searchHeading');
  if (h) h.textContent = q ? `Results for "${q}"` : 'Search Products';
  const inp = document.getElementById('searchPageInput');
  if (inp) inp.value = q;
  if (q) await searchProducts();
}

async function searchProducts() {
  const grid = document.getElementById('searchGrid');
  if (!grid) return;
  grid.innerHTML = skeleton(8);
  try {
    const q = db.from('products').select('*').ilike('name', `%${State.searchQuery}%`);
    if (State.filterPriceMin !== null) q.gte('price', State.filterPriceMin);
    if (State.filterPriceMax !== null) q.lte('price', State.filterPriceMax);
    q.order(State.sortBy, { ascending: State.sortAsc }).limit(CONFIG.pagination.productsPerPage);
    const results = await q.execute();
    await attachImages(results);
    grid.innerHTML = results.length
      ? results.map(productCard).join('')
      : `<p class="empty-msg">No products found for "<strong>${esc(State.searchQuery)}</strong>".<br>Try a different keyword.</p>`;
    const h = document.getElementById('searchHeading');
    if (h) h.textContent = `${results.length} result${results.length!==1?'s':''} for "${State.searchQuery}"`;
    grid.querySelectorAll('.product-card').forEach(el => observeReveal(el));
    initCardMiniSliders(grid);
  } catch { grid.innerHTML = '<p class="empty-msg">Search failed. Please try again.</p>'; }
}

// ─── Page: About ──────────────────────────────────────────────
function renderAboutPage() { setPage('about-page'); }

// ─── Page: FAQ ────────────────────────────────────────────────
async function renderFaqPage() {
  setPage('faq-page');
  const list = document.getElementById('fullFaqList');
  if (!list) return;
  list.innerHTML = skeleton(6, 'skeleton-faq');
  try {
    const faqs = await db.from('faqs').select('question,answer').eq('active', true).order('sort_order').execute();
    list.innerHTML = faqs.map((f, i) => `
      <div class="faq-item">
        <button class="faq-question" aria-expanded="false" aria-controls="ffq${i}">
          ${esc(f.question)} <span class="faq-icon" aria-hidden="true">+</span>
        </button>
        <div class="faq-answer" id="ffq${i}" role="region"><p>${esc(f.answer)}</p></div>
      </div>`).join('');
    initFAQ(list);
  } catch { list.innerHTML = '<p class="empty-msg">Could not load FAQs.</p>'; }
}

// ─── Page: Contact ────────────────────────────────────────────
function renderContactPage() { setPage('contact-page'); }

// ─── Page: Reviews ────────────────────────────────────────────
async function renderReviewsPage() {
  setPage('reviews-page');
  const grid = document.getElementById('reviewsGrid');
  if (!grid) return;
  grid.innerHTML = skeleton(8);
  try {
    const reviews = await db.from('reviews').select('*').order('created_at', { ascending:false }).limit(CONFIG.pagination.reviewsPerPage).execute();
    grid.innerHTML = reviews.length ? reviews.map(r => `
      <div class="review-card">
        <div class="review-header">
          <div class="review-avatar">${(r.customer_name||'C').charAt(0).toUpperCase()}</div>
          <div>
            <p class="review-author">${esc(r.customer_name||'Customer')}</p>
            <p class="review-stars">${'★'.repeat(Math.min(5,r.rating||5))}${'☆'.repeat(5-Math.min(5,r.rating||5))}</p>
          </div>
        </div>
        <p class="review-text">"${esc(r.review_text||r.text||'')}"</p>
        ${r.product_name ? `<p class="review-product">Product: ${esc(r.product_name)}</p>` : ''}
      </div>`).join('') : '<p class="empty-msg">No reviews yet. Be the first!</p>';
    grid.querySelectorAll('.review-card').forEach(el => observeReveal(el));
  } catch { grid.innerHTML = '<p class="empty-msg">Could not load reviews.</p>'; }
}

// ─── Page: Legal ──────────────────────────────────────────────
function renderPrivacyPage() { setPage('privacy-page'); }
function renderTermsPage()   { setPage('terms-page'); }

// ─── Page Switcher ────────────────────────────────────────────
function setPage(id) {
  $$('.page').forEach(p => { p.hidden = true; p.setAttribute('aria-hidden','true'); });
  const page = document.getElementById(id);
  if (page) {
    page.hidden = false;
    page.setAttribute('aria-hidden','false');
    page.querySelectorAll('.will-reveal').forEach(el => revealObserver.observe(el));
  }
  window.scrollTo({ top:0, behavior:'smooth' });
  updateActiveNav();
}

function updateActiveNav() {
  const cur = Router.current();
  $$('.nav-link,.drawer-link').forEach(a => {
    const r = a.dataset.route || a.getAttribute('href')?.slice(1);
    a.classList.toggle('active', r === cur);
  });
}

// ─── Form Handlers ────────────────────────────────────────────
function handleContactForm(e) {
  e.preventDefault();
  const f = e.target;
  const msg = encodeURIComponent(
`Hello Knot & Thread Tales! 👋

Name: ${f.contactName?.value.trim()}
Email: ${f.contactEmail?.value.trim()}
Subject: ${f.contactSubject?.value.trim()||'Enquiry'}

Message:
${f.contactMessage?.value.trim()}`
  );
  window.open(`https://wa.me/${CONFIG.whatsapp.number}?text=${msg}`, '_blank');
  showToast('Redirecting to WhatsApp 💬');
  f.reset();
}

// ─── Sort / Filter ────────────────────────────────────────────
window.applySort = (val) => {
  const [col, dir] = val.split(':');
  State.sortBy = col; State.sortAsc = dir === 'asc'; State.page = 0;
  Router.current() === '/search' ? searchProducts() : loadAndRenderProducts();
};

window.applyPriceFilter = () => {
  const min = document.getElementById('priceMin')?.value;
  const max = document.getElementById('priceMax')?.value;
  State.filterPriceMin = min ? Number(min) : null;
  State.filterPriceMax = max ? Number(max) : null;
  State.page = 0;
  Router.current() === '/search' ? searchProducts() : loadAndRenderProducts();
};

window.clearFilters = () => {
  State.filterPriceMin = null; State.filterPriceMax = null;
  State.sortBy = 'created_at'; State.sortAsc = false; State.page = 0;
  const min = document.getElementById('priceMin'); if (min) min.value = '';
  const max = document.getElementById('priceMax'); if (max) max.value = '';
  Router.current() === '/search' ? searchProducts() : loadAndRenderProducts();
};

window.searchPageSearch = () => {
  const q = document.getElementById('searchPageInput')?.value.trim();
  if (q) {
    State.searchQuery = q;
    const h = document.getElementById('searchHeading');
    if (h) h.textContent = `Searching for "${q}"…`;
    searchProducts();
  }
};

// ─── Expose Globals ───────────────────────────────────────────
window.openProductModal    = openProductModal;
window.openOrderModal      = openOrderModal;
window.closeModal          = closeModal;
window.submitOrder         = submitOrder;
window.openPaymentModal    = openPaymentModal;
window.copyUPI             = copyUPI;
window.downloadQR          = downloadQR;
window.shareQR             = shareQR;
window.handleContactForm   = handleContactForm;

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
