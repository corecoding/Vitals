import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
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

        this._provider = new Gtk.CssProvider();
        this._provider.load_from_path(this._extensionObject.path + '/prefs.css');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            this._provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        let iconStyle = this._settings.get_int('icon-style');
        let iconDirs = ['original', 'gnome'];
        let preferred = iconDirs[iconStyle] || 'original';
        iconDirs = [preferred].concat(iconDirs.filter(dir => dir !== preferred));
        for (let key in iconDirs) {
            iconTheme.add_search_path(this._extensionObject.path + '/icons/' + iconDirs[key]);
        }

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._extensionObject.metadata['gettext-domain']);
        this.builder.add_from_file(this._extensionObject.path + '/prefs.ui');

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

        this.builder.get_object('github-row').connect('activated', () => {
            Gtk.UriLauncher.new('https://github.com/corecoding/Vitals/issues').launch(null, null, null);
        });
        this.builder.get_object('donate-row').connect('activated', () => {
            Gtk.UriLauncher.new('https://corecoding.com/donate.php').launch(null, null, null);
        });
    }
});


export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();
        window.add_css_class('vitals-preferences');

        let settings = new Settings(this);

        let pages = [ 'general', 'temperature', 'voltage', 'fan', 'memory',
                      'processor', 'system', 'network', 'storage', 'battery', 'gpu' ];
        for (let key in pages) {
            window.add(settings.builder.get_object(pages[key] + '-page'));
        }
    }
}
