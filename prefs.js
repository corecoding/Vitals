import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {sensorCatalog} from './helpers/catalog.js';
import {
    formatColorEntry,
    labelFromSensorKey,
    sanitizeAndSortColorEntries,
    sensorKeyBelongsToColorPage,
    sensorKeyFromTypeLabel,
} from './helpers/colors.js';
import * as SensorsModule from './sensors.js';

const SENSOR_DISCOVERY_SETTLE_SECONDS = 2;
// AdwViewSwitcherSidebar landed in libadwaita 1.9 (GNOME 49+/50).
function supportsModernSidebarPrefs() {
    return typeof Adw.ViewSwitcherSidebar === 'function';
}

// AdwNavigationSplitView landed in libadwaita 1.4 (GNOME 45+).
function supportsLegacySidebarPrefs() {
    return typeof Adw.NavigationSplitView === 'function';
}

function ensureSidebarShellTypes(modern) {
    GObject.type_ensure(Adw.HeaderBar.$gtype);
    GObject.type_ensure(Adw.NavigationPage.$gtype);
    GObject.type_ensure(Adw.NavigationSplitView.$gtype);
    GObject.type_ensure(Adw.ToolbarView.$gtype);
    GObject.type_ensure(Adw.ViewStack.$gtype);
    if (modern)
        GObject.type_ensure(Adw.ViewSwitcherSidebar.$gtype);
}

const Settings = new GObject.Class({
    Name: 'Vitals.Settings',

    _init: function(extensionObject, params) {
        this._extensionObject = extensionObject
        this.parent(params);

        this._settings = extensionObject.getSettings();
        this._apply_icon_style();

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._extensionObject.metadata['gettext-domain']);
        this.builder.add_from_file(this._extensionObject.path + '/prefs-pages.ui');

        if (supportsModernSidebarPrefs()) {
            ensureSidebarShellTypes(true);
            this.builder.add_from_file(this._extensionObject.path + '/prefs.ui');
        } else if (supportsLegacySidebarPrefs()) {
            ensureSidebarShellTypes(false);
            this.builder.add_from_file(this._extensionObject.path + '/prefs-legacy.ui');
        }

        // Threshold color editors are built lazily when each page is first shown,
        // so we do not construct dozens of Gtk.ColorButtons up front.
        this._thresholdColorsInitialized = {};
        this._thresholdColorGroups = {};
        // pageName -> { settingsKey, pageName, page, palettes, addColorsDropdown }
        this._thresholdColorPages = {};
        // Session-only stash of panel sensors removed when a group is toggled off,
        // so turning the group back on before closing prefs can restore them.
        this._removedHotSensors = {};
        // pageName -> sorted list of discovered sensor keys (from Sensors.query).
        this._discoveredSensorsByPage = {};
        this._addColorsDropdowns = [];
        this._sensors = null;
        this._sensorDiscoveryTimeoutId = 0;
        this._bind_sensor_page_gates();
        this._bind_settings();
        this._start_sensor_discovery();
    },

    destroy: function() {
        if (this._sensorDiscoveryTimeoutId) {
            GLib.source_remove(this._sensorDiscoveryTimeoutId);
            this._sensorDiscoveryTimeoutId = 0;
        }
        if (this._sensors) {
            this._sensors.destroy();
            this._sensors = null;
        }
    },

    _start_sensor_discovery: function() {
        if (this._sensors)
            return;

        this._sensors = new SensorsModule.Sensors(this._settings, sensorCatalog);
        let collect = (label, value, type, format) => {
            this._collect_discovered_sensor(label, type, format);
        };

        // First pass starts hwmon discovery; second pass fills processor deltas.
        this._sensors.query(collect, 1);
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (this._sensors)
                this._sensors.query(collect, 1);
            return GLib.SOURCE_REMOVE;
        });
        this._sensorDiscoveryTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, SENSOR_DISCOVERY_SETTLE_SECONDS, () => {
                this._sensorDiscoveryTimeoutId = 0;
                this._refresh_applies_dropdowns();
                return GLib.SOURCE_REMOVE;
            });
    },

    _collect_discovered_sensor: function(label, type, format) {
        if (!type || type.endsWith('-group'))
            return;

        let key = sensorKeyFromTypeLabel(type, label);
        if (!key || key.startsWith('__'))
            return;

        for (let pageName of Object.keys(sensorCatalog)) {
            let formats = sensorCatalog[pageName]?.colorFormats;
            if (!formats || !formats.includes(format))
                continue;
            if (!sensorKeyBelongsToColorPage(pageName, key))
                continue;

            if (!this._discoveredSensorsByPage[pageName])
                this._discoveredSensorsByPage[pageName] = [];
            if (!this._discoveredSensorsByPage[pageName].includes(key))
                this._discoveredSensorsByPage[pageName].push(key);
        }
    },

    _refresh_applies_dropdowns: function() {
        for (let pageName of Object.keys(this._discoveredSensorsByPage))
            this._discoveredSensorsByPage[pageName].sort();

        for (let info of this._addColorsDropdowns)
            this._sync_add_colors_row(info.pageName);
    },

    _apply_icon_style: function() {
        let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        let styles = ['original', 'gnome'];
        let dir = styles[this._settings.get_int('icon-style')] || 'original';
        let vitalsPath = `${this._extensionObject.path}/icons/${dir}`;
        let iconsRoot = `${this._extensionObject.path}/icons/`;
        let others = (iconTheme.get_search_path() || []).filter(p => !p.startsWith(iconsRoot));
        iconTheme.set_search_path([vitalsPath].concat(others));
        return iconTheme;
    },

    // Resolve a Vitals *-symbolic icon so GTK can recolor it with the theme fg
    // (light/dark). Prefer theme lookup over new_for_file, which draws fills as-is.
    _lookup_symbolic_icon: function(iconName, size, scale) {
        let iconTheme = this._apply_icon_style();
        return iconTheme.lookup_icon(
            iconName,
            null,
            size,
            scale,
            Gtk.TextDirection.NONE,
            Gtk.IconLookupFlags.FORCE_SYMBOLIC);
    },

    _connect_icon_style_refresh: function(refresh) {
        this.builder.get_object('icon-style').connect('changed', refresh);

        // Legacy Gtk.Image symbolic paintables can lag style changes; refresh on dark toggle.
        let styleManager = Adw.StyleManager.get_default();
        styleManager.connect('notify::dark', refresh);
        styleManager.connect('notify::color-scheme', refresh);
    },

    // ViewSwitcherSidebar binds icon-name, so theme cache can keep old SVGs after
    // icon-style changes. Push a symbolic paintable from the active pack instead.
    refresh_sidebar_icons: function(switcher, stack) {
        let sidebar = switcher.get_first_child();
        if (!(sidebar instanceof Adw.Sidebar))
            return;

        let scale = Math.max(1, switcher.get_scale_factor());
        let pages = stack.get_pages();
        let items = sidebar.get_items();
        let count = Math.min(pages.get_n_items(), items.get_n_items());

        for (let i = 0; i < count; i++) {
            let iconName = pages.get_item(i).get_icon_name();
            if (!iconName || iconName === 'preferences-system-symbolic')
                continue;

            items.get_item(i).set_icon_paintable(
                this._lookup_symbolic_icon(iconName, 16, scale));
        }
    },

    // Legacy ListBox rows: use icon-name (not paintables). On older GTK,
    // set_from_paintable often leaves #bebebe unmapped — fine on dark, gray on light.
    // icon-name recolors with the theme fg; refresh after icon-style / dark changes.
    refresh_legacy_sidebar_icons: function(rows) {
        this._apply_icon_style();

        for (let row of rows) {
            if (!row.iconName || row.iconName === 'preferences-system-symbolic')
                continue;

            row.image.clear();
            row.image.set_from_icon_name(row.iconName);
        }
    },

    ensure_threshold_colors_for_page: function(pageName) {
        if (this._thresholdColorsInitialized[pageName])
            return;

        if (!sensorCatalog[pageName]?.colorFormats)
            return;

        this._thresholdColorsInitialized[pageName] = true;
        this._add_threshold_colors_group(
            `${pageName}-page`,
            `${pageName}-colors`,
            pageName);
    },

    _action_row_for: function(widget) {
        let current = widget;
        while (current) {
            if (current instanceof Adw.ActionRow)
                return current;
            current = current.get_parent();
        }
        return widget;
    },

    _set_dependent_widgets_sensitive: function(widgetIds, sensitive) {
        for (let id of widgetIds) {
            let widget = this.builder.get_object(id);
            if (!widget)
                continue;
            this._action_row_for(widget).set_sensitive(sensitive);
        }
    },

    _sync_sensor_page_sensitivity: function(pageName) {
        let gate = this._sensorPageGates[pageName];
        if (!gate)
            return;

        let enabled = this.builder.get_object(gate.toggle).get_active();
        this._set_dependent_widgets_sensitive(gate.widgets, enabled);

        let thresholdGroups = this._thresholdColorGroups[pageName];
        if (thresholdGroups) {
            for (let group of thresholdGroups)
                group.set_sensitive(enabled);
        }

        if (gate.afterSync)
            gate.afterSync(enabled);
    },

    _bind_sensor_page_gates: function() {
        let providerWidget = this.builder.get_object('network-public-ip-provider');
        let flagWidget = this.builder.get_object('network-public-ip-show-flag');

        this._sensorPageGates = {
            'temperature': { toggle: 'show-temperature', widgets: ['unit'] },
            'voltage': { toggle: 'show-voltage', widgets: [] },
            'fan': { toggle: 'show-fan', widgets: [] },
            'memory': { toggle: 'show-memory', widgets: ['memory-measurement'] },
            'processor': { toggle: 'show-processor', widgets: ['include-static-info'] },
            'system': { toggle: 'show-system', widgets: ['monitor-cmd'] },
            'network': {
                toggle: 'show-network',
                widgets: [
                    'include-public-ip',
                    'network-public-ip-interval',
                    'network-public-ip-provider',
                    'network-public-ip-show-flag',
                    'network-speed-format',
                    'network-speed-unit',
                ],
                afterSync: (networkEnabled) => {
                    // Keep flag disabled for ipify even when network monitoring is on.
                    this._action_row_for(flagWidget).set_sensitive(
                        networkEnabled && providerWidget.get_active() !== 2);
                },
            },
            'storage': { toggle: 'show-storage', widgets: ['storage-path', 'storage-measurement'] },
            'battery': { toggle: 'show-battery', widgets: ['battery-slot'] },
            'gpu': { toggle: 'show-gpu', widgets: ['include-static-gpu-info'] },
        };

        for (let pageName in this._sensorPageGates) {
            let gate = this._sensorPageGates[pageName];
            let toggle = this.builder.get_object(gate.toggle);
            toggle.connect('notify::active', () => {
                this._sync_sensor_page_sensitivity(pageName);
            });
            this._sync_sensor_page_sensitivity(pageName);
        }
    },

    // Drop panel-pinned sensors that belong to a disabled sensor group.
    // Keys look like _memory_usage_ / __network-rx_max__; group name is in the key.
    _remove_hot_sensors_for_group: function(group) {
        let hotSensors = this._settings.get_strv('hot-sensors');
        let removed = [];
        let filtered = hotSensors.filter(key => {
            if (key === '_default_icon_')
                return true;
            if (key.includes(group)) {
                removed.push(key);
                return false;
            }
            return true;
        });

        if (removed.length === 0)
            return;

        this._removedHotSensors[group] = removed;

        if (filtered.length === 0)
            filtered.push('_default_icon_');

        this._settings.set_strv('hot-sensors', filtered);
    },

    // Restore sensors stashed earlier in this prefs session when the group is re-enabled.
    _restore_hot_sensors_for_group: function(group) {
        let restored = this._removedHotSensors[group];
        if (!restored || restored.length === 0)
            return;

        delete this._removedHotSensors[group];

        let hotSensors = this._settings.get_strv('hot-sensors').filter(
            key => key !== '_default_icon_'
        );
        for (let key of restored) {
            if (!hotSensors.includes(key))
                hotSensors.push(key);
        }

        this._settings.set_strv('hot-sensors', hotSensors);
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function() {
        let widget;

        // process sensor toggles
        let sensors = [ 'show-temperature', 'show-voltage', 'show-fan',
                        'show-memory', 'show-processor', 'show-system',
                        'show-network', 'show-storage', 'use-higher-precision',
                        'alphabetize', 'hide-zeros', 'include-public-ip',
                        'network-public-ip-show-flag', 'show-battery', 'fixed-widths',
                        'hide-icons', 'menu-centered', 'include-static-info',
                        'show-gpu', 'include-static-gpu-info' ];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                // update hot-sensors before flipping show-* so the extension redraw sees it
                if (sensor.startsWith('show-')) {
                    let group = sensor.substring(5);
                    if (!val)
                        this._remove_hot_sensors_for_group(group);
                    else
                        this._restore_hot_sensors_for_group(group);
                }
                this._settings.set_boolean(sensor, val);
            });
        }

        // process individual drop down sensor preferences
        sensors = [
            'position-in-panel', 'unit', 'network-speed-format', 'network-speed-unit',
            'memory-measurement', 'storage-measurement', 'battery-slot', 'icon-style',
            'network-public-ip-provider'
        ];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this._settings.set_int(sensor, widget.get_active());
            });
        }

        let providerWidget = this.builder.get_object('network-public-ip-provider');
        providerWidget.connect('changed', () => {
            this._sync_sensor_page_sensitivity('network');
        });

        let updateTime = this.builder.get_object('update-time');
        updateTime.set_value(this._settings.get_int('update-time'));
        updateTime.connect('value-changed', (widget) => {
            this._settings.set_int('update-time', Math.round(widget.get_value()));
        });

        this._settings.bind('network-public-ip-interval', this.builder.get_object('network-public-ip-interval'),
            'value', Gio.SettingsBindFlags.DEFAULT);

        // process individual text entry sensor preferences
        sensors = [ 'storage-path', 'monitor-cmd' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_text(this._settings.get_string(sensor));

            widget.connect('changed', (widget) => {
                let text = widget.get_text();
                if (!text) text = widget.get_placeholder_text();
                this._settings.set_string(sensor, text);
            });
        }

    },

    // Runtime matching is `value >= threshold` (see values.js), so each band is
    // [low, high). Integer breakpoints use high-1 in the label (0–39, 40–59, …).
    // Float breakpoints keep an explicit half-open label (0 – <0.5).
    _band_title: function(low, high) {
        if (high === null || high === undefined)
            return _('%s and above').format(low);

        if (!(high > low))
            return `${low}`;

        if (Number.isInteger(low) && Number.isInteger(high))
            return `${low} – ${high - 1}`;

        return `${low} – <${high}`;
    },

    _threshold_for_row: function(row) {
        let text = row._thresholdEntry.text.trim();
        let value = Number.parseFloat(text);
        if (text === '' || !Number.isFinite(value))
            return row._committedThreshold;
        return value;
    },

    _commit_threshold_entry: function(row) {
        let text = row._thresholdEntry.text.trim();
        let value = Number.parseFloat(text);
        if (text === '' || !Number.isFinite(value)) {
            row._thresholdEntry.text = `${row._committedThreshold}`;
            return row._committedThreshold;
        }

        row._committedThreshold = value;
        return value;
    },

    // Band pairing stays on committed order so mid-edit typing does not move
    // "and above" between rows; label numbers use the live entry text.
    _refresh_band_titles: function(rows) {
        let items = rows.map(row => ({
            row: row,
            orderKey: row._committedThreshold,
            value: this._threshold_for_row(row),
        }));
        items.sort((a, b) => a.orderKey - b.orderKey || a.value - b.value);

        for (let i = 0; i < items.length; i++) {
            let low = items[i].value;
            let high = (i < items.length - 1) ? items[i + 1].value : null;
            // ActionRow titles are Pango markup; unescaped `<` in float labels
            // (e.g. "0 – <0.5") fails to apply and leaves the old "and above" title.
            items[i].row.set_title(
                GLib.markup_escape_text(this._band_title(low, high), -1));
        }
    },

    _reorder_threshold_rows: function(palette) {
        let rows = palette.rows;
        let sorted = rows.slice().sort(
            (a, b) => a._committedThreshold - b._committedThreshold);
        if (sorted.every((row, i) => row === rows[i]))
            return;

        for (let row of rows)
            palette.group.remove(row);

        rows.length = 0;
        for (let row of sorted) {
            palette.group.add(row);
            rows.push(row);
        }
    },

    _entries_by_sensor_key: function(entries) {
        let byKey = new Map();
        for (let entry of entries) {
            let key = entry.sensorKey || null;
            if (!byKey.has(key))
                byKey.set(key, []);
            byKey.get(key).push(entry);
        }
        return byKey;
    },

    _sync_all_threshold_colors: function(pageName) {
        let state = this._thresholdColorPages[pageName];
        if (!state)
            return;

        let items = [];
        for (let palette of state.palettes) {
            for (let row of palette.rows) {
                let rgba = row._colorButton.get_rgba();
                items.push({
                    threshold: this._threshold_for_row(row),
                    red: rgba.red,
                    green: rgba.green,
                    blue: rgba.blue,
                    sensorKey: palette.sensorKey || null,
                });
            }
        }
        items.sort((a, b) => {
            if (a.threshold !== b.threshold)
                return a.threshold - b.threshold;
            let aKey = a.sensorKey || '';
            let bKey = b.sensorKey || '';
            return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
        });
        this._settings.set_strv(state.settingsKey, items.map(entry => formatColorEntry(entry)));

        for (let palette of state.palettes) {
            this._reorder_threshold_rows(palette);
            this._refresh_band_titles(palette.rows);
        }
        this._sync_add_colors_row(pageName);
    },

    _color_sensor_options: function(pageName, settingsKey, excludeKeys = null) {
        let excluded = new Set(excludeKeys || []);
        let live = [];
        let liveSet = new Set();
        for (let key of (this._discoveredSensorsByPage[pageName] || [])) {
            if (excluded.has(key) || liveSet.has(key))
                continue;
            liveSet.add(key);
            live.push(key);
        }
        for (let key of this._settings.get_strv('hot-sensors')) {
            if (!sensorKeyBelongsToColorPage(pageName, key) || excluded.has(key) || liveSet.has(key))
                continue;
            liveSet.add(key);
            live.push(key);
        }
        live.sort();

        let orphans = [];
        let orphanSet = new Set();
        for (let entry of sanitizeAndSortColorEntries(this._settings.get_strv(settingsKey))) {
            if (!entry.sensorKey || excluded.has(entry.sensorKey) ||
                liveSet.has(entry.sensorKey) || orphanSet.has(entry.sensorKey))
                continue;
            orphanSet.add(entry.sensorKey);
            orphans.push(entry.sensorKey);
        }
        orphans.sort();
        return {live, orphans};
    },

    _palette_targets_in_use: function(pageName) {
        let state = this._thresholdColorPages[pageName];
        if (!state)
            return [];
        return state.palettes.map(palette => palette.sensorKey || null);
    },

    _target_already_used: function(pageName, sensorKey) {
        let target = sensorKey || null;
        return this._palette_targets_in_use(pageName).some(key => key === target);
    },

    _available_add_color_targets: function(pageName, settingsKey) {
        let inUse = this._palette_targets_in_use(pageName);
        let excludeSensors = inUse.filter(key => key !== null);
        let {live, orphans} = this._color_sensor_options(pageName, settingsKey, excludeSensors);
        let keys = [];
        let labels = [];

        if (!inUse.some(key => key === null)) {
            keys.push(null);
            labels.push(_('All sensors'));
        }
        for (let key of live) {
            keys.push(key);
            labels.push(labelFromSensorKey(key));
        }
        for (let key of orphans) {
            keys.push(key);
            labels.push(_('%s (unavailable)').format(labelFromSensorKey(key)));
        }
        return {keys, labels};
    },

    _populate_add_colors_dropdown_model: function(dropdown, pageName, settingsKey) {
        let {keys, labels} = this._available_add_color_targets(pageName, settingsKey);
        let model = new Gtk.StringList();
        for (let label of labels)
            model.append(label);

        dropdown.set_model(model);
        dropdown._sensorKeys = keys;
        if (keys.length > 0)
            dropdown.set_selected(0);
    },

    _make_add_colors_dropdown: function(pageName, settingsKey) {
        let dropdown = new Gtk.DropDown({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            tooltip_text: _('Apply a color scale to all sensors or one sensor'),
        });
        this._populate_add_colors_dropdown_model(dropdown, pageName, settingsKey);
        return dropdown;
    },

    _sync_add_colors_row: function(pageName) {
        let state = this._thresholdColorPages[pageName];
        if (!state || !state.addColorsRow || !state.addGroup)
            return;

        let {keys} = this._available_add_color_targets(pageName, state.settingsKey);
        let row = state.addColorsRow;

        // Title belongs on this group only when it is the sole Threshold Colors
        // block (no scales yet); otherwise scales carry their own titles.
        state.addGroup.set_title(
            state.palettes.length === 0 ? _('Threshold Colors') : '');

        if (keys.length === 0) {
            if (row.get_parent())
                state.addGroup.remove(row);
            if (state.addGroup.get_parent())
                state.page.remove(state.addGroup);
            return;
        }

        this._reload_add_colors_dropdown(state.addColorsDropdown, pageName, state.settingsKey);
        if (!row.get_parent())
            state.addGroup.add(row);
        if (!state.addGroup.get_parent())
            state.page.add(state.addGroup);
        else
            this._keep_add_group_last(state);
    },

    _reload_add_colors_dropdown: function(dropdown, pageName, settingsKey) {
        if (!dropdown)
            return;
        dropdown._reloading = true;
        this._populate_add_colors_dropdown_model(dropdown, pageName, settingsKey);
        dropdown._reloading = false;
    },

    _palette_title: function(sensorKey, pageName, settingsKey) {
        if (!sensorKey)
            return _('All sensors colors');

        let {live} = this._color_sensor_options(pageName, settingsKey, []);
        let label = labelFromSensorKey(sensorKey);
        if (live.includes(sensorKey))
            return _('%s colors').format(label);
        return _('%s colors (unavailable)').format(label);
    },

    // New breakpoints sort after the current max so they become the new
    // "and above" row. Prefer a whole-number step to avoid decimal creep.
    _next_breakpoint_threshold: function(palette) {
        if (!palette.rows.length)
            return 0;

        let values = palette.rows.map(row => row._committedThreshold)
            .filter(value => Number.isFinite(value));
        let max = Math.max(...values);
        if (values.every(value => Number.isInteger(value)))
            return max + 10;
        return max + 1;
    },

    _make_color_row: function(pageName, palette, text = '0.0', red = 224 / 255, green = 27 / 255, blue = 36 / 255) {
        let initial = Number.parseFloat(text);
        if (!Number.isFinite(initial))
            initial = 0;

        let entry = new Gtk.Entry({
            input_purpose: Gtk.InputPurpose.NUMBER,
            text: `${initial}`,
            width_chars: 7,
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Color applies at this value and up to the next breakpoint'),
        });

        let colorButton = new Gtk.ColorButton({
            rgba: new Gdk.RGBA({red, green, blue, alpha: 1.0}),
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Band color'),
        });

        let deleteButton = new Gtk.Button({
            icon_name: 'edit-delete-symbolic',
            tooltip_text: _('Remove breakpoint'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });

        let row = new Adw.ActionRow({
            title: '',
            activatable: false,
        });
        row._thresholdEntry = entry;
        row._colorButton = colorButton;
        row._committedThreshold = initial;
        row.add_suffix(entry);
        row.add_suffix(colorButton);
        row.add_suffix(deleteButton);
        palette.group.add(row);
        palette.rows.push(row);
        this._refresh_band_titles(palette.rows);

        let commitAndSync = () => {
            this._commit_threshold_entry(row);
            this._sync_all_threshold_colors(pageName);
        };

        entry.connect('changed', () => {
            this._refresh_band_titles(palette.rows);
        });
        entry.connect('activate', commitAndSync);
        entry.connect('notify::has-focus', () => {
            if (!entry.has_focus)
                commitAndSync();
        });
        colorButton.connect('color-set', () => {
            this._sync_all_threshold_colors(pageName);
        });
        deleteButton.connect('clicked', () => {
            let index = palette.rows.indexOf(row);
            if (index < 0)
                return;

            palette.group.remove(row);
            palette.rows.splice(index, 1);
            if (palette.rows.length === 0)
                this._remove_threshold_palette(pageName, palette);
            else
                this._sync_all_threshold_colors(pageName);
        });
    },

    _keep_add_group_last: function(state) {
        if (!state.page || !state.addGroup || !state.addGroup.get_parent())
            return;
        state.page.remove(state.addGroup);
        state.page.add(state.addGroup);
    },

    _register_threshold_group: function(pageName, group) {
        if (!this._thresholdColorGroups[pageName])
            this._thresholdColorGroups[pageName] = [];
        this._thresholdColorGroups[pageName].push(group);
    },

    _unregister_threshold_group: function(pageName, group) {
        let groups = this._thresholdColorGroups[pageName] || [];
        let index = groups.indexOf(group);
        if (index >= 0)
            groups.splice(index, 1);
    },

    _add_threshold_palette: function(pageName, sensorKey, entries, options = null) {
        let seedDefault = !!(options && options.seedDefault);
        let state = this._thresholdColorPages[pageName];
        let targetKey = sensorKey || null;
        let group = new Adw.PreferencesGroup({
            title: this._palette_title(targetKey, pageName, state.settingsKey),
            margin_start: 10,
            margin_end: 10,
        });

        let palette = {
            sensorKey: targetKey,
            group,
            rows: [],
        };

        let addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add breakpoint'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        addButton.connect('clicked', () => {
            this._make_color_row(
                pageName, palette, `${this._next_breakpoint_threshold(palette)}`);
            this._sync_all_threshold_colors(pageName);
        });

        let removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove color scale'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        removeButton.connect('clicked', () => {
            this._remove_threshold_palette(pageName, palette);
        });

        let actions = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
            valign: Gtk.Align.CENTER,
        });
        actions.append(addButton);
        actions.append(removeButton);
        group.set_header_suffix(actions);

        state.page.add(group);
        this._keep_add_group_last(state);
        this._register_threshold_group(pageName, group);
        state.palettes.push(palette);
        this._sync_add_colors_row(pageName);

        let rows = entries;
        if (seedDefault && rows.length === 0)
            rows = [{threshold: 0, red: 224 / 255, green: 27 / 255, blue: 36 / 255}];

        for (let entry of rows) {
            this._make_color_row(
                pageName, palette,
                `${entry.threshold}`, entry.red, entry.green, entry.blue);
        }
        this._refresh_band_titles(palette.rows);
        return palette;
    },

    _remove_threshold_palette: function(pageName, palette) {
        let state = this._thresholdColorPages[pageName];
        if (!state)
            return;

        let index = state.palettes.indexOf(palette);
        if (index < 0)
            return;

        state.page.remove(palette.group);
        this._unregister_threshold_group(pageName, palette.group);
        state.palettes.splice(index, 1);
        this._sync_all_threshold_colors(pageName);
    },

    _add_threshold_colors_group: function(pageId, settingsKey, pageName) {
        let page = this.builder.get_object(pageId);
        let sorted = sanitizeAndSortColorEntries(this._settings.get_strv(settingsKey));
        this._settings.set_strv(settingsKey, sorted.map(entry => formatColorEntry(entry)));
        let byKey = this._entries_by_sensor_key(sorted);

        let addGroup = new Adw.PreferencesGroup({
            title: _('Threshold Colors'),
            margin_start: 10,
            margin_end: 10,
        });

        let state = {
            settingsKey,
            pageName,
            page,
            addGroup,
            palettes: [],
            addColorsDropdown: null,
            addColorsRow: null,
        };
        this._thresholdColorPages[pageName] = state;
        this._thresholdColorGroups[pageName] = [];
        this._register_threshold_group(pageName, addGroup);

        if (byKey.has(null))
            this._add_threshold_palette(pageName, null, byKey.get(null));
        let sensorKeys = [...byKey.keys()].filter(key => key !== null).sort();
        for (let key of sensorKeys)
            this._add_threshold_palette(pageName, key, byKey.get(key) || []);

        let addColorsDropdown = this._make_add_colors_dropdown(pageName, settingsKey);
        let addColorsButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            label: _('Add'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        let addColorsRow = new Adw.ActionRow({
            title: _('Add Color Scale'),
            activatable_widget: addColorsButton,
        });
        addColorsRow.add_suffix(addColorsDropdown);
        addColorsRow.add_suffix(addColorsButton);
        addGroup.add(addColorsRow);
        page.add(addGroup);

        state.addColorsDropdown = addColorsDropdown;
        state.addColorsRow = addColorsRow;

        this._addColorsDropdowns.push({
            dropdown: addColorsDropdown,
            pageName,
            settingsKey,
        });
        this._sync_add_colors_row(pageName);

        addColorsButton.connect('clicked', () => {
            let selected = addColorsDropdown.get_selected();
            let keys = addColorsDropdown._sensorKeys || [];
            if (selected >= keys.length)
                return;
            let sensorKey = keys[selected];
            if (sensorKey === undefined)
                return;
            if (this._target_already_used(pageName, sensorKey))
                return;

            this._add_threshold_palette(pageName, sensorKey, [], {seedDefault: true});
            this._sync_all_threshold_colors(pageName);
            this._sync_sensor_page_sensitivity(pageName);
        });

        this._sync_sensor_page_sensitivity(pageName);
    }
});


function prefsPageNames() {
    return ['general'].concat(Object.keys(sensorCatalog));
}

function prefsPageInfos() {
    let pages = [{ name: 'general' }];
    for (let name of Object.keys(sensorCatalog)) {
        let page = { name };
        if (pages.length === 1)
            page.section = _('Sensors');
        pages.push(page);
    }
    return pages;
}

export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        let settings = new Settings(this);
        window._vitalsSettings = settings;
        window.connect('close-request', () => {
            settings.destroy();
            window._vitalsSettings = null;
        });

        if (supportsModernSidebarPrefs())
            this._fillModernSidebarPreferences(window, settings);
        else if (supportsLegacySidebarPrefs())
            this._fillLegacySidebarPreferences(window, settings);
        else
            this._fillClassicPreferences(window, settings);
    }

    _fillClassicPreferences(window, settings) {
        for (let name of prefsPageNames())
            window.add(settings.builder.get_object(name + '-page'));

        let loadVisible = () => {
            let visible = window.visible_page;
            if (visible && visible.name)
                settings.ensure_threshold_colors_for_page(visible.name);
        };
        window.connect('notify::visible-page', loadVisible);
        loadVisible();
    }

    _attachStackPages(settings, stack, useSections) {
        let pages = prefsPageInfos();
        for (let i = 0; i < pages.length; i++) {
            let info = pages[i];
            let page = settings.builder.get_object(info.name + '-page');
            let title = page.get_title();
            let iconName = page.get_icon_name();
            // Header bar already shows the section title; hide the page banner.
            page.set_title('');

            let stackPage = stack.add_titled_with_icon(page, info.name, title, iconName);
            if (useSections && info.section) {
                stackPage.set_starts_section(true);
                stackPage.set_section_title(info.section);
            }
            info.title = title;
            info.iconName = iconName;
        }
        return pages;
    }

    _syncContentTitle(stack, contentPage, name) {
        let visible = stack.get_visible_child();
        if (!visible)
            return;

        let stackPage = stack.get_page(visible);
        let title = stackPage.get_title();
        // Sensor pages used to open as "Network Preferences", etc.
        if (name && name !== 'general')
            title = title + ' ' + _('Preferences');
        contentPage.set_title(title);
    }

    _fillModernSidebarPreferences(window, settings) {
        window.set_search_enabled(false);
        window.set_default_size(720, 620);

        let root = settings.builder.get_object('prefs-root');
        let stack = settings.builder.get_object('prefs-stack');
        let sidebar = settings.builder.get_object('prefs-sidebar');
        let contentPage = settings.builder.get_object('prefs-content-page');

        // Replace PreferencesWindow's bottom-tab navigation with a Settings-style sidebar.
        window.get_content().set_child(root);
        this._attachStackPages(settings, stack, true);

        let syncVisiblePage = () => {
            let name = stack.get_visible_child_name();
            this._syncContentTitle(stack, contentPage, name);
            if (name)
                settings.ensure_threshold_colors_for_page(name);
        };

        stack.connect('notify::visible-child', syncVisiblePage);
        sidebar.connect('activated', () => {
            root.set_show_content(true);
        });
        syncVisiblePage();

        settings.refresh_sidebar_icons(sidebar, stack);
        settings._connect_icon_style_refresh(() => {
            settings.refresh_sidebar_icons(sidebar, stack);
        });
    }

    _fillLegacySidebarPreferences(window, settings) {
        window.set_search_enabled(false);
        window.set_default_size(720, 620);

        let root = settings.builder.get_object('prefs-root');
        let stack = settings.builder.get_object('prefs-stack');
        let list = settings.builder.get_object('prefs-sidebar');
        let contentPage = settings.builder.get_object('prefs-content-page');

        window.get_content().set_child(root);
        let pages = this._attachStackPages(settings, stack, false);
        let rows = [];

        list.set_header_func((row, before) => {
            let section = row._sectionTitle;
            if (!section) {
                row.set_header(null);
                return;
            }
            if (before && before._sectionTitle === section) {
                row.set_header(null);
                return;
            }
            let header = new Gtk.Label({
                label: section,
                xalign: 0,
                margin_start: 12,
                margin_end: 12,
                margin_top: 12,
                margin_bottom: 6,
            });
            header.add_css_class('heading');
            row.set_header(header);
        });

        for (let info of pages) {
            let image = new Gtk.Image({
                icon_name: info.iconName || 'image-missing',
                pixel_size: 16,
            });
            let label = new Gtk.Label({
                label: info.title,
                xalign: 0,
                hexpand: true,
            });
            let box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                margin_start: 6,
                margin_end: 6,
                margin_top: 4,
                margin_bottom: 4,
            });
            box.append(image);
            box.append(label);

            let row = new Gtk.ListBoxRow({ child: box });
            row._pageName = info.name;
            row._sectionTitle = info.section || null;
            row.iconName = info.iconName;
            row.image = image;
            list.append(row);
            rows.push(row);
        }

        let selectRowForVisible = () => {
            let name = stack.get_visible_child_name();
            for (let row of rows) {
                if (row._pageName === name) {
                    list.select_row(row);
                    break;
                }
            }
        };

        list.connect('row-activated', (_list, row) => {
            if (!row?._pageName)
                return;
            stack.set_visible_child_name(row._pageName);
            root.set_show_content(true);
        });
        // Browse mode selects on click; keep stack in sync.
        list.connect('row-selected', (_list, row) => {
            if (!row?._pageName)
                return;
            if (stack.get_visible_child_name() !== row._pageName)
                stack.set_visible_child_name(row._pageName);
        });

        let syncVisiblePage = () => {
            let name = stack.get_visible_child_name();
            selectRowForVisible();
            this._syncContentTitle(stack, contentPage, name);
            if (name)
                settings.ensure_threshold_colors_for_page(name);
        };

        stack.connect('notify::visible-child', syncVisiblePage);
        syncVisiblePage();

        settings.refresh_legacy_sidebar_icons(rows);
        settings._connect_icon_style_refresh(() => {
            settings.refresh_legacy_sidebar_icons(rows);
        });
    }
}
