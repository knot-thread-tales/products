// ============================================================
// Knot & Thread Tales — Configuration
// ============================================================

const CONFIG = {
  supabase: {
    url: 'https://ktsvofdifhhitlhzgsut.supabase.co',
    anonKey: 'sb_publishable_4vqZsp517MJ_jsJiLvOY_w_6xoXt5G9',
  },
  whatsapp: {
    number: '917075636381',
    businessName: 'Knot & Thread Tales',
  },
  upi: {
    id: 'rakeshroy001@icici',
    name: 'Knot & Thread Tales',
  },
  business: {
    name: 'Knot & Thread Tales',
    tagline: 'Crafted with love, wrapped in warmth.',
    email: 'knotthreadtales@gmail.com',
    phone: '+91 70756 36381',
    address: 'Hyderabad, Telangana, India',
    instagram: 'https://instagram.com/knotandthreadtales',
    currency: '₹',
    deliveryDays: '5–7 business days',
  },
  pagination: {
    productsPerPage: 12,
    reviewsPerPage: 8,
  },
  search: {
    debounceMs: 320,
  },
  cache: {
    ttlMs: 5 * 60 * 1000,
  },
  // ── Theme ──────────────────────────────────────────────────
  // Mirrors the CSS custom properties defined in the ":root" tokens
  // block of styles.css. Edit values here to re-theme the site — no
  // need to touch styles.css. applyTheme() in app.js pushes these
  // onto :root at load, overriding the CSS defaults.
  theme: {
    colors: {
      primary:      '#A66E4A',
      primaryDark:  '#8a5836',
      primaryLight: '#be8a6b',
      secondary:    '#D8B89C',
      accent:       '#E6C9A8',
      bg:           '#FAF7F2',
      surface:      '#FFFFFF',
      text:         '#2C2623',
      text2:        '#6E625A',
      text3:        '#9c8f87',
      success:      '#4CAF50',
      error:        '#E53E3E',
      border:       '#EDE4DB',
      borderDark:   '#d5c5b5',
    },
    radius: {
      sm:   '6px',
      md:   '12px',
      lg:   '20px',
      xl:   '32px',
      full: '9999px',
    },
    shadow: {
      sm: '0 1px 4px rgba(44,38,35,.06), 0 2px 8px rgba(44,38,35,.04)',
      md: '0 4px 16px rgba(44,38,35,.10), 0 1px 4px rgba(44,38,35,.06)',
      lg: '0 8px 32px rgba(44,38,35,.14), 0 2px 8px rgba(44,38,35,.08)',
      xl: '0 20px 60px rgba(44,38,35,.18)',
    },
    transition: {
      fast: '150ms ease',
      mid:  '280ms ease',
      slow: '450ms ease',
    },
    font: {
      display: "'Playfair Display', Georgia, serif",
      body:    "'Inter', system-ui, -apple-system, sans-serif",
    },
    layout: {
      maxWidth: '1240px',
    },
  },
};

Object.freeze(CONFIG);
