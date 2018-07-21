const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const VitalsItem = Me.imports.vitalsItem;
const Sensors = Me.imports.sensors;

const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const VitalsMenuButton = new Lang.Class({
    Name: 'VitalsMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(St.Align.START);
        this.connect('destroy', Lang.bind(this, this._onDestroy));

        this._settings = Convenience.getSettings();

        this._sensorMenuItems = {};

        this._sensorIcons = {
            'temperature' : Gio.icon_new_for_string(Me.path + '/icons/temperature.svg'),
            'voltage' : Gio.icon_new_for_string(Me.path + '/icons/voltage.svg'),
            'fan' : Gio.icon_new_for_string(Me.path + '/icons/fan.svg'),
            'memory' : Gio.icon_new_for_string(Me.path + '/icons/memory.svg'),
            'processor' : Gio.icon_new_for_string(Me.path + '/icons/cpu.svg'),
            'system' : Gio.icon_new_for_string(Me.path + '/icons/cpu.svg'),
            'network' : Gio.icon_new_for_string(Me.path + '/icons/cpu.svg'),
            'storage' : Gio.icon_new_for_string(Me.path + '/icons/cpu.svg')
        }

        this._menuLayout = new St.BoxLayout();
        this._hotLabels = {};
        this._hotIcons = {};

        this._groups = {};

        this._update_time = this._settings.get_int('update-time');

        this._sensors = new Sensors.Sensors(this._update_time);

        // grab list of selected menubar icons
        let hotSensors = this._settings.get_strv('hot-sensors');
        let showIcon = this._settings.get_boolean('show-icon-on-panel');
        for (let key of Object.values(hotSensors)) {
            this._createHotItem(key, showIcon);
        }

        // TODO Fix bug that causes dropdown to be scooted left when juggling sensors
        // adds drop down arrow in menubar
        //this._menuLayout.add(PopupMenu.arrowIcon(St.Side.BOTTOM));

        this.actor.add_actor(this._menuLayout);

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('show-icon-on-panel', Lang.bind(this, this._showIconOnPanelChanged));
        this._addSettingChangedSignal('position-in-panel', Lang.bind(this, this._positionInPanelChanged));

        let settings = ['unit', 'hot-sensors', 'use-higher-precision', 'hide-zeros', 'alphabetize'];
        for (let setting of Object.values(settings)) {
            this._addSettingChangedSignal(setting, Lang.bind(this, this._querySensors));
        }

        // add signals for show- preference based categories
        for (let sensor of Object.keys(this._sensorIcons)) {
            this._addSettingChangedSignal('show-' + sensor, Lang.bind(this, this._showHideSensors));
        }

        this._initializeMenu();
        this._initializeTimer();
    },

    _initializeMenu: function() {
        // display sensor categories
        for (let sensor of Object.keys(this._sensorIcons)) {
            // groups associated sensors under accordion menu
            if (typeof this._groups[sensor] == 'undefined') {
                this._groups[sensor] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(sensor)), true);
                this._groups[sensor].icon.gicon = this._sensorIcons[sensor];

                // hide menu items that user has requested to not include
                if (!this._settings.get_boolean('show-' + sensor)) {
                    this._groups[sensor].actor.hide();
                }

                if (!this._groups[sensor].status) { // gnome 3.18 and higher
                    this._groups[sensor].status = this._defaultLabel();
                    this._groups[sensor].actor.insert_child_at_index(this._groups[sensor].status, 4);
                }

                this.menu.addMenuItem(this._groups[sensor]);
            }
        }

        let panelSystem = Main.panel.statusArea.aggregateMenu._system;
        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'vitals-menu-button-container'
        });

        // round preferences button
        let prefsButton = panelSystem._createActionButton('preferences-system-symbolic', _("Preferences"));
        prefsButton.connect('clicked', function() {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });
        item.actor.add(prefsButton);

        // round monitor button
        let monitorButton = panelSystem._createActionButton('utilities-system-monitor-symbolic', _("System Monitor"));
        monitorButton.connect('clicked', function() {
            Util.spawn(["gnome-system-monitor"]);
        });
        item.actor.add(monitorButton);

        // round refresh button
        let refreshButton = panelSystem._createActionButton('view-refresh-symbolic', _("Refresh"));
        refreshButton.connect('clicked', Lang.bind(this, function(self) {
            this._querySensors();
        }));
        item.actor.add(refreshButton);

        // add separator and buttons
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(item);
    },

    _initializeTimer: function() {
        // start off with fresh sensors
        this._querySensors();

        // used to query sensors and update display
        this._refreshTimeoutId = Mainloop.timeout_add_seconds(this._update_time, Lang.bind(this, function() {
            this._querySensors();

            // read to update queue
            return true;
        }));
    },

    _showHideSensors: function() {
        for (let sensor of Object.keys(this._sensorIcons)) {
            if (this._settings.get_boolean('show-' + sensor)) {
                this._groups[sensor].actor.show();
            } else {
                this._groups[sensor].actor.hide();
            }
        }
    },

    _createHotItem: function(key, showIcon, gicon, value) {
        if (showIcon) {
            let icon = this._defaultIcon(gicon);
            this._hotIcons[key] = icon;
            this._menuLayout.add(icon);
        }

        if (!value) {
            value = '\u2026'; /* ... */
        }

        let label = new St.Label({
            text: value,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        this._hotLabels[key] = label;
        this._menuLayout.add(label);
    },

    _positionInPanelChanged: function() {
        this.container.get_parent().remove_actor(this.container);

        // small HACK with private boxes :)
        let boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox
        };

        let p = this.positionInPanel;
        boxes[p].insert_child_at_index(this.container, p == 'right' ? 0 : -1)
    },

    _showIconOnPanelChanged: function() {
        if (this._settings.get_boolean('show-icon-on-panel')) {
            let index = 0;
            for (let key in this._hotLabels) {
                let icon = this._defaultIcon(this._sensorMenuItems[key].gicon);
                this._hotIcons[key] = icon;
                this._menuLayout.insert_child_at_index(icon, index);
                index += 2;
            }
        } else {
            for (let key in this._hotIcons)
                this._hotIcons[key].destroy();

            this._hotIcons = {};
        }
    },

    _updateTimeChanged: function() {
        this._update_time = this._settings.get_int('update-time');
        this._sensors.update_time = this._update_time;

        // invalidate and reinitialize timer
        Mainloop.source_remove(this._refreshTimeoutId);
        this._initializeTimer();
    },

    _addSettingChangedSignal: function(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    },

    _updateDisplay: function(sensor) {
        // update sensor value in menubar
        let key = sensor.key || sensor.label;
        let label = this._hotLabels[key];
        if (label) label.set_text(sensor.value + ' ');

        // have we added this sensor before?
        let item = this._sensorMenuItems[key];
        if (item) {
            // update sensor value next to group header
            if (sensor.type.includes('-group')) {
                item.status.text = sensor.value;
            } else {
                // update sensor value in the group
                item.value = sensor.value;
            }
        } else {
            this._appendMenuItems(sensor);
        }
    },

    _appendMenuItems: function(sensor) {
        let showIcon = this._settings.get_boolean('show-icon-on-panel');
        let key = sensor.key || sensor.label;

        // displays text next to group
        if (sensor.type.includes('-group')) {
            let parts = sensor.type.split('-');
            if (this._groups[parts[0]]) {
                this._groups[parts[0]].status.text = sensor.value;
                this._sensorMenuItems[sensor.type] = this._groups[parts[0]];
            }

            return;
        }

        let item = new VitalsItem.VitalsItem(this._sensorIcons[sensor.type], key, sensor.label, sensor.value);
        item.connect('activate', Lang.bind(this, function(self) {
            let hotSensors = this._settings.get_strv('hot-sensors');

            if (self.checked) {
                // require that one checkbox is always visible
                if (hotSensors.length <= 1) {
                    // don't close dropdown menu
                    return true;
                }

                let label = this._hotLabels[self.key];
                hotSensors.splice(hotSensors.indexOf(self.key), 1);
                delete this._hotLabels[self.key];

                // make sure set_label is not called on non existant actor
                label.destroy();

                this._hotIcons[self.key].destroy();
                delete this._hotIcons[self.key];

                self.checked = false;
            } else {
                // add sensor to menubar
                hotSensors.push(self.key);
                this._createHotItem(self.key, showIcon, self.gicon, self.value);
                self.checked = true;
            }

            for (let i = hotSensors.length - 1; i >= 0; i--) {
                let k = hotSensors[i];
                if (!this._sensorMenuItems[k]) {
                    hotSensors.splice(i, 1);
                    let label = this._hotLabels[k]
                    delete this._hotLabels[k];

                    // make sure set_label is not called on non existant actor
                    label.destroy();

                    this._hotIcons[k].destroy();
                    delete this._hotIcons[k];
                }
            }

            // this code is called asynchronously - make sure to save it for next round
            this._settings.set_strv('hot-sensors', hotSensors.filter(
                function(item, pos) {
                    return hotSensors.indexOf(item) == pos;
                }
            ));
        }));

        if (this._hotLabels[key]) {
            item.checked = true;
            if (this._hotIcons[key])
                this._hotIcons[key].gicon = item.gicon;
        }

        this._sensorMenuItems[key] = item;

        // only group items if we have more than one
        if (typeof this._sensorIcons[sensor.type] != 'undefined') {
            this._groups[sensor.type].menu.addMenuItem(item);
        } else {
            this.menu.addMenuItem(item);
        }
    },

    _defaultLabel: function() {
        return new St.Label({
            style_class: 'vitals-status-menu-item',
               y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
        });
    },

    _defaultIcon: function(gicon) {
        let icon = new St.Icon( {
            icon_name: "utilities-system-monitor-symbolic",
            icon_size: 16
        });

        if (gicon) icon.gicon = gicon;

        return icon;
    },

    _toFahrenheit: function(c) {
        return ((9 / 5) * c + 32);
    },

    _formatValue: function(value, sensorClass) {
        if (value === null) return 'N/A';
        value = value.toString().trim();

        let format = '';
        let ending = '';
        let useHigherPrecision = this._settings.get_boolean('use-higher-precision');

        let kilo = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        switch (sensorClass) {
            case 'percent':
                format = (useHigherPrecision)?'%.1f%s':'%d%s';
                ending = '%';
                break;
            case 'temp':
                value = value / 1000;
                let fahrenheit = (this._settings.get_string('unit') == 'fahrenheit');
                if (fahrenheit) value = this._toFahrenheit(value);
                format = (useHigherPrecision)?'%.1f%s':'%d%s';
                ending = (fahrenheit) ? "\u00b0F" : "\u00b0C";
                break;
            case 'fan':
                format = '%d rpm';
                break;
            case 'in':
                value = value / 1000;
                format = ((value >= 0) ? '+' : '-') + '%.2f%s';
                ending = 'V';
                break;
            case 'storage':
                format = (useHigherPrecision)?'%.2f%s':'%.1f%s';
            case 'speed':
                if (!format) format = (useHigherPrecision)?'%.1f%s':'%.0f%s';
                let i = 0;

                if (value > 0) {
                    i = Math.floor(Math.log(value) / Math.log(kilo));
                    value = parseFloat((value / Math.pow(kilo, i)));
                }

                ending = sizes[i];
                if (sensorClass == 'speed')
                    ending = ending + '/s';
                break;
            case 'duration':
                let levels = {
                    scale: [24, 60, 60],//, 1],
                    units: ['d ', 'h ', 'm ']//, 's ']
                };

                const cbFun = (d, c) => {
                    let bb = d[1] % c[0],
                        aa = (d[1] - bb) / c[0];
                    aa = aa > 0 ? aa + c[1] : '';

                    return [d[0] + aa, bb];
                };

                let rslt = levels.scale.map((d, i, a) => a.slice(i).reduce((d, c) => d * c))
                    .map((d, i) => ([d, levels.units[i]]))
                    .reduce(cbFun, ['', value]);
                value = rslt[0].trim();

                format = '%s';
                break;
            default:
                format = '%s';
                break;
        }

        return format.format(value, ending);
    },

    _ucFirst: function(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    },

    get positionInPanel() {
        return this._settings.get_string('position-in-panel');
    },

    _querySensors: function() {
        this._sensors.query(Lang.bind(this, function(label, value, type, format, key) {
            value = this._formatValue(value, format);

            global.log('...label=' + label, 'value=' + value, 'type=' + type + ', format=' + format);
            let sensor = { 'value': value, 'type': type, 'label': label, 'key': key }

            this._updateDisplay(sensor);
        }));
    },

    _onDestroy: function() {
        Mainloop.source_remove(this._refreshTimeoutId);

        for (let signal of Object.values(this._settingChangedSignals)) {
            this._settings.disconnect(signal);
        };
    }
});

let vitalsMenu;

function init(extensionMeta) {
    Convenience.initTranslations();
}

function enable() {
    vitalsMenu = new VitalsMenuButton();
    let positionInPanel = vitalsMenu.positionInPanel;
    Main.panel.addToStatusArea('vitalsMenu', vitalsMenu, positionInPanel == 'right' ? 0 : -1, positionInPanel);
}

function disable() {
    vitalsMenu.destroy();
    vitalsMenu = null;
}
