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

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        const group = new Adw.PreferencesGroup({});
        group.add(widget);
        page.add(group);
        window.add(page);
        window.set_default_size(widget.width, widget.height);
        widget.show();

        // second page: pick exactly which sensors show in the top bar
        this._buildPanelSensorsPage(window, window._settings);
    }

    // Builds a page that lists every sensor the extension has discovered,
    // grouped by category, with a switch per sensor. Toggling a switch adds or
    // removes that sensor from 'hot-sensors' (the sensors shown in the panel).
    _buildPanelSensorsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'utilities-system-monitor-symbolic'
        });
        window.add(page);

        // groups we add dynamically, so we can rebuild when the sensor list changes
        let dynamicGroups = [];
        let keyToSwitch = {};
        // guards against feedback loops between our writes and the change signals
        let updating = false;

        const rebuild = () => {
            for (let g of dynamicGroups) page.remove(g);
            dynamicGroups = [];
            keyToSwitch = {};

            let available = [];
            try {
                available = JSON.parse(settings.get_string('available-sensors'));
            } catch (e) {
                available = [];
            }

            if (!available.length) {
                let empty = new Adw.PreferencesGroup({
                    title: _('Sensors in the panel'),
                    description: _('Open the Vitals menu in the top bar once so your sensors can be detected. They will then appear here to be toggled on or off.')
                });
                page.add(empty);
                dynamicGroups.push(empty);
                return;
            }

            let intro = new Adw.PreferencesGroup({
                title: _('Sensors in the panel'),
                description: _('Choose which sensors are shown in the top bar.')
            });
            page.add(intro);
            dynamicGroups.push(intro);

            // bucket sensors by their category
            let byGroup = {};
            for (let sensor of available) {
                if (!byGroup[sensor.group]) byGroup[sensor.group] = [];
                byGroup[sensor.group].push(sensor);
            }

            let hot = settings.get_strv('hot-sensors');

            for (let groupName of Object.keys(byGroup).sort()) {
                let pg = new Adw.PreferencesGroup({ title: this._groupDisplayName(groupName) });

                for (let sensor of byGroup[groupName]) {
                    let row = new Adw.SwitchRow({
                        title: sensor.label,
                        active: hot.indexOf(sensor.key) >= 0
                    });
                    keyToSwitch[sensor.key] = row;

                    row.connect('notify::active', () => {
                        if (updating) return;

                        let list = settings.get_strv('hot-sensors');
                        let idx = list.indexOf(sensor.key);
                        if (row.active && idx < 0) list.push(sensor.key);
                        else if (!row.active && idx >= 0) list.splice(idx, 1);
                        else return;

                        // same invariant the panel uses: show the generic
                        // placeholder icon only when no real sensor is selected
                        let defIdx = list.indexOf('_default_icon_');
                        if (defIdx >= 0) list.splice(defIdx, 1);
                        if (list.length === 0) list.push('_default_icon_');

                        updating = true;
                        settings.set_strv('hot-sensors', list);
                        updating = false;
                    });

                    pg.add(row);
                }

                page.add(pg);
                dynamicGroups.push(pg);
            }
        };

        rebuild();

        // extension discovered new sensors (or the app just started) -> rebuild
        let availId = settings.connect('changed::available-sensors', () => rebuild());

        // hot-sensors changed elsewhere (e.g. the dropdown) -> reflect in switches
        let hotId = settings.connect('changed::hot-sensors', () => {
            if (updating) return;
            let hot = settings.get_strv('hot-sensors');
            updating = true;
            for (let key in keyToSwitch)
                keyToSwitch[key].active = hot.indexOf(key) >= 0;
            updating = false;
        });

        // avoid leaking the signal handlers when the window is closed
        window.connect('close-request', () => {
            settings.disconnect(availId);
            settings.disconnect(hotId);
            return false;
        });
    }

    _groupDisplayName(group) {
        if (group.startsWith('gpu')) {
            let n = group.split('#')[1];
            return n ? _('Graphics') + ' ' + n : _('Graphics');
        }
        return group.charAt(0).toUpperCase() + group.slice(1);
    }
}
