---
name: Forest & Gold — Handoff
colors:
  surface: '#19382D'
  surface-dim: '#142D25'
  surface-bright: '#315345'
  surface-container-lowest: '#10241D'
  surface-container-low: '#162F26'
  surface-container: '#1C3B30'
  surface-container-high: '#27483B'
  surface-container-highest: '#315345'
  on-surface: '#F5F2E9'
  on-surface-variant: '#D3DAD0'
  inverse-surface: '#F5F2E9'
  inverse-on-surface: '#19382D'
  outline: '#A4B4A7'
  outline-variant: '#536C5D'
  surface-tint: '#D8B65C'
  primary: '#19382D'
  on-primary: '#FFFFFF'
  primary-container: '#DDE9DD'
  on-primary-container: '#173A2B'
  inverse-primary: '#B9D2C1'
  secondary: '#D8B65C'
  on-secondary: '#29230F'
  secondary-container: '#F4E8C6'
  on-secondary-container: '#5E4718'
  tertiary: '#F5F2E9'
  on-tertiary: '#19382D'
  tertiary-container: '#D9E2D7'
  on-tertiary-container: '#263D30'
  error: '#FFB4AB'
  on-error: '#690005'
  error-container: '#93000A'
  on-error-container: '#FFDAD6'
  primary-fixed: '#DDE9DD'
  primary-fixed-dim: '#B9D2C1'
  on-primary-fixed: '#10271D'
  on-primary-fixed-variant: '#355746'
  secondary-fixed: '#F4E8C6'
  secondary-fixed-dim: '#D8B65C'
  on-secondary-fixed: '#29230F'
  on-secondary-fixed-variant: '#5E4718'
  tertiary-fixed: '#F5F2E9'
  tertiary-fixed-dim: '#D9E2D7'
  on-tertiary-fixed: '#19382D'
  on-tertiary-fixed-variant: '#526558'
  background: '#19382D'
  on-background: '#F5F2E9'
  surface-variant: '#315345'
typography:
  h1:
    fontFamily: Oxanium
    fontSize: 84px
    fontWeight: '800'
    lineHeight: '1.0'
    letterSpacing: -0.02em
  h2:
    fontFamily: Oxanium
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.01em
  h3:
    fontFamily: Oxanium
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: '0'
  body-lg:
    fontFamily: Outfit
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  body-xl:
    fontFamily: Outfit
    fontSize: 24px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Outfit
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  label-caps:
    fontFamily: Oxanium
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.12em
  label-data:
    fontFamily: Outfit
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.5'
    letterSpacing: '0'
spacing:
  unit: 8px
  gutter: 24px
  margin-page: 64px
  section-gap: 160px
  diagonal-offset: 12vw
brand-colors:
  forest: '#19382D'
  gold: '#D8B65C'
  gold-strong: '#B18A32'
  ivory: '#F5F2E9'
  graphite: '#29332F'
  sage: '#A4B4A7'
app-colors:
  canvas: '#F5F2E9'
  panel: '#FFFFFF'
  panel-subtle: '#FAF9F5'
  text: '#19382D'
  text-muted: '#52675E'
  border: '#DDE2D9'
  border-strong: '#A4B4A7'
  focus: '#B18A32'
  selected: '#F4E8C6'
  sidebar: '#19382D'
  sidebar-text: '#F5F2E9'
  action: '#19382D'
  action-text: '#FFFFFF'
  attention: '#D8B65C'
  attention-text: '#29230F'
status-colors:
  success: '#2F7651'
  success-bg: '#E0F0E4'
  warning: '#946A16'
  warning-bg: '#F8EECF'
  danger: '#B84242'
  danger-bg: '#FBE5E1'
  info: '#386B85'
  info-bg: '#E4EFF4'
  neutral: '#58645D'
  neutral-bg: '#EBEEE8'
radius:
  default: 0px
  card: 0px
  button: 0px
  input: 0px
---


## Brand & Style

The design system is anchored in a high-contrast, "Dark Mode First" philosophy. The visual style blends **Minimalism** with **Brutalism**, utilizing heavy whitespace and diagonal layouts to suggest motion and high-end technical precision.

## Colors — intentional dual-brand system

- **Forest `#19382D`:** The primary brand identity, navigation, major headings, solid actions, dark marketing surfaces, and key structure.
- **Muted gold `#D8B65C`:** The equally recognizable second brand hue; highlights, approval prompts, active timeline markers, selected moments, and limited promotional accents. It is **not** the universal warning color.
- **Gold ink `#B18A32`:** Darker gold for large icons, decorative rules and headings on light surfaces. For small text on ivory, use `#735518` instead to maintain legibility.
- **Warm ivory `#F5F2E9`:** Main application canvas and contrasting marketing sections; not a green-tinted white.
- **Graphite `#29332F`:** Supporting readable text on light surfaces.
- **Usage balance:** In the app aim for roughly 65% ivory/white, 25% forest and neutral structure, 10% gold and supporting accents. On dark marketing sections forest can dominate; gold should remain selective.
- **Accessibility:** Check WCAG contrast on the actual text/background pairs. Use `on-secondary` dark ink on gold fills; never use white text on the gold fill for small UI labels. Never convey status by color alone.
- **Two visual contexts:** `colors` are the original **dark marketing theme** semantic tokens; `app-colors` are the **light workspace** semantic tokens. Do not reuse `colors.background` for the app canvas. The original primary/secondary token slots now mean forest/gold; audit every old use of `bg-app-canvas` that previously assumed an ivory section.

### Service Accent Palette (marketing only)

Service identifiers remain compatible with existing content frontmatter. Use a restrained set of accents so the core forest/gold identity is not lost. These are categorical colors, **not** approval/status semantics.

| Service | Key | Hex |
| --- | --- | --- |
| Web Development | indigo | `#687B9E` |
| AI Integration | purple | `#857C9A` |
| Mobile App Development | cyan | `#5A9EAA` |
| UI/UX Design | amber | `#D8B65C` |
| Deployments & DevOps | emerald | `#5B9A76` |
| AI Workflows & Automation | magenta | `#A37B92` |
| CTO-as-a-Service | crimson | `#B76C67` |
| Ongoing Maintenance | teal | `#5C9992` |
| SEO & Performance | blue | `#688AA5` |
| Performance & Security | coral | `#BA886B` |
| Template Customization | lime | `#A1A66C` |
| Analytics & Tracking | azure | `#6A98AA` |

Keep the keys and update their corresponding CSS variables; no hardcoded service hex values in components. For Handoff's core workspace, **do not apply these twelve service accents**: use brand tokens plus semantic status tokens.

## Typography

The system uses a pairing of technical geometry and modern grotesque accessibility.

- **Headlines:** Use **Oxanium**. Its faceted, technical cuts reinforce the precise Handoff identity. Used in heavy weights with tight tracking for an aggressive, architectural presence.
- **Body:** Use **Outfit**. Its circular nature and high legibility provide a friendly yet professional contrast to the sharp headlines, ensuring long-form content is easy to digest.
- **Metadata & Labels:** Use **Oxanium** for all-caps labels to lean into the technical aesthetic, while using **Outfit** for dense data points to ensure clarity.

## Layout & Spacing

- **The Diagonal:** Sections are separated by -3 to -5 degree skews. Content is counter-skewed to maintain vertical alignment.
- **Rhythm:** Large vertical gaps (160px+) ensure the high-contrast elements feel intentional and premium.
- **Alignment:** Asymmetric balance—left-hung Oxanium headlines versus right-aligned Outfit metadata.

## Elevation & Depth

- **Surfaces:** Depth is achieved through tonal layering (using `#1C3B30`) rather than soft shadows.
- **Borders:** 1px solid lines in `#536C5D` define boundaries, leaning into a blueprint/wireframe aesthetic.
- **Layering:** Elements overlap; an Oxanium tag might "pierce" the border of an image container.

## Shapes

- **Zero Radius:** All corners are strictly 0px. The sharp geometry complements the angular cuts of the Oxanium typeface.

## Geometric Shape Language

Four geometric shapes make up a secondary design language, shared between the custom cursor and decorative diagrams. Their paths are defined once in `src/lib/shapes.ts` and reused everywhere so they stay visually identical.

- **Triangle** — action / speed (cursor `default` state)
- **Diamond** — clickable / precision (cursor `pointer` state)
- **Square** — draggable / stability (cursor `grab` state)
- **Octagon** — loading / structure (cursor `loading` state)

Usage is intentionally sparse. Their primary application is the two hero diagrams, which turn the shapes into a readable visual tied to the product story:

- **Home hero (main_hero):** the studio promise pillars — FAST, PREMIUM, SCALABLE, AI-ENGINE.
- **About hero (about-hero):** the trust / proof points — CLIENTS, PROJECTS, YEARS, ZERO-DEFECT. The proof numbers resolve from `site.toml` `[stats]` so they never drift from the stats section.

Each diagram is a **constellation flowing down the hero image's diagonal cut** — the shapes follow the angular boundary instead of fighting it, connected by an animated dashed circuit line, gently floating. On mobile the four shapes become a compact centered row so the design language is always present. The image stays the background; the diagram floats above it (`z-10`).

Styling: shapes use the `on-surface` token (warm ivory fill) with a `background` (forest) stroke, and `label-caps-style` Oxanium labels at `--font-size-tag` in `background` — the same treatment as the custom cursor, so they stay legible on both the dark grayscale image and the warm ivory hero surface. The diamond reads as a `pointer` cursor and the square as `grab`, echoing the cursor's interactive states.

## Components

- **Buttons:** Rectangular, 2px border. Hover inverts from Outline to Solid. Forest is the default action; gold is reserved for decisive approval moments.
- **Chips:** Small Oxanium labels in a 1px frame for tech stacks.
- **Cards:** Defined by 1px borders; no elevation until hover, which triggers a subtle fill (#162F26).
- **Input Fields:** Bottom-border only. On focus, the Outfit label slides up and transitions to Oxanium for a "system-active" feel.
- **Custom cursor:** the `pointer` diamond and the `grab` square each carry a small center dot (`r = 2` in the 22-unit viewBox, about 5.4px on screen) so both shapes read as a hit-point rather than as decoration. The two states are the ones a visitor aims at: `pointer` says "click here" and `grab` says "drag this", and neither shape has a centre of gravity on its own, so neither says where the interaction actually lands. The dot is deliberately absent from `default` and `type`, which are not targets, and it is the same absolute size in both states so it reads as one consistent signal rather than one whose weight changes per shape. Because the grab square is smaller than the pointer diamond, the dot looks proportionally larger inside it, which suits a thumb the visitor is about to drag rather than fight. Its fill is `--color-background`, the same token already on the shapes' strokes, and the contrast it resolves against is the shape's own warm ivory fill rather than the page. That is the load-bearing part. A dot colored for the page would vanish over forest sections; one sitting on the warm ivory fill stays legible over forest sections, the warm ivory app bands, and the hero imagery alike, and needs no new token. The dot tweens with the same duration and ease as the shape, so it arrives with the shape instead of trailing it. The circular dot is a deliberate micro-exception to the zero-radius rule: at four pixels across it reads as a hit-point rather than as rounded geometry, where a four-pixel square would read as debris. The dot animates its `r` attribute and carries **no CSS transform at all**, which is a correctness constraint rather than a style choice. A scale transform cannot be relied on to stay centred here: GSAP resolves `transform-origin` against `transform-box: fill-box`, which injected a stray `-5.5px` translate that pushed the dot up and out of the diamond, and GSAP's `svgOrigin` is no remedy because it builds the matrix as `p -> s*p - s*origin`, an assumption that only holds for shapes authored around `(0,0)` while the dot sits at `(11,11)`. Animating `r` leaves `cx` and `cy` pinned at the centre on every frame, so the dot is centred by construction rather than by a matrix having to survive the animation. Measured after the fix, the dot's bounding-box centre, its screen rect centre, the shape's centre, and the viewBox centre all resolve to the same point with an offset of exactly `0, 0`, in both states.
- **Quote:** Callout component (`Quote` in `src/components/mdx/quote.tsx`) used as explicit JSX in blog and service MDX content. Centered italic warm ivory text at pull-quote scale, framed by two oversized Oxanium quotation marks (`text-display` size) pinned to opposite corners: the opening mark at the top-left and the closing mark at the bottom-right (the same opening glyph rotated 180°, so its ink hugs the corner). Marks render at reduced opacity (60%) to stay secondary to the text; there is no border rule. Quote text uses the `body-xl-style` utility backed by the `--font-size-body-xl` token (24px), added for pull-quote scale since no existing body token was large enough. Default colors are token grays (`outline` marks, `on-surface` text). Accepts a `color` prop with a service accent key (e.g., `color="indigo"`) that resolves through `service-accent.ts` to the matching `--color-service-*` token, tinting both marks; service entries pass their own accent key so quotes match the service's symbol color. No other new tokens were required.
- **MDX content components:** shared set in `src/components/mdx/` used as explicit JSX inside service and blog MDX. **Claim** renders the cold-open bold claim as pure typography: a statement-scale line (`--font-size-claim`, clamping roughly 22px on small screens up to 28px on desktop, exposed as the `text-claim` utility) in heavy sentence-case Oxanium with tight leading, balanced wrapping, and no container. Whitespace alone isolates it, so the one line every visitor must read reads first; scale does the emphasis, not decoration. **Headline** replaces scene headings with a semantic h2 in uppercase Oxanium plus a small filled square marker (zero-radius shape language) tinted by the service accent key. **Steps** lays numbered engagement steps between 1px structural borders with oversized outline Oxanium numerals; **Checklist** marks feature items with small accent-filled squares. **Callout** frames notes/warnings as bordered boxes with a chip-style header row (error tokens on warning tone). **ContentCta** closes a page scene with a bordered outline-variant button built from the shared `buttonVariants` and an ArrowRight icon. All colors resolve from existing tokens; `--font-size-claim` is the only newly added size token.
- **World Globe:** Dotted-globe component (`world/world-section.astro`) expressing worldwide reach in the design language. The sphere is a tonal disc (`--surface-container-lowest`) with a 1px `--outline-variant` rim, no gradients and no shadows, so depth reads through structure rather than glow. Land is ~4.6k square dots (zero-radius geometry) in `--on-surface`, alpha-bucketed toward the limb for cheap depth shading. Markers reuse the shape system via `SHAPE_VERTICES`: the Lahore HQ renders as a diamond (cursor `pointer` echo), target markets as small squares, warm ivory-filled with a forest stroke, matching cursor and hero-diagram treatment. Service arcs are dashed 1px lines in `--outline` with marching dashes, echoing the hero constellation connector. Side chips are Oxanium `--font-size-tag` labels in 1px frames (the chip pattern); selection syncs marker and chip, and the active state adds a dashed ring around the marker. All colors resolve from tokens at runtime; reduced motion collapses rotation to a single static frame. No new tokens were required.
  The section is a true half-and-half split from `lg` up: chips on one side, globe on the other, equal columns, so the data and the picture carry the same weight. The globe is **draggable**, and the drag reuses the cursor system rather than inventing a signal: the canvas carries `data-cursor="grab"`, so the cursor layer resolves it through its existing grab selector to the square-with-a-centre-dot shape, which is already the vocabulary for "drag this", and the drag itself announces `grabbing`. No label is added, because that shape is the affordance and a caption would only restate it. Tap and drag are separated by a 5px slop so a tap still selects a market instead of nudging the globe. The canvas is `touch-action: pan-y` rather than `none`, which is what keeps a vertical swipe over a globe this large scrolling the page normally instead of becoming a dead zone. Reduced motion collapses the idle spin to a single static frame while leaving the drag available, since rotating by hand is a response to the visitor rather than decoration.
- **Stats band:** `shared/stats-section.astro` proof band of four stats (5+ Years, 15+ Projects, Full-Stack, Founder-Led) laid out as a 1px-bordered grid on the warm ivory `app-colors.canvas` surface. Numeric stats keep the digit-roll counter, text stats render at `h2-style`; hairline dividers use `border-background/15`. All values and labels resolve from `site.toml` `[stats]`. No new tokens.
- **Studio statement:** `about/agency-intro.astro` editorial split for the "A new agency. Not new to engineering." identity statement (`section/agency.md`). Line one of the Oxanium headline sits in `text-foreground`, line two in `text-outline` for tonal contrast, with the body copy in `body-lg-style text-on-surface-variant` on a `bg-surface` band. No new tokens.
- **Pipeline trace:** `--circuit-stroke` (2px) is the weight of the About page's build-methodology circuit on mobile. The trace is an SVG path inside a `preserveAspectRatio="none"` viewport, which stretches the coordinate system non-uniformly, so a `stroke-width` in user units resolves to a different number of screen pixels depending on which axis the run travels along: the mobile container is roughly 1:4, which collapsed the vertical to 0.56px while the horizontal corner rendered at 2.35px, a 4x jump at the turn. Sizing the SVG wrapper to the same width as its `viewBox` (56px) pins the x scale at 1 and therefore pins a vertical run to this value exactly at every viewport width. 2px matches the phase icon boxes' `border-2`, so the trace and the components seated on it read as one system. Desktop keeps its own user-unit stroke and is unaffected. No new colors.
- **Sparkle texture:** `layouts/sparkle-layout.astro` overlays a `feTurbulence` + `feSpecularLighting` glitter field on the CTA and social bands, resolved from the existing `--sparkle-base` / `--sparkle-high` tokens. It is deliberately **static**: one `opacity-45` on the layer, no animation, and a constant `feTurbulence` `baseFrequency` on a fixed 700-unit `viewBox` under `preserveAspectRatio="xMidYMid slice"`. Both a breathing opacity and a resize-driven density recalculation were tried and removed. The reason the pulse read as a bad glitter rather than a dim-and-bright fade is that a specular-lit noise field has a heavily skewed brightness distribution, so animating its opacity changes how many speckles clear the perceptual limit instead of how bright the band looks. Recalculating `baseFrequency` on resize re-rolled the whole lattice mid-session, which is a harder jump than any pulse. No new tokens were required.
- **Transactional emails:** `src/lib/email-template.ts` renders enquiry notifications (internal) and confirmations (client-facing) as Forest & Gold branded HTML. Forest canvas with a `#162F26` card surface, 1px structural borders in `#536C5D`, tracked uppercase labels echoing `label-caps-style`, chip-styled interest tags, zero radius throughout, and the hosted `icon-192.png` H. monogram as header logo. Email clients cannot load site fonts or consume runtime CSS variables, so markup uses nested tables, inline styles, web-safe font fallbacks, and hex values that mirror the tokens above; if a token changes in `global.css`, update the template palette to match. Both templates are exercised by `bun scripts/test-brevo.mts` (dev-side only).
- **Analytics and tracking:** two third-party tags live in the `main.astro` head and render in production builds only. **Microsoft Clarity** provides session replay, heatmaps, and interaction analysis; it masks form field content in recordings by default. **Google Analytics 4** provides traffic and engagement measurement under Google Consent Mode v2, where every analytics and advertising storage signal defaults to `denied` until the visitor chooses in the consent panel. **Cookie settings panel:** `consent/consent-banner.astro` is a fixed bottom-right card in the 1px structural-border idiom: `--surface-container-low` panel, `--outline-variant` rules and switch tracks, `--primary` forest fill for an engaged switch with an `--on-primary` light knob, Oxanium `label-caps-style` labels at `--font-size-tag`, body copy at `--font-size-micro`, and the shared `buttonVariants` for its actions. It is deliberately a small card rather than a full-screen wall, and it slides up once on first visit with `prefers-reduced-motion` honored. Prominence comes from structure rather than size: a 2px `--secondary` gold top bar echoing the service-card accent device, a floating 1px `--on-surface` outline at `outline-offset: 4px` that keeps the card legible over both forest and warm ivory sections, a `--surface-container-highest` panel, an `--outline` border, and a `--font-size-panel-title` heading. The off-state switch track stays transparent so the panel reads as secondary to the page. `--font-size-panel-title` (14px) was added because the existing scale bottomed out at 11px `--font-size-tag`, too small for a legal notice heading; it is exposed as the `text-panel-title` utility. No other new design tokens were needed.
- **Nested scroll behavior:** two distinct treatments, and the difference is deliberate rather than incidental. **Trapped** containers (modal and overlay surfaces: the mobile nav drawer, the table of contents drawer list, the select and command palettes) use Lenis's `data-lenis-prevent` and swallow every gesture, so the page behind a modal never moves. **Latched** containers use `data-lenis-nested` and keep the gesture only while they have somewhere to go in the current direction, handing it to the page at their own limit; the table of contents sidebar is the only one, and it is what lets a reader scroll the list, continue into the article, then reverse and have the list take the scroll back. Latched elements carry `overscroll-behavior: contain` so that a gesture larger than the remaining room cannot chain natively and move the page outside the scroll animation, which would desynchronise it. No visual tokens are involved, so nothing was added to the palette. See `src/lib/nested-scroll.ts`.
- **Button foreground tokens:** `--color-primary-foreground` and `--color-secondary-foreground` map to `--on-primary` and `--on-secondary` in the `@theme inline` shadcn compatibility block. Both were missing while the shared `buttonVariants` already referenced `text-primary-foreground` on its `default` variant, which made a solid warm ivory button render warm ivory text on an warm ivory fill and produce an invisible label. They are aliases for existing tokens, not new colors, so no new hex values were introduced.
- **Navbar clearance:** `--nav-clearance` (96px plus the announcement banner's measured height) is the vertical space reserved below the fixed navbar for any in-page jump. It exists because the navbar is not a constant height: `navbar.astro` renders at 104px at rest and 72px once collapsed, swapping `py-8` for `py-4` past the 50px scroll threshold. 96px is the collapsed height plus 24px of breathing room, so a heading lands in the same place whether the navbar is currently open or hidden by its headroom logic. The token is applied as `scroll-margin-top` on `.prose-custom` and `.legal-content` headings, which covers table of contents links, native hash navigation, and browser find-in-page with one declaration. `src/lib/toc-scroll.ts` and `src/hooks/use-active-heading.ts` both read the value back out of the computed style rather than repeating the number, so the CSS stays the single source of truth. Four hardcoded guesses for this same clearance existed before it (a `- 90` scroll offset in three components, a `48px` bar offset, an `80px` ScrollTrigger pin start, and a `calc(100vh - 8rem)` sidebar height); all are now derived from the token. No new colors, and the only new value is a spacing one. The announcement banner is not added at any call site. The banner measures itself and writes two tokens: `--announcement-offset` (its own height) for consumers that add the banner's space to something already positioned, and `--nav-clearance` (rewritten to the resolved pixel total) for consumers that want the whole reserved space. The second is written as a plain number rather than as a `calc()` on purpose: the legal-page TOC pins read the token with `parseFloat`, and `parseFloat("calc(96px + 32px)")` is `NaN`, which silently reinstated a pin offset one banner too high. A `calc()` here would have broken exactly the consumers it was meant to serve. The base stays 96px in CSS and the banner's contribution disappears with the banner.
- **Announcement banner:** `components/announcement/announcement-banner.astro` renders a thin full-width strip above the nav row, mounted as the first child of the fixed header in `navbar.astro` rather than as a sibling. Nesting it is what makes the layout deterministic: it inherits the header's `z-[60]` stacking context instead of racing the modal layer at `z-50`, it hides with the navbar on scroll-down instead of needing a second copy of the headroom logic, and it cannot be overrun by the navbar during the `yPercent: -100` hide animation, which a sibling at any z-index would have to be tuned around. The message, optional link, and dismiss label live in `section/announcement-banner.md`, so no copy sits in the component. **The color is `--secondary` (muted gold) with `--on-secondary` text**, not a new token: that token is already the system's attention color (the consent panel's top bar), so the banner joins an existing meaning rather than inventing a parallel one, and gold with dark ink is intended to provide strong contrast; verify computed contrast. A solid gold fill is also the one treatment that cannot be mistaken for a page section: it is loud against both the warm ivory hero surfaces and the forest pages, where an warm ivory or forest banner would blend into one of them. Type is `label-caps-style text-tag` (11px Oxanium, tracked, uppercase) on `py-2`, which keeps the strip genuinely thin and matches the chip idiom rather than introducing a size. **Dismissal is deliberately not persisted:** the close button sets `hidden` and writes nothing to `localStorage` or `sessionStorage`, so the announcement returns on the next load, soft or hard, and stays hidden only for the current view. Persisting it would defeat the point of an announcement. Because the clearance can also change after load (fonts settling, a resize that wraps the message, and the dismiss itself), the banner cannot be treated as a one-shot layout input: it dispatches a `nav:clearance` window event and `main.astro` turns that into a `ScrollTrigger.refresh()`.
- **Everything that positions itself against the header, once the banner exists:** the change touches four consumers, and all four now derive from the measured value rather than a guess. **Pins** read the clearance through a _function_ (`start: () => \`top ${navClearancePx()}px\``) rather than a captured number, because a function is re-evaluated on every refresh: the two legal-page TOC pins and the blog TOC rail use the total, and the journey horizontal scrub uses the offset alone (it pins flush to the viewport top and clears the collapsed navbar with its own `pt-20`). The blog rail previously used a hardcoded `top 80px`, which also sat 16px above the line the active-heading tracker uses, so that one is corrected rather than merely banner-proofed. **The mobile nav sheet** keeps its fixed relationship to the header with `top-[calc(88px_+_var(--announcement-offset,0px))]`, so the drawer still tucks the same distance under the header whether or not a banner is present. **The TOC surfaces** (sidebar `max-h`, the active heading, the rail geometry) re-measure through the refresh, since all three cache positions. **The heroes** are the odd one out and the fix there is not the banner but the breakpoint: `pt-[var(--nav-clearance)]`applies from`lg`up only, because below`lg`the grid stacks and the text sits under the 48svh image, where the clearance was pure dead space above the first line.`src/lib/nav-clearance.ts` is the shared reader for all of it.
- **Dismissal must not shift layout badly:** closing the banner removes the tokens, which returns `--nav-clearance` to its 96px base and refreshes every trigger. That is one deliberate 30px reflow on an explicit user action, and it is the reason the override is removed rather than left stale: leaving it would keep dead space above every hero for the rest of the visit.
- **`--announcement-offset` is 0px when there is no banner.** With `show: false` the markup is not rendered, the inline script returns early on the missing element, and both tokens keep their CSS defaults, so a site with no announcement has no banner math anywhere. The script stays at the top level rather than inside the conditional because the Astro parser cannot take a `<script>` nested inside an expression, and a script that no-ops is cheaper than a formatter that cannot parse the file.

## Handoff product-specific interface rules

### Visual personality

The Handoff product is a **client-facing delivery and approval workspace**, not a generic task manager. Its visual signature is sharp geometry, generous editorial spacing, dense but orderly work surfaces, deep green framing, and decisive muted-gold moments. Keep corners square; avoid glassmorphism, gradients, heavy drop shadows, neon, ornamental blobs, and gold on every button.

### Layout zones

1. **Public marketing:** dark forest hero and footer, ivory story sections, gold limited to call-to-action moments and visual traces.
2. **Authenticated workspace:** warm ivory page background, white document/cards, forest navigation and key text, fine sage-gray dividers, gold active markers.
3. **Client review:** quieter ivory-first interface; clearly distinguish *draft*, *submitted*, *changes requested*, *approved*, and *superseded* without relying solely on color.
4. **Rich-text docs:** white editing sheet, graphite text, forest headings, subdued toolbar; gold only for comments, suggested changes or current selection when meaningful.

### Approval and milestone semantics

| State | Treatment | Meaning |
| --- | --- | --- |
| Draft | Neutral gray label | Editable internal work |
| Submitted for review | Gold outlined chip + timestamp | Decision needed |
| Changes requested | Warm warning background + explicit label | Revision requested |
| Approved | Success green chip + check icon | Accepted version |
| Superseded | Neutral outline + history icon | Historical record |
| Blocked | Danger chip + reason | Cannot proceed |

**Gold is a brand accent, not a substitute for semantic states.** An approved milestone must be distinguishable from a green navigation item. Show state text, actor, and time alongside the icon.

### Change requests, timelines, and audit history

- A submitted change request is a **review object**, not an immediate edit to a committed deliverable. Display a before/after diff, requested by, scope, and decision.
- Once approved, link the decision to the resulting milestone/deliverable revision. Keep old revisions visible in history.
- Timeline extensions show original dates, proposed dates, affected dependencies, justification, submitter, and client approval status.
- Do not visually imply that a proposal is active before approval. Proposed changes use gold attention styling; committed dates use standard forest text.
- For collaborative editing, show avatars/cursors as clearly labeled presence indicators; do not depend on randomly assigned brand colors alone.

### Interaction specifications

- **Primary action:** forest fill `#19382D`, white text. Gold fill `#D8B65C`, dark text, only for highlighted review/approval calls to action.
- **Secondary action:** transparent or white fill, forest 1px outline.
- **Danger action:** separate red semantic palette, never gold.
- **Focus ring:** visible 2px `#B18A32` plus offset, verify contrast against surrounding surface.
- **Cards:** white, 1px `#DDE2D9`, 0px radius, no default shadow.
- **Inputs:** white or transparent, subtle border; focus border forest with an external gold focus indicator.
- **Tables:** ivory/white rows, hairline borders, restrained hover `#FAF9F5`; pinned header when useful.
- **Timeline:** forest line for committed progress, gold for pending decision or proposed extension, gray for future/unscheduled. Use dashed lines for proposals, solid lines for approved dates.
- **Docs:** preserve keyboard accessibility, visible selection, revision metadata, and independent read-only snapshots for approved deliverables.
- **Responsive:** 24px gutters on mobile; collapse sidebars rather than shrinking readable document text. Preserve minimum 44px touch targets.
- **Motion:** subtle 120–220ms opacity/position transitions; honor `prefers-reduced-motion`.

### CSS token implementation example

```css
:root {
  --brand-forest: #19382D;
  --brand-gold: #D8B65C;
  --brand-gold-ink: #735518;
  --brand-ivory: #F5F2E9;
  --app-canvas: #F5F2E9;
  --app-panel: #FFFFFF;
  --app-text: #19382D;
  --app-text-muted: #52675E;
  --app-border: #DDE2D9;
  --app-action: #19382D;
  --app-action-text: #FFFFFF;
  --app-attention: #D8B65C;
  --app-attention-text: #29230F;
}
```

### Migration checklist from Charcoal & Ivory

1. Map dark surface tokens to forest shades; preserve the original names for compatibility.
2. Update every former `secondary` usage: it now means gold, **not** an ivory background. Use `app-canvas` or `tertiary` for ivory sections.
3. Audit components that assumed `primary` meant ivory; it now means forest, so update text colors and inverted hover states.
4. Replace hardcoded hex in email templates, SVGs, animations, meta/OG artwork, and chart themes.
5. Apply light workspace tokens to all dashboard routes, dark tokens only where the layout explicitly opts into dark marketing styling.
6. Run automated and manual contrast checks for small labels, disabled states, charts, focused inputs, and gold-on-ivory combinations.
7. Review approval, revision, and milestone states for semantics independent of color.
8. Verify mobile, keyboard, reduced-motion, print/PDF, and email-client renderings.

**Design principle:** Forest provides confidence. Gold draws attention to decisions. Ivory makes the work readable. The interface must always prioritize clarity over decoration.
