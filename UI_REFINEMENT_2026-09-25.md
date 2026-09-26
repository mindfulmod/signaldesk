# SignalDesk UI refinement

## Direction

Preserve the dark graphite/green identity and static stack. The redesign trial
found that repeated initials, outlined score badges, full-width tab buttons,
repeated "New" labels, and multi-line source metadata competed with stock names.
The compact tab and six-column board trial kept evidence and risk visible while
making typography carry the hierarchy. The detail pane uses fewer nested boxes.

`favicon.svg` is an original, code-native mark: a rounded S-shaped signal trace
and detached endpoint, drawn on a 32-unit grid. The same SVG is the favicon and
header mark; no font, external image, or raster-generation dependency is needed.

## Interaction changes

- Native sorting works on desktop and mobile. Counts describe the board, not
  mixed units on tabs. Attention filters stay on the board; company size and
  source controls share the Filters panel.
- Mobile filters open above the board. Empty results offer a clear recovery
  action and do not retain a misleading previously selected stock.
- The desktop app bar now stays sticky: horizontal overflow clipping no longer
  creates a non-scrolling ancestor. Cross-tab stock selection scrolls directly
  to the board. A different ticker resets the detail pane to its heading.
- Ticker keyboard activation preserves focus on desktop. Mobile detail sheets
  focus the close control, isolate the background, wrap Tab/Shift-Tab, close
  with Escape, and restore focus to the table/radar/map control that opened them.
- Full quote provenance remains in the detail pane and quote tooltips; stale
  and missing-quote warnings remain visible. No scoring thresholds were changed.

## Verification

Tested the same stock board at 375×812 and 1440×900, plus intermediate responsive
widths. Checked sorting, search and empty-state recovery, filter selection,
watchlist add/remove, show-all expansion, tab keyboard navigation, and all three
stock-selection entry points. The first complete stock card fits the initial
375px-wide screen. Browser console checks and JavaScript syntax checks were clean.

All 142 Node tests pass, including regression checks for quote freshness labels, rank
change labels, unique control IDs, sort options, and the shared SVG asset.
This extends the existing review branch; it is not a production deployment.
