# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary users:** Researchers, journalists, economists, and citizens exploring regional and provincial public tax performance across Turkey via an open public data discovery portal.
- **Usage situation:** Desktop and mobile web visitors quickly scanning national/regional tax realization, comparing provinces, and inspecting official revenue breakdowns without login or spreadsheet friction.

## Product Purpose

Make Turkey's 81-province tax accrual (`tahakkuk`), collection (`tahsilat`), and collection-ratio (`tahsilat / tahakkuk`) statistics immediately understandable and explorable through an interactive map, summary metrics, rankings, and frontend-driven provincial exploration on top of official Treasury and Finance Ministry datasets.

## Positioning

Turns raw multi-sheet Treasury and Finance Ministry Excel tables (2004–2026) into an open, instant spatial and comparative public tax tracker—combining a 81-province choropleth map, regional filtering, ranked tables, and raw `.xls` archive downloads in one zero-friction Turkish web portal.

## Operating Context

- Single-page Turkish (`tr-TR`) web application served via Nginx (production on Railway) and Vite/React (development).
- Consumes existing Rust/Axum endpoints (`/api/bootstrap`, `/api/years`, `/api/config`, `/api/data`, `/api/geojson`, `/api/files`, `/api/files/download`).
- Each `/api/data` query returns a single `(year, category, month)` cross-section with `summary` and 81-province `records`.
- Users inspect provinces visually on the map, click a province to open a pinned Province Detail & Ranking Panel (comparing the province against Turkey and regional averages), filter by year, month, region (`Tüm Ülke` + 7 geographical regions), and revenue/tax category, compare top/bottom provinces, sort full 81-province tables, and download original `.xls` files.

## Capabilities and Constraints

- **Frontend-only redesign scope:** Existing Rust/Axum API contract (`/api/*`) remains unchanged; all new interactions (including clicking a province on the map to open a pinned detail/ranking panel comparing against Turkey and region averages) must be built on the frontend using existing API payloads.
- **Strict self-hosted font CSP:** `frontend/nginx.conf` enforces `font-src 'self'` (only self-hosted or system fonts may load; external font CDNs are blocked).
- **SEO & PWA preservation:** Must keep the single semantic `<h1>`, Schema.org JSON-LD (`WebSite`, `WebApplication`, `Dataset`), Google Analytics (`G-K2TNMPX1TT`), `robots.txt`, `sitemap.xml`, `site.webmanifest`, `favicon.svg`, `icon-192.png`, `icon-512.png`, and `og-image.png`.
- **Official data semantics:** Raw API amounts are in `Bin TL` and scaled by `1000` for human-readable Turkish currency display (`Bin ₺`, `Milyon ₺`, `Milyar ₺`, `Trilyon ₺`). Null/missing values must render honestly rather than coercing to misleading figures.
- **Confirmed usage scene & binding visual constraint:** Daytime research and reading scene (bright, airy, trustworthy publication/analysis feel). Neon/cyber-HUD effects and cramped bureaucratic Excel-grid aesthetics are explicitly rejected; `index.html` and `site.webmanifest` dark defaults (`#0b0f19` / `color-scheme: dark`) from the legacy UI should be replaced accordingly.

## Brand Commitments

- **Product name:** Tahsilat & Tahakkuk Harita Analizi
- **Language:** Turkish (`tr-TR`) only
- **Official source attribution:** T.C. Hazine ve Maliye Bakanlığı Muhasebat Genel Müdürlüğü (`muhasebat.hmb.gov.tr`)

## Evidence on Hand

- Official public dataset served live by Rust backend (`/api/bootstrap`, `/api/data`, `/api/geojson`, `/api/files`)
- Incumbent React + TypeScript + Tailwind v4 + d3-geo + TanStack Query implementation in `frontend/src/`
- Public SEO/PWA assets in `frontend/public/` and `frontend/index.html`
- SEO checklist in `SEO_REHBERI.md`
- **Absences not to fabricate:** No user testimonials, external benchmarks, unserved historical trend endpoints, or unconfirmed institutional endorsements.

## Product Principles

1. **Public clarity in seconds:** Researchers, journalists, and citizens should grasp national, regional, and provincial performance immediately without fiscal jargon barriers.
2. **Data honesty:** Preserve exact Treasury scaling (`Bin TL` -> `₺`), missing-data states, and official attribution without inventing unsupported metrics.
3. **Richer exploration over static display:** Elevate provincial selection, comparison, and category navigation on the frontend using existing API data without modifying the backend.
4. **Standards-compliant delivery:** Respect Nginx `font-src 'self'` CSP, single-`<h1>` SEO semantics, and PWA/social metadata.

## Accessibility & Inclusion

- Clear Turkish labels and `aria-label` attributes on all filter controls, map regions, and interactive triggers (`SEO_REHBERI.md`).
- High-contrast typography, keyboard-accessible province/table inspection, and color scales that remain legible across vision differences.
