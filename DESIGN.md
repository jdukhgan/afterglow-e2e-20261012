# Afterglow design foundation

## Brief
- **Who:** one person after work, often on a phone in low light, deciding what small thing to do tonight.
- **Main activity:** scan a short list of evening ideas, narrow by mood and the time available, then plan one. Next: add, edit, delete, and mark ideas saved, planned or tried.
- **Content:** 5–30 entries. Titles are 2–10 words; places are short; notes run from empty to a paragraph.
- **Character:** a night-edition programme. Dark dusk background, warm paper-coloured text, an editorial serif for titles, quiet controls. No dashboard tiles, no repeated card grid.
- **Constraints:** vanilla HTML/CSS/JS with no build step, fonts served by the app itself, fictional content only, no accounts, maps, bookings or third-party platforms.

## Composition
I compared two layouts: (A) a list on one side with a detail panel on the other, and (B) a single programme column with a sticky sidebar for filters. I chose **B**. Each idea is a short entry, so a detail pane would mostly sit empty.
- **Desktop (≥901px):** a 340px sidebar holds the wordmark, **Add an evening** and the filters, and stays in place while scrolling. The programme list is up to 780px wide.
- **Tablet and phone:** everything stacks in one column. On phones the mood chips scroll sideways, the status switch takes the full row width, and the editor fills the screen.
- **Attention order:** (1) entry titles and their length, (2) **Add an evening** and the filters, (3) status and edit controls on each row.
- **Signature move — the horizon:** a dusk gradient stands for "more time, more light". The *Time I have* filter is drawn as a horizon that fills up to the chosen length (ease-out, about 520ms). The same gradient appears as each row's duration bar and as the top edge of the editor. Planned rows get a soft amber afterglow; tried rows are dimmed.

## Tokens (`web/styles.css` `:root`)
- **Type:** Instrument Serif for display (wordmark, headings, titles, minute numbers) and Hanken Grotesk (variable) for the interface. Both are OFL-licensed and stored in `web/fonts/`. Numbers use tabular figures.
- **Colour:**
  - Base: `--ground #15121d`, surfaces `--surface*`, ink `--ink/-2/-3` (all pass AA on the ground colour).
  - Accent: `--ember` for the primary action and the planned state.
  - Moods: `--mood-quiet` (lavender), `--mood-social` (ember), `--mood-outdoors` (sage).
  - Feedback: `--danger`, `--success`, `--focus`.
- **Spacing, shape, motion:** spacing runs `--space-1…8` (4–72px). Corner radius tokens are `s/m/l/pill`. Motion uses `--ease-out` with `--dur-quick` and `--dur-move`; all motion is reduced to about 1ms under `prefers-reduced-motion`.
- **Browser defaults are themed too:** text selection, caret, scrollbar and focus ring.

## Components (`web/index.html` + `web/app.js`)
| Component | Entry point | States |
|---|---|---|
| Buttons `.btn-primary/-secondary/-quiet/-ghost/-danger`, `.icon-btn` | markup | hover, focus, `aria-disabled` (stays focusable), `aria-busy` spinner |
| Mood chips `#mood-filter` | radio `filter-mood` | All / quiet / social / outdoors |
| Time horizon `#time-filter` | radio `filter-time`, `.horizon[data-fill]` | 30 / 60 / 120 / any |
| Evening row `#evening-template` | `createRow`, `fillRow` | `data-status`, `data-mood`, place/note may be empty, long text clamped |
| Status switch `.status-switch` | `setRowPending`, `setRowFeedback` | pressed, pending on the target option (row height unchanged), error + Retry, success line |
| List states `#list-state` | `renderListState` | loading skeleton, load error + Try again, empty collection, empty filtered + Show all |
| Editor `<dialog id="editor">` | `editor.open({mode, activity, trigger})` | create / edit, per-field errors, form alert, pending (fields read-only, closing paused with an explanation), Retry save, delete confirmation, Retry delete |
| Toast `#toast` | `toast.show(msg, {tone, action})` | success, error + action; fixed position so the list never moves |

## Interaction contract (implemented)
- **Validation:** `validateDraft` applies the same rules as the API — text is trimmed, length is counted in code points (title 1–120, place ≤160, note ≤1000), mood and duration must be valid values. Character counters use the same count. Errors from the server's `{error:{message, fields}}` response appear the same way as local errors.
- **While saving:** the editor's fields and values stay exactly as typed. Save cannot be pressed twice. Escape and Close are paused until the save finishes. If saving fails, focus moves to the alert (or to the first invalid field) and the button changes to *Retry save*.
- **Focus:**
  - Opening the editor focuses Title. Tab and Shift+Tab stay inside the editor.
  - Escape or Cancel returns focus to the button that opened the editor. Escape during a delete confirmation goes back to the Delete button.
  - After saving, focus goes to the saved row's edit button; for a new evening that is hidden by the filters, it goes to Add.
  - If the opener is gone (deleted, or hidden by filters), focus moves to the next row, then the previous row, then **Add an evening**.
- **Filters:** results are filtered on screen immediately, then refreshed from the server. Responses that arrive out of date are ignored (sequence number). The list stays on screen while refreshing, dimming only if the refresh takes longer than 220ms. Clear filters / Show all resets both filters.
- **Status:** changes are not optimistic. The target option pulses until the server confirms; a failure keeps the old status and offers an inline Retry. Focus stays on the switch.

## Builder integration
- **Data access:** `app.js` goes through one adapter (its shape is documented at the top of the file). Replace `createFixtureAdapter()` with an API adapter for `GET/POST /api/activities`, `PATCH/DELETE /api/activities/:id`, which throws `AdapterError(message, {status, fields})`. Keep the components and the controller as they are.
- **Demo URL options** (fixture adapter only — remove them once integration tests cover the same states): `?latency=ms`, `?fail=load,save,status,delete,fields` (each fails once), `?empty=1`.
- **Seed data:** `web/fixtures.json` (`{activities:[Activity]}`, ids 1–7, follows the API field contract exactly) is the only seed — use it for the first-run SQLite seed.
- **Visual references:** `docs/design-reference/` (desktop 1366×850 and phone 390×844).
