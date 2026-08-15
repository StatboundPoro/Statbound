# Statbound

A local desktop companion app for the Riftbound TCG: deck tracking, match history, replay logging, and matchup prep for players.

## Unofficial project

Statbound was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

## Your data stays on your machine

Statbound is local-only, by design. There is no backend server, no user accounts, and no telemetry or analytics of any kind. The app makes no network calls on its own behalf; the only exception is the optional embedded Play tab, which loads the Rift Atlas web client, and only when you explicitly open that tab yourself. Your decks, match history, notes, and recordings are stored in a local database and local files on your own computer, and nothing is ever uploaded anywhere. "Your data never leaves your machine" is a core commitment of this project, not just an implementation detail.

## Features

### Deck Library and import

Build up a library of decks by pasting a decklist export directly into the app. Statbound parses the Legend, Champion, Main Deck, Battlefields, Runes, and Sideboard sections, validates the deck against real deckbuilding rules (39 main deck cards, 3 Battlefields, 12 Runes, and so on), and shows an editable preview before saving. Each deck's two Domains are derived automatically from its Runes. The library view shows every saved deck alongside a stat strip (win rate, streak, best deck, last played) computed from your real match history, with no fake or placeholder data.

![Deck Library screenshot](docs/screenshots/deck-library.png)
*Screenshot coming soon*

### Deck Detail

Every deck has its own detail page: its crest, name, Legend and Champion, both Domains, a stat summary, the full decklist broken out by section, its recent matches, its matchup record, and its notes, all in one place. A shortcut jumps straight into Insights pre-scoped to just that deck.

![Deck Detail screenshot](docs/screenshots/deck-detail.png)
*Screenshot coming soon*

### Log Match

Log a match by hand: Bo1 or Bo3, your deck, your opponent's name and Legend, one or more games with results, seat, battlefields, and any extra board features, plus free-text tags and notes. The result badge updates live as you fill in games, and a Bo3 never forces you to fill in a Game 3 after a 2-0 sweep. Matches can be edited or deleted later from their detail view.

![Log Match screenshot](docs/screenshots/log-match.png)
*Screenshot coming soon*

### Match History

A single running list of every match you've logged across every deck, most recent first, filterable by deck, opponent Legend, result, and format. Large histories are paginated so the list stays fast and readable.

![Match History screenshot](docs/screenshots/match-history.png)
*Screenshot coming soon*

### Matchup Record

For any deck, see your record broken down by the Legend you faced: games played, win rate, and the individual matches behind each row, sortable by games played, win rate, or Legend name. Only Legends you've actually played against show up, no pre-seeded list of every possible matchup.

![Matchup Record screenshot](docs/screenshots/matchup-record.png)
*Screenshot coming soon*

### Deck Notes

Keep freeform notes per deck, organized into a General set plus a set per opponent matchup you add. Each set has dedicated sections for general notes, mulligan guidance, game plan notes, a slot per named Battlefield in the deck, and custom notes with their own titles, so prep for a specific opponent stays organized instead of living in one long scratch pad.

![Deck Notes screenshot](docs/screenshots/deck-notes.png)
*Screenshot coming soon*

### Insights

An aggregate stats dashboard across your whole match history, or narrowed to a single deck. Overall win rate, a recent-form trend, and your current streak; seat advantage (how often going first or second correlates with a win); a battlefield win rate table; and a best/worst matchup summary alongside a full matchup breakdown table. Everything is computed fresh from your logged matches each time you open it, so it's always up to date with no separate step to refresh it.

![Insights screenshot](docs/screenshots/insights.png)
*Screenshot coming soon*

### Play tab

An embedded view of the Rift Atlas web client, right inside Statbound, so you can play without leaving the app. It loads only once you open the Play tab yourself, not automatically on launch. A deck picker lets you flag which deck you're playing so matches and recordings can be tied back to it, and a Log Match shortcut is right there in the header.

![Play tab screenshot](docs/screenshots/play-tab.png)
*Screenshot coming soon*

### Replay recording

Record video of your games as you play them. You can start and stop recording manually, or turn on Auto-record so Statbound starts recording automatically when a game begins and stops automatically once you're back at the lobby, no manual timing required. Recording is video only, with no audio capture of any kind. Auto-detection works by watching the Play tab's own connection to know when a game has started, and by watching for the lobby screen to reappear to know when it's ended, nothing beyond that timing signal is read or stored.

Finished recordings that haven't been tied to a match yet collect in a "Log Recent Match" queue, accessible from a badge in the sidebar on any screen, so you can catch up on logging matches after a play session instead of doing it between every game. Logging a match from the queue lets you attach its recording, and once a match is logged you can watch its replay back at any time from the match's detail view.

![Replay Recording screenshot](docs/screenshots/replay-recording.png)
*Screenshot coming soon*

### Settings, backups, and video capture

Export a full backup of your database to a file, or import one back in (with a confirmation step before anything gets replaced). Automatic backups can run on a schedule (hourly, every 6 hours, daily, or weekly) to a folder of your choosing, keeping the 10 most recent automatic backups without touching any manual export sitting in the same folder. Video capture settings let you choose where recordings are saved, pick a quality preset, and optionally auto-delete unlinked recordings after a retention window you set. A Danger Zone lets you reset all data entirely, also backed up first as a safety net. Your app data location is shown read-only with a one-click Open Folder button.

![Settings screenshot](docs/screenshots/settings.png)
*Screenshot coming soon*

### Legends autocomplete

A bundled, up-to-date list of real Riftbound Legend names powers autocomplete suggestions when you're typing an opponent's Legend or naming a matchup note, so you're not stuck retyping the same names from scratch or worrying about a typo splitting one Legend into two separate matchup groups. These fields stay free text, so nothing you type is ever rejected even if it doesn't match a known name.

![Legends autocomplete screenshot](docs/screenshots/legends-autocomplete.png)
*Screenshot coming soon*

### First-run experience

A new install starts with a genuinely empty deck library and a short guided welcome tour covering importing a deck, logging a match, checking Insights, and recording a replay. The tour runs once automatically and can be replayed any time from Settings.

![First-Run Experience screenshot](docs/screenshots/first-run-experience.png)
*Screenshot coming soon*

## Project status

Statbound is pre-1.0 and actively developed. There is no packaged installer available yet; packaged releases for Windows, macOS, and Linux are planned.

## Tech stack

- [Electron](https://www.electronjs.org/): desktop shell
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) (via [electron-vite](https://electron-vite.org/)): UI
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3): embedded local database
- [ffmpeg](https://ffmpeg.org/) (via `ffmpeg-static`): replay video encoding

## License

Statbound is licensed under the [MIT License](LICENSE).
