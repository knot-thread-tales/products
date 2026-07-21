// ============================================================
// Knot & Thread Tales — Admin Panel
// Requires: config.js loaded first, @supabase/supabase-js UMD loaded first.
// ============================================================
'use strict';

const sb = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function toast(msg, type = '') {
  const host = $('#adminToastHost');
  const t = document.createElement('div');
  t.className = `admin-toast${type ? ' admin-toast--' + type : ''}`;
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ── Table configs: one entry per "master data" table ────────
// options: fixed array, or {table, valueKey, labelKey} to load dynamically
const TABLE_CONFIGS = {
  products: {
    label: 'Products', order: [{col:'created_at', asc:false}],
    columns: [
      { key:'product_code',  label:'Code',         type:'text', required:true },
      { key:'name',          label:'Name',         type:'text', required:true },
      { key:'category_id',   label:'Category',     type:'select', options:{ table:'categories', valueKey:'id', labelKey:'name' } },
      { key:'price',         label:'Price (₹)',    type:'number', required:true },
      { key:'offer_price',   label:'Offer Price (₹)', type:'number' },
      { key:'description',   label:'Description',  type:'textarea' },
      { key:'dimensions',    label:'Dimensions',   type:'text' },
      { key:'materials',     label:'Materials',    type:'text' },
      { key:'colors',        label:'Colors',       type:'text' },
      { key:'wash_care',     label:'Wash / Care',  type:'text' },
      { key:'delivery_days', label:'Delivery days', type:'text' },
      { key:'in_stock',       label:'In stock',       type:'checkbox', default:true },
      { key:'is_bestseller',  label:'Bestseller',     type:'checkbox' },
      { key:'is_customizable', label:'Customizable',  type:'checkbox' },
    ],
    listColumns: ['product_code','name','price','in_stock','is_bestseller'],
    rowActions: [{ label:'Images', fn:'openImages' }],
  },
  announcements: {
    label: 'Announcements', order: [{col:'sort_order', asc:true}],
    columns: [
      { key:'message',   label:'Message', type:'text', required:true },
      { key:'emoji',     label:'Emoji (optional)', type:'text' },
      { key:'type',      label:'Type', type:'select', options:[
          {value:'info', label:'Info'}, {value:'discount', label:'Discount'}, {value:'feature', label:'Feature'} ] },
      { key:'link_url',  label:'Link URL', type:'text' },
      { key:'link_text', label:'Link Text', type:'text' },
      { key:'sort_order', label:'Sort Order', type:'number', default:0 },
      { key:'starts_at', label:'Starts At', type:'datetime-local' },
      { key:'ends_at',   label:'Ends At', type:'datetime-local' },
      { key:'is_active', label:'Active', type:'checkbox', default:true },
    ],
    listColumns: ['message','type','is_active','sort_order'],
  },
  categories: {
    label: 'Categories', order: [{col:'sort_order', asc:true}],
    columns: [
      { key:'name', label:'Name', type:'text', required:true },
      { key:'slug', label:'Slug', type:'text', required:true },
      { key:'icon', label:'Icon (emoji)', type:'text' },
      { key:'sort_order', label:'Sort Order', type:'number', default:0 },
    ],
    listColumns: ['icon','name','slug','sort_order'],
  },
  faqs: {
    label: 'FAQs', order: [{col:'sort_order', asc:true}],
    columns: [
      { key:'question', label:'Question', type:'text', required:true },
      { key:'answer',   label:'Answer', type:'textarea', required:true },
      { key:'sort_order', label:'Sort Order', type:'number', default:0 },
      { key:'active',   label:'Active', type:'checkbox', default:true },
    ],
    listColumns: ['question','active','sort_order'],
  },
  testimonials: {
    label: 'Testimonials', order: [{col:'sort_order', asc:true}],
    columns: [
      { key:'customer_name', label:'Customer Name', type:'text', required:true },
      { key:'location',      label:'Location', type:'text' },
      { key:'rating',        label:'Rating (1-5)', type:'number', default:5 },
      { key:'review',        label:'Review Text', type:'textarea', required:true },
      { key:'sort_order',    label:'Sort Order', type:'number', default:0 },
      { key:'active',        label:'Active', type:'checkbox', default:true },
    ],
    listColumns: ['customer_name','rating','active'],
  },
  payment_settings: {
    label: 'Payment Settings', order: [], singleton: true,
    columns: [
      { key:'upi_id',        label:'UPI ID', type:'text', required:true },
      { key:'merchant_name', label:'Merchant Name', type:'text', required:true },
      { key:'qr_image',      label:'QR Image URL (optional — leave blank to auto-generate)', type:'text' },
    ],
    listColumns: ['upi_id','merchant_name'],
  },
  orders: {
    label: 'Orders', order: [{col:'created_at', asc:false}], readOnly: true,
    columns: [
      { key:'status', label:'Status', type:'select', options:[
          {value:'pending',label:'Pending'},{value:'confirmed',label:'Confirmed'},
          {value:'shipped',label:'Shipped'},{value:'delivered',label:'Delivered'},{value:'cancelled',label:'Cancelled'} ] },
    ],
    listColumns: ['product_name','customer_name','customer_phone','quantity','status','created_at'],
    statusEditable: true,
  },
  reviews: {
    label: 'Reviews', order: [{col:'created_at', asc:false}], readOnly: true,
    columns: [],
    listColumns: ['customer_name','rating','review_text','approved','created_at'],
    reviewModeration: true,
  },
};

let State = { view: 'products', rows: [], categoriesCache: null, tableSearch: '', sortKey: null, sortDir: 'asc' };

// ── Auth ──────────────────────────────────────────────────
async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showDashboard(); else showLogin();
}

function showLogin() {
  $('#loginScreen').hidden = false;
  $('#dashboard').hidden = true;
}

function showDashboard() {
  $('#loginScreen').hidden = true;
  $('#dashboard').hidden = false;
  loadView('products');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const errEl = $('#loginError');
  const btn = e.target.querySelector('button[type="submit"]');
  errEl.hidden = true;
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  showDashboard();
});

$('#logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  showLogin();
});

// ── Mobile sidebar toggle ─────────────────────────────────
$('#menuToggle')?.addEventListener('click', () => {
  $('.admin-sidebar').classList.toggle('open');
  $('#sidebarBackdrop')?.classList.toggle('show');
});
$('#sidebarBackdrop')?.addEventListener('click', () => {
  $('.admin-sidebar').classList.remove('open');
  $('#sidebarBackdrop')?.classList.remove('show');
});

// ── Nav ───────────────────────────────────────────────────
$('#adminNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-nav-btn');
  if (!btn) return;
  $$('.admin-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('.admin-sidebar').classList.remove('open');
  $('#sidebarBackdrop')?.classList.remove('show');
  State.tableSearch = ''; State.sortKey = null; State.sortDir = 'asc';
  loadView(btn.dataset.view);
});

// ── Load + render a table view ───────────────────────────
async function loadView(view) {
  State.view = view;
  const cfg = TABLE_CONFIGS[view];
  $('#viewTitle').textContent = cfg.label;
  $('#addBtn').hidden = !!cfg.readOnly || !!cfg.singleton;
  const body = $('#viewBody');
  body.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div>Loading…</div>';

  try {
    let q = sb.from(view).select('*');
    (cfg.order || []).forEach(o => { q = q.order(o.col, { ascending: o.asc }); });
    const { data, error } = await q;
    if (error) throw error;
    State.rows = data || [];

    if (cfg.singleton) {
      $('#addBtn').hidden = true;
      renderSingletonForm(cfg, data && data[0]);
      return;
    }
    renderTable(cfg, State.rows);
  } catch (err) {
    body.innerHTML = `<div class="admin-empty">⚠️ Could not load ${esc(cfg.label)}: ${esc(err.message)}</div>`;
  }
}

// Returns rows filtered by the current search box (matches against
// every listColumn's rendered text) and sorted by the current column.
function getVisibleRows(cfg) {
  const cols = cfg.listColumns;
  let rows = State.rows;

  if (State.tableSearch.trim()) {
    const term = State.tableSearch.trim().toLowerCase();
    rows = rows.filter(r => cols.some(c => String(r[c] ?? '').toLowerCase().includes(term)));
  }

  if (State.sortKey) {
    const dir = State.sortDir === 'asc' ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      let av = a[State.sortKey], bv = b[State.sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });
  }
  return rows;
}

function renderTable(cfg, allRows) {
  const body = $('#viewBody');
  const cols = cfg.listColumns;
  const rows = getVisibleRows(cfg);

  body.innerHTML = `
    <div class="admin-toolbar">
      <div class="admin-toolbar__search">
        <span class="admin-toolbar__search-icon">🔎</span>
        <input type="search" id="tableSearchInput" placeholder="Search ${esc(cfg.label.toLowerCase())}…" value="${esc(State.tableSearch)}">
      </div>
      <div class="admin-toolbar__meta">
        <span class="admin-toolbar__count">${rows.length} of ${allRows.length}</span>
        <button class="admin-btn-sm" id="exportCsvBtn" ${!allRows.length ? 'disabled' : ''}>⬇ CSV</button>
        <button class="admin-btn-sm" id="exportXlsxBtn" ${!allRows.length ? 'disabled' : ''}>⬇ Excel</button>
      </div>
    </div>
    ${!rows.length
      ? `<div class="admin-empty">${allRows.length ? '🔍 No results match your search.' : `No ${esc(cfg.label.toLowerCase())} yet. Click "+ Add" to create one.`}</div>`
      : `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          ${cols.map(c => `<th class="sortable ${State.sortKey===c?'sorted-'+State.sortDir:''}" data-sort="${c}">${esc(colLabel(cfg, c))}<span class="sort-arrow"></span></th>`).join('')}
          <th class="actions-col">Actions</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr data-id="${r.id}">
              ${cols.map(c => `<td data-label="${esc(colLabel(cfg, c))}">${renderCell(cfg, c, r)}</td>`).join('')}
              <td class="actions" data-label="Actions">${renderRowActions(cfg, r)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`}`;

  body.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', () => handleRowAction(cfg, el.dataset.act, el.dataset.id));
  });
  if (cfg.statusEditable) {
    body.querySelectorAll('select[data-status-id]').forEach(sel => {
      sel.addEventListener('change', () => updateOrderStatus(sel.dataset.statusId, sel.value));
    });
  }

  const searchInput = $('#tableSearchInput');
  searchInput?.addEventListener('input', () => {
    State.tableSearch = searchInput.value;
    const pos = searchInput.selectionStart;
    renderTable(cfg, allRows);
    const el = $('#tableSearchInput');
    el.focus(); el.setSelectionRange(pos, pos);
  });

  body.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      State.sortDir = (State.sortKey === key && State.sortDir === 'asc') ? 'desc' : 'asc';
      State.sortKey = key;
      renderTable(cfg, allRows);
    });
  });

  $('#exportCsvBtn')?.addEventListener('click', () => exportTable(cfg, 'csv'));
  $('#exportXlsxBtn')?.addEventListener('click', () => exportTable(cfg, 'xlsx'));
}

function exportTable(cfg, format) {
  const cols = cfg.listColumns;
  const rows = getVisibleRows(cfg);
  const headers = cols.map(c => colLabel(cfg, c));
  const data = rows.map(r => cols.map(c => {
    const v = r[c];
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (c === 'created_at' && v) return new Date(v).toLocaleString('en-IN');
    return v ?? '';
  }));
  const filename = `${State.view}-${new Date().toISOString().slice(0,10)}`;

  if (format === 'csv') {
    const escCsv = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...data].map(row => row.map(escCsv).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${filename}.csv`);
  } else {
    if (typeof XLSX === 'undefined') { toast('Excel export library did not load.', 'error'); return; }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 31));
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }
  toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}.`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function colLabel(cfg, key) {
  const c = cfg.columns.find(c => c.key === key);
  return c ? c.label : key.replace(/_/g, ' ');
}

function renderCell(cfg, key, row) {
  const val = row[key];
  if (key === 'status' && cfg.statusEditable) {
    const opts = cfg.columns.find(c => c.key === 'status').options;
    return `<select data-status-id="${row.id}" class="admin-pill-select admin-pill-select--${val}">${opts.map(o => `<option value="${o.value}" ${o.value===val?'selected':''}>${o.label}</option>`).join('')}</select>`;
  }
  if (key === 'created_at' && val) return new Date(val).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  if (typeof val === 'boolean') return `<span class="admin-pill admin-pill--${val ? 'yes' : 'no'}">${val ? '✓ Yes' : '✕ No'}</span>`;
  if (key === 'approved' && cfg.reviewModeration) return `<span class="admin-pill admin-pill--${val ? 'yes' : 'no'}">${val ? '✓ Approved' : '⏳ Pending'}</span>`;
  if (key === 'rating' && typeof val === 'number') return '★'.repeat(val) + '☆'.repeat(Math.max(0, 5 - val));
  if (val && typeof val === 'string' && val.length > 70) return `<span title="${esc(val)}">${esc(val.slice(0, 70))}…</span>`;
  return esc(val ?? '—');
}

function renderRowActions(cfg, row) {
  if (cfg.reviewModeration) {
    return `
      ${!row.approved ? `<button class="admin-btn-sm admin-btn-sm--primary" data-act="approve" data-id="${row.id}">✓ Approve</button>` : `<button class="admin-btn-sm" data-act="unapprove" data-id="${row.id}">Unapprove</button>`}
      <button class="admin-btn-sm admin-btn-sm--danger" data-act="delete" data-id="${row.id}">Delete</button>`;
  }
  let html = '';
  if (!cfg.readOnly) {
    html += `<button class="admin-btn-sm" data-act="edit" data-id="${row.id}">✎ Edit</button>`;
    html += `<button class="admin-btn-sm admin-btn-sm--danger" data-act="delete" data-id="${row.id}">🗑</button>`;
  }
  (cfg.rowActions || []).forEach(a => {
    html += `<button class="admin-btn-sm" data-act="${a.fn}" data-id="${row.id}">${a.label}</button>`;
  });
  return html;
}

async function handleRowAction(cfg, act, id) {
  const row = State.rows.find(r => String(r.id) === String(id));
  if (act === 'edit') return openRecordModal(cfg, row);
  if (act === 'openImages') return openImagesModal(row);
  if (act === 'delete') {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    const { error } = await sb.from(State.view).delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    toast('Deleted.');
    loadView(State.view);
  }
  if (act === 'approve' || act === 'unapprove') {
    const { error } = await sb.from('reviews').update({ approved: act === 'approve' }).eq('id', id);
    if (error) return toast(error.message, 'error');
    toast(act === 'approve' ? 'Review approved — now visible on the site.' : 'Review hidden.');
    loadView('reviews');
  }
}

async function updateOrderStatus(id, status) {
  const { error } = await sb.from('orders').update({ status }).eq('id', id);
  if (error) return toast(error.message, 'error');
  toast('Order status updated.');
}

// ── Add / Edit modal (generic form from column config) ──────
$('#addBtn').addEventListener('click', () => openRecordModal(TABLE_CONFIGS[State.view], null));
$('#recordModalClose').addEventListener('click', () => $('#recordModal').hidden = true);

async function ensureOptionsLoaded(cfg) {
  for (const col of cfg.columns) {
    if (col.type === 'select' && col.options && !Array.isArray(col.options)) {
      const { table, valueKey, labelKey } = col.options;
      const { data } = await sb.from(table).select('*');
      col._resolvedOptions = (data || []).map(r => ({ value: r[valueKey], label: r[labelKey] }));
    }
  }
}

async function openRecordModal(cfg, row) {
  await ensureOptionsLoaded(cfg);
  $('#recordModalTitle').textContent = row ? `Edit ${cfg.label}` : `Add ${cfg.label}`;
  const form = $('#recordForm');
  form.innerHTML = cfg.columns.map(c => fieldHTML(c, row)).join('') +
    `<div class="admin-form-actions">
       <button type="submit" class="btn btn--primary btn--sm">Save</button>
       <button type="button" class="btn btn--outline btn--sm" id="recordCancelBtn">Cancel</button>
     </div>`;
  $('#recordCancelBtn').onclick = () => $('#recordModal').hidden = true;
  form.onsubmit = (e) => saveRecord(e, cfg, row);
  $('#recordModal').hidden = false;
}

function fieldHTML(col, row) {
  const val = row ? row[col.key] : (col.default ?? '');
  const req = col.required ? 'required' : '';
  if (col.type === 'checkbox') {
    return `<div class="admin-field admin-field--checkbox">
      <input type="checkbox" id="f_${col.key}" ${val ? 'checked' : ''}>
      <label for="f_${col.key}">${esc(col.label)}</label>
    </div>`;
  }
  if (col.type === 'textarea') {
    return `<div class="admin-field"><label>${esc(col.label)}</label>
      <textarea id="f_${col.key}" ${req}>${esc(val)}</textarea></div>`;
  }
  if (col.type === 'select') {
    const opts = col._resolvedOptions || col.options || [];
    return `<div class="admin-field"><label>${esc(col.label)}</label>
      <select id="f_${col.key}" ${req}>
        <option value="">— Select —</option>
        ${opts.map(o => `<option value="${esc(o.value)}" ${String(o.value)===String(val)?'selected':''}>${esc(o.label)}</option>`).join('')}
      </select></div>`;
  }
  return `<div class="admin-field"><label>${esc(col.label)}</label>
    <input type="${col.type}" id="f_${col.key}" value="${esc(val)}" ${req}></div>`;
}

async function saveRecord(e, cfg, row) {
  e.preventDefault();
  const payload = {};
  cfg.columns.forEach(c => {
    const el = $(`#f_${c.key}`);
    if (!el) return;
    if (c.type === 'checkbox') payload[c.key] = el.checked;
    else if (c.type === 'number') payload[c.key] = el.value === '' ? null : Number(el.value);
    else payload[c.key] = el.value === '' ? null : el.value;
  });

  const table = State.view;
  const { error } = row
    ? await sb.from(table).update(payload).eq('id', row.id)
    : await sb.from(table).insert(payload);

  if (error) return toast(error.message, 'error');
  toast(row ? 'Updated.' : 'Created.');
  $('#recordModal').hidden = true;
  loadView(table);
}

// ── Singleton form (payment_settings) ────────────────────
function renderSingletonForm(cfg, row) {
  const body = $('#viewBody');
  body.innerHTML = `<form id="singletonForm" style="max-width:480px;background:var(--c-surface);padding:24px;border-radius:12px;">
    ${cfg.columns.map(c => fieldHTML(c, row)).join('')}
    <button type="submit" class="btn btn--primary btn--sm">Save</button>
  </form>`;
  $('#singletonForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    cfg.columns.forEach(c => {
      const el = $(`#f_${c.key}`);
      payload[c.key] = c.type === 'checkbox' ? el.checked : (el.value || null);
    });
    const { error } = row
      ? await sb.from(State.view).update(payload).eq('id', row.id)
      : await sb.from(State.view).insert(payload);
    if (error) return toast(error.message, 'error');
    toast('Saved.');
    loadView(State.view);
  };
}

// ── Product Images Manager ───────────────────────────────
let currentImagesProduct = null;

async function openImagesModal(product) {
  currentImagesProduct = product;
  $('#imagesModalTitle').textContent = `Images — ${product.name}`;
  $('#imagesModal').hidden = false;
  await refreshImagesList();
}
$('#imagesModalClose').addEventListener('click', () => $('#imagesModal').hidden = true);

async function refreshImagesList() {
  const list = $('#imagesList');
  list.innerHTML = '<p class="admin-empty">Loading…</p>';
  const { data, error } = await sb.from('product_images').select('*').eq('product_id', currentImagesProduct.id).order('sort_order');
  if (error) { list.innerHTML = `<p class="admin-empty">${esc(error.message)}</p>`; return; }
  if (!data.length) { list.innerHTML = '<p class="admin-empty">No images yet — upload one below.</p>'; return; }
  list.innerHTML = data.map(img => `
    <div class="admin-image-item ${img.is_primary ? 'is-primary' : ''}" data-id="${img.id}">
      ${img.is_primary ? '<span class="admin-image-item__primary-badge">Primary</span>' : ''}
      <img src="${esc(img.image_url)}" alt="${esc(img.alt_text || '')}" loading="lazy">
      <div class="admin-image-item__bar">
        ${!img.is_primary ? `<button data-img-act="primary" data-id="${img.id}">Set Primary</button>` : '<span></span>'}
        <button data-img-act="delete" data-id="${img.id}">Delete</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-img-act]').forEach(btn => {
    btn.addEventListener('click', () => handleImageAction(btn.dataset.imgAct, btn.dataset.id));
  });
}

async function handleImageAction(act, id) {
  if (act === 'delete') {
    if (!confirm('Delete this image?')) return;
    const { error } = await sb.from('product_images').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
  } else if (act === 'primary') {
    // Only one row per product may be is_primary=true — clear the rest first.
    await sb.from('product_images').update({ is_primary: false }).eq('product_id', currentImagesProduct.id);
    const { error } = await sb.from('product_images').update({ is_primary: true }).eq('id', id);
    if (error) return toast(error.message, 'error');
  }
  await refreshImagesList();
  loadView('products'); // refresh main table's cached row data too
}

$('#imageUploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('#imageFileInput').files[0];
  if (!file) return;
  const alt = $('#imageAltInput').value.trim();
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const path = `${currentImagesProduct.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error: upErr } = await sb.storage.from('product-images').upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from('product-images').getPublicUrl(path);
    const { count } = await sb.from('product_images').select('*', { count: 'exact', head: true }).eq('product_id', currentImagesProduct.id);
    const { error: insErr } = await sb.from('product_images').insert({
      product_id: currentImagesProduct.id,
      image_url: pub.publicUrl,
      alt_text: alt || null,
      is_primary: !count, // first image for this product becomes primary automatically
      sort_order: count || 0,
    });
    if (insErr) throw insErr;
    toast('Image uploaded.');
    e.target.reset();
    await refreshImagesList();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Upload';
  }
});

$('#imageUrlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#imageUrlInput').value.trim();
  const alt = $('#imageUrlAltInput').value.trim();
  if (!url) return;
  const { count } = await sb.from('product_images').select('*', { count: 'exact', head: true }).eq('product_id', currentImagesProduct.id);
  const { error } = await sb.from('product_images').insert({
    product_id: currentImagesProduct.id,
    image_url: url,
    alt_text: alt || null,
    is_primary: !count,
    sort_order: count || 0,
  });
  if (error) return toast(error.message, 'error');
  toast('Image added.');
  e.target.reset();
  await refreshImagesList();
});

// ── Boot ──────────────────────────────────────────────────
checkSession();
