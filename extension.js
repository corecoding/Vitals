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
const SensorsUtil = Me.imports.sensorsUtil;
const FreonItem = Me.imports.freonItem;

const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const FreonMenuButton = new Lang.Class({
    Name: 'FreonMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(St.Align.START);

        this._settings = Convenience.getSettings();

        this._sensorMenuItems = {};

        this._utils = {
            sensors: new SensorsUtil.SensorsUtil()
        };

        this.update_time = this._settings.get_int('update-time');

        let temperatureIcon = Gio.icon_new_for_string(Me.path + '/icons/freon-temperature-symbolic.svg');
        this._sensorIcons = {
            'temperature' : temperatureIcon,
            'voltage' : Gio.icon_new_for_string(Me.path + '/icons/freon-voltage-symbolic.svg'),
            'fan' : Gio.icon_new_for_string(Me.path + '/icons/freon-fan-symbolic.svg'),
            'memory' : Gio.icon_new_for_string(Me.path + '/icons/memory.svg'),
            'processor' : Gio.icon_new_for_string(Me.path + '/icons/cpu.svg')
        }

        this._menuLayout = new St.BoxLayout();
        this._hotLabels = {};
        this._hotIcons = {};
        let hotSensors = this._settings.get_strv('hot-sensors');

        let showIcon = this._settings.get_boolean('show-icon-on-panel');
        for (let s of Object.values(hotSensors)) {
            this._createHotItem(s, showIcon);
        }

        if (hotSensors.length == 0) {
            this._createInitialIcon();
        }

        // adds drop down arrow in menubar
        this._menuLayout.add(PopupMenu.arrowIcon(St.Side.BOTTOM));

        this.actor.add_actor(this._menuLayout);

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('show-icon-on-panel', Lang.bind(this, this._showIconOnPanelChanged));
        this._addSettingChangedSignal('position-in-panel', Lang.bind(this, this._positionInPanelChanged));

        let settings = ['unit', 'hot-sensors', 'use-higher-precision', 'show-fan-rpm', 'show-voltage', 'group-metrics', 'show-temperature', 'show-memory', 'show-processor', 'hide-zeros', 'alphabetize'];
        for (let setting of Object.values(settings)) {
            this._addSettingChangedSignal(setting, Lang.bind(this, this._querySensors));
        }

        this.connect('destroy', Lang.bind(this, this._onDestroy));

        // don't postprone the first call by update-time.
        this._querySensors();

        this._querySensorsTimer();

        this._updateUITimeoutId = Mainloop.timeout_add(1000, Lang.bind(this, function () {
            this._updateUI();

            // read to update queue
            return true;
        }));
    },

    _createHotItem: function(s, showIcon, gicon) {
        if (showIcon) {
            let i = new St.Icon({ style_class: 'system-status-icon'});
            this._hotIcons[s] = i;
            if (gicon)
                i.gicon = gicon;
            this._menuLayout.add(i);
        }
        let l = new St.Label({
            text: '\u2026', /* ... */
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._hotLabels[s] = l;
        this._menuLayout.add(l);
    },

    _createInitialIcon: function() {
        this._initialIcon = new St.Icon({ style_class: 'system-status-icon'});
        this._menuLayout.add(this._initialIcon);
    },

    _rerender : function() {
        this._needRerender = true;
        this._querySensors();
    },

    _positionInPanelChanged : function() {
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

    _showIconOnPanelChanged : function() {
        if (this._settings.get_boolean('show-icon-on-panel')) {
            let index = 0;
            for (let k in this._hotLabels) {
                let i = new St.Icon({ style_class: 'system-status-icon'});
                this._hotIcons[k] = i;
                i.gicon = this._sensorMenuItems[k].gicon;
                this._menuLayout.insert_child_at_index(i, index);
                index += 2;
            }
        } else {
            for (let k in this._hotIcons)
                this._hotIcons[k].destroy();
            this._hotIcons = {};
        }
    },

    _updateTimeChanged : function() {
        this.update_time = this._settings.get_int('update-time');
        Mainloop.source_remove(this._timeoutId);
        this._querySensorsTimer();
    },

    _querySensorsTimer : function() {
        this._timeoutId = Mainloop.timeout_add_seconds(this.update_time, Lang.bind(this, function () {
            this._querySensors();

            // read to update queue
            return true;
        }));
    },

    _addSettingChangedSignal : function(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    },

    _onDestroy: function() {
        Mainloop.source_remove(this._timeoutId);
        Mainloop.source_remove(this._updateUITimeoutId);

        for (let signal of Object.values(this._settingChangedSignals)) {
            this._settings.disconnect(signal);
        };
    },

    _querySensors: function() {
        for (let sensor of Object.values(this._utils)) {
            if (sensor.available) {
                sensor.execute(Lang.bind(this, function() {
                    // we cannot change actor in background thread #74
                }));
            }
        }
    },

    _updateUI: function() {
        let needUpdate = false;
        for (let sensor of Object.values(this._utils)) {
            if (sensor.available && sensor.updated) {
                sensor.updated = false;
                needUpdate = true;
            }
        }

        if (needUpdate) {
            this._updateDisplay(); // #74
        }
    },

    _updateDisplay: function() {
        let tempInfo = [];
        if (this._settings.get_boolean('show-temperature'))
            tempInfo = this._utils.sensors.temp;

        let fanInfo = [];
        if (this._settings.get_boolean('show-fan-rpm'))
            fanInfo = this._utils.sensors.rpm;

        let voltageInfo = [];
        if (this._settings.get_boolean('show-voltage'))
            voltageInfo = this._utils.sensors.volt;

        let memoryInfo = [];
        if (this._settings.get_boolean('show-memory'))
            memoryInfo = this._utils.sensors.memory;

        let processorInfo = [];
        if (this._settings.get_boolean('show-processor')) {
            this._utils.sensors.update_time = this.update_time;
            processorInfo = this._utils.sensors.processor;
        }

        // should we alphabetize the sensors?
        if (this._settings.get_boolean('alphabetize')) {
          tempInfo['data'].sort(function(a, b) { return a.label.localeCompare(b.label) });
          fanInfo['data'].sort(function(a, b) { return a.label.localeCompare(b.label) });
          voltageInfo['data'].sort(function(a, b) { return a.label.localeCompare(b.label) });
          memoryInfo['data'].sort(function(a, b) { return a.label.localeCompare(b.label) });
          processorInfo['data'].sort(function(a, b) { return a.label.localeCompare(b.label) });
        }

        let sensors = [];

        if (tempInfo['data'].length > 0) {
            // add average and maximum temperature entries
            sensors.push({type: 'temperature',
                           key: '__avgtemp__',
                         label: _("Average"),
                         value: this._formatTemp(tempInfo['avg'])});

            sensors.push({type: 'temperature',
                           key: '__maxtemp__',
                         label: _("Maximum"),
                         value: this._formatTemp(tempInfo['max'])});

            // add individual temperature sensors
            for (let i of Object.values(tempInfo['data'])) {
                sensors.push({type: 'temperature',
                             label: i.label,
                             value: this._formatTemp(i.value)});
            }

            // add group for temperature sensors
            if (this._settings.get_boolean('group-metrics')) {
                sensors.push({type: 'temp-group',
                             label: 'temp-group',
                             value: this._formatTemp(tempInfo['avg']) });
            }
        }

        if (fanInfo['data'].length > 0) {
            let hide_zeros = this._settings.get_boolean('hide-zeros');
            for (let fan of Object.values(fanInfo['data'])) {
                if ((fan.value > 0 && hide_zeros) || !hide_zeros) {
                sensors.push({type: 'fan',
                             label: fan.label,
                             value: _("%d rpm").format(fan.value)});
                }
            }
        }

        if (voltageInfo['data'].length > 0) {
            for (let voltage of Object.values(voltageInfo['data'])) {
                sensors.push({type: 'voltage',
                             label: voltage.label,
                             value: _("%s%.2fV").format(((voltage.value >= 0) ? '+' : '-'), voltage.value)});
            }
        }

        if (memoryInfo['data'].length > 0) {
            let utilized = 0;
            for (let memory of Object.values(memoryInfo['data'])) {
                let value = memory.value;

                if (memory.format == 'percent') {
                    utilized = value;
                    value = this._formatPercent(value);
                } else if (memory.format == 'storage') {
                    value = value / 1024 / 1024 / 1024;
                    value = this._formatMemory(value);
                }

                sensors.push({
                    type : 'memory',
                    label:memory.label,
                    value: value});
            }

            if (this._settings.get_boolean('group-metrics')) {
                // assign memory value next to group header
                sensors.push({
                    type:'mem-group',
                    label:'mem-group',
                    value: this._formatPercent(utilized)});
            }
        }

        if (processorInfo['data'].length > 0) {
            sensors.push({type: 'processor',
                           key: '__load__',
                         label: _("Load"),
                         value: this._formatPercent(processorInfo['avg'])});

            for (let cpu of Object.values(processorInfo['data'])) {
                sensors.push({
                    type: 'processor',
                    label: cpu.label,
                    value: this._formatPercent(cpu.value)});
            }

            // add group for processor usage
            if (this._settings.get_boolean('group-metrics')) {
                sensors.push({type: 'cpu-group',
                             label: 'cpu-group',
                             value: this._formatPercent(processorInfo['avg']) });
            }
        }

        if (sensors.length > 0) {
            for (let s of Object.values(sensors)) {
                let l = this._hotLabels[s.key || s.label];
                if (l) l.set_text(s.value);
            }

            if (this._lastSensorsCount && this._lastSensorsCount == sensors.length) {
                for (let s of Object.values(sensors)) {
                    let item = this._sensorMenuItems[s.key || s.label];
                    if (item) {
                        if (s.type == 'temp-group'
                         || s.type == 'mem-group'
                         || s.type == 'cpu-group'
                         || s.type == 'fan-group'
                         ) {
                            item.status.text = s.value;
                        } else {
                            item.value = s.value;
                            if (s.displayName)
                                item.display_name = s.displayName;
                        }
                    } else {
                        this._needRerender = true;
                    }
                }
            } else {
                this._needRerender = true;
            }

            if (this._needRerender) {
                this._needRerender = false;
                this.menu.removeAll();
                this._appendMenuItems(sensors);
            }
        } else {
            this._sensorMenuItems = {};
            this.menu.removeAll();

            let item = new PopupMenu.PopupMenuItem(
                this._utils.sensors.available
                    ? _("Please run sensors-detect as root.")
                    : _("Please install lm_sensors.\nIf this doesn\'t help, click here to report with your sensors output!")
            );

            item.connect('activate',function() {
                Util.spawn(["xdg-open", "https://github.com/UshakovVasilii/gnome-shell-extension-freon/wiki/Dependency"]);
            });

            this.menu.addMenuItem(item);
            this._appendSettingsMenuItem();
        }
    },

    _appendSettingsMenuItem : function() {
        // separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false
        });

        let prefsButton = Main.panel.statusArea.aggregateMenu._system._createActionButton('preferences-system-symbolic', _("Settings"));

        prefsButton.connect('clicked', function () {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });

        item.actor.add(prefsButton);

        let monitorButton = Main.panel.statusArea.aggregateMenu._system._createActionButton('utilities-system-monitor-symbolic', _("Settings"));

        monitorButton.connect('clicked', function () {
            Util.spawn(["gnome-system-monitor"]);
        });

        item.actor.add(monitorButton);

        this.menu.addMenuItem(item);
    },

    _appendMenuItems : function(sensors) {
        this._lastSensorsCount = sensors.length;
        this._sensorMenuItems = {};

        let needGroupTemperature = this._settings.get_boolean('group-metrics');
        let needGroupVoltage = this._settings.get_boolean('group-metrics');
        let needGroupMemory = this._settings.get_boolean('group-metrics');
        let needGroupProcessor = this._settings.get_boolean('group-metrics');
        let needGroupFan = this._settings.get_boolean('group-metrics');

        // TODO set booleans to false when < 2
        if (needGroupVoltage) {
            let i = 0;
            for (let s of Object.values(sensors))
                if (s.type == 'voltage') i++;

            //if (i < 2) needGroupVoltage = false;
        }

        let groups = {};
        let lastType = '';

        for (let s of Object.values(sensors)) {
            if (s.type == 'temp-group' && groups['temperature']) {
                groups['temperature'].status.text = s.value;
                this._sensorMenuItems['temp-group'] = groups['temperature'];
            } else if (s.type == 'mem-group' && groups['memory']) {
                groups['memory'].status.text = s.value;
                this._sensorMenuItems['mem-group'] = groups['memory'];
            } else if (s.type == 'cpu-group' && groups['processor']) {
                groups['processor'].status.text = s.value;
                this._sensorMenuItems['cpu-group'] = groups['processor'];
            } else if (s.type == 'fan-group' && groups['fan']) {
                groups['fan'].status.text = s.value;
                this._sensorMenuItems['fan-group'] = groups['fan'];
            } else if (s.type == 'voltage-group' && groups['voltage']) {
                groups['voltage'].status.text = s.value;
                this._sensorMenuItems['voltage-group'] = groups['voltage'];
            } else {
                let key = s.key || s.label;
                let item = new FreonItem.FreonItem(this._sensorIcons[s.type], key, s.label, s.value, s.displayName || undefined);
                item.connect('activate', Lang.bind(this, function (self) {
                    let l = this._hotLabels[self.key];
                    let hotSensors = this._settings.get_strv('hot-sensors');
                    if (l) {
                        hotSensors.splice(hotSensors.indexOf(self.key), 1);
                        delete this._hotLabels[self.key];
                        l.destroy(); // destroy is called after dict cleanup to prevent set_label on not exist actor
                        let i = this._hotIcons[self.key];
                        if (i) {
                            i.destroy();
                            delete this._hotIcons[self.key];
                        }
                        self.main = false;
                    } else {
                        hotSensors.push(self.key);
                        if (Object.keys(this._hotLabels).length == 0) {
                            this._initialIcon.destroy();
                            this._initialIcon = null;
                        }
                        let showIcon = this._settings.get_boolean('show-icon-on-panel');
                        this._createHotItem(self.key, showIcon, self.gicon);
                        self.main = true;
                    }

                    for (let i = hotSensors.length -1; i >= 0 ; i--) {
                        let k = hotSensors[i];
                        if (!this._sensorMenuItems[k]) {
                            hotSensors.splice(i, 1);
                            let ll = this._hotLabels[k]
                            delete this._hotLabels[k];
                            ll.destroy(); // destroy is called after dict cleanup to prevert set_label on not exist actor
                            if (this._hotIcons[k]) {
                                this._hotIcons[k].destroy();
                                delete this._hotIcons[k];
                            }
                        }
                    }

                    if (Object.keys(this._hotLabels).length == 0)
                        this._createInitialIcon();

                    this._settings.set_strv('hot-sensors', hotSensors.filter(
                        function(item, pos) {
                            return hotSensors.indexOf(item) == pos;
                        }));
                }));

                if (this._hotLabels[key]) {
                    item.main = true;
                    if (this._hotIcons[key])
                        this._hotIcons[key].gicon = item.gicon;
                }

                this._sensorMenuItems[key] = item;

                if ((needGroupProcessor && s.type == 'processor')
                        || (needGroupFan && s.type == 'fan')
                        || (needGroupMemory && s.type == 'memory')
                        || (needGroupVoltage && s.type == 'voltage')
                        || (needGroupTemperature && s.type == 'temperature')
                        ) {

                    // groups associated sensors under accordion menu
                    if (typeof groups[s.type] == 'undefined') {
                        groups[s.type] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(s.type)), true);
                        groups[s.type].icon.gicon = this._sensorIcons[s.type];

                        if (!groups[s.type].status) { // gnome 3.18 and hight
                            groups[s.type].status = this._defaultLabel();
                            groups[s.type].actor.insert_child_at_index(groups[s.type].status, 4);
                        }

                        this.menu.addMenuItem(groups[s.type]);
                    }

                    groups[s.type].menu.addMenuItem(item);
                } else {
                    // add separator when not grouping metrics
                    if (lastType != s.type && !this._settings.get_boolean('group-metrics'))
                        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                    this.menu.addMenuItem(item);
                }
            }

            lastType = s.type;
        }

        this._appendSettingsMenuItem();
    },

    _defaultLabel: function() {
        return new St.Label({
            style_class: 'popup-status-menu-item',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER });
    },

    _toFahrenheit: function(c) {
        return ((9 / 5) * c + 32);
    },

    _formatTemp: function(value) {
        if (value === null) return 'N/A';

        if (this._settings.get_string('unit') == 'fahrenheit') {
            value = this._toFahrenheit(value);
        }

        let format = (this._settings.get_boolean('use-higher-precision'))?'%.1f%s':'%d%s';
        return format.format(value, (this._settings.get_string('unit') == 'fahrenheit') ? "\u00b0F" : "\u00b0C");
    },

    _formatMemory: function(value) {
        if (value === null) return 'N/A';

        let format = (this._settings.get_boolean('use-higher-precision'))?'%.3f%s':'%.1f%s';
        return format.format(value, ' GiB');
    },

    _formatPercent: function(value) {
        if (value === null) return 'N/A';

        let format = (this._settings.get_boolean('use-higher-precision'))?'%.1f%s':'%d%s';
        return format.format(value, '%');
    },

    _ucFirst: function capitalizeFirstLetter(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    },

    get positionInPanel() {
        return this._settings.get_string('position-in-panel');
    }
});

let freonMenu;

function init(extensionMeta) {
    Convenience.initTranslations();
}

function enable() {
    freonMenu = new FreonMenuButton();
    let positionInPanel = freonMenu.positionInPanel;
    Main.panel.addToStatusArea('freonMenu', freonMenu, positionInPanel == 'right' ? 0 : -1, positionInPanel);
}

function disable() {
    freonMenu.destroy();
    freonMenu = null;
}
