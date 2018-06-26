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
            'memory' : Gio.icon_new_for_string(Me.path + '/icons/freon-fan-symbolic.svg'),
            'processor' : Gio.icon_new_for_string(Me.path + '/icons/freon-fan-symbolic.svg')
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

        this.actor.add_actor(this._menuLayout);

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('unit', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-icon-on-panel', Lang.bind(this, this._showIconOnPanelChanged));
        this._addSettingChangedSignal('hot-sensors', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('use-higher-precision', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-fan-rpm', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-voltage', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('position-in-panel', Lang.bind(this, this._positionInPanelChanged));
        this._addSettingChangedSignal('group-metrics', Lang.bind(this, this._querySensors))

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
            for(let k in this._hotLabels) {
                let i = new St.Icon({ style_class: 'system-status-icon'});
                this._hotIcons[k] = i;
                i.gicon = this._sensorMenuItems[k].gicon;
                this._menuLayout.insert_child_at_index(i, index);
                index += 2;
            }
        } else {
            for(let k in this._hotIcons)
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

    _fixNames: function(sensors) {
        let names = [];
        for (let s of Object.values(sensors)) {
            if (s.type == 'separator'
             || s.type == 'temp-group'
             || s.type == 'mem-group'
             || s.type == 'cpu-group') continue;

            let name = s.label;
            let i = 1;

            while (names.indexOf(name) >= 0) {
                name = s.label + '-' + i++;
            }

            if (name != s.label) {
                s.displayName = s.label;
                s.label = name;
            }

            names.push(name);
        }
    },

    _updateDisplay: function() {
        let sensorsInfo = this._utils.sensors.temp;

        let fanInfo = [];
        if (this._settings.get_boolean('show-fan-rpm'))
            fanInfo = this._utils.sensors.rpm;

        let voltageInfo = [];
        if (this._settings.get_boolean('show-voltage'))
            voltageInfo = this._utils.sensors.volt;

        let memoryInfo = [];
        if (this._settings.get_boolean('show-voltage')) // TODO FIX ME
            memoryInfo = this._utils.sensors.memory;

        let processorInfo = [];
        if (this._settings.get_boolean('show-voltage')) // TODO FIX ME
            processorInfo = this._utils.sensors.processor;

        //sensorsInfo.sort(function(a,b) { return a.label.localeCompare(b.label) });
        //fanInfo.sort(function(a,b) { return a.label.localeCompare(b.label) });
        //voltageInfo.sort(function(a,b) { return a.label.localeCompare(b.label) });

        if (sensorsInfo.length > 0) {
            let total = 0;
            let sum = 0;
            let max = 0;
            for (let i of Object.values(sensorsInfo)) {
                if (i.temp !== null) {
                    total++;
                    sum += i.temp;

                    if (i.temp > max) max = i.temp;
                }
            }

            let sensors = [];

            // Add average and maximum entries
            sensors.push({type: 'temperature',
                          key: '__average__',
                          label: _("Average"),
                          value: this._formatTemp(sum/total)});

            sensors.push({type: 'temperature',
                          key: '__max__',
                          label: _("Maximum"),
                          value: this._formatTemp(max)});

            for (let i of Object.values(sensorsInfo)) {
                sensors.push({type:'temperature', label: i.label, value:this._formatTemp(i.temp)});
            }

            if (fanInfo.length > 0 || voltageInfo.length > 0)
                sensors.push({type : 'separator'});


            // assign temperature next to group header
            if (sensorsInfo.length > 0 && this._settings.get_boolean('group-metrics')) {
                sum = 0;
                for (let i of Object.values(sensorsInfo)) {
                    sum += i.temp;
                }

                sensors.push({
                    type:'temp-group',
                    label:'temp-group',
                    value: this._formatTemp(sum / sensorsInfo.length)});
            }


            for (let fan of Object.values(fanInfo)) {
                sensors.push({
                    type:'fan',
                    label:fan.label,
                    value:_("%d rpm").format(fan.rpm)});
            }

            if (fanInfo.length > 0 && voltageInfo.length > 0) {
                sensors.push({type : 'separator'});
            }

            for (let voltage of Object.values(voltageInfo)) {
                sensors.push({
                    type : 'voltage',
                    label:voltage.label,
                    value:_("%s%.2fV").format(((voltage.volt >= 0) ? '+' : '-'),
                    voltage.volt)});
            }




            if (!this._settings.get_boolean('group-metrics')) {
                sensors.push({type : 'separator'});
            }




            for (let memory of Object.values(memoryInfo)) {
                let value = memory.value;

                if (memory.format == 'percent') {
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
            } else {
                sensors.push({type : 'separator'});
            }




            for (let cpu of Object.values(processorInfo)) {
                sensors.push({
                    type: 'processor',
                    label: cpu.label,
                    value: _("%.0f%").format(cpu.value)});
            }


            this._fixNames(sensors);

            for (let s of Object.values(sensors)) {
                if (s.type != 'separator') {
                    let l = this._hotLabels[s.key || s.label];
                    if (l) l.set_text(s.value);
                }
            }

            if (this._lastSensorsCount && this._lastSensorsCount==sensors.length) {
                for (let s of Object.values(sensors)) {
                    if (s.type != 'separator') {
                        let item = this._sensorMenuItems[s.key || s.label];
                        if (item) {
                            if (s.type == 'temp-group' || s.type == 'mem-group' || s.type == 'cpu-group') {
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

        let item = new PopupMenu.PopupBaseMenuItem();
        item.actor.add(new St.Label({ text: _("Settings") }), { expand: true, x_fill: false });

        item.connect('activate', function () {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });

        this.menu.addMenuItem(item);
    },

    _appendMenuItems : function(sensors) {
        this._lastSensorsCount = sensors.length;
        this._sensorMenuItems = {};

        let needGroupTemperature = this._settings.get_boolean('group-metrics');
        let needGroupVoltage = this._settings.get_boolean('group-metrics');
        let needGroupMemory = this._settings.get_boolean('group-metrics');
        let needGroupProcessor = this._settings.get_boolean('group-metrics');

        if (needGroupVoltage) {
            let i = 0;
            for (let s of Object.values(sensors))
                if (s.type == 'voltage') i++;

            if (i < 2) needGroupVoltage = false;
        }

        let temperatureGroup = null;
        let voltageGroup = null;
        let memoryGroup = null;
        let processorGroup = null;

        for (let s of Object.values(sensors)) {
            if (s.type == 'separator') {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            } else if (s.type == 'temp-group' && temperatureGroup) {
                temperatureGroup.status.text = s.value;
                this._sensorMenuItems['temp-group'] = temperatureGroup;
            } else if (s.type == 'mem-group' && memoryGroup) {
                memoryGroup.status.text = s.value;
                this._sensorMenuItems['mem-group'] = memoryGroup;
            } else if (s.type == 'cpu-group' && processorGroup) {
                processorGroup.status.text = s.value;
                this._sensorMenuItems['cpu-group'] = processorGroup;
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

                    for(let i = hotSensors.length -1; i >= 0 ; i--) {
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

                if (needGroupTemperature && s.type == 'temperature') {

                    if (!temperatureGroup) {
                        temperatureGroup = new PopupMenu.PopupSubMenuMenuItem(_('Temperature'), true);
                        temperatureGroup.icon.gicon = this._sensorIcons['temperature'];

                        if (!temperatureGroup.status) { // gnome 3.18 and hight
                            temperatureGroup.status = this._defaultLabel();
                            temperatureGroup.actor.insert_child_at_index(temperatureGroup.status, 4);
                        }
                        this.menu.addMenuItem(temperatureGroup);
                    }
                    temperatureGroup.menu.addMenuItem(item);

                } else if (needGroupMemory && s.type == 'memory') {

                    if (!memoryGroup) {
                        memoryGroup = new PopupMenu.PopupSubMenuMenuItem(_('Memory'), true);
                        memoryGroup.icon.gicon = this._sensorIcons['temperature'];

                        if (!memoryGroup.status) { // gnome 3.18 and hight
                            memoryGroup.status = this._defaultLabel();
                            memoryGroup.actor.insert_child_at_index(memoryGroup.status, 4);
                        }
                        this.menu.addMenuItem(memoryGroup);
                    }
                    memoryGroup.menu.addMenuItem(item);

                } else if (needGroupVoltage && s.type == 'voltage') {

                    if (!voltageGroup) {
                        voltageGroup = new PopupMenu.PopupSubMenuMenuItem(_('Voltage'), true);
                        voltageGroup.icon.gicon = this._sensorIcons['voltage'];
                        this.menu.addMenuItem(voltageGroup);
                    }
                    voltageGroup.menu.addMenuItem(item);

                } else if (needGroupProcessor && s.type == 'processor') {

                    if (!processorGroup) {
                        processorGroup = new PopupMenu.PopupSubMenuMenuItem(_('Processor'), true);
                        processorGroup.icon.gicon = this._sensorIcons['temperature'];

                        if (!processorGroup.status) { // gnome 3.18 and hight
                            processorGroup.status = this._defaultLabel();
                            processorGroup.actor.insert_child_at_index(processorGroup.status, 4);
                        }
                        this.menu.addMenuItem(processorGroup);
                    }
                    processorGroup.menu.addMenuItem(item);

                } else {
                    this.menu.addMenuItem(item);
                }
            }
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
        return ((9/5)*c+32);
    },

    _formatTemp: function(value) {
        if (value === null) return 'N/A';

        if (this._settings.get_string('unit') == 'fahrenheit') {
            value = this._toFahrenheit(value);
        }

        let format = (this._settings.get_boolean('use-higher-precision'))?'%.1f':'%d';
        format += '%s';

        return format.format(value, (this._settings.get_string('unit') == 'fahrenheit') ? "\u00b0F" : "\u00b0C");
    },

    _formatMemory: function(value) {
        if (value === null) return 'N/A';

        let format = (this._settings.get_boolean('use-higher-precision'))?'%.3f':'%.1f';
        format += '%s';

        return format.format(value, ' GiB');
    },

    _formatPercent: function(value) {
        if (value === null) return 'N/A';

        let format = (this._settings.get_boolean('use-higher-precision'))?'%.1f':'%d';
        format += '%s';

        return format.format(value, '%');
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
