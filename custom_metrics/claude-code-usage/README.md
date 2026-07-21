# Claude Code usage → Vitals Custom Metrics

Feeds Claude Code's own `statusLine` data (model, context %, 5-hour and 7-day
rate-limit usage) into Vitals' [Custom Metrics](../../README.md#custom-metrics)
feature, so it shows up in your GNOME top bar / Vitals menu alongside your
other sensors.

## How it works

`claude-usage-statusline.sh` is a single script with two modes, chosen
automatically by how Claude Code invokes it:

1. **statusLine mode.** Claude Code runs the script and pipes a JSON blob
   describing the current session on stdin (after every assistant message,
   `/compact`, permission-mode change, etc. - see [Claude Code's statusLine
   docs](https://docs.claude.com/en/docs/claude-code/statusline)). The script
   pulls out the model name, context-window usage, and 5h/7d rate-limit usage,
   writes them to `~/.claude/claude-usage.json` in Vitals' custom-metrics JSON
   format, and prints the normal status-line text back to stdout (this part is
   required - it's what actually renders in Claude Code's status bar).

2. **Bootstrap/install mode.** Run the script yourself (or let the login item
   below run it) with no piped input, and it idempotently:
   - adds a `statusLine` entry to `~/.claude/settings.json` pointing at itself
     (merges in - it won't clobber other settings already in that file),
   - installs `~/.config/autostart/claude-usage-vitals.desktop`, an XDG
     autostart entry, so this bootstrap step re-runs every login,
   - finds your installed Vitals extension's schema and adds
     `~/.claude/claude-usage.json` to its `custom-metrics-paths` (falls back to
     printing instructions if it can't find one),
   - makes a best-effort attempt to refresh the file straight from the
     `claude` CLI if it's on PATH (see "About the CLI refresh" below),
   - writes a placeholder `~/.claude/claude-usage.json` if one still doesn't
     exist after that, so Vitals has something to show before your first
     Claude Code session of the day.

Every step checks current state before acting, so running it again (e.g. at
every login) is a no-op once everything's already wired up.

## Setup

```sh
chmod +x claude-usage-statusline.sh
./claude-usage-statusline.sh
```

That's the only manual step. From then on:
- Every login re-verifies the wiring (via the autostart entry) and repairs
  anything that got reset.
- Every Claude Code session updates `~/.claude/claude-usage.json` as you use it.

To verify by hand instead of waiting for Claude Code:

```sh
echo '{"model":{"display_name":"Sonnet 5"},"context_window":{"used_percentage":5.4},
"rate_limits":{"five_hour":{"used_percentage":16.4},"seven_day":{"used_percentage":1.0}}}' \
  | ./claude-usage-statusline.sh
cat ~/.claude/claude-usage.json
```

## About the CLI refresh (`try_cli_usage_refresh`)

The statusLine hook only updates while Claude Code is actively rendering a
session - so right after login, or on a machine that's never opened Claude
Code that day, the file would otherwise sit on stale or placeholder data. The
bootstrap step tries to close that gap by calling `claude -p "/usage"
--output-format json` directly, if `claude` is on `PATH`.

**As of this writing, that call doesn't actually work** - `/usage` is
documented as a TUI-only command with no supported headless equivalent, so
this is speculative. The function is written defensively for that reason: it
only ever overwrites `claude-usage.json` if the output it gets back parses
into real percentages for the 5h/7d fields; anything else (an error, a
conversational non-answer, no `claude` binary at all) is silently ignored and
the existing file is left untouched. Today it's a no-op on every known Claude
Code version. If a future version adds a real headless usage command, update
the `claude -p ...` invocation and field names in `try_cli_usage_refresh` to
match its actual output - the validation/fallback logic around it doesn't need
to change.

## Requirements

- `jq` (`sudo apt install jq` / `sudo dnf install jq` / `sudo pacman -S jq`)
- `python3` (used only by the installer, to safely read-modify-write the
  Vitals `custom-metrics-paths` array without touching anything else in it)
- `gsettings` (optional - only needed for automatic registration with Vitals;
  the script degrades gracefully to printing manual instructions without it)

## Caveats

- `rate_limits` in the statusLine payload is only populated for Claude.ai
  subscribers (Pro/Max), and only after the first API response of a session.
  Until then (or on API/Console accounts), the 5h/7d rows show `N/A`.
- The exact statusLine JSON schema is Claude Code's, not Vitals' or this
  script's - if a future Claude Code version renames or removes a field, the
  affected metric just falls back to `N/A` rather than breaking the script
  (everything is read via `// empty` jq fallbacks).
- If you ever want to stop this, remove the `statusLine` key from
  `~/.claude/settings.json`, delete
  `~/.config/autostart/claude-usage-vitals.desktop`, and remove the path
  from Vitals' custom-metrics-paths in Preferences.
