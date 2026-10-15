# Session Deck

A desktop dashboard for Claude Code sessions running across LocalWP sites, for
macOS and Windows. Its job is one thing: make a session that is *blocked on you*
announce itself.

## Screenshots

![The deck: one session blocked, one working, one interrupted](docs/screenshots/deck.png)

| | |
|---|---|
| ![A focused session](docs/screenshots/focused-session.png) | ![The diff view](docs/screenshots/diff.png) |
| ![Hours worked, by ticket](docs/screenshots/worked-on.png) | ![A session summary](docs/screenshots/summary.png) |
| ![The Cyberdeck skin](docs/screenshots/skin-cyberdeck.png) | ![The HUD skin](docs/screenshots/skin-hud.png) |
| ![Settings](docs/screenshots/settings.png) | ![A theme with a background image](docs/screenshots/background.png) |

*Rendered from `npm run preview` with example data — no real projects or tickets.*

## Setup

```sh
npm install                               # postinstall fixes node-pty's spawn-helper and downloads Electron
npm run install-integration               # dry run — shows what it would change
npm run install-integration -- --write    # apply
npm run dev
```

`install-integration` (alias: `install-hooks`) sets up Claude Code for **every**
session, including ones started outside the deck:

1. **Hooks** in `~/.claude/settings.json` — status, plus the headers that tie a
   terminal to its tile (`X-Deck-Session`) and to its Claude process
   (`X-Claude-Pid`). Existing deck hooks are updated in place; the file is backed
   up first.
2. **The MCP server** at user scope, via `claude mcp add` — pointing at
   `~/.session-deck/mcp-bridge.mjs`, a stable copy the app refreshes on start.

New Claude sessions pick it up; running ones keep their old configuration.

## Building a real app

```sh
npm run dist        # macOS -> dist/Session Deck-<version>-arm64.dmg + dist/mac-arm64/Session Deck.app
npm run pack        # macOS, unpacked .app only, faster
npm run dist:win    # Windows -> dist/Session Deck Setup <version>.exe (also builds on macOS)
```

**macOS:** drag the app to `/Applications` and it is Spotlight-launchable. The build is
**ad-hoc signed** (`identity: "-"`), not signed with an Apple Developer ID or
notarized. Up to 0.2.0 it was not signed at all (`identity: null`), which left
Electron's original signature broken by the rename. Apple Silicon Macs report a
downloaded copy of such a build as "damaged", with no way to open it. An ad-hoc
signature is valid, so macOS only says it cannot verify the developer — once:
open it, then *System Settings → Privacy & Security → Open Anyway*. Or clear the
quarantine flag up front:

```sh
xattr -dr com.apple.quarantine "/Applications/Session Deck.app"
```

Hardened runtime stays off: with an ad-hoc signature it would refuse to load
node-pty's native module. `npmRebuild` is off too, and node-pty's `build/` is
left out of the package: its prebuilds cover every target, and a rebuild under
Rosetta Node compiled an x64 `pty.node` into an arm64 app.

**Windows:** run the installer. It is unsigned too, so SmartScreen warns once —
*More info* → *Run anyway*.

The icon is generated, not hand-drawn: `build/icon.html` is rendered by
`build/render-icon.cjs` (using the Electron already installed) into
`build/icon-1024.png`, then `sips` + `iconutil` produce `build/icon.icns`, and
`build/make-ico.mjs` packs resized PNGs into `build/icon.ico` for Windows.
Edit the HTML and re-run those steps to change it.

**Window lifecycle (macOS).** Closing the window with the red button does *not*
end your sessions -- the app stays in the dock with everything running, and
reopening it shows the same deck. Sessions are torn down on `before-quit` only,
because watching long-running work is the point of the app. On Windows/Linux,
closing the last window quits.

Dev and the packaged app share hook port 47823, so only one can own status at a
time. The second one to start warns and keeps working rather than dying.

## Updates

The deck checks GitHub's latest release 15 seconds after starting and every six
hours after that; *Session Deck → Check for Updates…* checks on demand. A newer
version puts an *Update to x.y.z* button in the title bar.

Electron's own updater (Squirrel) only accepts apps signed with an Apple
Developer ID, so the deck does it itself (`src/main/updater.js`):

1. It downloads the dmg for its architecture (or the Windows installer) and
   checks its size and the sha256 GitHub publishes for every asset. A release
   whose asset has no checksum is not installed; the dialog links the release
   page instead.
2. *Restart and update* quits the app — deck sessions end and come back as
   resumable — and hands over to a script that outlives it
   (`update-core.js`): wait for the pid, mount the dmg, move the old bundle
   aside, `ditto` the new one in, restore the old one if that fails, clear any
   quarantine flag, relaunch. It logs to `$TMPDIR/session-deck-update/install.log`.
   On Windows the NSIS installer runs silently (`/S --force-run`).

A file the app downloads itself gets no quarantine flag, unlike a browser
download, so an updated version opens without the Gatekeeper prompt. Only the
first install needs *Open Anyway*.

The app has to be able to replace itself: not from the dmg or App Translocation
(move it to Applications first), and with write access to its folder. Otherwise
the dialog says why and links the release page instead. Updating is disabled in
development.

For a release to be offered, the tag must be newer than the running version
(`v0.3.0` > `0.2.0`) and it must carry the `-arm64.dmg`, `-x64.dmg` and `.exe`
assets `npm run dist:all` produces.

## Windows

Tested and working on Windows (2026-09-16). `npm run dist:win` builds
`dist/Session Deck Setup <version>.exe` (NSIS, x64, unsigned); it cross-builds
from macOS, since node-pty ships a Windows prebuild and nothing native needs
compiling. [docs/windows-testing.md](docs/windows-testing.md) is the checklist
used, worth re-running after changes to the platform-specific parts.

What differs, all behind `process.platform`:

| | macOS | Windows |
|---|---|---|
| Local data | `~/Library/Application Support/Local` | `%APPDATA%\Local` |
| Site shell | `bash <site>.sh` with `SHELL` → launcher (`exec $SHELL`) | `cmd /c launcher.cmd`: `call <site>.bat`, then `claude` |
| Plain directory | `$SHELL -l -c launcher` | the same `.cmd`, without the `call` |
| Finding claude/node | own `PATH`, then a login and an interactive shell's `command -v`, then known paths (incl. nvm, Volta) | `where` (prefers `.exe` over a `.cmd` shim) |
| Hook command | `curl` (~10ms) | Node script `~/.session-deck/hook-client.mjs` |
| Process list | `ps` every 5s | PowerShell `Win32_Process` every 10s |
| Go to app | first `.app` bundle, `open -a` | first non-shell ancestor, `WScript.Shell.AppActivate` |
| Stop | SIGTERM to the tree | `taskkill /T` |
| Window | traffic lights over the title bar | normal frame, menu on Alt |

The hook runner is a trade-off. On macOS starting node costs ~150ms against
curl's ~10ms, on every tool call, so curl stays. On Windows it is not known
whether hooks run under cmd.exe or Git Bash, and the curl form needs POSIX shell
syntax — so the Node script, which works under both. Override either way with
`npm run install-integration -- --write --hook-runner=curl|node`.

Platform logic is written against injectable path and process data
(`platform.js`, `proc.js`'s `parseWindowsProcesses`, `launch-script.js`) so the
Windows paths are unit-testable from a Mac.

## How it works

Three channels, none of which require patching Claude Code:

| Direction | Channel | Carries |
|---|---|---|
| out | Local site shell | Spawns the PTY with PHP/MySQL/WP-CLI on `PATH` |
| in | Hooks | Lifecycle events → tile status |
| in | MCP | Session names and test-page URLs |

**Launching.** Local's `ssh-entry/<siteID>.sh` ends with `exec $SHELL`. We spawn
that script with `SHELL` pointed at a one-shot launcher that execs
`claude --session-id <uuid>`. The UUID is minted before spawning, so every hook
event correlates to a tile with no guessing. See `src/main/launcher.js`.

**Tile state comes from hooks, not the terminal.** Claude Code redraws its TUI
with cursor movement, so the raw PTY stream has no stable "last four lines".
Hook payloads carry the structured facts the tile needs — tool name, target
file, permission question — so tiles are rendered from those. The PTY buffer
exists only to replay into xterm.js when a session is focused.
See `src/main/registry.js`.

**One emulator, ever.** Tiles are plain text. A real `xterm.js` instance mounts
only in the focused view, at the PTY's pinned 120×32, and is disposed on close.

## The MCP server

`src/main/mcp-bridge.mjs` is a dependency-free stdio JSON-RPC server:

- `set_session_name(name)` — names the tile
- `report_test_page(url, title?)` — the test page link
- `report_pull_request(url, title?)` — the PR link. Reported rather than looked
  up: the repos are on Bitbucket, which needs an API token to query. Kept per
  project (the last 50) like test pages: a tile links the PR for its branch and
  offers "all N" for the rest, each forgettable.
- `add_user_todo(text)` — an item on the user's after-Claude checklist

Its handshake also returns `instructions` saying *when* to use each tool — that is
what gets Claude to call them unprompted, without a separate skill. A session
launched by the deck passes the server with `--mcp-config` unless it is already
installed globally, so no session gets two copies.

A deck-launched bridge identifies itself by `SESSION_DECK_ID`. A globally
installed one has no deck env, so it sends its parent pid; the deck walks up to
the `claude` process, which the hooks have already tied to a session.

It is wired **per session** via `claude --mcp-config <tmpfile>`, written at launch
alongside the shell launcher. Nothing global is registered, and the server exists
only for sessions the deck itself started.

Identity travels by environment: the deck exports `SESSION_DECK_ID` into the
session, and Claude Code passes its environment down to MCP subprocesses, so the
bridge knows which tile it belongs to without being told.

The bridge has no dependencies on purpose -- it is executed by Claude Code from
`Contents/Resources`, where the app's `node_modules` is not reachable. It ships
as an `extraResources` entry so it lands outside `app.asar`.

**Session names.** `set_session_name` is the good name, but Claude has to choose
to call it. So `UserPromptSubmit` also derives a fallback name from the first
prompt -- a tile never reads "Untitled session". An MCP-set name always wins.

## Sessions started outside the deck

Hooks are installed globally, so sessions started in a terminal or an IDE send
events too. The deck **adopts** them as read-only tiles: full status, named from
the first user message in their transcript, but no terminal and no launch --
there is no PTY to attach to. They carry an `external` badge, and "Remove from
deck" drops the tile without touching the session.

Without this the deck silently under-reported what was running on the machine,
which is worse than showing less: a dashboard that omits half your sessions is
one you stop trusting.

## Notification types are not all urgent

`Notification` fires for `notification_type: "idle_prompt"` -- Claude finished
and awaits your next instruction -- as well as for genuine permission requests.
Mapping all of them to "Needs you" made the deck raise its one urgent signal for
sessions that wanted nothing. `idle_prompt` now maps to **Done**; everything else
raises the alert, and the alert only says "Permission requested" when the
payload's type actually indicates one.

## Test pages

The deck does **not** create pages. `report_test_page(url, title?)` records a URL
Claude gives it — Claude creates the page however that site needs (usually
WP-CLI). Deck-side WP-CLI was considered and rejected: the sites differ too much
in setup for one code path to hold.

Records are keyed by **project**, so they accumulate across sessions, and they
live in `~/.session-deck/store.json` so they survive a restart. A tile links the
most recent and offers "all N" for the full list.

Storage is a JSON file with atomic temp+rename writes, deliberately not SQLite:
the payload is a few hundred links, and a native module would add exactly the
rebuild and architecture failure modes that already cost a day on node-pty.

"Forget" removes the deck's record only. The WordPress page is never touched —
the deck has no post ID and no WP access, and it should stay that way.

## Resume after a restart

Sessions are children of the app, so quitting kills them — but the *conversation*
survives on disk, and `claude --resume <uuid>` reopens it **under the original
session id** (forking is opt-in via `--fork-session`). So a resumed session's
hooks keep matching its existing tile: it recovers its identity, not just its
history.

The deck records every session it launches in `store.json`. On startup those
records become dashed **Interrupted** tiles with a Resume action. Records are
dropped when:

- `SessionEnd` fired — the session was ended deliberately, not interrupted
- its Local site no longer exists
- it has not been seen for 7 days

So the deck offers to resume only what it actually lost.

## Diff view

A LocalWP site is **not one repository**, and this is the thing that shapes the
whole feature. On a typical agency WordPress project:

- the site-level repo (`<site>/app`) gitignores `public/` entirely, so it can
  never show a change to any WordPress code
- the actual work lives in ten or more independent repos under `wp-content` --
  the theme, each custom plugin, plus vendored third-party ones

So the panel does not resolve "the" repo. It finds repos two ways:

1. **From the files the session edited.** `PreToolUse` gives us every
   `file_path`, so the repo containing each one is resolved directly. Precise,
   and free.
2. **A shallow scan** of `wp-content/{themes,plugins,mu-plugins}` as a fallback,
   for changes made outside the session (a build step, a colleague's branch).

Repos with no changes *and* no edits are dropped, so the panel does not list ten
clean vendored plugins. Edited repos sort first and are badged.

Left pane: repos, each split into **Conflicted / Staged / Unstaged / Untracked**.
A file staged with further unstaged edits appears in both groups, each with its
own diff (`--cached` versus working tree). Right pane: unified diff, coloured by
line role. Untracked files diff against `/dev/null` so a new file shows as fully
added. Diffs are capped at 400KB and marked when truncated.

## Closing, reopening, removing

- **End session** kills the PTY. The tile stays as *Closed*, across restarts too.
- **Reopen / Resume** runs `claude --resume` for a Closed or Interrupted tile.
  Offered only when its transcript exists — resuming a missing conversation makes
  Claude fall back to a fresh session or the resume picker.
- **Remove from deck** drops the tile and forgets it entirely.

On startup, records are pruned only when they could never be reopened: the Local
site is gone, the conversation cannot be found, or it has been idle for a week.

Any tile with nothing running behind it — closed, adopted, or interrupted —
carries a dismiss (×) in its corner. Live sessions do not: removing one kills it,
and that should stay a deliberate act from inside the session view.

## Starting a session in a directory

**New session** has two tabs: *Local site* and *Directory*. A directory comes from
the native folder picker or the recent list (last 8).

- **Inside a Local site** the session still gets that site's shell — WP-CLI, the
  site's PHP — just started in the chosen folder. Local's ssh-entry script does
  its own `cd`, then execs the launcher, which `cd`s into the chosen folder.
- **Anywhere else** the launcher runs under the user's login shell (`$SHELL -l`).

The chosen folder is remembered separately from the live `cwd`, because Claude
files a conversation under the directory it started in: reopening has to start
there again, while a site session must not be forced out of the `app/public`
Local lands in. The launcher text lives in `launch-script.js`, free of Electron
imports, so it can be tested directly.

The launcher also restores the real `$SHELL` before starting Claude — the Local
trick borrows `SHELL`, and Claude used to inherit the launcher path as its shell.

## Processes, apps and hours

**Background processes.** Every 5s one `ps` call covers all sessions. Claude runs
each Bash call as a direct child shell (`… && eval '<command>'`); those whose
command matches a `run_in_background` call from the hooks are listed as
background, with their task id, plus foreground commands running over 20s.
**Stop** sends SIGTERM to the shell and its descendants — never the process
group, which could include Claude itself.

**Go to app.** For an external session the deck walks up from its `claude`
process to the first `.app` bundle (Terminal, iTerm, PhpStorm…) and runs
`open -a` on it. The claude process is resolved *while the hook request is in
flight* — the response is held until it is, because the shell a hook reports
exits right after, leaving nothing to walk up from.

**Checklist.** Things the user must do once Claude is done, per project: added by
Claude through `add_user_todo`, or by hand.

**Worked on.** What was worked on per day, grouped by ticket (parsed from
prompts, names and branches), for logging hours by hand. Each session's active
time is hidden by default — it leaves out testing, reviews and changes made
outside Claude, so it reads as less than the time spent on a ticket. *Settings →
Worked on times* shows it again. A silence over 10 minutes ends a block. A wrong or missing ticket can be set by hand per session
(`ticketOverrides` in `store.json`); it applies on every day that session ran
and on its tile, and clearing it returns to the detected one. Stored as compact blocks in `store.json`, built once from
the hook log's history. **Local only** — nothing is sent anywhere.

**The hook log** keeps what explains behaviour and drops bulk (Write/Edit
payloads carried whole files), and rotates at 20MB.

**The focused terminal** is large by default and drag-resizable; it refits to the
dialog and resizes the PTY only when the grid actually changes.

## A session's id is not stable

Claude switches session id mid-terminal: a resume that falls back to a fresh
session, the resume picker, `/resume`, `/clear`. Keying tiles on the id the deck
minted therefore produced duplicate tiles — the real session got adopted as
external under its new id.

Hooks inherit Claude's environment, which contains the `SESSION_DECK_ID` the deck
exported into the PTY. The hook command sends it as `X-Deck-Session`, and the deck
re-binds the tile to whatever id the session now reports, absorbing any duplicate
adopted in the meantime. `SessionEnd` with reason `clear` or `resume` is treated
as a switch, not an end. The UI keys on a stable `uid` (the deck id) so an open
terminal survives the switch.

This needs the current hook command — re-run `npm run install-integration -- --write`
after upgrading. It updates existing deck hooks in place.

## Launching the deck from inside a Claude session

A running Claude session exports `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`,
`CLAUDE_CODE_SESSION_ID` and more to everything it starts. If the deck was started
from such a shell, every session it launched inherited them and ran as a *child*
session — and child sessions are never saved as resumable transcripts. The
launcher strips these variables from each PTY (keeping `CLAUDE_CONFIG_DIR`), so
this holds however the app was started.

## Session names

Sources, in increasing priority: the first prompt, Claude's `set_session_name`
MCP call, and a user rename. User renames come from either the deck
(click a name — the pencil cursor marks it — on a tile or in the focused view) or `/rename` inside
Claude, which the deck reads incrementally from the transcript's `custom-title`
entries; between those two the latest wins. Deck renames are stored in
`store.json`. They do not rename the session inside Claude.

## Dropping files on the terminal

Drag an image — or any file — from Finder onto a focused session's terminal and
its path is typed at the cursor, escaped the way a terminal would, several
files separated by spaces. Claude Code turns an image path into an attachment.
The path goes in as a paste, so nothing is submitted until you press Enter.
Only files on disk work: an image dragged straight out of a web page has no
path and is ignored.

## Settings

One panel, from the title bar or *Session Deck → Settings…* (⌘,): **theme**,
**light or dark**, **skin**, **background**, **tile height**, **tile text size**,
**terminal text size**, where ticket links point, and **check for updates** with
the running version. Looks are per machine (`localStorage`); the ticket base URL
is shared (`store.json`).

Seven themes, each with a light and a dark version (Auto follows the system):
**Plum**, **Cyberpunk** (electric blue, neon red), **Spaceship** (steel navy,
teal, amber), **Nature** (paper and moss), **Electric** (a live yellow wire),
**Candy** (soft pink) and **Gothic** (purples).

All 14 palettes live in `src/renderer/src/themes.js` and are applied as CSS
variables at runtime — not 14 blocks of CSS. One source of truth, and the
swatches in Settings read from it, so they cannot drift from the real colours.
Only the default light and dark sets are in CSS, as what shows before the script
runs.

A theme sets its neutrals and its accent; the semantic colours (working, needs
you, done, idle) come from a shared light or dark set unless they would collide
with that theme's accent. That is a rule, not a preference — *Needs you* has to
read at a glance in every theme — and it drives, for example, teal for *Done* in
Nature (green is the accent) and orange for *Needs you* in Electric (amber
beside yellow is one colour).

Every text pair in every palette meets WCAG AA (4.5:1); there is a contrast
check in the repo history for when palettes change. Fixing that also corrected
two colours that had been slightly under AA since the first version: the idle
pill and the amber *Needs you* chip.

### Skins

A skin changes shapes and frames, never colours, so it works with every theme,
light or dark: **Plain** (the default), **Cyberdeck** and **HUD**.

- **Cyberdeck** — hardware. Panels have a stepped silhouette: the top edge
  steps down part-way along, the bottom edge steps the other way, corners are
  chamfered, and a faint second outline traces the bezel. The screens inside
  (tile activity, the terminal) follow the same step, and the tiles' have faint
  scanlines. Pills are parallelograms, controls have small chamfers.
- **HUD** — a projected display. No full outlines: frames are pieces — corner
  brackets that step inwards at 45°, a marker square in each corner, a notched
  bar at the top centre, and on dialogs C-shaped side pieces and a row of ticks.
  Brackets take the *Needs you* colour on a blocked tile. The deck sits on a
  faint grid, pills are outlined readouts, the title bar is a ruler.

How: `src/renderer/src/skins.js` holds the geometry — per skin and per kind
(tile, dialog, focused window) a function of width and height that returns the
silhouette and the frame lines in pixels. `<SkinFrame kind="…" />`, the first
child of every tile and dialog, measures its parent, draws the lines as an SVG
over it and clips the parent to the silhouette, so outline and shape cannot
disagree, and 45° stays 45° at any size (a stretched SVG would skew it).
`skins.css` colours the frames from theme tokens and does what CSS can on its
own: screens, pills, controls, the grid and the ruler.

The focused window keeps a square bottom-right corner for its resize handle.
Clipped elements show focus on their frame, since a clip cuts an outer focus
ring off. Neither skin adds motion or changes text.
`npm run preview -- skin-<skin>-<theme>-<mode>[-focused|-dialog] out.png`
renders them; the scenarios pair each skin with its natural theme and a light
one it was not designed for.

## Backgrounds

Eight backgrounds ship with the app, in `resources/backgrounds` — stored as JPEG
(~2.5MB for the set, against ~15MB as PNG) so they can live in the repository.
**Choose…** takes any other image; that choice is per machine.

Images reach the renderer over a dedicated `deckbg://` scheme rather than
`file://`: the renderer runs from `http://` in dev and `file://` when packaged,
and its CSP allows neither. The handler serves only the bundled images and the
ones chosen through **Choose…** (recorded in `store.json`) — not any image on
disk.

Two controls keep them from making the deck unreadable:

- **Background dim** — everything sits on a scrim of the page colour at
  *Subtle*, *Medium* or *Strong*. With no background the scrim is the page
  colour at full strength, so it does nothing.
- **Tile opacity** — how much of the image shows through the tiles. The activity
  block inside a tile keeps its own solid background at any setting, so that text
  never sits directly on the image.

Thumbnails in the panel are resized by the main process, so picking a background
does not load eight full-size images into the window.

## Ticket numbers

A tile shows the ticket it is on, taken from the branch (`feature/EXC-207-…`) or
the session name — the same parsing the hours list uses, so `php-8.3` is not
mistaken for a ticket. A ticket set by hand in *Worked on* wins.

It becomes a link once the deck knows where tickets live. That is learned from
any ticket URL pasted into a prompt (`…/browse/AS-23230`), or set in Settings.
Tickets are only ever linked — never read, never changed.

## Session summaries

*Summary* in a focused session writes up what it did: goal, what was done, where
it stands, what is left — useful for a hand-over, a PR description or the hours
list. It is made on request, never in the background, and kept in `store.json`;
when the conversation has continued since, the dialog says so and offers a new
one.

`src/main/transcript.js` boils the transcript down first (prompts, replies, one
line per tool call; tool output, thinking and file snapshots dropped, the middle
cut past 120k characters — 37ms for an 11MB transcript). `src/main/summary.js`
then runs one `claude -p` on Haiku with:

- `--tools ""` — it only reads what it is given;
- `--safe-mode` — no hooks, MCP servers or CLAUDE.md. Without it the deck's own
  global hooks would report the run as a new session and give it a tile;
- `--no-session-persistence` and a temp directory as cwd.

`--bare` would skip hooks too, but only accepts an API key, not a subscription
login.

## Security

The deck is a local developer tool: it starts shells, reads repositories and
listens on localhost. What keeps that contained:

- **The hook server** listens on `127.0.0.1` only and wants the token from
  `~/.session-deck/token` on every route. The macOS hook has curl read the
  header from `~/.session-deck/token-header` (`-H @file`), so the token is never
  in a process's arguments, where `ps` would show it to other local users.
- **`~/.session-deck` is private** (`0700`, files `0600`). `hooks.jsonl` keeps
  every hook payload — prompts cut to 1000 characters, Bash commands and URLs
  in full, obvious secrets masked (`redact.js`, a safety net rather than a
  guarantee) — until it rotates out at 20MB, with one
  previous file kept. Nothing in it leaves the machine.
- **Only `http(s)` links are opened.** Test pages, pull requests, the ticket
  base and the release page all end in `shell.openExternal`; anything else is
  refused when it is stored and again when it is clicked.
- **The window** is sandboxed, cannot navigate and cannot open windows. It may
  only ask for diffs inside repositories it was shown, and only load the
  backgrounds described above.
- **Per-session launcher files** (in `$TMPDIR/session-deck-launchers`, one of
  them holding the token) are private and removed when the session ends. A
  folder that turns out to belong to another user is not used: the launch
  fails instead (`private-dir.mjs`).

Accepted, and noted where the code does it:

- The token is in the environment of everything a session runs
  (`launcher.js`) — that is how the hooks and the MCP server reach the deck.
- Updates trust the GitHub repository and nothing else: no signature of our
  own, no Authenticode or Gatekeeper check (`update-core.js`).
- DevTools stay available in the packaged app (`index.js`).

After updating from 0.4.0 or earlier, re-run
`npm run install-integration -- --write` once to move the macOS hook to the
token header file. The old hook keeps working until then.

## Diagnostics

```sh
npm run status                    # token-gated GET /sessions
cat ~/.session-deck/hooks.jsonl   # every raw hook payload received
cat ~/.session-deck/store.json    # durable state (sessions, names, test pages)
npm run build && npm run preview -- deck out.png   # render the UI with fixture data
```

`npm run preview -- <scenario> <out.png> [w] [h]` renders the built renderer with
fixture data (`scripts/preview/fixtures.cjs`) and clicks through real UI to reach
a state: `deck`, `tall`, `focused`, `closed`, `diff`, `pages`, `new`, `newdir`,
`todos`, `procs`, `worklog`. Transitions are
disabled so a capture shows end states. It exists because layout bugs were
invisible from code — the deck's grid shrank every tile to fit the window rather
than scrolling, and only a screenshot showed it.

## Layout

```
src/main/       local.js      read Local's sites.json (read-only)
                launcher.js   the SHELL-override spawn
                hooks.js      localhost hook receiver (127.0.0.1:47823, token-gated)
                config-dir.js ~/.session-deck, private to the user
                redact.js     masks secrets before they reach the hook log
                urls.js       the http(s)-only rule for links
                registry.js   session state, hook → status mapping
                index.js      window, IPC, notifications
src/preload/    contextBridge surface — no node in the renderer
src/renderer/   React: App, SessionTile, FocusedSession, ProjectPicker
```

## Status

v1 slice: project picker, launch, hook-driven tiles, focused terminal,
answer permission prompts from the tile.

v1.5: MCP server (session names, test pages) -- built.

**Answering from the deck is deliberately not a feature.** An early version put
Allow/Deny on the tile by writing menu numbers into the PTY; the menu varies per
tool, and "Deny" selected "yes, and don't ask again" -- a deny button that
granted standing permission. The deck's job is to tell you *which* session needs
you. Answering happens in that session's own prompt, where the options are
unambiguous and nothing has to be inferred. Do not reintroduce it.

Everything in the original spec is built. Possible next: side-by-side diff
(currently unified), committing from the panel, notification tuning.

## Known environment notes

**Check that Node matches your CPU architecture.** On Apple Silicon it is easy
to end up with an x64 Node running under Rosetta:

```sh
node -p process.arch   # x64 …
uname -m               # …while the machine says arm64
```

When they disagree, anything Node builds or launches is translated too. It
works, but a daily-driver desktop app will be slower and use more battery than
it needs to. Fixing it means reinstalling Node for arm64, which affects every
other project on the machine — so it is worth deciding deliberately rather than
discovering later.

**If `npm run dev` says `Error: Electron uninstall`,** Electron's binary has
not been downloaded. Electron no longer does that in an install script of its
own, and electron-vite does not trigger the download, so this project's
`postinstall` runs it. If that was skipped (`npm install --ignore-scripts`),
recover with:

```sh
node node_modules/electron/install.js
```

**Local writes unexpanded `~` into some `sites.json` paths.** Some sites store
`~/Local Sites/<name>` literally. That is not a real path, so using
it as a spawn `cwd` fails with `posix_spawnp failed`. `local.js` expands it, and
`launcher.js` falls back to `$HOME` if a path still does not resolve -- the
ssh-entry script cd's into the site itself, so `cwd` only has to be valid.

**Local only writes a site's ssh-entry script on its first "Open site shell".**
A new site has none, and used to be left out of the site list. On macOS
`local.js` now builds an equivalent script from `sites.json` — the site's PHP
and MySQL from `lightning-services`, WP-CLI and Composer from `Local.app`,
`PHPRC`/`MYSQL_HOME` from `run/<siteID>` — into `~/.session-deck/site-shells/`,
leaving Local's own folder untouched. Local's script wins once it exists. If
the services can't be found the site is still listed and starts in a plain shell.

**`posix_spawnp failed` on every launch.** npm extraction drops the execute bit
from node-pty's `prebuilds/*/spawn-helper`. node-pty spawns that helper via
`posix_spawnp`, so without `+x` every session dies with that message -- which
names neither the file nor the reason. `npm run fix-pty` (also wired to
`postinstall`) restores it.

**No `electron-rebuild`.** node-pty 1.x ships NAPI prebuilds that work across
Electron versions, so rebuilding is unnecessary. It can also be actively
harmful: if Node and Electron differ in architecture (see above), `electron-rebuild`
builds for Node's, producing a `build/Release` that shadows the correct prebuild.
The dependency has been removed and `postinstall` runs `fix-node-pty.mjs` instead.

**Dev-only advisories.** `npm audit` reports findings in the build chain
(`vite`, and `tar` via `@electron/rebuild`). These are build-time dependencies
that do not ship in the packaged app. Electron itself is kept current — v32 was
past end-of-life and has been upgraded to v44.
