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

        // Process sensor using AdwExpanderRow
        let sensors = ['show-temperature', 'show-memory',
            'show-processor', 'show-network',
            'show-storage', 'show-battery', 'show-batterycombined'];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);

            this._settings.bind(
                sensor, widget, 'enable-expansion',
                Gio.SettingsBindFlags.DEFAULT
            );
        }

        // Process sensor using AdwSwitchRow
        let sensorsWithActive = ['show-voltage', 'show-fan',
            'include-static-info', 'include-public-ip',
            'use-higher-precision', 'alphabetize', 'hide-zeros',
            'fixed-widths', 'hide-icons', 'menu-centered', 'show-system',
            'show-batterybat0', 'show-batterybat1',
            'show-batterybat2', 'show-batterycmb0',
            'combined-include-macsmc-battery', 'combined-include-bat0',
            'combined-include-bat1', 'combined-include-bat2',
            'combined-include-cmb0'];

        for (let key in sensorsWithActive) {
            let sensor = sensorsWithActive[key];

            widget = this.builder.get_object(sensor);

            this._settings.bind(
                sensor, widget, 'active',
                Gio.SettingsBindFlags.DEFAULT
            );
        }

        // Process individual AdwComboRow sensor preferences
        let dropdownSensors = ['position-in-panel', 'unit', 'network-speed-format', 'memory-measurement', 'storage-measurement', 'battery-slot'];
        for (let key in dropdownSensors) {
            let sensor = dropdownSensors[key];

            widget = this.builder.get_object(sensor);

            this._settings.bind(
                sensor, widget, 'selected',
                Gio.SettingsBindFlags.DEFAULT
            );
        }

        this._settings.bind('update-time', this.builder.get_object('update-time'), 'value', Gio.SettingsBindFlags.DEFAULT);

        // Process individual text entry sensor preferences
        let textEntrySensors = ['storage-path', 'monitor-cmd'];
        for (let key in textEntrySensors) {
            let sensor = textEntrySensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_text(this._settings.get_string(sensor));

            widget.connect('notify::text', (widget) => {
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

        widgetGeneral.show();
        widgetSensor.show();
    }
}

