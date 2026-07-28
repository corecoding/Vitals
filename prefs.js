import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._extensionObject.metadata['gettext-domain']);
        this.builder.add_from_file(this._extensionObject.path + '/prefs.ui');
        this.widget = this.builder.get_object('prefs-container');

        this._bind_settings();
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
                        'show-gpu', 'include-static-gpu-info', 'show-custom' ];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this._settings.set_boolean(sensor, val);
            });
        }

        // process individual drop down sensor preferences
        sensors = [ 'position-in-panel', 'unit', 'network-speed-format', 'network-speed-unit', 'memory-measurement', 'storage-measurement', 'battery-slot', 'icon-style', 'network-public-ip-provider' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this._settings.set_int(sensor, widget.get_active());
            });
        }

        let providerWidget = this.builder.get_object('network-public-ip-provider');
        let flagWidget = this.builder.get_object('network-public-ip-show-flag');
        let updateFlagSensitivity = () => {
            flagWidget.set_sensitive(providerWidget.get_active() !== 2);
        };
        updateFlagSensitivity();
        providerWidget.connect('changed', updateFlagSensitivity);

        this._settings.bind('update-time', this.builder.get_object('update-time'), 'value', Gio.SettingsBindFlags.DEFAULT);

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

        // makes individual sensor preference boxes appear
        sensors = [ 'temperature', 'network', 'storage', 'memory', 'battery', 'system', 'processor', 'gpu', 'custom' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            // create dialog for intelligent autohide advanced settings
            this.builder.get_object(sensor + '-prefs').connect('clicked', () => {
                let transientObj = this.widget.get_root();
                let title = sensor.charAt(0).toUpperCase() + sensor.slice(1);
                let dialog = new Gtk.Dialog({ title: _(title) + ' ' + _('Preferences'),
                                              transient_for: transientObj,
                                              use_header_bar: false,
                                              modal: true });

                let box = this.builder.get_object(sensor + '_prefs');
                dialog.get_content_area().append(box);
                dialog.connect('response', (dialog, id) => {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                    return;
                });

                dialog.show();
            });
        }

        this._bindCustomMetrics();
    },

    // manage the list of custom metrics JSON files
    _bindCustomMetrics: function() {
        this._customPathsListbox = this.builder.get_object('custom-paths-listbox');

        this._refreshCustomPathsListbox();

        this.builder.get_object('custom-add-path').connect('clicked', () => {
            let dialog = new Gtk.FileDialog({ title: _('Select Custom Metrics JSON File') });

            let filter = new Gtk.FileFilter();
            filter.add_pattern('*.json');
            filter.set_name(_('JSON files'));
            let filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);
            dialog.set_filters(filters);

            dialog.open(this.widget.get_root(), null, (self, res) => {
                try {
                    let file = self.open_finish(res);
                    let path = file.get_path();
                    if (!path) return;

                    let paths = this._settings.get_strv('custom-metrics-paths');
                    if (!paths.includes(path)) {
                        paths.push(path);
                        this._settings.set_strv('custom-metrics-paths', paths);
                        this._refreshCustomPathsListbox();
                    }
                } catch (e) { } // user cancelled the dialog
            });
        });
    },

    _refreshCustomPathsListbox: function() {
        let listbox = this._customPathsListbox;

        // clear existing rows
        let row;
        while ((row = listbox.get_row_at_index(0)) !== null)
            listbox.remove(row);

        let paths = this._settings.get_strv('custom-metrics-paths');
        for (let path of paths) {
            let box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6,
            });

            let label = new Gtk.Label({ label: path, hexpand: true, halign: Gtk.Align.START, ellipsize: 3 });
            box.append(label);

            let removeButton = new Gtk.Button({ icon_name: 'user-trash-symbolic' });
            removeButton.connect('clicked', () => {
                let updated = this._settings.get_strv('custom-metrics-paths').filter(p => p !== path);
                this._settings.set_strv('custom-metrics-paths', updated);
                this._refreshCustomPathsListbox();
            });
            box.append(removeButton);

            listbox.append(new Gtk.ListBoxRow({ child: box, selectable: false }));
        }
    }
});

 
export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        let settings = new Settings(this);
        let widget = settings.widget;

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({});
        group.add(widget);
        page.add(group);
        window.add(page);
        window.set_default_size(widget.width, widget.height);
        widget.show();
    }
}
