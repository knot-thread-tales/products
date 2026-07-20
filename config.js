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
};

Object.freeze(CONFIG);
