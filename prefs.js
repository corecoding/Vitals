import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const Settings = new GObject.Class({
    Name: 'Vitals.Settings',

    _init: function (extensionObject, params) {
        this._extensionObject = extensionObject;
        this.parent(params);

        this._settings = extensionObject.getSettings();

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._extensionObject.metadata['gettext-domain']);
        this.builder.add_from_file(this._extensionObject.path + '/prefs.ui');
        this.widgetGeneral = this.builder.get_object('general_page');
        this.widgetSensor = this.builder.get_object('sensor_page');

        this._bind_settings();
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function () {
        let widget;

        // Process sensor toggles that needs set_enable_expansion
        let sensors = ['show-temperature',
            'show-memory', 'show-processor', 'show-system',
            'show-network', 'show-storage', 'use-higher-precision',
            'alphabetize', 'hide-zeros', 'include-public-ip',
            'show-battery', 'fixed-widths', 'hide-icons',
            'menu-centered', 'include-static-info'];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_enable_expansion(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this._settings.set_boolean(sensor, val);
            });
        }

        // Process sensor toggles that needs set_active
        let sensors = ['show-voltage', 'show-fan'];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);

            widget.set_active(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this._settings.set_boolean(sensor, val);
            });
        }

        // Process individual drop-down sensor preferences
        sensors = ['position-in-panel', 'unit', 'network-speed-format', 'memory-measurement', 'storage-measurement', 'battery-slot'];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this._settings.set_int(sensor, widget.get_active());
            });
        }

        this._settings.bind('update-time', this.builder.get_object('update-time'), 'value', Gio.SettingsBindFlags.DEFAULT);

        // Process individual text entry sensor preferences
        sensors = ['storage-path', 'monitor-cmd'];
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
});

export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        let settings = new Settings(this);
        let widgetGeneral = settings.widgetGeneral;
        let widgetSensor = settings.widgetSensor;

        window.add(widgetGeneral);
        window.add(widgetSensor);

        window.set_default_size(Math.max(widgetGeneral.width, widgetSensor.width), widgetGeneral.height + widgetSensor.height);
        widgetGeneral.show();
        widgetSensor.show();
    }
}
