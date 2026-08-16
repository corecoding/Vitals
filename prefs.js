import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {sensorCatalog, colorPageForSensor} from './helpers/catalog.js';
import {
    compareColorEntries,
    DEFAULT_THRESHOLD_RGBA,
    formatColorEntry,
    labelFromSensorKey,
    sanitizeAndSortColorEntries,
    sensorKeyBelongsToColorPage,
    sensorKeyFromTypeLabel,
} from './helpers/colors.js';
import * as SensorsModule from './sensors.js';

const SENSOR_DISCOVERY_SETTLE_SECONDS = 2;

class Settings {
    constructor(extensionObject) {
        this._extensionObject = extensionObject;

        this._settings = extensionObject.getSettings();
        this._apply_icon_style();

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._extensionObject.metadata['gettext-domain']);

        GObject.type_ensure(Adw.HeaderBar.$gtype);
        GObject.type_ensure(Adw.NavigationPage.$gtype);
        GObject.type_ensure(Adw.NavigationSplitView.$gtype);
        GObject.type_ensure(Adw.ToolbarView.$gtype);
        GObject.type_ensure(Adw.ViewStack.$gtype);
        GObject.type_ensure(Adw.ViewStackPage.$gtype);
        this.builder.add_from_file(this._extensionObject.path + '/prefs.ui');

        // Threshold color editors are built lazily when each page is first shown,
        // so we do not construct dozens of Gtk.ColorButtons up front.
        // pageName -> { settingsKey, page, addGroup, palettes, addColorsDropdown, ... }
        this._thresholdColorPages = {};
        // Session-only stash of panel sensors removed when a group is toggled off,
        // so turning the group back on before closing prefs can restore them.
        this._removedHotSensors = {};
        // pageName -> sorted list of discovered sensor keys (from Sensors.query).
        this._discoveredSensorsByPage = {};
        this._sensors = null;
        this._sensorDiscoveryTimeoutId = 0;
        this._bind_sensor_page_gates();
        this._bind_settings();
        this._start_sensor_discovery();
    }

    _flatButton({icon_name, label, tooltip_text}) {
        let props = {
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        };
        if (icon_name)
            props.icon_name = icon_name;
        if (label)
            props.label = label;
        if (tooltip_text)
            props.tooltip_text = tooltip_text;
        return new Gtk.Button(props);
    }

    destroy() {
        if (this._sensorDiscoveryTimeoutId) {
            GLib.source_remove(this._sensorDiscoveryTimeoutId);
            this._sensorDiscoveryTimeoutId = 0;
        }
        if (this._sensors) {
            this._sensors.destroy();
            this._sensors = null;
        }
    }

    _start_sensor_discovery() {
        if (this._sensors)
            return;

        this._sensors = new SensorsModule.Sensors(this._settings, sensorCatalog, _);
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
                this._refresh_add_colors_dropdowns();
                return GLib.SOURCE_REMOVE;
            });
    }

    _collect_discovered_sensor(label, type, format) {
        if (!type || type.endsWith('-group'))
            return;

        let key = sensorKeyFromTypeLabel(type, label);
        if (!key || key.startsWith('__'))
            return;

        let pageName = colorPageForSensor(type, format);
        if (!pageName)
            return;

        if (!this._discoveredSensorsByPage[pageName])
            this._discoveredSensorsByPage[pageName] = [];
        if (!this._discoveredSensorsByPage[pageName].includes(key))
            this._discoveredSensorsByPage[pageName].push(key);
    }

    _refresh_add_colors_dropdowns() {
        for (let pageName of Object.keys(this._discoveredSensorsByPage))
            this._discoveredSensorsByPage[pageName].sort();

        for (let pageName of Object.keys(this._thresholdColorPages))
            this._sync_add_colors_row(pageName);
    }

    _apply_icon_style() {
        let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        let styles = ['original', 'gnome'];
        let dir = styles[this._settings.get_int('icon-style')] || 'original';
        let vitalsPath = `${this._extensionObject.path}/icons/${dir}`;
        let iconsRoot = `${this._extensionObject.path}/icons/`;
        let others = (iconTheme.get_search_path() || []).filter(p => !p.startsWith(iconsRoot));
        iconTheme.set_search_path([vitalsPath].concat(others));
        return iconTheme;
    }

    _connect_icon_style_refresh(refresh) {
        this.builder.get_object('icon-style').connect('changed', refresh);

        let styleManager = Adw.StyleManager.get_default();
        styleManager.connect('notify::dark', refresh);
        styleManager.connect('notify::color-scheme', refresh);
    }

    // ListBox rows use icon-name so GTK can recolor with the theme fg after
    // icon-style / dark changes. set_from_paintable often leaves #bebebe unmapped.
    refresh_sidebar_icons() {
        this._apply_icon_style();

        for (let name of Object.keys(sensorCatalog)) {
            let image = this.builder.get_object('sidebar-icon-' + name);
            if (!image)
                continue;

            let iconName = image.icon_name;
            image.clear();
            image.set_from_icon_name(iconName);
        }
    }

    ensure_threshold_colors_for_page(pageName) {
        if (this._thresholdColorPages[pageName] || !sensorCatalog[pageName]?.colorFormats)
            return;

        this._add_threshold_colors_group(
            `${pageName}-page`,
            `${pageName}-colors`,
            pageName);
    }

    _action_row_for(widget) {
        let current = widget;
        while (current) {
            if (current instanceof Adw.ActionRow)
                return current;
            current = current.get_parent();
        }
        return widget;
    }

    _set_dependent_widgets_sensitive(widgetIds, sensitive) {
        for (let id of widgetIds) {
            let widget = this.builder.get_object(id);
            if (!widget)
                continue;
            this._action_row_for(widget).set_sensitive(sensitive);
        }
    }

    _sync_sensor_page_sensitivity(pageName) {
        let gate = this._sensorPageGates[pageName];
        if (!gate)
            return;

        let enabled = this.builder.get_object(gate.toggle).get_active();
        this._set_dependent_widgets_sensitive(gate.widgets, enabled);

        let state = this._thresholdColorPages[pageName];
        if (state) {
            for (let group of [state.addGroup, ...state.palettes.map(p => p.group)])
                group.set_sensitive(enabled);
        }

        if (gate.afterSync)
            gate.afterSync(enabled);
    }

    _bind_sensor_page_gates() {
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
    }

    // Drop panel-pinned sensors that belong to a disabled sensor group.
    // Keys look like _memory_usage_ / __network-rx_max__; group name is in the key.
    _remove_hot_sensors_for_group(group) {
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
    }

    // Restore sensors stashed earlier in this prefs session when the group is re-enabled.
    _restore_hot_sensors_for_group(group) {
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
    }

    // Bind the gtk window to the schema settings
    _bind_settings() {
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

    }

    // Runtime matching is `value >= threshold` (see values.js), so each band is
    // [low, high). Integer breakpoints use high-1 in the label (0–39, 40–59, …).
    // Float breakpoints keep an explicit half-open label (0 – <0.5).
    _band_title(low, high) {
        if (high === null || high === undefined)
            return _('%s and above').format(low);

        if (!(high > low))
            return `${low}`;

        if (Number.isInteger(low) && Number.isInteger(high))
            return `${low} – ${high - 1}`;

        return `${low} – <${high}`;
    }

    _threshold_for_row(row) {
        let text = row._thresholdEntry.text.trim();
        let value = Number.parseFloat(text);
        if (text === '' || !Number.isFinite(value))
            return row._committedThreshold;
        return value;
    }

    _commit_threshold_entry(row) {
        let text = row._thresholdEntry.text.trim();
        let value = Number.parseFloat(text);
        if (text === '' || !Number.isFinite(value)) {
            row._thresholdEntry.text = `${row._committedThreshold}`;
            return row._committedThreshold;
        }

        row._committedThreshold = value;
        return value;
    }

    // Band pairing stays on committed order so mid-edit typing does not move
    // "and above" between rows; label numbers use the live entry text.
    _refresh_band_titles(rows) {
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
    }

    _reorder_threshold_rows(palette) {
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
    }

    _sync_all_threshold_colors(pageName) {
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
        items.sort(compareColorEntries);
        this._settings.set_strv(state.settingsKey, items.map(entry => formatColorEntry(entry)));

        for (let palette of state.palettes) {
            this._reorder_threshold_rows(palette);
            this._refresh_band_titles(palette.rows);
        }
        this._sync_add_colors_row(pageName);
    }

    _color_sensor_options(pageName, settingsKey, excludeKeys = null) {
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
    }

    _palette_targets_in_use(pageName) {
        let state = this._thresholdColorPages[pageName];
        if (!state)
            return [];
        return state.palettes.map(palette => palette.sensorKey || null);
    }

    _sensor_key_is_live(pageName, sensorKey) {
        if ((this._discoveredSensorsByPage[pageName] || []).includes(sensorKey))
            return true;
        return this._settings.get_strv('hot-sensors').includes(sensorKey);
    }

    _available_add_color_targets(pageName, settingsKey) {
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
    }

    _populate_add_colors_dropdown_model(dropdown, pageName, settingsKey) {
        let {keys, labels} = this._available_add_color_targets(pageName, settingsKey);
        let model = new Gtk.StringList();
        for (let label of labels)
            model.append(label);

        dropdown.set_model(model);
        dropdown._sensorKeys = keys;
        if (keys.length > 0)
            dropdown.set_selected(0);
    }

    _sync_add_colors_row(pageName) {
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

        this._populate_add_colors_dropdown_model(
            state.addColorsDropdown, pageName, state.settingsKey);
        if (!row.get_parent())
            state.addGroup.add(row);
        if (!state.addGroup.get_parent()) {
            state.page.add(state.addGroup);
        } else {
            state.page.remove(state.addGroup);
            state.page.add(state.addGroup);
        }
    }

    _palette_title(sensorKey, pageName) {
        if (!sensorKey)
            return _('All sensors colors');

        let label = labelFromSensorKey(sensorKey);
        if (this._sensor_key_is_live(pageName, sensorKey))
            return _('%s colors').format(label);
        return _('%s colors (unavailable)').format(label);
    }

    // New breakpoints sort after the current max so they become the new
    // "and above" row. Prefer a whole-number step to avoid decimal creep.
    _next_breakpoint_threshold(palette) {
        if (!palette.rows.length)
            return 0;

        let values = palette.rows.map(row => row._committedThreshold)
            .filter(value => Number.isFinite(value));
        let max = Math.max(...values);
        if (values.every(value => Number.isInteger(value)))
            return max + 10;
        return max + 1;
    }

    _make_color_row(pageName, palette, text = '0.0',
        red = DEFAULT_THRESHOLD_RGBA.red,
        green = DEFAULT_THRESHOLD_RGBA.green,
        blue = DEFAULT_THRESHOLD_RGBA.blue,
        refreshTitles = true) {
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

        let deleteButton = this._flatButton({
            icon_name: 'edit-delete-symbolic',
            tooltip_text: _('Remove breakpoint'),
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
        if (refreshTitles)
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
    }

    _add_threshold_palette(pageName, sensorKey, entries, options = null) {
        let seedDefault = !!(options && options.seedDefault);
        let state = this._thresholdColorPages[pageName];
        let targetKey = sensorKey || null;
        let group = new Adw.PreferencesGroup({
            title: this._palette_title(targetKey, pageName),
            margin_start: 10,
            margin_end: 10,
        });

        let palette = {
            sensorKey: targetKey,
            group,
            rows: [],
        };

        let addButton = this._flatButton({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add breakpoint'),
        });
        addButton.connect('clicked', () => {
            this._make_color_row(
                pageName, palette, `${this._next_breakpoint_threshold(palette)}`);
            this._sync_all_threshold_colors(pageName);
        });

        let removeButton = this._flatButton({
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove color scale'),
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
        if (state.addGroup.get_parent()) {
            state.page.remove(state.addGroup);
            state.page.add(state.addGroup);
        }
        state.palettes.push(palette);
        this._sync_add_colors_row(pageName);

        let rows = entries;
        if (seedDefault && rows.length === 0)
            rows = [{threshold: 0, ...DEFAULT_THRESHOLD_RGBA}];

        for (let entry of rows) {
            this._make_color_row(
                pageName, palette,
                `${entry.threshold}`, entry.red, entry.green, entry.blue,
                false);
        }
        this._refresh_band_titles(palette.rows);
        return palette;
    }

    _remove_threshold_palette(pageName, palette) {
        let state = this._thresholdColorPages[pageName];
        if (!state)
            return;

        let index = state.palettes.indexOf(palette);
        if (index < 0)
            return;

        state.page.remove(palette.group);
        state.palettes.splice(index, 1);
        this._sync_all_threshold_colors(pageName);
    }

    _add_threshold_colors_group(pageId, settingsKey, pageName) {
        let page = this.builder.get_object(pageId);
        let sorted = sanitizeAndSortColorEntries(this._settings.get_strv(settingsKey));
        this._settings.set_strv(settingsKey, sorted.map(entry => formatColorEntry(entry)));

        let byKey = new Map();
        for (let entry of sorted) {
            let key = entry.sensorKey || null;
            if (!byKey.has(key))
                byKey.set(key, []);
            byKey.get(key).push(entry);
        }

        let addGroup = new Adw.PreferencesGroup({
            title: _('Threshold Colors'),
            margin_start: 10,
            margin_end: 10,
        });

        let state = {
            settingsKey,
            page,
            addGroup,
            palettes: [],
            addColorsDropdown: null,
            addColorsRow: null,
        };
        this._thresholdColorPages[pageName] = state;

        if (byKey.has(null))
            this._add_threshold_palette(pageName, null, byKey.get(null));
        let sensorKeys = [...byKey.keys()].filter(key => key !== null).sort();
        for (let key of sensorKeys)
            this._add_threshold_palette(pageName, key, byKey.get(key) || []);

        let addColorsDropdown = new Gtk.DropDown({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            tooltip_text: _('Apply a color scale to all sensors or one sensor'),
        });
        this._populate_add_colors_dropdown_model(addColorsDropdown, pageName, settingsKey);

        let addColorsButton = this._flatButton({
            icon_name: 'list-add-symbolic',
            label: _('Add'),
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
        this._sync_add_colors_row(pageName);

        addColorsButton.connect('clicked', () => {
            let selected = addColorsDropdown.get_selected();
            let keys = addColorsDropdown._sensorKeys || [];
            if (selected >= keys.length)
                return;
            let sensorKey = keys[selected];
            if (sensorKey === undefined)
                return;
            let target = sensorKey || null;
            if (state.palettes.some(palette => (palette.sensorKey || null) === target))
                return;

            this._add_threshold_palette(pageName, sensorKey, [], {seedDefault: true});
            this._sync_all_threshold_colors(pageName);
            this._sync_sensor_page_sensitivity(pageName);
        });

        this._sync_sensor_page_sensitivity(pageName);
    }
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

        window.set_search_enabled(false);
        window.set_default_size(720, 620);

        let root = settings.builder.get_object('prefs-root');
        let stack = settings.builder.get_object('prefs-stack');
        let list = settings.builder.get_object('prefs-sidebar');
        let contentPage = settings.builder.get_object('prefs-content-page');

        // Replace PreferencesWindow's bottom-tab navigation with the sidebar shell.
        window.get_content().set_child(root);

        let selectRowForVisible = () => {
            let name = stack.get_visible_child_name();
            for (let i = 0; ; i++) {
                let row = list.get_row_at_index(i);
                if (!row)
                    break;
                if (row.name === name) {
                    list.select_row(row);
                    break;
                }
            }
        };

        list.connect('row-activated', (_list, row) => {
            if (!row?.name || !stack.get_child_by_name(row.name))
                return;
            stack.set_visible_child_name(row.name);
            root.set_show_content(true);
        });
        list.connect('row-selected', (_list, row) => {
            if (!row?.name || !stack.get_child_by_name(row.name))
                return;
            if (stack.get_visible_child_name() !== row.name)
                stack.set_visible_child_name(row.name);
        });

        let syncVisiblePage = () => {
            let name = stack.get_visible_child_name();
            selectRowForVisible();

            let visible = stack.get_visible_child();
            if (visible) {
                let title = stack.get_page(visible).get_title();
                if (name && name !== 'general')
                    title = title + ' ' + _('Preferences');
                contentPage.set_title(title);
            }
            if (name)
                settings.ensure_threshold_colors_for_page(name);
        };

        stack.connect('notify::visible-child', syncVisiblePage);
        syncVisiblePage();

        settings.refresh_sidebar_icons();
        settings._connect_icon_style_refresh(() => {
            settings.refresh_sidebar_icons();
        });

        // GNOME Shell's prefs host requires visible_page after fillPreferencesWindow
        // (extensionPrefsDialog.js). The sidebar replaces the window content, so
        // register an unused page to satisfy that check.
        window.add(new Adw.PreferencesPage());
    }
}
