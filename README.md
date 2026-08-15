# Statbound

A desktop companion app for the **Riftbound TCG** — deck building, match tracking, and
replay logging, built as a local-first tool for players.

> Working name. May change before the first public release.

## Privacy

**All data is stored 100% locally on your machine.** Statbound has no accounts, no
backend server, and makes no network calls. Your decks, match history, and notes live
in a single SQLite database file in your own user data directory (see below) — nothing
is ever uploaded anywhere. There is a `sync_status` column reserved on each table for a
possible future *opt-in* community-sync feature, but no sync logic exists yet, and none
will run without explicit opt-in.

## Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) (via [electron-vite](https://electron-vite.org/)) — UI
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — embedded local database (main process only)

## Development

Requires [Node.js](https://nodejs.org/) (LTS).

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite dev server for the UI and launches the Electron window,
with hot reload for renderer changes.

On first launch, Statbound creates its SQLite database file (and tables) automatically
if one doesn't already exist.

### Where the database file lives

Electron's `app.getPath('userData')` resolves to an OS-specific per-user app data
folder. On Windows that's:

```
%APPDATA%\Statbound\rifttrack.db
```

(typically `C:\Users\<you>\AppData\Roaming\Statbound\rifttrack.db`).

## Project structure

```
src/
  main/       Electron main process (Node): window management, SQLite, IPC handlers
  preload/    Preload script — the only bridge between the renderer and main process
  renderer/   React UI (runs sandboxed, no direct Node/Electron/filesystem access)
```

## License

MIT — see [LICENSE](LICENSE).
