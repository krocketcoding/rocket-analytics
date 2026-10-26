# Unified workspace — experience plan

The site becomes a single workspace holding **two panes**. Each pane displays
any view — a chart or a table — and the user chooses what each shows, drags the
divider between them, or maximizes one pane to fill the workspace. No tabs, no
stat cards, no chart modal, no hero header: the workspace *is* the site.

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ Rocket Analytics                                       [↓] │
├─────────────────────────────┬⋮┌────────────────────────────┤
│ BARS·By rocket  [yr][↓][⛶]  │⋮│ TBL·Upcoming [filter..][⛶] │
│                             │⋮│                            │
│    ▐▌ ▐▌ ▐▌ ▐▌ ▐▌           │⋮│  Date   Mission  Pad ...   │
│    ▐▌ ▐▌ ▐▌ ▐▌ ▐▌   chart   │⋮│  launch rows (scroll)      │
│    ▐▌ ▐▌ ▐▌ ▐▌ ▐▌           │⋮│                            │
└─────────────────────────────┴⋮┴────────────────────────────┘
```

- **Desktop:** two panes side by side. Default: "Launches by rocket" bar chart
  (All time) on the left, Upcoming launches table on the right, split 50/50.
- **Mobile:** the same two panes stack top-to-bottom — chart on top, table
  below — at a fixed even split; the divider is not draggable on mobile.
- The workspace fills the screen below the header bar. Tables scroll inside
  their pane with a sticky header; the page no longer scrolls through rows.

## The header and footer

- **Header** is a single compact bar: small title left, download and
  "Reset layout" buttons right. Nothing else — the hero title, notes, and
  stat cards are gone.
- **Each pane keeps its own view picker in its head** (option B): the picker
  sits next to the content it controls, so there's never ambiguity about what
  a picker affects — identical behavior split or maximized, desktop or mobile.
- **Footer** absorbs the displaced header notes — the "observed rockets"
  explanation and the local-timezone note join the data-source / updated /
  GitHub line.

## Anatomy of a pane

A pane head contains, left to right:

- **Kind tag** — "BARS", "DONUT", "TREND", or "TABLE".
- **View picker** — a dropdown of everything the pane can show: *Bars* (rocket,
  family, manufacturer, country, site) · *Donut* (same subjects) · *Trend*
  (rocket, manufacturer, country) · *Tables* (Upcoming, Previous, Rockets).
- **View controls**, depending on the view:
  - *Chart:* year-scope segment, country/rocket pickers, toggles (Successes
    only, Cumulative, By variant), entity picker — all as today. A pager sits
    under the chart when data spans pages.
  - *Table:* text filter with live match count, plus a quiet "select a row for
    details" hint. Rockets keeps its sortable columns.
- **Export** — PNG download for chart panes, CSV download for table panes.
- **Maximize button** — a prominent bordered chip at the head's right end.

## Focus vs. split

The workspace always contains two panes; the display modes are **split**,
**A focused**, or **B focused**. Focusing is the only way to get a full-size
view — there's no close button and no "add pane" step.

- **Maximize** expands a pane to fill the workspace; the other pane hides with
  its view state intact.
- **Restore:** while maximized the same button shows the reversed icon
  (inward arrows); clicking it returns to split at the same divider position.
- The divider hides while maximized.

## The divider

- Draggable on desktop only: a vertical gutter you drag left/right.
  Double-click resets to 50/50. On mobile the split is fixed and even — no
  drag handle.
- Each pane keeps a minimum share (~30%) so neither can be crushed.
- **Crossing breakpoints** (rotating a tablet, resizing a window): the
  panes switch from side-by-side to stacked. The desktop divider position is
  remembered and restored when the window goes wide again; mobile always uses
  the fixed even split. Panes keep their views, order, and focus mode.

## View rules

- **Each table exists once.** If Upcoming is open in one pane it's greyed out
  ("open") in the other pane's picker. Charts can repeat freely — duplicates
  are the point of comparison.
- **Two charts with the same unit share a y-axis** so bar heights compare
  honestly across the split (existing explorer behavior).
- **Narrow panes adapt:** a cramped table scrolls horizontally; a donut's
  percentage table drops below the figure (the phone treatment today).
- **Unchanged behaviors:** row click opens the launch/rocket detail modals,
  Esc/backdrop close them; chart pagers, filter popovers, and the year segment
  behave identically.

## Persistence and sharing

- The workspace remembers itself: each pane's view, the divider position, and
  the focus mode persist between visits. A small "Reset layout" button in the
  header bar restores the default split.
- **The URL encodes the full workspace state** in the hash — each pane's view
  *and* its current filters (year scope, country/rocket selections, toggles,
  entity picks for charts; search text for tables), the divider position, and
  which pane is focused — something like
  `#by-rocket:2024+usa|upcoming@60` or `#by-site:all|by-rocket:2025@45^a`.
  The hash rewrites live as state changes (without spamming history), so
  copying the address at any moment shares exactly what you see: a colleague
  opening the link lands on the same two views, same filters, same split.
- An empty or unrecognized hash falls back to the remembered layout, then the
  default split.

## What goes away

- Five stat cards; the hero header; table tab strip; chart-box tabs and its
  shared year control; the "All charts" button and chart modal; the close ×
  and "Split view" button; long page scrolling.

## Out of scope for v1

- Chart→table linked filtering (the layout enables it later).
- Pane reordering, three-pane layouts, saved filter presets.
- Keyboard divider control and a maximize hotkey — cheap accessibility adds
  worth speccing: focus the divider, arrows resize.

## Technical decisions

- **One view registry.** Table views become defs in the same registry as the
  charts (`kind: 'Table'`), with a different `mount` and a `{q}` filter shape
  instead of the chart keys. The picker, the is-this-view-open-elsewhere
  check, and URL serialization all read one source.
- **Tables relocate, they aren't re-rendered.** The Jinja macros keep
  rendering `tab-upcoming` / `tab-past` / `tab-rockets` into a hidden staging
  area; a table def's `mount` moves the node into the pane. Sortable headers
  and row-click delegation already use document-level selectors, so they keep
  working. The one-instance rule falls out naturally — a node can only be in
  one pane, so the picker greys it out in the other.
- **URL state is JSON in the hash.** Entity names contain spaces and commas,
  so a hand-readable `key=value` grammar invites parsing bugs; an encoded
  JSON blob is robust and trivially extensible. Includes each pane's view and
  filter state, the divider position, the focus mode, and the rockets table's
  sort column/direction. Rewritten live via `replaceState`; precedence on
  load is hash > localStorage > default. (`localStorage` on `file://` is
  best-effort — the hash still works for the offline build.)
- **Divider:** panes sized by `flex-basis` on a flex container; the media
  query flips `flex-direction` between row and column. Pointer Events handle
  mouse and touch in one handler; drag updates the basis live, clamped to
  ~30–70%; double-click resets to 50%. On mobile the divider is fixed and
  non-interactive (`pointer-events: none`). Charts get `resize()` nudges after
  drags and focus changes, same as today's tab-switch resize.
- **Focus mode** is a three-way state (`split | 0 | 1`): maximized hides the
  divider and the sibling pane, swaps the button icon, and resizes the chart;
  restoring unhides and resizes the revealed pane (the known 0×0-mount case).
- **Donut in a narrow pane:** a `.split`-aware class on the workspace forces
  the donut's figure+table to stack — not container queries.
- **New file `static/workspace.js`** (loaded last) owns the shell — panes,
  divider, focus mode, URL/storage serialization. `charts.js` keeps chart
  mounting and filter controls. Deleted: the inline chart-box path
  (`#chart-tabs`, shared pager, `inlineScope`, `all-charts-btn`,
  open/closeChartModal), the launch-tabs wiring and `.filter`, the
  `#chart-modal` markup, the stat cards, and the hero header. ESC still
  closes the detail modals.
- **CSV export** builds client-side from the `LAUNCHES`/`ENTITIES` JSON with
  the same columns the table shows — no DOM scraping.

### Implementation order

1. Workspace skeleton: two chart panes with pickers, replacing the inline box
   (reuses the slot machinery wholesale).
2. Tables as views + per-pane filter.
3. Divider drag + maximize/restore.
4. URL hash + localStorage.
5. Header/footer/template surgery, dead CSS/JS cleanup.
6. CSV export, then verification: `python main.py`, `node --check` on each
   edited `static/*.js`, `data-images` sanity-check in the offline build.
