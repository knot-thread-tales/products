# 🧶 Knot & Thread Tales

> Premium handmade crochet, embroidery, personalized gifts, pet accessories, and corporate gifting platform — built for real customers, ready to launch.

A production-ready, fully static e-commerce website built with **HTML5, CSS3, and Vanilla JavaScript** — zero frameworks, zero build step, zero server. Deploys directly to **GitHub Pages**. Product data lives in **Supabase**, product images are hosted on **Google Drive**.

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/knot-thread-tales.git
cd knot-thread-tales
```

### 2. `config.js` is already filled in

Your Supabase credentials, WhatsApp number, and UPI ID are already set in `config.js`. Double-check before going live:

```js
const CONFIG = {
  supabase: {
    url: 'https://vgbidligpmrblgmngtqs.supabase.co',
    anonKey: 'sb_publishable_22xgvBSlk5b4AkUoKsz0jw_VpTdgVb-',
  },
  whatsapp: { number: '917075636381' },
  upi:      { id: 'rakeshroy001@icici', name: 'Knot & Thread Tales' },
  business: { email: 'knotthreadtales@gmail.com', phone: '+91 70756 36381' },
};
```

> ⚠️ The Supabase `anonKey` here is a **publishable/anon key** — safe to expose in client-side code by design (read-only via RLS policies). Never put a `service_role` key in `config.js`.

### 3. Set up your database

Run these 3 files **in order** in the Supabase SQL Editor (Dashboard → SQL Editor → New Query):

| Order | File | What it does |
|---|---|---|
| 1 | `database/01_schema.sql` | Creates all 9 tables + indexes |
| 2 | `database/02_rls.sql` | Enables public read-only access |
| 3 | `database/03_seed_data.sql` | Inserts categories, FAQs, testimonials, reviews, payment & business settings |

Products in `03_seed_data.sql` reference placeholder image URLs (`REPLACE_IMAGE_ID_...`) — see the **Google Drive Image Setup** section below to swap these for your real product photos (every product ships with 3–4 image slots ready to fill).

> **Using CSVs instead of SQL?** The Supabase Table Editor's "Import from CSV" feature works great for `01_categories.csv` and `02_products.csv` directly. However, `03_product_images.csv`, `04_featured_products.csv`, and `07_reviews.csv` reference products by `product_code` (e.g. `KTT-001`) rather than the auto-generated numeric `id` — because the CSVs intentionally drop all `id` columns and let Supabase assign them. The Table Editor's CSV importer can't auto-resolve a text code into a foreign-key `id` on its own, so for those three files either: (a) run the equivalent block from `03_seed_data.sql` instead (it already does this lookup via SQL `JOIN`), or (b) import the CSV into a temporary staging table first, then run a short `INSERT ... SELECT ... JOIN products ON product_code` to populate the real table. The SQL route is simpler if you're not customising the seed data.

### 4. Deploy to GitHub Pages

1. Push all files to a GitHub repository (public or private)
2. Go to **Settings → Pages**
3. Source: **Deploy from a branch → `main` → `/ (root)`**
4. Save — your site goes live at `https://yourusername.github.io/knot-thread-tales/`
5. (Optional) Add a custom domain under **Settings → Pages → Custom domain** and update the `<link rel="canonical">` + Open Graph URLs in `index.html` to match

That's it — no build step, no `npm install`, no server.

---

## 🗄️ Database Structure

| Table | Purpose |
|---|---|
| `categories` | Crochet, Embroidery, Pet Accessories, etc. |
| `products` | Main product catalog — **no image column**, see below |
| `product_images` | **Every** product image lives here (1 to N per product) — powers the card thumbnail, the hover mini-slider, and the full-screen product gallery slider |
| `reviews` | Per-product customer reviews |
| `featured_products` | Controls homepage "Featured" carousel |
| `faqs` | Powers both homepage FAQ preview and `/faq` page |
| `testimonials` | Homepage scrolling testimonial marquee |
| `payment_settings` | UPI ID, merchant name, optional QR image |
| `business_settings` | Key-value store for site-wide settings |

Full column definitions are in `database/01_schema.sql`.

### Why no `main_image` column on `products`?

Every product image — whether it's the one shown on the product card or the fourth photo in a detail gallery — lives in `product_images`. Mark exactly one row per product as `is_primary = true` and that becomes the card thumbnail automatically; the rest populate the slider in `sort_order`. This means a product with 1 image and a product with 6 images use the exact same data model — no special-casing, no separate "thumbnail" field to keep in sync.

### Row-Level Security (RLS)

All 9 tables have RLS enabled with a single `public_read` policy — anyone can `SELECT`, nobody can `INSERT`/`UPDATE`/`DELETE` using the anon key. **You manage all content via the Supabase Table Editor UI** (Dashboard → Table Editor), not through the website. This keeps the static site fully read-only and secure.

---

## 🖼️ Google Drive Image Setup (replaces Cloudinary)

No image CDN account needed — just use Google Drive. Every image, for every product, goes into a single table: `product_images`.

### Step-by-step:

1. **Upload your product photos** to Google Drive (any folder) — upload all angles/shots for one product together (front, detail close-up, lifestyle, alt colour, etc).
2. **Right-click each file → Share → General access → "Anyone with the link"** (must be set to viewer, not restricted).
3. **Copy each share link** — it looks like:
   ```
   https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing
   ```
4. **Insert one row per image** into `product_images`, all pointing at the same `product_id` (or `product_code` if you're using the CSVs):

```sql
INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES
  (1, 'https://drive.google.com/file/d/FILE_ID_1/view?usp=sharing', 'Front view',        true,  1),
  (1, 'https://drive.google.com/file/d/FILE_ID_2/view?usp=sharing', 'Close-up detail',   false, 2),
  (1, 'https://drive.google.com/file/d/FILE_ID_3/view?usp=sharing', 'Styled lifestyle',  false, 3),
  (1, 'https://drive.google.com/file/d/FILE_ID_4/view?usp=sharing', 'Alternate colour',  false, 4);
```

The website automatically converts every share link into a fast-loading thumbnail URL behind the scenes (`drive.google.com/thumbnail?id=...&sz=w800` for full-size, `&sz=w480` for card thumbnails) — you don't need to do any conversion yourself. Just paste the normal "share" link.

### How many images should I add?

- **Minimum 1** — the product still works fine, card shows a single static image, gallery shows one slide with zoom.
- **Recommended 3–4** — front view, a close-up detail/texture shot, a lifestyle/in-use shot, and (if relevant) a colour-variant shot. This is what the seed data ships with for every sample product.
- **No hard maximum** — add as many as you like; the slider, dots, and thumbnail strip all scale automatically.

### `is_primary` — which image shows on the card?

Mark **exactly one** row per product as `is_primary = true` (the schema enforces this with a unique partial index — you can't accidentally mark two as primary for the same product). That image becomes:
- The single image shown on product cards with only 1 photo
- The first slide / first thumbnail in the gallery slider for products with multiple photos

If you forget to set `is_primary`, the website falls back to whichever image has the lowest `sort_order`.

### Tips for best results:
- Use square or near-square images (1:1 ratio) — they crop most consistently across cards, sliders, and thumbnails.
- Compress images to **under 2MB** before uploading for fast load times (Google Drive doesn't auto-optimize like a CDN would).
- Make sure sharing is set to **"Anyone with the link"** on every single file — if even one is restricted, that image will fail to load for visitors.
- For the UPI QR code (`payment_settings.qr_image`), the same Google Drive process works. If left blank, the site auto-generates a QR code on the fly using your UPI ID.

---

## 🖼️ Multi-Image Slider & Zoom — What Customers See

Every product with 2+ images automatically gets:

| Feature | Where |
|---|---|
| **Photo-count badge** (📷 3) | Top-right of the product card, only shown when there's more than 1 image |
| **Auto-cycling preview** | Hovering a card on desktop cycles through all its photos every ~0.9s with little dot indicators — a sneak peek before opening the product |
| **Full slider with arrows + dots** | Inside the product detail modal — swipe on mobile, click arrows on desktop |
| **Thumbnail strip** | Click any thumbnail to jump straight to that image |
| **Click-to-zoom** | Click/tap the main image to zoom in ~2.2×; on desktop, move the mouse while zoomed to pan around |
| **Fullscreen lightbox** | Dedicated fullscreen button opens an immersive viewer with its own arrows, swipe support, counter, and independent zoom |
| **Keyboard navigation** | Arrow keys move between slides when the gallery is focused or in fullscreen |

All of this is pure CSS transforms + vanilla JS — no slider library, no extra page weight.

---



## 📱 WhatsApp Order Flow

1. Customer clicks **"Order via WhatsApp"** on any product card or detail view
2. An order form modal opens — name, phone, address, pincode, quantity, customization notes
3. On submit: confetti plays 🎉, a formatted WhatsApp message is generated, customer is redirected to WhatsApp
4. A payment modal automatically opens with the UPI QR code

## 💳 UPI Payment Flow

Loaded from the `payment_settings` table:
- QR code (Google Drive image, or auto-generated via `api.qrserver.com` if left blank)
- UPI ID with one-click copy
- Download QR / Share QR buttons
- Optional payment screenshot upload + transaction reference field for the customer's own reference

---

## ✨ Customer Engagement Features

These were added specifically so visitors stay engaged and convert, rather than bouncing off a static catalog:

| Feature | What it does |
|---|---|
| **Floating WhatsApp button** | Pulsing button, bottom-right, on every page — with a one-time tooltip nudge after 4 seconds |
| **Live "X people viewing" counter** | Simulated social-proof counter on the hero, fluctuates every 5s |
| **"Today's offer ends in…" countdown** | Live ticking countdown to midnight, creates urgency |
| **Recent purchase ticker** | Rotating "Priya from Hyderabad ordered..." messages near the hero |
| **Confetti burst** | Fires when a customer successfully submits an order |
| **Quick View on hover** | Product cards reveal a "Quick View" button on hover for fast browsing without leaving the grid |
| **Scroll-reveal animations** | Sections fade/slide in as the visitor scrolls — staggered per card |
| **Parallax hero background** | Subtle depth effect as the user scrolls past the hero |
| **Animated category & product cards** | Lift, shine-sweep, and zoom effects on hover |
| **Infinite scrolling testimonials** | Auto-scrolling marquee, pauses on hover |

All of these are intentionally lightweight (pure CSS animations + small JS, no external animation libraries) so Lighthouse performance stays high.

---

## 🔧 File Structure

```
knot-thread-tales/
├── index.html              # Single-page app — all pages via hash routing
├── styles.css              # Complete design system + engagement-feature styles
├── app.js                  # Application logic, router, Supabase client, Drive image handling
├── config.js                # Live credentials — Supabase, WhatsApp, UPI, business info
├── .gitignore
├── robots.txt
├── sitemap.xml
├── README.md
└── database/
    ├── 01_schema.sql        # Table definitions
    ├── 02_rls.sql           # Row-level security policies
    ├── 03_seed_data.sql     # Full seed data (run via SQL editor)
    └── csv/                 # Same seed data as CSVs (import via Table Editor UI)
        ├── 01_categories.csv
        ├── 02_products.csv
        ├── 03_product_images.csv
        ├── 04_featured_products.csv
        ├── 05_faqs.csv
        ├── 06_testimonials.csv
        ├── 07_reviews.csv
        ├── 08_payment_settings.csv
        └── 09_business_settings.csv
```

---

## 🎨 Design System

| Token | Value |
|---|---|
| Primary | `#A66E4A` |
| Secondary | `#D8B89C` |
| Accent | `#E6C9A8` |
| Background | `#FAF7F2` |
| Surface | `#FFFFFF` |
| Text | `#2C2623` |
| Text Secondary | `#6E625A` |
| Success | `#4CAF50` |

**Fonts:** Playfair Display (headings) + Inter (body), loaded from Google Fonts with `display=swap`.

---

## 📄 Pages & Routes

| Route | Description |
|---|---|
| `/` | Home — hero, live offer countdown, featured, trending, categories, testimonials, FAQ |
| `/products` | All products with filtering, sorting, pagination |
| `/category/:slug` | Category-filtered listing |
| `/search?q=...` | Live search with debounce |
| `/about` | Brand story and values |
| `/faq` | Full FAQ list |
| `/contact` | Contact form → WhatsApp |
| `/reviews` | All customer reviews |
| `/privacy` | Privacy Policy |
| `/terms` | Terms & Conditions |

---

## ⚡ Performance

- No frameworks, no build step, no `node_modules`
- Google Fonts with `preconnect` + `display=swap`
- Google Drive thumbnail endpoint (`sz=w800` / `sz=w480`) keeps payload small
- `loading="lazy"` + `decoding="async"` on all product images
- IntersectionObserver-based scroll reveal (no scroll-jank libraries)
- In-memory cache layer (5-min TTL) on all Supabase REST calls — avoids redundant fetches when navigating back and forth
- `prefers-reduced-motion` respected throughout

## ♿ Accessibility

- WCAG AA color contrast
- Full keyboard navigation, visible focus states
- ARIA labels/roles on dialogs, nav, search, forms
- Skip-to-content link
- Screen-reader-friendly product cards and modals

## 🔍 SEO

- Open Graph + Twitter Card meta tags
- JSON-LD structured data: `Organization`, `LocalBusiness`, `WebSite` + `SearchAction`
- Canonical URL, `robots.txt`, `sitemap.xml`
- Semantic HTML5 (`header`, `main`, `nav`, `footer`, `article`, `section`)

---

## 🛡️ Admin Panel (manage everything without touching Supabase)

`admin.html` is a second, separate page (deployed alongside `index.html` at `/admin.html`) that lets you manage every table — products, images, categories, FAQs, testimonials, payment settings, announcements — plus review orders and moderate customer reviews, all from a normal web UI. It is **not linked from the customer-facing site** — bookmark the URL yourself.

**One-time setup:**
1. Run `database/04_new_features.sql` in the Supabase SQL Editor (adds the tables/policies below and is safe to re-run).
2. In the Supabase Dashboard → **Authentication → Users → Add user**, create your own login (email + password). There is no public sign-up — that's the only account `admin.html` will accept.
3. Open `admin.html` on your deployed site and sign in.

**What it adds:**

| Feature | Where it lives |
|---|---|
| **Announcements** — a dismissible top banner for discounts/news, with optional link, active window (`starts_at`/`ends_at`), and type (info/discount/feature) | new `announcements` table, managed from **Announcements** tab |
| **Orders** — every WhatsApp order a customer places is now also logged to the database (product, customer details, quantity, status), even if they close WhatsApp before sending | new `orders` table, managed from **Orders** tab — status dropdown updates in place |
| **Review moderation** — customers can submit a review from any product page; it's hidden until you approve it from the **Reviews** tab | `reviews.approved` column (defaults `true` for your existing seed reviews, `false` for new customer submissions) |
| **Product image uploads** — click **Images** next to any product to upload photos directly (stored in a `product-images` Supabase Storage bucket) or paste an external URL, set which one is primary, and delete images | new `product-images` Storage bucket |
| **Master data CRUD** — Products, Categories, FAQs, Testimonials, Payment Settings all editable in place | RLS write policies scoped to `auth.role() = 'authenticated'` |

Anonymous site visitors keep the exact same read-only access as before (plus the ability to submit an order or an unapproved review) — nothing about the public site's security model changes.

---

## 🖼️ Why product images were failing to load

`drive.google.com/thumbnail?...` and `/uc?export=view` are **undocumented, unsupported Google endpoints** — Google can and does rate-limit or 403 them without warning, which is why some product photos loaded and others silently fell back to the placeholder. The site now tries three different Drive URL formats before giving up (`lh3.googleusercontent.com/d/...` first, since it hotlinks most reliably, then the two older formats), but the durable fix is to stop depending on Drive entirely: use the **Images** button in `admin.html` to upload photos straight to the new `product-images` Storage bucket. Supabase Storage URLs are plain, permanent `https://` links and need no special handling — the site already renders any non-Drive URL as-is.

---

## 🐛 Why some products didn't show up in the listing

Postgres does not guarantee a stable order for rows that tie on the sort column — and if your seed data inserted several products in one statement, they can share the *exact same* `created_at` timestamp. Without a tiebreaker, `ORDER BY created_at DESC LIMIT 12 OFFSET 0` can return a different set of "first 12" rows on different requests, so a product can end up skipped by every page. Every product query now sorts by `created_at, id` (or `id` alone for search) so the order — and therefore which page a product lands on — is always the same. Search was also only matching the `name` column before, so searching for a product code like `KTT-001` returned nothing even though the product existed; it now matches name, product code, and description.

---

## 🛠️ Common Customizations

**Change WhatsApp number** → `CONFIG.whatsapp.number` in `config.js`

**Change brand colors** → CSS custom properties under `:root` in `styles.css`

**Add a new page** → add `<div id="new-page" class="page" hidden>` in `index.html`, then `Router.on('/new-page', renderNewPage)` in `app.js`

**Add more products** → insert a row into `products` via the Supabase Table Editor, then add 1+ matching rows into `product_images` with that product's `id` (mark one `is_primary = true`). Or extend `database/csv/02_products.csv` + `03_product_images.csv` and re-import.

**Disable an engagement feature** (e.g. live visitor counter) → comment out the relevant `init...()` call inside `initApp()` or `renderHero()` in `app.js`

**Swap fonts** → update the Google Fonts `<link>` in `index.html` and the `--font-display` / `--font-body` variables in `styles.css`

---

## ✅ Pre-Launch Checklist

- [ ] Run all 3 SQL files (or import all 9 CSVs) into Supabase
- [ ] Replace every `REPLACE_IMAGE_ID_xxx` placeholder with real Google Drive share links (3–4 per product recommended)
- [ ] Confirm exactly one image per product is marked `is_primary = true`
- [ ] Set every uploaded Drive file to **"Anyone with the link"** sharing
- [ ] Open a multi-image product on desktop and mobile — check slider arrows, swipe, dots, thumbnails, zoom, and fullscreen all work
- [ ] Hover a multi-image product card and confirm the mini-slider auto-cycles
- [ ] Test placing a real order end-to-end (WhatsApp message should arrive correctly formatted)
- [ ] Verify UPI QR code scans correctly to your account
- [ ] Update `og-image`, canonical URL, and sitemap URLs in `index.html` / `sitemap.xml` once your final domain is known
- [ ] Test on a real mobile device (WhatsApp deep links behave differently on iOS vs Android vs desktop)
- [ ] Check GitHub Pages is serving over HTTPS (it does by default)

---

## 📞 Support

Built for **Knot & Thread Tales**, Hyderabad. For platform questions, raise an issue on the GitHub repository.

Crafted with 💛
