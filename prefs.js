import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    formatColorEntry,
    sanitizeAndSortColorEntries,
} from './helpers/colors.js';

/*
        if (sensor == 'show-storage' && this._settings.get_boolean(sensor)) {

            let val = true;

            try {
                let GTop = imports.gi.GTop;
            } catch (e) {
                val = false;
            }

            let now = new Date().getTime();
            this._notify("Vitals", "Please run sudo apt install gir1.2-gtop-2.0", 'folder-symbolic');

        }
*/

const Settings = new GObject.Class({
    Name: 'Vitals.Settings',

    _init: function(extensionObject, params) {
        this._extensionObject = extensionObject
        this.parent(params);

        this._settings = extensionObject.getSettings();
        this._apply_icon_style();

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._extensionObject.metadata['gettext-domain']);
        this.builder.add_from_file(this._extensionObject.path + '/prefs.ui');

        // Threshold color editors are built lazily when each page is first shown,
        // so we do not construct dozens of Gtk.ColorButtons up front.
        this._thresholdColorsInitialized = {};
        this._thresholdColorGroups = {};
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

    ensure_threshold_colors_for_page: function(pageName) {
        if (this._thresholdColorsInitialized[pageName])
            return;

        let colorPages = {
            'temperature': ['temperature-page', 'temperature-colors'],
            'fan': ['fan-page', 'fan-colors'],
            'memory': ['memory-page', 'memory-colors'],
            'processor': ['processor-page', 'processor-colors'],
            'system': ['system-page', 'system-colors'],
            'battery': ['battery-page', 'battery-colors'],
            'gpu': ['gpu-page', 'gpu-colors'],
        };

        let entry = colorPages[pageName];
        if (!entry)
            return;

        this._thresholdColorsInitialized[pageName] = true;
        this._add_threshold_colors_group(entry[0], entry[1], pageName);
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
        let filtered = hotSensors.filter(key => {
            if (key === '_default_icon_')
                return true;
            return !key.includes(group);
        });

        if (filtered.length === 0)
            filtered.push('_default_icon_');

        if (filtered.length !== hotSensors.length)
            this._settings.set_strv('hot-sensors', filtered);
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
                // prune before flipping show-* so the extension redraw sees the new list
                if (!val && sensor.startsWith('show-'))
                    this._remove_hot_sensors_for_group(sensor.substring(5));
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

        this.builder.get_object('github-row').connect('activated', () => {
            Gtk.UriLauncher.new('https://github.com/corecoding/Vitals/issues').launch(null, null, null);
        });
        this.builder.get_object('donate-row').connect('activated', () => {
            Gtk.UriLauncher.new('https://corecoding.com/donate.php').launch(null, null, null);
        });
    },

    _bind_threshold_colors: function() {
        // kept for compatibility; pages initialize lazily via ensure_threshold_colors_for_page()
    },

    _band_title: function(low, high) {
        if (high === null || high === undefined)
            return _('%s and above').format(low);
        return `${low} – ${high}`;
    },

    _refresh_band_titles: function(rows) {
        let items = rows.map(row => ({
            row: row,
            threshold: Number.parseFloat(row._thresholdEntry.text) || 0,
        }));
        items.sort((a, b) => a.threshold - b.threshold);

        for (let i = 0; i < items.length; i++) {
            let low = items[i].threshold;
            let high = (i < items.length - 1) ? items[i + 1].threshold : null;
            items[i].row.title = this._band_title(low, high);
        }
    },

    _sync_threshold_colors: function(settingsKey, rows) {
        let items = rows.map(row => {
            let rgba = row._colorButton.get_rgba();
            return {
                threshold: Number.parseFloat(row._thresholdEntry.text) || 0,
                red: rgba.red,
                green: rgba.green,
                blue: rgba.blue,
            };
        });
        items.sort((a, b) => a.threshold - b.threshold);
        this._settings.set_strv(settingsKey, items.map(entry => formatColorEntry(entry)));
        this._refresh_band_titles(rows);
    },

    _make_color_row: function(settingsKey, group, rows, text = '0.0', red = 224 / 255, green = 27 / 255, blue = 36 / 255) {
        let entry = new Gtk.Entry({
            input_purpose: Gtk.InputPurpose.NUMBER,
            text: text,
            width_chars: 7,
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Lower bound for this color band'),
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
            title: this._band_title(Number.parseFloat(text) || 0, null),
            activatable: false,
        });
        row._thresholdEntry = entry;
        row._colorButton = colorButton;
        row.add_suffix(entry);
        row.add_suffix(colorButton);
        row.add_suffix(deleteButton);
        group.add(row);
        rows.push(row);

        entry.connect('changed', () => {
            this._sync_threshold_colors(settingsKey, rows);
        });
        colorButton.connect('color-set', () => {
            this._sync_threshold_colors(settingsKey, rows);
        });
        deleteButton.connect('clicked', () => {
            let index = rows.indexOf(row);
            if (index < 0)
                return;

            group.remove(row);
            rows.splice(index, 1);
            this._sync_threshold_colors(settingsKey, rows);
        });
    },

    _add_threshold_colors_group: function(pageId, settingsKey, pageName) {
        let page = this.builder.get_object(pageId);
        let group = new Adw.PreferencesGroup({
            title: _('Threshold Colors'),
            description: _('The sensor changes color when its value goes above a breakpoint. Below the lowest breakpoint, the default text color is used.'),
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
            this._sync_threshold_colors(settingsKey, rows);
        });

        page.add(group);
        if (pageName) {
            this._thresholdColorGroups[pageName] = group;
            this._sync_sensor_page_sensitivity(pageName);
        }
    }
});


export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();
        window.set_search_enabled(false);
        window.set_default_size(720, 520);

        let settings = new Settings(this);
        let root = settings.builder.get_object('prefs-root');
        let stack = settings.builder.get_object('prefs-stack');
        let sidebar = settings.builder.get_object('prefs-sidebar');
        let contentPage = settings.builder.get_object('prefs-content-page');

        // Replace PreferencesWindow's bottom-tab navigation with a Settings-style sidebar.
        window.get_content().set_child(root);

        let pages = [
            { name: 'general' },
            { name: 'temperature', section: _('Sensors') },
            { name: 'voltage' },
            { name: 'fan' },
            { name: 'memory' },
            { name: 'processor' },
            { name: 'system' },
            { name: 'network' },
            { name: 'storage' },
            { name: 'battery' },
            { name: 'gpu' },
        ];

        for (let i = 0; i < pages.length; i++) {
            let info = pages[i];
            let page = settings.builder.get_object(info.name + '-page');
            let title = page.get_title();
            let iconName = page.get_icon_name();
            // Header bar already shows the section title; hide the page banner.
            page.set_title('');

            let stackPage = stack.add_titled_with_icon(page, info.name, title, iconName);
            if (info.section) {
                stackPage.set_starts_section(true);
                stackPage.set_section_title(info.section);
            }
        }

        let syncVisiblePage = () => {
            let name = stack.get_visible_child_name();
            let visible = stack.get_visible_child();
            if (visible) {
                let stackPage = stack.get_page(visible);
                let title = stackPage.get_title();
                // Sensor pages used to open as "Network Preferences", etc.
                if (name && name !== 'general')
                    title = title + ' ' + _('Preferences');
                contentPage.set_title(title);
            }
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
}
