import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {sensorCatalog} from './helpers/catalog.js';

// Threshold color entries are stored as: "threshold r g b"
function parseColorEntry(colorEntry) {
    if (typeof colorEntry !== 'string')
        return null;

    const parts = colorEntry.split(' ');
    if (parts.length !== 4)
        return null;

    const [threshold, red, green, blue] = parts.map(Number);
    if (![threshold, red, green, blue].every(Number.isFinite))
        return null;

    return {threshold, red, green, blue};
}

function formatColorEntry({threshold, red, green, blue}) {
    return `${threshold} ${red} ${green} ${blue}`;
}

function sanitizeAndSortColorEntries(colorsArray) {
    return colorsArray
        .map(parseColorEntry)
        .filter(Boolean)
        .sort((a, b) => a.threshold - b.threshold);
}

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
        // Session-only stash of panel sensors removed when a group is toggled off,
        // so turning the group back on before closing prefs can restore them.
        this._removedHotSensors = {};
        this._bind_sensor_page_gates();
        this._bind_settings();
    },

    _apply_icon_style: function() {
        let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        let styles = ['original', 'gnome'];
        let dir = styles[this._settings.get_int('icon-style')] || 'original';
        let vitalsPath = `${this._extensionObject.path}/icons/${dir}`;
        let iconsRoot = `${this._extensionObject.path}/icons/`;
        let others = (iconTheme.get_search_path() || []).filter(p => !p.startsWith(iconsRoot));
        iconTheme.set_search_path([vitalsPath].concat(others));
        return vitalsPath;
    },

    // ViewSwitcherSidebar binds icon-name, so theme cache keeps serving the old SVGs.
    // Load the selected style from disk onto the inner AdwSidebar rows instead.
    refresh_sidebar_icons: function(switcher, stack) {
        let iconsDir = this._apply_icon_style();
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

            let file = Gio.File.new_for_path(`${iconsDir}/${iconName}.svg`);
            if (file.query_exists(null))
                items.get_item(i).set_icon_paintable(Gtk.IconPaintable.new_for_file(file, 16, scale));
        }
    },

    // Legacy ListBox rows use Gtk.Image; refresh paintables from the active icon style.
    refresh_legacy_sidebar_icons: function(rows) {
        let iconsDir = this._apply_icon_style();
        let scale = 1;
        if (rows.length && rows[0].image)
            scale = Math.max(1, rows[0].image.get_scale_factor());

        for (let row of rows) {
            if (!row.iconName || row.iconName === 'preferences-system-symbolic')
                continue;

            let file = Gio.File.new_for_path(`${iconsDir}/${row.iconName}.svg`);
            if (file.query_exists(null))
                row.image.set_from_paintable(Gtk.IconPaintable.new_for_file(file, 16, scale));
            else
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

        let thresholdGroup = this._thresholdColorGroups[pageName];
        if (thresholdGroup)
            thresholdGroup.set_sensitive(enabled);

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

    _reorder_threshold_rows: function(group, rows) {
        let sorted = rows.slice().sort(
            (a, b) => a._committedThreshold - b._committedThreshold);
        if (sorted.every((row, i) => row === rows[i]))
            return;

        for (let i = 0; i < rows.length; i++)
            group.remove(rows[i]);

        rows.length = 0;
        for (let i = 0; i < sorted.length; i++) {
            group.add(sorted[i]);
            rows.push(sorted[i]);
        }
    },

    _sync_threshold_colors: function(settingsKey, group, rows) {
        let items = rows.map(row => {
            let rgba = row._colorButton.get_rgba();
            return {
                threshold: this._threshold_for_row(row),
                red: rgba.red,
                green: rgba.green,
                blue: rgba.blue,
            };
        });
        items.sort((a, b) => a.threshold - b.threshold);
        this._settings.set_strv(settingsKey, items.map(entry => formatColorEntry(entry)));
        this._reorder_threshold_rows(group, rows);
        this._refresh_band_titles(rows);
    },

    _make_color_row: function(settingsKey, group, rows, text = '0.0', red = 224 / 255, green = 27 / 255, blue = 36 / 255) {
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
        group.add(row);
        rows.push(row);
        this._refresh_band_titles(rows);

        let commitAndSync = () => {
            this._commit_threshold_entry(row);
            this._sync_threshold_colors(settingsKey, group, rows);
        };

        entry.connect('changed', () => {
            this._refresh_band_titles(rows);
        });
        entry.connect('activate', commitAndSync);
        entry.connect('notify::has-focus', () => {
            if (!entry.has_focus)
                commitAndSync();
        });
        colorButton.connect('color-set', () => {
            this._sync_threshold_colors(settingsKey, group, rows);
        });
        deleteButton.connect('clicked', () => {
            let index = rows.indexOf(row);
            if (index < 0)
                return;

            group.remove(row);
            rows.splice(index, 1);
            this._sync_threshold_colors(settingsKey, group, rows);
        });
    },

    _add_threshold_colors_group: function(pageId, settingsKey, pageName) {
        let page = this.builder.get_object(pageId);
        let group = new Adw.PreferencesGroup({
            title: _('Threshold Colors'),
            description: _('The sensor changes color when its value reaches a breakpoint. Below the lowest breakpoint, the default text color is used.'),
            margin_start: 10,
            margin_end: 10,
        });

        let rows = [];
        let addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add breakpoint'),
            valign: Gtk.Align.CENTER,
        });
        let addRow = new Adw.ActionRow({
            title: _('Add Breakpoint'),
            subtitle: _('Each color covers the range up to the next breakpoint.'),
            activatable_widget: addButton,
        });
        addRow.add_suffix(addButton);
        group.add(addRow);

        let sorted = sanitizeAndSortColorEntries(this._settings.get_strv(settingsKey));
        this._settings.set_strv(settingsKey, sorted.map(entry => formatColorEntry(entry)));

        for (let key in sorted) {
            let entry = sorted[key];
            this._make_color_row(settingsKey, group, rows, `${entry.threshold}`, entry.red, entry.green, entry.blue);
        }
        this._refresh_band_titles(rows);

        addButton.connect('clicked', () => {
            this._make_color_row(settingsKey, group, rows);
            this._sync_threshold_colors(settingsKey, group, rows);
        });

        page.add(group);
        if (pageName) {
            this._thresholdColorGroups[pageName] = group;
            this._sync_sensor_page_sensitivity(pageName);
        }
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
        settings.builder.get_object('icon-style').connect('changed', () => {
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
        settings.builder.get_object('icon-style').connect('changed', () => {
            settings.refresh_legacy_sidebar_icons(rows);
        });
    }
}
