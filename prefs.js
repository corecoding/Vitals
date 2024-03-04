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
                        'show-battery', 'fixed-widths', 'hide-icons', 
                        'menu-centered', 'include-static-info', 
                        'show-gpu', 'include-static-gpu-info' ];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this._settings.set_boolean(sensor, val);
            });
        }

        // process individual drop down sensor preferences
        sensors = [ 'position-in-panel', 'unit', 'network-speed-format', 'memory-measurement', 'storage-measurement', 'battery-slot', 'icon-style' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this._settings.set_int(sensor, widget.get_active());
            });
        }

        this._settings.bind('update-time', this.builder.get_object('update-time'), 'value', Gio.SettingsBindFlags.DEFAULT);

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
        sensors = [ 'temperature', 'network', 'storage', 'memory', 'battery', 'system', 'processor', 'gpu' ];
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
