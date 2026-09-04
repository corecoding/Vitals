# Vitals — agent notes

GNOME Shell extension (`Vitals@CoreCoding.com`) that polls hardware sensors asynchronously and shows them in the top bar. Runtime is GJS ES modules (Shell 45–50). Official getting-started and practices: [Creating an extension](https://gjs.guide/extensions/development/creating.html), [Anatomy](https://gjs.guide/extensions/overview/anatomy.html), [Imports](https://gjs.guide/extensions/overview/imports-and-modules.html), [Debugging](https://gjs.guide/extensions/development/debugging.html), [Best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html).

## Layout

The install directory **must match** `metadata.json` `uuid`. User install: `~/.local/share/gnome-shell/extensions/Vitals@CoreCoding.com/`.

Required: `metadata.json`, `extension.js`. This repo also uses `prefs.js`, `stylesheet.css`, `schemas/`, `locale/`, helpers, and icons.

Required metadata: `uuid`, `name`, `description`, `shell-version`, `url`. This project also sets `settings-schema`, `gettext-domain`, `version`, and `donations`. Do not invent a `version` bump for EGO; that site owns submission versioning.

## ES modules (GNOME 45+)

- `extension.js` default-exports a subclass of `Extension` with `enable()` / `disable()`.
- `prefs.js` default-exports a subclass of `ExtensionPreferences`.
- Platform libs: `import St from 'gi://St'` (prefs: pin GTK 4, e.g. `gi://Gtk?version=4.0`).
- Shell modules: `resource:///org/gnome/shell/...` in the shell process; prefs use `resource:///org/gnome/Shell/Extensions/js/...`.
- Local files: relative paths (`./sensors.js`). No `imports.` / `this.imports`.

Shared helpers must not import `St`/`Clutter` **and** `Gtk`/`Adw`/`Gdk`. Shell and prefs are different processes.

## Lifecycle

Constructor runs once on load. Do not create GObjects, connect signals, add timeouts, or change the Shell there.

- `enable()`: build UI, connect, add sources, `Main.panel.addToStatusArea(...)`.
- `disable()`: undo **everything** from `enable()`. Destroy widgets, disconnect, remove sources even if they would later return `SOURCE_REMOVE`, then null references. Screen lock also calls `disable()`. This is the usual EGO rejection reason.

Keep `enable()` / `disable()` next to each other and small. Timeout create/remove stay adjacent; do not wrap `destroy()` / `GLib.Source.remove()` in try/catch.

## Process split

| File | Process | Toolkit |
|---|---|---|
| `extension.js` and shell modules | `gnome-shell` | Clutter / St |
| `prefs.js` | separate GTK app | GTK 4 / Adwaita |

A crash in the shell process can take down the desktop. Prefer async I/O (this project’s design). Do not block the main loop.

`stylesheet.css` applies only to Shell UI, not prefs.

Settings: schema id lives in metadata; entry points use `this.getSettings()` with no argument.

## Testing

GJS caches loaded modules. **Code changes require a new gnome-shell process**, not just disable/enable.

- Wayland: `dbus-run-session gnome-shell --devkit --wayland` (GNOME 49+; needs `mutter-devkit`). GNOME 48 and earlier: `--nested --wayland`. Then `gnome-extensions enable Vitals@CoreCoding.com` inside that session.
- X11: Alt+F2 → `restart`, then enable. Wayland sessions cannot restart in-place; log out.
- Logs: `journalctl -f -o cat /usr/bin/gnome-shell`. Use `console.debug` / `warn` / `error`; keep volume low (journal is system-wide). `SHELL_DEBUG=backtrace-warnings` adds JS stacks. Looking Glass: Alt+F2 → `lg`.

Local clone: compile schemas after schema edits (`glib-compile-schemas --strict schemas/`). See README for develop-branch install.

## Code in this repo

- Do not poll or format on the main thread; keep `Gio.File.load_contents_async` / subprocess patterns.
- Gettext: `_()` from the Extension/prefs import, domain `vitals`.
- GObject subclasses: `GObject.registerClass` + unique `GTypeName`.
- Icons: `St.Icon` / `Gtk.Image`, not emoji.
- Line length: stay under ~200 characters (EGO review UI).
