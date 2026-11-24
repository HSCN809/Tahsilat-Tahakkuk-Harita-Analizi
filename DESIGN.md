---
name: Türkiye Vergi Atlası
description: Devlet İstatistik Yıllığı — Archival daylight publication design system for Turkey's 81-province tax accrual and collection statistics.
colors:
  paper-bone: "#F7F5F0"
  plate-white: "#FFFFFF"
  inset-ivory: "#FCFBF8"
  warm-cream: "#FAF9F6"
  muted-ash: "#EFECE4"
  ink-charcoal: "#1E242B"
  ink-slate: "#525A63"
  rule-hairline: "#D9D4C9"
  rule-subtle: "#EAE5DA"
  control-stroke: "#C8C1B4"
  hazine-crimson: "#9E2A2B"
  hazine-crimson-hover: "#822021"
  crimson-tint: "#F9EDED"
  aegean-teal: "#1B6B63"
  teal-tint: "#E9F3F1"
  ochre-text: "#8A6518"
  ochre-map: "#C9A25E"
typography:
  display:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0em"
  body:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "'Source Sans 3', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  none: "0px"
  xs: "2px"
  sm: "3px"
  md: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.hazine-crimson}"
    textColor: "{colors.plate-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.hazine-crimson-hover}"
  button-chip:
    backgroundColor: "{colors.inset-ivory}"
    textColor: "{colors.ink-charcoal}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  plate-card:
    backgroundColor: "{colors.plate-white}"
    textColor: "{colors.ink-charcoal}"
    rounded: "{rounded.md}"
    padding: "20px"
  input-field:
    backgroundColor: "{colors.warm-cream}"
    textColor: "{colors.ink-charcoal}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  segment-tab-active:
    backgroundColor: "{colors.ink-charcoal}"
    textColor: "{colors.plate-white}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
---

# Design System: Türkiye Vergi Atlası

## Overview

**Creative North Star: "Devlet İstatistik Yıllığı"**

Türkiye Vergi Atlası treats public fiscal exploration as an authoritative Turkish statistical yearbook plate built for daytime reading and economic research. Rather than floating glass cards, glowing dark dashboards, or cramped spreadsheet grids, the interface grounds every figure on warm archival paper framed by crisp one-pixel hairlines and heavy charcoal datum rules.

Density stays purposeful and scannable: national totals occupy a single unified horizontal strip divided by vertical hairlines, geographic choropleth tones map performance from Treasury crimson through warm ochre to Aegean teal, and every tabular number aligns vertically across summary strips, ranking panels, and the full 81-province ledger.

**Key Characteristics:**
- Warm archival daylight field separated cleanly from crisp white data plates without decorative blurs or drop shadows.
- Structural grammar driven by 1px stone hairlines, 2px charcoal datum rules under headers, and targeted 2px top rules signaling active sort or pinned inspection.
- Self-hosted variable-free `Source Sans 3` with strict `tabular-nums` alignment and `tr-TR` comma-decimal punctuation on all currency and ratio figures.
- Synchronized province pinning linking map polygons, Top 5 / Bottom 5 leaderboards, and the searchable 81-province ledger to a live regional and national benchmark panel.

## Colors

The daylight palette pairs neutral bone paper and ink tones with three disciplined semantic accents drawn from classical cartography and Turkish Treasury publishing.

### Primary
- **Hazine Crimson** (`paper-bone` contrast ink / `hazine-crimson`): Anchors primary export actions (`Ham .xls İndir`), pinned inspection top rules, active period tags, low realization (`< 50%`) warning figures, and the lower bound of the choropleth gradient. Deepens to **Hazine Crimson Hover** on interaction.

### Secondary
- **Aegean Teal** (`aegean-teal`, paired with `teal-tint` when tinted): Communicates strong tax realization (`>= 75%`), positive national/regional percentage-point variances (`+puan`), and the upper end of the geographic choropleth scale.

### Tertiary
- **Ochre Amber** (`ochre-text` for legible text, `ochre-map` for graphic bars and map midpoints): Marks intermediate realization (`50%` to `74,99%`), choropleth 50% midpoints, and regional average benchmark comparison bars without overpowering primary crimson/teal signals.

### Neutral
- **Paper Bone** (`paper-bone`): Page ground canvas supporting long reading sessions.
- **Plate White** (`plate-white`): Primary card, header, filter bar, tooltip, and modal surface.
- **Inset Ivory** (`inset-ivory`) & **Warm Cream** (`warm-cream`): Recessed map well, stat sub-blocks, alternate hover rows, and form control fills.
- **Muted Ash** (`muted-ash`): Loading skeleton blocks, progress bar tracks, and subtle hover washes.
- **Ink Charcoal** (`ink-charcoal`) & **Ink Slate** (`ink-slate`): High-contrast primary headings/figures and secondary labels/metadata.
- **Rule Hairline** (`rule-hairline`), **Rule Subtle** (`rule-subtle`), and **Control Stroke** (`control-stroke`): Structural borders, table dividers, and form boundaries.

**The Semantic Threshold Rule.** Realization percentages and choropleth ramps always speak through the exact three-band scale: Aegean Teal at `>= 75%`, Ochre from `50%` through `74,99%`, and Hazine Crimson below `50%`—never hardcode teal onto underperforming provinces.

**The Single Anchor Rule.** Reserve solid Hazine Crimson buttons and badges for one primary action per region (`Ham .xls İndir`, `En Düşük 5` toggle, `Zip Olarak İndir`), leaving navigation and metric tabs in charcoal Ink Charcoal so visual gravity stays clear.

## Typography

**Display Font:** `'Source Sans 3'` self-hosted via `@fontsource/source-sans-3` (with `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
**Body Font:** `'Source Sans 3'` (weights 400, 500, 600, 700 bundled locally to comply with `font-src 'self'` CSP)

**Character:** Humanist geometric clarity engineered for dense Turkish diacritics (`ğ, ı, İ, ö, ş, ü`) and high-speed comparative scanning between headers, map tooltips, and 81-row ledger columns.

### Hierarchy
- **Display** (`700` bold, `24px` / `1.5rem`, `line-height: 1.2`, `letter-spacing: -0.02em`, `tabular-nums`): Summary strip headline figures (`Toplam Tahakkuk`, `Toplam Tahsilat`, `Tahsilat / Tahakkuk Oranı`).
- **Headline** (`700` bold, `20px` / `1.25rem` desktop and `18px` mobile, `tracking-tight`): Single semantic page `<h1>` in the institutional masthead and modal titles.
- **Title** (`700` bold, `16px` / `1rem` to `18px`): Panel headings (`81 İl Coğrafi Dağılımı`, `İl Bazlı Tam Dağılım Kütüğü`, `Oran Sıralaması`, pinned province uppercase title).
- **Body** (`400`–`600`, `14px` / `0.875rem` with `13px` compact table cells): Control values, province names, leaderboard metrics, and searchable ledger rows.
- **Label** (`700` bold uppercase `11px` / `0.6875rem`, `letter-spacing: 0.04em` to `0.06em`; `12px` semibold for contextual labels): Table headers, summary metric captions, filter labels, and period kesiti stamps.

**The Turkish Locale Rule.** Every numeric, currency (`Bin TL` raw input scaled `× 1000` into `Bin ₺` / `Milyon ₺` / `Milyar ₺` / `Trilyon ₺`), and percentage output formats strictly with `tr-TR` comma decimals (`%81,89`, `+3,71 puan`) inside `tabular-nums` containers—never mix dot decimals.

## Layout

Content spans up to `1440px` (`px-4` mobile, `sm:px-7` tablet/desktop) atop the scrollable Paper Bone field with vertical breathing room (`py-5`, `gap-5`).
- **Institutional Masthead:** Full-width Plate White header bounded below by a `2px` Ink Charcoal datum line.
- **Sticky Filter Bar:** Directly docked under the header (`12`-column desktop grid allocating `2 + 2 + 3 + 5` columns for `Yıl`, `Ay`, `Bölge`, and searchable `Kalem`; stacks with uniform `44px` (`w-11`) labels on mobile `390px` viewports so every input shares a straight vertical edge).
- **Unified Summary Strip:** Single Plate White container partitioned into three equal columns on `md+` (`1px` dividers, stacking cleanly on mobile) with a `2px` top sort indicator matching the active ledger sort column.
- **Primary Analysis Grid (`8:4` ratio on `lg`):** Left 8 columns house the responsive SVG choropleth map (`16:9` aspect on mobile, dynamically capped desktop height with interactive `Tahakkuk / Tahsilat / Oran (%)` mode selector and gradient scale); right 4 columns stack the sticky `ProvinceInspector` (2px crimson top border when pinned) above the `Oran Sıralaması` Top 5 / Bottom 5 table.
- **Full 81-Province Ledger (`#il-kutugu`):** Placed below the fold with live search filter and sortable headers; hides redundant `Bölge` and standalone `Tahakkuk` columns on narrow viewports by pairing an unbroken `whitespace-nowrap` `Tahakkuk` sub-line directly beneath the province button.

**The Ruled-Plate Rhythm Rule.** Use vertical spacing (`20px`) between structural plates and `1px` internal hairlines inside multi-column bands rather than wrapping individual stats in nested rounded boxes.

## Elevation & Depth

At rest, every surface is completely flat—depth and reading order rely purely on tonal separation (`Paper Bone` ground vs. `Plate White` plates vs. `Inset Ivory` wells) and border weight hierarchy (`1px` hairline vs. `2px` datum/top rule). Elevations appear exclusively on transient floating layers (the sticky filter bar boundary, hovered map tooltip, open category listbox dropdown, and modal dialog).

### Shadow Vocabulary
- **Tooltip Elevation** (`0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` via Tailwind `shadow-md`): Crisp hovered map province callout framed by `1px` Ink Charcoal border, flipping both horizontally (`alignLeft`) and vertically (`alignTop`) so edge provinces never clip.
- **Floating Menu Elevation** (`shadow-lg`): Searchable `Kalem` dropdown panel anchored directly under its trigger.
- **Modal Dialog Elevation** (`shadow-xl` over `45%` Ink Charcoal backdrop): Centered `Ham Veri İndir (.xls)` dialog box with automatic focus entry and close restoration.

**The Flat-By-Default Rule.** Never add ambient shadows, glass backdrop blurs, or colored hover glows to static panels, metric strips, or province rows.

## Shapes

Architectural sharpness defines the yearbook aesthetic: subtle micro-radii soften interactive edges without drifting into pill-shaped consumer widgets.
- **Plates & Modals:** `4px` corner radius (`ProvinceLedger`, `Leaderboard`, `DownloadModal`) or sharp `0px` corners on ruled multi-column bands (`StatsCards`).
- **Map Wells & Table Frames:** `2px` radius (`Map` SVG well, skeleton loaders, table wrapper, proportional benchmark tracks, custom scrollbar thumbs).
- **Compact Controls & Badges:** `3px` radius for segmented tabs, quick-pick province chips, active province badge (`Seçili: ANKARA`), and tooltips; `4px` radius for selects, text inputs, and action buttons.
- **Hairline Hierarchy:** Outer containers use `1px` `Rule Hairline`; panel header dividers use `1px` `Ink Charcoal`; left/right borders strictly stay `<= 1px`—never use thick vertical colored stripes along card edges.

## Components

Every component pairs razor-thin structure with accessible contrast (`>= 4.5:1`), localized focus indicators, and synchronous cross-filtering.

### Buttons
- **Shape:** Subtle rectangular geometry (`4px` radius on standalone actions; `3px` on compact quick-pick chips and close controls).
- **Primary (`Ham .xls İndir`, `Zip Olarak İndir`):** Solid Hazine Crimson fill, Plate White uppercase-free bold/semibold `12px` label, `8px 14px` to `10px 16px` padding, shifting to Hazine Crimson Hover on pointer hover.
- **Hover / Focus:** `150ms` background transition; native keyboard `:focus-visible` renders a crisp `2px solid` Hazine Crimson ring with `2px` offset (never suppressed with `outline: none`).
- **Secondary / Ghost:** Warm Cream fill with `Control Stroke` border for reset/select-all actions (`Tümünü Seç`, `Seçimi Bırak`), or Inset Ivory pill-free `3px` chips (`ANKARA`, `BURSA`) for instant pinning.

### Chips & Tabs
- **Segmented Metric & Rank Switchers:** Grouped inline strip with `1px` `Control Stroke` perimeter and `1px` `Rule Hairline` cell dividers (`Tahakkuk | Tahsilat | Oran (%)` in `Ink Charcoal` when active; `En Yüksek 5 | En Düşük 5` toggling Aegean Teal and Hazine Crimson).
- **Pinned Province Tag (`Seçili: <IL>`):** Crimson Tint (`#F9EDED`) surface with `1px` `#E6C5C5` border, uppercase `12px` Hazine Crimson text, and one-click clear icon inside the map header.

### Cards / Plates
- **Corner Style:** `0px` on `StatsCards` band, `4px` on standalone desktop/mobile plates (`ProvinceInspector`, `Leaderboard`, `ProvinceLedger`, `Map`).
- **Background:** Plate White (`#FFFFFF`) container resting on `Paper Bone` (`#F7F5F0`), accented with `Inset Ivory` (`#FCFBF8`) summary wells inside the inspector.
- **Shadow Strategy:** None at rest; uses `border-t-2` (`2px`) in Ink Charcoal/Aegean Teal (summary sort) or Hazine Crimson (pinned inspector) to signal state.
- **Border & Padding:** `1px solid` `Rule Hairline` perimeter with `20px` (`p-5`) card padding and `14px` (`py-3.5 px-5`) stat cell rhythm.

### Inputs / Fields
- **Style:** Warm Cream (`#FAF9F6`) background, `1px` `Control Stroke` (`#C8C1B4`) border, `4px` radius (`3px` on compact dropdown search), `6px 10px` to `8px 12px` padding.
- **Focus:** Border shifts to Hazine Crimson while inheriting global `2px` `:focus-visible` outline (`caret-color: #9E2A2B`, selection highlight `#9E2A2B` on `#FFFFFF`).
- **Custom Scrollbar & States:** Thin `8px` archival stone scrollbar thumbs (`#C8C1B4`); disabled/empty actions drop to `40%` opacity with `not-allowed` cursor.

### Province Inspector & Cross-Filter Tables (Signature Components)
- **ProvinceInspector:** Sticky-flow panel replacing unpinned onboarding prompt (`Ankara` / `Bursa` / top province quick buttons) with uppercase province title, national (`#9/81`) & regional (`#1/13`) ranks, `2`-column `Tahakkuk`/`Tahsilat` well, and three proportional progress bars (`İl Tahsilat Oranı` shaded via `getRatioTone`, `<Bölge> Ortalaması` in Ochre, `Türkiye Ortalaması` in Ink Charcoal) plus explicit percentage-point variance (`+puan` / `-puan`).
- **Interactive Tables (`Leaderboard` & `ProvinceLedger`):** Clickable rows synchronized with `selectedProvince` (`#F9EDED` selected wash, `#FCFBF8` hover), paired with native `<button type="button" aria-pressed>` triggers inside each province cell for keyboard navigation.

## Do's and Don'ts

### Do:
- **Do** keep `::selection`, `caret-color`, `:focus-visible`, `.tabular-nums`, and scrollbar styling bound to `:root` archival tokens so browser chrome matches the printed page.
- **Do** format every Turkish numeric metric and percentage via shared `formatCurrency` (`Bin TL × 1000`) and `formatPercent` (`tr-TR` 2-decimal comma formatting) helpers, and resolve all ratio text/bar tones via `getRatioTone`.
- **Do** render every map feature, table province link, and modal control with accessible keyboard buttons (`tabIndex`, `aria-pressed`, `Enter`/`Space`, initial modal focus + return focus).
- **Do** keep labels above/beside headings cleanly omitted and rely on the heading + hairline datum rule to establish section authority.

### Don't:
- **Don't** introduce dark-mode surfaces (`#0b0f19`), neon gradients, frosted backdrop blurs, or drop-shadow cards on static containers.
- **Don't** add kicker/eyebrow labels above section or modal headings, emoji icons (use crisp Lucide vector icons), or `> 1px` colored side borders along cards or list items.
- **Don't** reference external font CDNs (violates Nginx `font-src 'self'` CSP); keep fonts bundled via `@fontsource/source-sans-3`.
- **Don't** suppress focus outlines (`focus:outline-none`) or split formatted currency units across mobile lines (`whitespace-nowrap` on currency totals).
