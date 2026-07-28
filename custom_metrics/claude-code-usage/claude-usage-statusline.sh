#!/usr/bin/env bash
#
# Vitals Custom Metrics companion script for Claude Code.
#
# Dual purpose, detected automatically by how it's invoked:
#
#   1. Claude Code invokes it as a `statusLine` command, piping session JSON
#      on stdin. In that mode it writes/refreshes the Vitals custom-metrics
#      JSON file (model, context %, 5h/7d rate-limit usage) and prints the
#      normal status line text Claude Code expects back on stdout.
#
#   2. Run directly by a human (or at login, with no stdin piped) it acts as
#      its own installer: it wires itself into Claude Code's settings.json as
#      the statusLine command, drops an XDG autostart entry so it re-runs
#      this bootstrap at every login, and points Vitals' custom-metrics-paths
#      setting at the JSON file it produces. All steps are idempotent - safe
#      to re-run any time. It also makes a best-effort attempt to refresh
#      from `claude`'s own /usage data (see try_cli_usage_refresh below) so
#      there's something recent to show even between active sessions.
#
# See README.md in this directory for setup instructions and the JSON schema.

set -euo pipefail

CLAUDE_USAGE_FILE="${CLAUDE_USAGE_FILE:-$HOME/.claude/claude-usage.json}"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
AUTOSTART_DESKTOP="$HOME/.config/autostart/claude-usage-vitals.desktop"
VITALS_SCHEMA="org.gnome.shell.extensions.vitals"

script_path() {
    # resolve our own path even if invoked via a relative path or symlink
    local dir base
    dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    base="$(basename "${BASH_SOURCE[0]}")"
    printf '%s/%s' "$dir" "$base"
}

require_jq() {
    if ! command -v jq >/dev/null 2>&1; then
        echo "jq is required but not installed. Install it with one of:" >&2
        echo "  sudo apt install jq      # Debian/Ubuntu" >&2
        echo "  sudo dnf install jq      # Fedora" >&2
        echo "  sudo pacman -S jq        # Arch/Manjaro" >&2
        exit 1
    fi
}

# writes the Vitals custom-metrics JSON file atomically (temp file + mv, same
# directory, so the mv is a same-filesystem rename - Vitals never reads a
# half-written file)
write_metrics_json() {
    local model="$1" context_disp="$2" five_disp="$3" seven_disp="$4"
    mkdir -p "$(dirname "$CLAUDE_USAGE_FILE")"
    local tmp
    tmp="$(mktemp "${CLAUDE_USAGE_FILE}.XXXXXX")"
    jq -n \
        --arg model "$model" \
        --arg context "$context_disp" \
        --arg five "$five_disp" \
        --arg seven "$seven_disp" \
        '{
            title: "Claude Code",
            metricsBarValue: $context,
            metrics: [
                { title: "Model", formattedValue: $model },
                { title: "Context", formattedValue: $context },
                { title: "5h window", formattedValue: $five },
                { title: "7d window", formattedValue: $seven }
            ]
        }' > "$tmp"
    mv "$tmp" "$CLAUDE_USAGE_FILE"
}

# --- statusLine mode: Claude Code piped us session JSON on stdin ---
handle_statusline() {
    require_jq
    local input
    input="$(cat)"

    # debug: always keep the last raw payload around so field-mapping issues
    # (e.g. rate_limits not showing up) can be diagnosed against what Claude
    # Code is actually sending, rather than what the docs say it sends
    printf '%s' "$input" > "$HOME/.claude/claude-usage-debug.json" 2>/dev/null || true

    local model context five_hour seven_day
    model="$(jq -r '.model.display_name // .model.id // "Claude Code"' <<<"$input")"
    context="$(jq -r '.context_window.used_percentage // empty' <<<"$input")"
    five_hour="$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input")"
    seven_day="$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$input")"

    local context_disp="N/A" five_disp="N/A" seven_disp="N/A"
    [ -n "$context" ] && context_disp="${context}%"
    [ -n "$five_hour" ] && five_disp="${five_hour}%"
    [ -n "$seven_day" ] && seven_disp="${seven_day}%"

    write_metrics_json "$model" "$context_disp" "$five_disp" "$seven_disp"

    # this line is what actually renders in Claude Code's status bar
    printf '%s | ctx %s | 5h %s | 7d %s\n' "$model" "$context_disp" "$five_disp" "$seven_disp"
}

# --- best-effort refresh via the `claude` CLI directly, for when no active
# session's statusLine has run recently (e.g. right after login) ---
#
# As of this writing, Claude Code's `/usage` is a TUI-only command - there is
# no documented, scriptable way to fetch current 5h/7d rate-limit percentages
# outside of an active interactive session (the statusLine hook above is the
# only supported mechanism). This function is deliberately conservative: it
# only ever overwrites the metrics file if it gets back output it can
# actually parse into real percentages, so today it silently no-ops on every
# known Claude Code version rather than write anything approximate or
# fabricated. It exists so that if/when Claude Code adds a headless usage
# command, this starts working without any changes needed here - update the
# parsing below to match whatever that command actually outputs.
try_cli_usage_refresh() {
    command -v claude >/dev/null 2>&1 || return 0

    local output
    output="$(timeout 10 claude -p "/usage" --output-format json 2>/dev/null)" || return 0
    [ -n "$output" ] || return 0

    require_jq
    # speculative field names, matching the statusLine schema this script
    # already understands - adjust if a real headless usage command ships
    # with a different shape
    local model context five_hour seven_day
    model="$(jq -r '.model.display_name // .model.id // empty' <<<"$output" 2>/dev/null)" || return 0
    context="$(jq -r '.context_window.used_percentage // empty' <<<"$output" 2>/dev/null)"
    five_hour="$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$output" 2>/dev/null)"
    seven_day="$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$output" 2>/dev/null)"

    # only trust this enough to write the file if at least the rate-limit
    # fields we actually care about came back as real numbers
    [[ "$five_hour" =~ ^[0-9]+(\.[0-9]+)?$ ]] || return 0
    [[ "$seven_day" =~ ^[0-9]+(\.[0-9]+)?$ ]] || return 0

    local context_disp="N/A"
    [ -n "$context" ] && context_disp="${context}%"
    write_metrics_json "${model:-Claude Code}" "$context_disp" "${five_hour}%" "${seven_day}%"
    echo "Refreshed $CLAUDE_USAGE_FILE from claude CLI"
}

# --- bootstrap mode: wire everything up, idempotently ---
install_statusline_hook() {
    require_jq
    local self
    self="$(script_path)"
    mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
    [ -f "$CLAUDE_SETTINGS" ] || echo '{}' > "$CLAUDE_SETTINGS"

    if jq -e --arg cmd "$self" '.statusLine.command == $cmd' "$CLAUDE_SETTINGS" >/dev/null 2>&1; then
        echo "statusLine already points at $self"
        return
    fi

    local tmp
    tmp="$(mktemp)"
    jq --arg cmd "$self" '.statusLine = {type: "command", command: $cmd}' "$CLAUDE_SETTINGS" > "$tmp"
    mv "$tmp" "$CLAUDE_SETTINGS"
    echo "Configured statusLine command in $CLAUDE_SETTINGS"
}

install_autostart() {
    local self
    self="$(script_path)"
    mkdir -p "$(dirname "$AUTOSTART_DESKTOP")"
    if [ -f "$AUTOSTART_DESKTOP" ]; then
        echo "Login item already installed: $AUTOSTART_DESKTOP"
        return
    fi
    cat > "$AUTOSTART_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Claude Code Usage for Vitals
Comment=Keeps ~/.claude/claude-usage.json wired up for Vitals' custom metrics
Exec=$self --bootstrap
X-GNOME-Autostart-enabled=true
NoDisplay=true
Terminal=false
EOF
    echo "Installed login item: $AUTOSTART_DESKTOP"
}

# Vitals' schema is never registered system-wide - gnome-shell loads it
# straight out of the extension's own schemas/ directory, so plain
# `gsettings get/set org.gnome.shell.extensions.vitals ...` finds nothing.
# We have to point --schemadir at a real installed copy's schemas/ dir.
# (All Vitals-family extensions share the same fixed dconf path, so it
# doesn't matter which installed copy we borrow the compiled schema from -
# writing through any one of them updates the value every copy reads.)
find_vitals_schema_dir() {
    local ext_dir
    for ext_dir in "$HOME/.local/share/gnome-shell/extensions/"*/ /usr/share/gnome-shell/extensions/*/; do
        [ -f "${ext_dir}metadata.json" ] || continue
        if grep -q '"settings-schema"[[:space:]]*:[[:space:]]*"org.gnome.shell.extensions.vitals"' "${ext_dir}metadata.json" 2>/dev/null \
           && [ -f "${ext_dir}schemas/gschemas.compiled" ]; then
            printf '%s' "${ext_dir}schemas"
            return 0
        fi
    done
    return 1
}

register_with_vitals() {
    if ! command -v gsettings >/dev/null 2>&1; then
        echo "gsettings not found - add $CLAUDE_USAGE_FILE to Vitals' Custom Metrics preferences manually."
        return
    fi

    local schema_dir
    if ! schema_dir="$(find_vitals_schema_dir)"; then
        echo "Couldn't find an installed Vitals extension - add $CLAUDE_USAGE_FILE to Vitals' Custom Metrics preferences manually."
        return
    fi

    # Read-modify-write the array-of-strings key. Done in Python rather than
    # bash string surgery: gsettings' array literal formatting (spacing,
    # occasional line-wrapping for long values) isn't worth hand-parsing, and
    # a botched write here corrupts a real user setting, not a scratch file.
    if ! GSETTINGS_SCHEMADIR="$schema_dir" VITALS_SCHEMA="$VITALS_SCHEMA" CLAUDE_USAGE_FILE="$CLAUDE_USAGE_FILE" python3 <<'PYEOF'
import ast
import os
import subprocess
import sys
import time

schema_dir = os.environ["GSETTINGS_SCHEMADIR"]
schema = os.environ["VITALS_SCHEMA"]
path = os.environ["CLAUDE_USAGE_FILE"]
key = "custom-metrics-paths"

def read_paths():
    result = subprocess.run(
        ["gsettings", "--schemadir", schema_dir, "get", schema, key],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"Couldn't read {schema} {key}: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    value_text = result.stdout.strip()
    # gsettings sometimes prints the GVariant type annotation ahead of the
    # literal (e.g. "@as []" for an empty array) instead of a bare
    # Python-compatible literal - strip any such "@xyz " prefix before parsing.
    if value_text.startswith("@"):
        value_text = value_text.split(" ", 1)[1] if " " in value_text else "[]"
    return value_text

value_text = read_paths()
if value_text == "[]":
    # repeated re-reads guard against this coming back empty due to a
    # transient schema-cache staleness right after (re)compiling schemas -
    # never worth risking silently clobbering a real, non-empty setting with
    # a lone entry over one unlucky read
    for delay in (0.3, 0.6, 1.0):
        time.sleep(delay)
        value_text = read_paths()
        if value_text != "[]":
            break

try:
    paths = ast.literal_eval(value_text)
except (ValueError, SyntaxError) as e:
    print(f"Couldn't parse existing {key} value ({result.stdout.strip()!r}): {e}", file=sys.stderr)
    sys.exit(1)

if path in paths:
    print(f"Vitals is already watching {path}")
    sys.exit(0)

paths.append(path)
literal = "[" + ", ".join("'" + p.replace("\\", "\\\\").replace("'", "\\'") + "'" for p in paths) + "]"
result = subprocess.run(["gsettings", "--schemadir", schema_dir, "set", schema, key, literal])
if result.returncode != 0:
    sys.exit(1)
print(f"Registered {path} with Vitals' custom-metrics-paths (via {schema_dir})")
PYEOF
    then
        echo "Couldn't register with Vitals automatically - add $CLAUDE_USAGE_FILE to its Custom Metrics preferences manually." >&2
    fi
}

bootstrap() {
    install_statusline_hook
    install_autostart
    register_with_vitals
    try_cli_usage_refresh
    if [ ! -f "$CLAUDE_USAGE_FILE" ]; then
        write_metrics_json "Claude Code" "idle" "idle" "idle"
        echo "Wrote placeholder $CLAUDE_USAGE_FILE - it'll fill in real values the next time Claude Code renders its status line."
    fi
    echo "Done."
}

# --- entry point ---
# Explicit args always win, regardless of stdin - the autostart .desktop entry
# invokes us with --bootstrap and /dev/null on stdin, which looks identical to
# "non-tty" from a plain `[ -t 0 ]` check, so that alone can't distinguish the
# two modes. Only fall back to stdin-sniffing when invoked with no arguments
# at all, which is how Claude Code itself calls the statusLine command.
case "${1:-}" in
    --bootstrap) bootstrap ;;
    --help|-h)
        echo "Usage: $0 [--bootstrap]"
        echo "  --bootstrap: install/repair the statusLine hook, login item, and Vitals registration."
        echo "  No args, stdin piped (used internally by Claude Code): parse session JSON and refresh $CLAUDE_USAGE_FILE."
        echo "  No args, stdin a tty (i.e. run by hand): same as --bootstrap."
        ;;
    "")
        if [ -t 0 ]; then
            bootstrap
        else
            handle_statusline
        fi
        ;;
    *)
        echo "Unknown argument: $1" >&2
        exit 1
        ;;
esac
