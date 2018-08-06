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

        this._debug = false;

        {
            let GioSSS = Gio.SettingsSchemaSource;
            let schema = GioSSS.new_from_directory(Me.path + '/schemas', GioSSS.get_default(), false);
            schema = schema.lookup('org.gnome.shell.extensions.vitals', false);
            this._settings = new Gio.Settings({ settings_schema: schema });
        }

        this._sensorIcons = {
            'temperature' : { 'icon': 'temperature-symbolic.svg',
                       'alphabetize': true },
                'voltage' : { 'icon': 'voltage-symbolic.svg',
                       'alphabetize': true },
                    'fan' : { 'icon': 'fan-symbolic.svg',
                       'alphabetize': true },
                 'memory' : { 'icon': 'memory-symbolic.svg',
                       'alphabetize': false },
              'processor' : { 'icon': 'cpu-symbolic.svg',
                       'alphabetize': true },
                 'system' : { 'icon': 'system-symbolic.svg',
                       'alphabetize': true },
                'network' : { 'icon': 'network-symbolic.svg',
                       'alphabetize': true,
                     'icon-download': 'network-download-symbolic.svg',
                       'icon-upload': 'network-upload-symbolic.svg' },
                'storage' : { 'icon': 'storage-symbolic.svg',
                       'alphabetize': false }
        }

        this._sensorMenuItems = {};
        this._hotLabels = {};
        this._hotIcons = {};
        this._groups = {};

        this._update_time = this._settings.get_int('update-time');
        this._use_higher_precision = this._settings.get_boolean('use-higher-precision');
        let hotSensors = this._settings.get_strv('hot-sensors');
        let showIcon = this._settings.get_boolean('show-icon-on-panel');

        this._sensors = new Sensors.Sensors(this._settings, this._sensorIcons, this._debug, this._update_time);
        this._menuLayout = new St.BoxLayout({ style_class: 'vitals-panel-box' });

        // grab list of selected menubar icons
        for (let key of Object.values(hotSensors)) {
            this._createHotItem(key, showIcon);
        }

        this.actor.add_actor(this._menuLayout);

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('show-icon-on-panel', Lang.bind(this, this._showIconOnPanelChanged));
        this._addSettingChangedSignal('position-in-panel', Lang.bind(this, this._positionInPanelChanged));
        this._addSettingChangedSignal('use-higher-precision', Lang.bind(this, this._higherPrecisionChanged));

        let settings = ['unit', 'hot-sensors', 'hide-zeros', 'alphabetize'];
        for (let setting of Object.values(settings)) {
            this._addSettingChangedSignal(setting, Lang.bind(this, this._querySensors));
        }

        // add signals for show- preference based categories
        for (let sensor in this._sensorIcons) {
            this._addSettingChangedSignal('show-' + sensor, Lang.bind(this, this._showHideSensorsChanged));
        }

        this._initializeMenu();
        this._initializeTimer();
    },

    _initializeMenu: function() {
        // display sensor categories
        for (let sensor in this._sensorIcons) {
            // groups associated sensors under accordion menu
            if (typeof this._groups[sensor] == 'undefined') {
                this._groups[sensor] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(sensor)), true);
                this._groups[sensor].icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[sensor]['icon']);

                // hide menu items that user has requested to not include
                if (!this._settings.get_boolean('show-' + sensor)) {
                    this._groups[sensor].actor.hide();
                }

                if (!this._groups[sensor].status) {
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
            this._updateTimeChanged();
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

    _higherPrecisionChanged: function() {
        this._use_higher_precision = this._settings.get_boolean('use-higher-precision');
        this._sensors.resetHistory();
        this._querySensors();
    },

    _showHideSensorsChanged: function() {
        for (let sensor in this._sensorIcons) {
            if (this._settings.get_boolean('show-' + sensor)) {
                this._groups[sensor].actor.show();
            } else {
                this._groups[sensor].actor.hide();
            }
        }
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

    _updateDisplay: function(label, value, type, key) {
        // update sensor value in menubar
        if (this._hotLabels[key])
            this._hotLabels[key].set_text(value);

        // have we added this sensor before?
        let item = this._sensorMenuItems[key];
        if (item) {
            // update sensor value in the group
            item.value = value;
        } else if (type.includes('-group')) {
            // update text next to group header
            let group = type.split('-')[0];
            if (this._groups[group]) {
                this._groups[group].status.text = value;
                this._sensorMenuItems[type] = this._groups[group];
            }
        } else {
            let sensor = { 'label': label, 'value': value, 'type': type }
            this._appendMenuItem(sensor, key);
        }
    },

    _appendMenuItem: function(sensor, key) {
        let showIcon = this._settings.get_boolean('show-icon-on-panel');

        let split = sensor.type.split('-');
        let type = split[0];
        let icon = (typeof split[1] != 'undefined')?'icon-' + split[1]:'icon';
        let gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[type][icon]);

        let item = new VitalsItem.VitalsItem(gicon, key, sensor.label, sensor.value);
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

        let i = Object.keys(this._sensorMenuItems[key]).length;

        // alphabetize the sensors for these categories
        if (this._sensorIcons[type]['alphabetize'] && this._settings.get_boolean('alphabetize')) {
            let menuItems = this._groups[type].menu._getMenuItems();
            for (i = 0; i < menuItems.length; i++)
                if (menuItems[i].key.localeCompare(key) > 0)
                    break;
        }

        this._groups[type].menu.addMenuItem(item, i);
    },

    _defaultLabel: function() {
        return new St.Label({
            style_class: 'vitals-status-menu-item',
               y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
        });
    },

    _defaultIcon: function(gicon) {
        let icon = new St.Icon({
            icon_name: "utilities-system-monitor-symbolic",
          style_class: 'system-status-icon'
        });

        //icon.style = this._setProgress(0.1);

        if (gicon) icon.gicon = gicon;

        return icon;
    },

    _formatValue: function(value, sensorClass) {
        if (value === null) return 'N/A';

        let format = '';
        let ending = '';
        let i = 0;

        let kilo = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        switch (sensorClass) {
            case 'percent':
                format = (this._use_higher_precision)?'%.1f%s':'%d%s';
                ending = '%';
                break;
            case 'temp':
                value = value / 1000;
                ending = "\u00b0C";

                // are we converting to fahrenheit?
                if (this._settings.get_int('unit') == 1) {
                    value = ((9 / 5) * value + 32);
                    ending = "\u00b0F";
                }

                format = (this._use_higher_precision)?'%.1f%s':'%d%s';
                break;
            case 'fan':
                format = '%d rpm';
                break;
            case 'in':
                value = value / 1000;
                format = ((value >= 0) ? '+' : '-') + '%.2f%s';
                ending = 'V';
                break;
            case 'mhz':
                format = (this._use_higher_precision)?'%.2f%s':'%.1f%s';
                ending = ' MHz';
                break;
            case 'storage':
                if (value > 0) {
                    i = Math.floor(Math.log(value) / Math.log(kilo));
                    value = parseFloat((value / Math.pow(kilo, i)));
                }

                format = (this._use_higher_precision)?'%.2f%s':'%.1f%s';
                ending = sizes[i];
                break;
            case 'speed':
                if (value > 0) {
                    i = Math.floor(Math.log(value) / Math.log(kilo));
                    value = parseFloat((value / Math.pow(kilo, i)));
                }

                format = (this._use_higher_precision)?'%.1f%s':'%.0f%s';
                ending = sizes[i] + '/s';
                break;
            case 'duration':
                let scale = [24, 60, 60];
                let units = ['d ', 'h ', 'm '];

                if (this._use_higher_precision) {
                    scale.push(1);
                    units.push('s ');
                }

                const cbFun = (d, c) => {
                    let bb = d[1] % c[0],
                        aa = (d[1] - bb) / c[0];
                    aa = aa > 0 ? aa + c[1] : '';

                    return [d[0] + aa, bb];
                };

                let rslt = scale.map((d, i, a) => a.slice(i).reduce((d, c) => d * c))
                    .map((d, i) => ([d, units[i]]))
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
        let positions = [ 'left', 'center', 'right' ];
        return positions[this._settings.get_int('position-in-panel')];
    },

    _querySensors: function() {
        this._sensors.query(Lang.bind(this, function(label, value, type, format, key) {
            value = this._formatValue(value, format);

            if (this._debug)
                global.log('...label=' + label, 'value=' + value, 'type=' + type + ', format=' + format);

            this._updateDisplay(label, value, type, key);
        }));
    },

    _setProgress: function(amount) {
        let a = '00FF00';
        let b = 'FF0000';

        var ah = parseInt(a, 16),
            ar = ah >> 16, ag = ah >> 8 & 0xff, ab = ah & 0xff,
            bh = parseInt(b, 16),
            br = bh >> 16, bg = bh >> 8 & 0xff, bb = bh & 0xff,
            rr = ar + amount * (br - ar),
            rg = ag + amount * (bg - ag),
            rb = ab + amount * (bb - ab);

        return 'color:#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb | 0).toString(16).slice(1);
    },

    _onDestroy: function() {
        Mainloop.source_remove(this._refreshTimeoutId);

        for (let signal of Object.values(this._settingChangedSignals))
            this._settings.disconnect(signal);
    }
});

let vitalsMenu;

function init() {
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
