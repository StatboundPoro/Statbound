# RiftTrack

## Project overview

RiftTrack (working name — may change before public release) is a local
desktop companion app for the **Riftbound TCG**: deck tracking, match
history, replay logging, and matchup prep for players.

It is **local-only, by design, for the foreseeable future**: no backend
server, no user accounts, no network calls, no telemetry or analytics of any
kind. "Your data never leaves your machine" is a core trust claim of this
project, not an implementation detail — it must remain true as features are
added. Any future feature that would send data anywhere (e.g. an opt-in
community sync) must be explicitly opt-in and off by default; see Standing
Rules below.

The project is MIT licensed (see `LICENSE`) with intent to go public once
it's reliable for personal day-to-day use.

## Stack

- **Electron** — desktop shell
- **React + Vite** (via `electron-vite`) — renderer/UI
- **better-sqlite3** — embedded local database, main process only

Standard Electron security posture:
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the
  BrowserWindow ([src/main/index.js](src/main/index.js))
- The renderer has zero direct access to Node, Electron APIs, or the
  database. `src/preload/index.js` exposes a small whitelisted `window.api`
  object via `contextBridge` — that's the *only* surface the renderer can
  reach.
- All IPC channels are registered in `src/main/ipc.js` and namespaced
  `"<resource>:<action>"` (e.g. `decks:list`, `decks:create`,
  `matches:list`, `matches:create`). The renderer never touches SQLite
  directly — every read or write is `window.api.<x>()` →
  `ipcRenderer.invoke` → an `ipcMain.handle` in main → a `better-sqlite3`
  call.

### Repo layout

```
src/
  main/       Electron main process (Node): window management, SQLite, IPC handlers
    db.js       opens/creates the SQLite file, schema, seeds a demo deck if empty;
                also exports getDbPath()/closeDb() so settings.js can back up,
                replace, or reopen the live file for import/reset
    decks.js    deck queries (listDecks, getDeckById, createDeck, updateDeck, deleteDeck)
    matches.js  match + game queries (listMatches, getMatchById, createMatch,
                updateMatch, deleteMatch) — also where a match's result/score
                gets derived from its games
    deckNotes.js  deck_notes CRUD (listDeckNotesByDeck, createDeckNote,
                  updateDeckNote, deleteDeckNote) — backs the Deck Detail
                  Notes section
    settings.js  Settings screen's backend: exportBackup, pickImportFile,
                 importBackup, resetAllData, chooseAutoBackupDirectory, and
                 writeCleanBackup (the shared, WAL-header-stripping backup
                 writer every one of those funnels through) — see Current
                 State's Settings entry for the full import/reset safety
                 story
    autoBackup.js  the scheduled-backup poller — see Current State's
                   Automatic Backups entry
    preferences.js  reads/writes userData/preferences.json (currently just
                    the auto-backup schedule) — deliberately separate from
                    the SQLite database; see Current State's Automatic
                    Backups entry for why
    playView.js  manages the Play tab's embedded WebContentsView (create,
                 show/hide, bounds-sync) — see Current State for how it works
    ipc.js      registers every ipcMain.handle()/ipcMain.on() endpoint
    index.js    app bootstrap, BrowserWindow creation
  preload/    preload script — the only bridge between renderer and main
  renderer/   React UI (sandboxed, no Node/Electron/filesystem access)
    src/components/  DeckLibrary, DeckCard, DeckDetail, MatchHistory,
                      RecentMatches, Sidebar, ImportDeckModal (create + edit),
                      LogMatchModal (create + edit), MatchDetailModal,
                      MatchupRecord, ConfirmDialog, DeckNotes, PlayScreen,
                      SettingsScreen
    src/lib/          domains.jsx (Domain colors/icons), stats.js (win rate/streak
                       math), parseDecklist.js (paste-import parser + serializer)
```

## Data model

SQLite schema exactly as implemented in [src/main/db.js](src/main/db.js):

```sql
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain_1 TEXT,
  domain_2 TEXT,
  legend_name TEXT,
  decklist TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only'
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  opponent_name TEXT,
  opponent_legend TEXT,
  format TEXT NOT NULL CHECK (format IN ('Bo1', 'Bo3')),
  flags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  played_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only'
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_number INTEGER NOT NULL CHECK (game_number IN (1, 2, 3)),
  result TEXT CHECK (result IN ('win', 'loss', 'incomplete')),
  my_score INTEGER,
  opponent_score INTEGER,
  seat TEXT CHECK (seat IN ('went_1st', 'went_2nd')),
  my_battlefield TEXT,
  opponent_battlefield TEXT,
  extra_battlefields TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE replays (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only'
);

CREATE TABLE deck_notes (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'general',
  category TEXT NOT NULL CHECK (category IN ('general', 'mulligan', 'game_plan', 'battlefield', 'custom')),
  battlefield_name TEXT,
  custom_title TEXT,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only'
);

CREATE INDEX idx_matches_deck_id ON matches(deck_id);
CREATE INDEX idx_games_match_id ON games(match_id);
CREATE INDEX idx_replays_match_id ON replays(match_id);
CREATE INDEX idx_deck_notes_deck_id ON deck_notes(deck_id);
```

Conventions, followed on every table:
- **IDs are UUIDs** (`crypto.randomUUID()`), not autoincrement integers.
- **Timestamps are ISO 8601 UTC strings** (`new Date().toISOString()`), not
  SQLite's native datetime type.
- **`sync_status`** exists on `decks`, `matches`, `replays`, and
  `deck_notes` (default `'local_only'`), reserved for a *possible future,
  opt-in* community-sync feature — no sync logic exists anywhere yet.
  `games` deliberately does **not** have its own `sync_status`: a game is
  child data of a match and always syncs (or doesn't) alongside its
  parent, so a per-row status would just be a copy of the match's that
  could drift. `deck_notes` gets one despite also being child data of a
  deck because individual notes are plausibly sync-eligible independently
  of each other (and of the deck) once that feature exists — unlike a
  game, a note isn't just an inseparable fragment of one larger record. If
  a future table's rows are truly inseparable from one parent row's sync
  state, skip `sync_status` there too rather than cargo-culting it onto
  every table by default.
- **A match's headline result and score are never stored — always derived
  from its games on read.** `listMatches()`/`getMatchById()` in
  `src/main/matches.js` compute `result` (`'win'`/`'loss'`/`null`) and
  `score` (`"<wins>-<losses>"`) from each match's `games` rows every time
  they're read, via `deriveMatchSummary()`. This is why `matches` has no
  `result`/`score`/`seat`/`battlefields` columns of its own — those live on
  `games` (per-game) or don't exist as stored columns at all (derived).
  Don't add a stored `matches.result` column later "for convenience" — it
  would be a second source of truth that can drift from the games.
- A deck's two Domains are fixed by its Legend (derived once at import from
  its Runes — see Deck Import Format below), so there's no
  `opponent_domains` field anywhere; `opponent_legend` alone is sufficient.
- **`deck_notes.scope` is a plain string, not a foreign key** —
  `'general'` for the General notes set, or whatever opponent legend name
  the user typed when adding a matchup via Deck Detail's Notes section.
  There's no Legends reference table yet, so matchup scope is free text
  entered by hand; because it's already just a string column, swapping it
  for a picker sourced from a future Legends table later only changes what
  populates the value, not the column itself — no migration needed. A
  matchup scope isn't tracked in any separate table either — it only
  starts persisting once its first note is actually saved (derived from
  `SELECT DISTINCT scope FROM deck_notes WHERE deck_id = ?`); see
  DeckNotes.jsx for how the UI handles a matchup added-but-not-yet-saved.

JSON-in-TEXT columns (SQLite has no native structured type):
- `decks.decklist` — parsed back into an object in `listDecks()`/
  `getDeckById()`. Shape: `{ legend, champion, main, battlefields, runes,
  sideboard }`, each an array of `{ count, name }`.
- `matches.flags` — a free-text tag list (e.g. `["ladder", "tournament"]`)
  entered via the Log Match form's tag input.
- `games.extra_battlefields` — optional named board features (e.g. "Baron
  Pit", "Brush"), only present if ticked when logging that game.

On first run against an empty `decks` table, `db.js` seeds one demo deck
("Demo Deck (sample data)") so the Deck Library isn't empty before deck
creation existed — safe to delete manually, it's just a normal row.

**Migration note:** the very first `matches` table shape (flat
`opponent_legend`/`result`/`score`/`seat`/`battlefields` columns, no
`format`) predates match logging having any create path at all, so it was
guaranteed empty on every database that ever had it. `db.js`'s
`migrateLegacyMatchesTable()` detects that old shape (no `format` column)
on startup and drops the table so the schema above recreates it fresh — a
real destructive migration was never needed because there was never any
real data to lose. If `matches`/`games` ever need a *genuine* schema change
after real match data exists, this drop-and-recreate approach is **not**
safe to reuse — write a real migration that preserves rows instead.

IPC surface currently implemented (`src/main/ipc.js`): `decks:list`,
`decks:get` (single deck by id, backs the Deck Detail page), `decks:create`,
`decks:update` (used by Edit Deck), `decks:delete`, `matches:list`,
`matches:get` (single match by id, backs MatchDetailModal), `matches:create`
(used by Log Match — inserts one match row plus one row per game in a
single transaction), `matches:update` (used by Edit Match — same shape as
create, but replaces the match's games wholesale: delete-then-reinsert
rather than diffing, since Bo1↔Bo3 edits can freely add/remove games),
`matches:delete`, `deck-notes:list` (all notes for one deck id),
`deck-notes:create`, `deck-notes:update` (content/title only —
scope/category/battlefield_name are fixed at creation), `deck-notes:delete`,
`settings:export` (save-dialog + snapshot the live database), `settings:pick-
import-file` (open-dialog + validates the chosen file's schema in the same
round trip), `settings:import` (re-validates, safety-backs-up the current
database, then replaces it wholesale), `settings:reset` (deletes every deck,
cascading to everything else), `settings:get-auto-backup`/`settings:update-
auto-backup` (read/write `preferences.json` via `preferences.js` — see
Current State's Automatic Backups entry), `settings:choose-auto-backup-
directory` (open-dialog scoped to `openDirectory`). There is nothing for
`replays` yet.

Also registered on `ipcMain.on()` rather than `.handle()` — fire-and-forget
UI sync events with no return value, not data requests: `play:show`,
`play:hide`, `play:set-bounds` (see Current State's Play tab entry for what
these drive).

## Deck import format

The Import Deck flow ([ImportDeckModal.jsx](src/renderer/src/components/ImportDeckModal.jsx)
+ [parseDecklist.js](src/renderer/src/lib/parseDecklist.js)) parses a
plain-text paste in this confirmed format:

```
Legend:
1 LeBlanc, Deceiver

Champion:
1 LeBlanc, Fragmented

MainDeck:
3 Watchful Sentry
3 Hidden Blade
...

Battlefields:
1 Windswept Hillock
...

Runes:
7 Order Rune
5 Mind Rune

Sideboard:
3 Imperial Decree
...
```

Parsing rules:
- Sections are marked by a header line ending in `:` — `Legend`, `Champion`,
  `MainDeck`, `Battlefields`, `Runes`, `Sideboard` (case-insensitive on
  read).
- Each card line is `<count> <card name>`, split **only on the first
  space** — card names can contain commas (e.g. `"LeBlanc, Deceiver"`).
- Blank lines between/within sections are tolerated and ignored.
- **Domains are derived directly from the `Runes:` section** (e.g. `"Order
  Rune"` + `"Mind Rune"` → `domain_1: Order`, `domain_2: Mind`, ordered by
  rune count descending), *not* looked up from any card/legend database —
  there isn't one.
- Deck shape is validated exactly: 1 Legend, 1 Champion ("Chosen"), 39
  MainDeck cards, 3 Battlefields, 12 Runes, and Sideboard must be either 0
  or exactly 10. Any mismatch throws a `DecklistParseError` with a specific
  message (e.g. `"MainDeck:" must have exactly 39 cards (found 38).`),
  which the modal shows inline rather than saving a broken deck.

**This format was confirmed from one real source only.** If other sites/
tools export decklists with different section names or conventions, the
parser will need generalizing (e.g. accepting alternate header spellings)
rather than assuming this is the only valid shape.

## Design language

- **Palette**: warm dark charcoal base, deliberately not pure black or
  blue-black (`--bg: #15171b`, `--bg-rail: #101216`, `--panel: #1b1e23`).
  Six Domain colors are the core accent system, used everywhere a deck's
  identity needs representing (`src/renderer/src/styles.css` `:root`):
  - Fury `#d6483f` (red), Calm `#4c9e68` (green), Mind `#3e82c9` (blue),
    Body `#da8a3b` (orange), Chaos `#9463c9` (purple), Order `#d3ae3f`
    (yellow).
  - Domain → color/icon mapping lives in
    [lib/domains.jsx](src/renderer/src/lib/domains.jsx), matched
    case-insensitively against `domain_1`/`domain_2`.
- **Typography**: Big Shoulders Display for headers and deck names (bold,
  uppercase, condensed), Inter for body text, IBM Plex Mono for
  numeric/stat data (win rates, card counts). Self-hosted via `@fontsource`,
  imported from `main.jsx` rather than `styles.css` — Vite's CSS `@import`
  resolver can't locate scoped npm packages, but its JS import resolver
  handles them fine.
- **Signature pattern — the deck "crest"**: a diagonal split between a
  deck's two Domain colors (`.deck-crest` / `.import-preview-crest` in
  `styles.css`, via `clip-path` polygons), since every deck's identity is
  defined by exactly two Domains. Domain glyphs (small SVG icons) sit on
  top of the crest.
- **Overall direction**: a modernized game-client feel — the structural
  reference point is the League of Legends client — not a generic AI-app
  aesthetic. No purple gradients, no frosted glass/blur. Sharp edges and
  thin, high-contrast borders (`--border`, `--border-soft`) instead of soft
  shadows.

## Current state

*(Update this section at the end of each significant feature — see Standing
Rules.)*

Five real screens exist: **Play**
([PlayScreen.jsx](src/renderer/src/components/PlayScreen.jsx)), **Deck
Library** ([DeckLibrary.jsx](src/renderer/src/components/DeckLibrary.jsx)),
**Deck Detail** ([DeckDetail.jsx](src/renderer/src/components/DeckDetail.jsx)),
**Match History** ([MatchHistory.jsx](src/renderer/src/components/MatchHistory.jsx)),
and **Settings** ([SettingsScreen.jsx](src/renderer/src/components/SettingsScreen.jsx)).
There's still no router — [App.jsx](src/renderer/src/App.jsx) holds a
`screen` state (`'play'`, `'decks'`, `'matches'`, or `'settings'`, driven by
which rail nav item was clicked) plus the pre-existing `selectedDeckId` state
for the library/detail toggle within the Decks screen; clicking the "Decks"
nav item resets `selectedDeckId` back to the library rather than leaving
whatever deck was previously open. A real routing library still isn't worth
it for four rail destinations plus one nested toggle — revisit if a further
screen needs its own navigable state (e.g. deep-linking into a specific deck
or match). [Sidebar.jsx](src/renderer/src/components/Sidebar.jsx) shows
Play/Decks/Matches/Insights, plus Settings pinned in its own `rail-bottom`
slot below them (gear icon), with Play listed first (above Decks); Play,
Decks, Matches, and Settings are all clickable (`onNavigate` prop from
`App.jsx`, active state highlighted via an `active` prop), while Insights
still renders as an inert (non-clickable) nav item with no screen behind it
yet, by design, rather than pretending to navigate anywhere.

The app shell itself (`.app` in `styles.css`) is sized to exactly `100vh`
rather than `min-height: 100vh`, and `.main` scrolls independently
(`overflow-y: auto`) while `.rail` does not — so the left rail (and its nav
items/Settings) stays fixed on screen regardless of how long the current
screen's content is, instead of scrolling away with it. This is a plain CSS
sizing/overflow split, not `position: sticky`/`fixed`; it relies on `.app`
being a single-row CSS grid so both `.rail` and `.main` size to the same
viewport-height row.

The window ([index.js](src/main/index.js)) is created hidden (`show: false`)
and maximized on `ready-to-show` before its first paint, so it always opens
filling whatever screen it's on rather than assuming every display is
1080p, with no visible flash of a smaller window snapping to full size.
`width`/`height: 1920x1080` in the `BrowserWindow` constructor aren't the
launch size (maximize wins on launch) — they're just the size the window
restores to if the user later clicks restore-down.

`.main` centers its content instead of hugging the left edge, which
otherwise looked distinctly off once the window is routinely maximized/
wide rather than the old fixed 1280×800: `width: 100%; max-width: 1640px;
margin: 0 auto;`. The `width: 100%` is load-bearing, not redundant — `.main`
is a CSS Grid item (child of `.app`'s grid), and a grid item with an auto
margin drops the default stretch-to-fill-column sizing in favor of
shrinking to fit its own content, so *without* an explicit `width` the rule
quietly renders far narrower than `max-width` regardless of how large
`max-width` is. `.main-play` (the Play tab) overrides `max-width: none` so
the embed still fills the track edge-to-edge with no cap to center within.
Chromium's default (light-colored) scrollbar was also replaced everywhere
in the app with a themed one matching the dark palette, via a global
`::-webkit-scrollbar` rule near the top of `styles.css` — safe to rely on
with no fallback since Electron's renderer is always Chromium.

**Built and working:**
- **Play tab**, reached via the Sidebar's new "Play" nav item (top of the
  rail, above Decks) or the Deck Library topbar's "Play" button (now
  enabled — both are the same destination, not separate views). Embeds
  https://play.riftatlas.com filling the screen's content area, via an
  Electron `WebContentsView` rather than a `<webview>` tag — see
  [playView.js](src/main/playView.js). `WebContentsView` was chosen because
  it's a separate `WebContents` the main process attaches directly to the
  `BrowserWindow`, with its own independent `webPreferences`
  (`contextIsolation`/`nodeIntegration`/`sandbox` set the same as the main
  window, no preload at all); it never requires touching the main window's
  own hardened `webPreferences` the way `<webview>` would (`<webview>`
  needs `webviewTag: true` set on the window that hosts it, which Electron's
  own security guidance recommends against). The tradeoff is that
  `WebContentsView` is positioned by pixel bounds from the main process
  rather than living in the DOM, so [PlayScreen.jsx](src/renderer/src/components/PlayScreen.jsx)
  syncs its container div's `getBoundingClientRect()` to main on
  mount/resize (`ResizeObserver` + a `window resize` listener) via the new
  `play:set-bounds` IPC channel, and calls `play:show`/`play:hide` on
  mount/unmount so the embed doesn't render on top of other screens.
  `playView.js` lazily creates the `WebContentsView` and only calls
  `loadURL()` the first time the user actually opens the Play tab — not at
  app startup — so the app makes zero requests to any third party until the
  user has explicitly asked for this embed, matching the "no network calls
  without exception" standing rule (the *user* choosing to open a browser-
  like embed of a site they asked for is not the app calling home). Hiding
  the tab detaches the view but doesn't destroy it, so login/session state
  on play.riftatlas.com survives switching to another screen and back. This
  is a **plain, read-only embed only** — no `webRequest`/`session` network
  interception, no `webContents.debugger` attachment, no reading of the
  embedded page's data of any kind; it behaves like visiting the site in an
  ordinary browser tab, just hosted inside this window. No recording/
  capture of any kind exists yet (a deliberately separate future feature),
  and there's no TCG Arena embed and no linking to decks/matches from this
  screen — this pass is purely "can I play Rift Atlas inside RiftTrack."
  Two non-obvious fixes were needed to get it actually rendering, both
  worth knowing before touching this code again: (1) `playView.js` calls
  `webContents.setBackgroundThrottling(false)` on the embed — Chromium
  otherwise treats an attached-but-secondary `WebContentsView` as
  "backgrounded" (throttled timers/animations, `document.visibilityState`
  stuck on `'hidden'`) purely because it isn't the window's primary content
  view, even though it's fully visible on screen, which stalled Rift
  Atlas's own loading sequence forever. (2) `PlayScreen.jsx` reads
  `el.getBoundingClientRect()`'s fields into a plain `{x, y, width,
  height}` object before calling `window.api.play.setBounds()` — passing
  the `DOMRect` itself arrives in preload as all-`undefined`, because its
  `x`/`y`/`width`/`height` are getters on `DOMRect.prototype`, not the
  instance's own properties, and `contextBridge` only clones an object's
  *own* enumerable properties across the isolated-world boundary.
- Deck Library loads decks + matches over real IPC → SQLite on mount and
  renders the full pipeline end to end (no mock data).
- Stat strip: overall win rate, current streak, best deck by win rate, last
  played — all computed client-side from real match data
  (`lib/stats.js`).
- Deck grid: one `DeckCard` per deck (crest, domains, legend name, win
  rate/record, streak pill, last played). Clicking a card navigates to that
  deck's Deck Detail page (`onOpenDeck` prop threaded from `App.jsx` down
  through `DeckLibrary` to `DeckCard`).
- Recent Matches panel: the 5 most recent matches (`MAX_ROWS` in
  RecentMatches.jsx), each row clickable to open MatchDetailModal (see
  below) — no longer read-only.
- **Import Deck** is fully implemented: "Import Deck" button and the "+ Add
  a deck" tile both open a modal → paste text → client-side parse/validate
  → preview (legend, domains, Chosen/Main/Battlefields/Runes/Sideboard/
  Total counts) → Save Deck → `decks:create` IPC → SQLite insert → deck
  list refetches and the new deck appears immediately. Malformed pastes
  show a specific inline error instead of creating a broken deck record.
- **Deck Detail** page: fetches one deck via the `decks:get` IPC handler
  (backed by `getDeckById()`, keyed off the id `DeckLibrary` passed in)
  plus all matches, filtered client-side to that deck. Renders the deck's
  crest (larger), legend + champion names, both Domain pills, a 3-cell
  stat strip (win rate / record / current streak), the full decklist
  grouped into Legend/Champion/Main Deck/Battlefields/Runes/Sideboard
  sections pulled straight from the stored `decklist` JSON (no
  re-parsing), a real **Recent Matches** panel (reuses the same
  `RecentMatches` component as the library, scoped to this deck), a real
  **Matchup Record** section, and a real **Notes** section (both described
  below). The stat strip and Recent Matches panel show an honest empty
  state until the first match is logged for this deck, then show real
  computed data from then on — same component, no separate "empty" vs.
  "real" code path. A "Deck Library" back link returns to the library.
- **Log Match**, launched from the primary "Log Match" button on Deck
  Detail's header (left of Edit Deck/Delete Deck). A fully manual entry
  form — [LogMatchModal.jsx](src/renderer/src/components/LogMatchModal.jsx)
  — with no auto-capture, replay parsing, or confidence scoring of any
  kind; every field is typed in by hand. Layout: a live-derived Result
  badge next to a Bo1/Bo3 format toggle, a My Side/Opponent two-column
  split (Deck dropdown defaulting to the deck this was launched from, with
  a read-only "My Legend" pulled from that deck's `legend_name` — not
  stored on the match row, since it's already on the deck), a Games
  section, a flag tag-input, and a notes textarea. Bo1 shows one game's
  fields directly; Bo3 shows an accordion of up to 3 collapsible game
  cards — Game 1 open by default, later games appended (collapsed, so
  filling in Game 1's result doesn't yank focus away mid-entry) once the
  prior game gets a result, or manually via "+ Add Game," but never once
  either side has already reached 2 game wins (a clean sweep doesn't
  demand a pointless Game 3). Each deck has exactly 3 Battlefields (from
  its decklist); "My Battlefield" for a given game excludes whatever was
  already picked in that same match's earlier games, and once only one
  battlefield remains unused it's auto-filled and shown read-only instead
  of offered as a choice — this reconciliation
  (`reconcileBattlefields()`) re-runs on every keystroke, so changing an
  earlier game's pick correctly clears/reassigns later games instead of
  leaving a stale conflict. "Opponent Battlefield" is unconstrained free
  text. Save is disabled until at least one game has a win/loss result;
  `matches:create` backstops the same rule plus "no duplicate My
  Battlefield" server-side in case a caller ever bypasses the UI. On save
  the modal closes and Deck Detail refetches its matches, so the stat
  strip and Recent Matches panel show the new match immediately.
  LogMatchModal also has an `edit` mode (`mode="edit"` + a `match` prop) —
  same component, pre-filled from an existing match and calling
  `matches:update` instead of `matches:create` on save; see MatchDetailModal
  below for how that's reached. `played_at` is intentionally not editable
  anywhere in the form, in either mode — an edit shouldn't silently move a
  match's position in match-history ordering as a side effect of fixing an
  unrelated field.
- **MatchDetailModal**, a click-to-view modal wired onto every match row
  in the app: Recent Matches (on both Deck Library and Deck Detail) and
  Matchup Record's expanded per-legend table. Self-contained — given only
  a `matchId` it fetches the match (`matches:get`) and its deck
  (`decks:get`) itself rather than depending on whatever data shape each
  caller already has, the same reasoning LogMatchModal already fetches its
  own deck list regardless of context. Opens in a read-only view (deck
  crest, opponent name/legend, format, colored overall result, flags,
  notes, and a per-game breakdown of result/score/seat/battlefields) with
  **Edit** and **Delete Match** actions. Edit swaps in the real
  LogMatchModal in edit mode (not a second form); saving returns to the
  updated view. Delete goes through the same ConfirmDialog pattern as
  Delete Deck. Both `RecentMatches` and `MatchupRecord` own their own
  `selectedMatchId` state and render their own `MatchDetailModal` instance
  — there's no shared "currently open match" state lifted to Deck Library
  or Deck Detail — and both take an `onChanged` callback (wired to the
  page's existing `refetchMatches`/`refreshLibrary`) fired after a
  successful save or delete, so the page's `matches` state refetches and
  every view derived from it (stat strip, Matchup Record, Recent Matches,
  DeckCard win rates/streaks on the library) recomputes together, since
  none of those numbers are stored anywhere — see "A match's headline
  result and score are never stored" under Data Model.
- **Delete Deck**, with a confirmation step, from both places a deck is
  shown: a trash icon on each `DeckCard` in the Deck Library grid, and a
  "Delete Deck" button on the Deck Detail page header. Both go through the
  same reusable [ConfirmDialog.jsx](src/renderer/src/components/ConfirmDialog.jsx)
  ("Delete "<name>"? This can't be undone.") before calling the new
  `decks:delete` IPC handler. Deleting from the library refetches the deck
  + match lists in place; deleting from Deck Detail navigates back to the
  library afterward, since the page it's on no longer has a deck to show.
  `matches.deck_id`, `deck_notes.deck_id`, and `replays.match_id` are all
  `ON DELETE CASCADE`, so deleting a deck also silently removes any
  matches/replays/notes logged against it — there's no separate cleanup
  step and no warning about it in the confirmation copy yet (worth adding
  now that match logging and deck notes make that a real possibility
  rather than a theoretical one).
- **Edit Deck**, on the Deck Detail page header, left of Delete Deck.
  Reuses [ImportDeckModal.jsx](src/renderer/src/components/ImportDeckModal.jsx)
  for both flows now — it takes a `mode` prop (`'create'`, the default, or
  `'edit'`) plus `deckId`/`initialText` for edit mode, and calls
  `decks:update` instead of `decks:create` on save. The textarea opens
  pre-filled with the deck's *current* content via the new
  `serializeDecklist()` in [parseDecklist.js](src/renderer/src/lib/parseDecklist.js)
  (the exact inverse of `parseDecklist()` — same section format back out),
  so editing means "re-paste a revised decklist over the old one," not a
  field-by-field form. It goes through the same paste → Preview → Save
  Changes steps as a fresh import, including the same validation. There's
  no other way to edit a deck (e.g. renaming without touching the
  decklist) — this is the only edit path that exists.
- **Matchup Record**, the Deck Detail section between Recent Matches and
  Notes ([MatchupRecord.jsx](src/renderer/src/components/MatchupRecord.jsx)),
  replacing the old placeholder. Entirely a computed view — nothing is
  stored — grouping this deck's matches by `opponent_legend` via
  `computeMatchupRecords()` in [lib/stats.js](src/renderer/src/lib/stats.js),
  which reuses the same `computeRecord`/`computeWinRate`/`computeStreak`
  helpers the stat strip and Deck Library already use, just applied once
  per legend instead of once per deck. Matches with no `opponent_legend`
  recorded land in an "Unknown Legend" row rather than being dropped. A
  sortable table lists one row per legend actually faced (never a
  pre-seeded list of all Legends) — Record, Win Rate, Streak, and Games
  Played (= matches against that legend, not individual games), with a
  segmented control (reusing the same `.segmented` control as Log Match's
  Format/Result toggles) to sort by Games Played (default), Win Rate, or
  Legend name. Clicking a row expands it in place (no separate
  match-detail screen or route exists to navigate to instead) into a table
  of that legend's individual **matches** — date, format (Bo1/Bo3),
  overall result/score, deck used — one row per match, not per game; a
  Bo3 match's Result column reuses the match's own derived result/score
  (`match.result`/`match.score`, the same values Recent Matches shows)
  rather than any single game's score. (An earlier version of this table
  flattened to one row per game, which silently disagreed with the
  Games-Played count in the summary row above it for any Bo3 match — fixed
  by aggregating both at the same match granularity. That version also had
  a Battlefield column, dropped since it doesn't play a role yet — revisit
  if/when battlefield-level matchup prep becomes a real feature.)
  Deliberately has **no link to the Notes section or its matchup-scope dropdown** —
  Matchup Record and Notes group by opponent legend independently and
  stay fully unconnected by design; don't add cross-navigation between
  them later without it being a deliberate decision. Shows an honest empty
  state ("No matchup data yet — log a match to start tracking") when the
  deck has zero matches, rather than an empty table shell.
- **Deck Notes**, the Deck Detail "Notes" section
  ([DeckNotes.jsx](src/renderer/src/components/DeckNotes.jsx)), replacing
  the old Prep Notes placeholder. Notes are organized into "sets" (a
  `scope`) via a dropdown defaulting to "General Notes," plus any opponent
  matchups added by hand through "+ Add Matchup" (free-text legend name —
  see the `deck_notes.scope` note under Data Model for why a matchup only
  persists once its first note is saved). Within a scope there are five
  category sections: three fixed freeform ones (General Notes, Mulligan
  Notes, Game Plan), **Battlefield Notes** — not one freeform box, but one
  slot per this deck's actual named Battlefields pulled from its stored
  decklist, each independently addable — and **Custom Notes**, where each
  note carries its own user-typed title instead of a fixed category. Every
  category (and each Battlefield slot) shows an inviting empty-state
  prompt rather than being hidden when it has no notes yet, and multiple
  notes are allowed per category/scope — each independently added, edited,
  and deleted via `deck-notes:create`/`update`/`delete`. Note content
  preserves line breaks and renders consecutive `-`/`*`-prefixed lines as
  a real bullet list (`renderContent()` in DeckNotes.jsx); editing works
  on the same raw text. This section is entirely separate from the
  Matchup Record section above it — see that bullet for why the two are
  deliberately unconnected.
- **Match History**, the screen reached via the Sidebar's "Matches" nav
  item ([MatchHistory.jsx](src/renderer/src/components/MatchHistory.jsx)).
  Unlike Recent Matches or Matchup Record, it is never scoped to one deck —
  it fetches every deck and every match on mount (the same
  `decks:list`/`matches:list` calls Deck Library already makes) and lists
  one row per match, most-recent first (`matches:list`'s natural order),
  with Date, Deck (a small Domain-gradient bar plus name, the same compact
  deck-identity treatment Recent Matches uses for its row, rather than a
  new visual language), Opponent Legend, Result (colored win/loss score in
  IBM Plex Mono, same as everywhere else), and Format. Four filters sit
  above the table — Deck (dropdown), Opponent Legend (free-text substring
  search, since the legend list has no fixed set to pick from), Result
  (All/Win/Loss segmented control), Format (All/Bo1/Bo3 segmented control)
  — and combine as a plain client-side `.filter()` over the already-fetched
  match list; there's no separate filtered query. Clicking a row opens the
  existing `MatchDetailModal` unmodified — it already fetches its own match
  and deck by id given only a `matchId`, so it needed no changes to work
  outside a single-deck context. Two distinct empty states: "No matches
  logged yet" when the whole match list is empty, versus "No matches found
  for these filters" when filters narrow a non-empty list to zero rows, so
  a user with real data can't mistake an over-narrow filter for having no
  data at all. The (post-filter) match list is paginated client-side at
  `PAGE_SIZE = 50` — a "Showing X–Y of Z" summary plus Previous/Next and a
  "Page N of M" indicator appear below the table, but only once there's
  more than one page, so nothing changes visually until a deck/filter combo
  actually has over 50 matches. Changing any filter resets back to page 1
  rather than leaving the user stranded on a page number that may no longer
  exist for the narrower result set, and the current page is clamped
  against the actual (post-filter) match count so a mid-session delete via
  `MatchDetailModal` can't leave it pointing past the new last page.
- **Settings**, the screen reached via the Sidebar's gear icon
  ([SettingsScreen.jsx](src/renderer/src/components/SettingsScreen.jsx)).
  A General section (Export Backup, Import Backup) and a visually distinct
  red-tinted Danger Zone section (Reset All Data) — `.settings-danger-zone`
  in `styles.css`, the app's first use of that treatment; Delete Deck/Match
  predate it and still use a plain outline button with no surrounding panel.
  **Export** (`settings:export` → `exportBackup()` in
  [settings.js](src/main/settings.js)) shows a native save dialog, then
  writes a consistent snapshot of the live database to the chosen path via
  better-sqlite3's online-backup API (`db.backup(path)`) rather than a raw
  file copy — safe to use against a live WAL-mode connection, since a plain
  `fs.copyFile` could catch pages mid-write. Every backup this app writes
  (Export, the pre-import safety copy below, and Automatic Backups) actually
  goes through one shared `writeCleanBackup()` in `settings.js`, not
  `db.backup()` directly: the live database runs in WAL mode for write
  concurrency, and that mode is recorded in the database file's own header,
  so a plain `.backup()` copy inherits it — meaning the moment anything
  opens the exported file at all, even read-only, SQLite spawns `-wal`/
  `-shm` sidecar files next to it. `writeCleanBackup()` runs `PRAGMA
  journal_mode = DELETE` against the destination immediately after backing
  it up, which strips that flag back out, so an exported file is exactly
  the one clean file a user expects at the location they picked — no
  surprise siblings, whether they open it themselves or the app later
  re-opens it for import validation. **Import** is a three-step
  round trip, all through `settings.js`: `pickImportFile()` opens a native
  open dialog and validates the chosen file in the same call (checks for the
  five expected tables plus a column spot-check on `decks`, via a read-only
  connection that's always closed afterward) so the renderer has real
  `{decks, matches, notes}` row counts before the user ever sees a confirm
  dialog; an invalid file is rejected with a specific inline error and
  nothing is touched. If valid, `SettingsScreen.jsx` shows a warning
  ConfirmDialog spelling out — by name, in full sentences, not just a title —
  that this **completely replaces** every deck/match/note with the backup's
  contents and that current data is unrecoverable unless separately
  exported. Confirming requires typing the literal word `REPLACE` into a
  text field before the button enables — see `requireText` below — and only
  then does `importBackup()` re-validate the file (never trusts the
  renderer's earlier check), snapshot the *current* database to
  `userData/backups/pre-import-<timestamp>-<uuid>.db` as a recovery path,
  close the live connection, delete stale `-wal`/`-shm` sidecars, copy the
  backup over the live file, and reopen it. `getDb({ seed: false })` is used
  for that reopen (and for Reset, below) — the normal empty-database
  demo-deck seed in `db.js` must NOT fire here, since an empty result is a
  deliberate "this is what the backup/reset actually contains," not a fresh
  install. On success the modal shows the safety-backup path, then the
  renderer calls `window.location.reload()` so every screen refetches from
  the new database with no manual app restart. If the file swap itself fails
  partway, `importBackup()` copies the safety snapshot back over the live
  file before returning an error, so a bad import can't leave the app
  pointed at a half-written database. **Reset All Data** (`settings:reset` →
  `resetAllData()`) is one `DELETE FROM decks`, relying on the schema's
  existing `ON DELETE CASCADE` chain (decks → matches → games, decks →
  deck_notes, decks → replays) to clear everything in one statement; no
  pre-reset safety backup is taken (only Import got that treatment, since
  that's the flow this feature was actually built around) — Export first is
  how a user protects themselves before resetting. Both Import and Reset
  gate their destructive confirm button on a new `requireText` prop on
  [ConfirmDialog.jsx](src/renderer/src/components/ConfirmDialog.jsx) (`type
  RESET` / `type REPLACE` into a field before the button enables) rather
  than the plain Cancel/Confirm click Delete Deck/Match use — deliberately a
  stronger gate, since these two actions affect every row in the database
  at once instead of one. Verified end-to-end with a Playwright `_electron`
  driver against an isolated `--user-data-dir` (native save/open dialogs
  mocked via `electronApp.evaluate` rather than a real OS file picker):
  export writes a real file, an invalid file is rejected untouched, both
  typed-confirmation gates actually block the button, reset empties the
  library, and importing the earlier export restores it — including the
  reload-without-restart behavior.
- **Automatic Backups**, a third Settings section between General and
  Danger Zone. An enable toggle (styled as `.checkbox-pill`, the same
  control Log Match's flag tag-input uses), a Backup Interval segmented
  control (Hourly / Every 6 Hours / Daily / Weekly, i.e. 1/6/24/168 hours —
  defaults to Daily), and a Backup Folder row (defaults to `Documents/
  RiftTrack Backups`, changeable via a native folder picker,
  `settings:choose-auto-backup-directory` → `chooseAutoBackupDirectory()`
  in `settings.js`) all backed by
  [preferences.js](src/main/preferences.js), which reads/writes a plain
  `userData/preferences.json` — **deliberately not a SQLite table.** This
  schedule is a setting about *this installation*, not TCG data, so it must
  survive Import and Reset untouched (importing someone else's backup, or
  resetting your own data, shouldn't silently redirect or wipe where your
  own auto-backups are going). The scheduler itself
  ([autoBackup.js](src/main/autoBackup.js)) is started once from
  `app.whenReady()` in `index.js`: it polls every 5 minutes (not one
  `setTimeout` sized to the user's chosen interval) and runs a backup — via
  the same `writeCleanBackup()` Export uses, so auto-backups are just as
  free of stray `-wal`/`-shm` files — whenever `now >= lastBackupAt +
  intervalHours`, including immediately on the very next poll after
  `lastBackupAt` is `null` (never backed up) or the app was closed past the
  due time; there's no separate "missed backup" handling because polling
  already covers it. After each run it prunes old backups in that folder
  down to `retainCount` (10, not currently user-configurable), matching by
  filename prefix (`rifttrack-auto-backup-`) only — it will never delete a
  manual Export or any other file a user keeps in the same folder, even an
  old `.db`. There's no "back up now" button; Export already covers
  on-demand, so this is purely the unattended background path. Verified by
  actually letting the real 5-minute poll fire (not by shortening the
  interval for the test) and confirming a real file landed in a redirected
  folder with no sidecars.

**Stubbed/placeholder:**
- The seeded "Demo Deck (sample data)" row still appears in a fresh
  database alongside any real imported decks. Its `decklist` JSON predates
  the import feature and has no `legend`/`champion` keys and no
  `battlefields`, so its Deck Detail page shows "—" for those sections and
  its Log Match form shows "No battlefields left" instead of a battlefield
  picker, rather than crashing — a useful smoke test for the empty-state
  paths.

Deck Detail no longer has any placeholder panels of its own — Recent
Matches, Matchup Record, and Notes are all real now (see Built and
working above).

**Doesn't exist yet:**
- Replay logging/import (the `replays` table exists in the schema; there is
  no IPC handler or UI for it at all).
- The Insights screen.
- Any sync feature — deliberately not started; only the reserved
  `sync_status` columns exist.

## Standing rules for future work

- **No telemetry, analytics, or network calls, anywhere, without
  exception.** This is the app's core trust claim, not a preference.
- Any future community/sync feature must be **opt-in and off by default**.
- **Keep this file updated at the end of each significant feature.** Treat
  it as living documentation of what's actually built, not a one-time
  snapshot — update the Current State section in particular whenever a
  screen or flow moves from stubbed to working (or vice versa).
