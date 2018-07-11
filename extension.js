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
const CoreStatsItem = Me.imports.coreStatsItem;

const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const CoreStatsMenuButton = new Lang.Class({
    Name: 'CoreStatsMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(St.Align.START);

        this._settings = Convenience.getSettings();

        this._sensorMenuItems = {};

        this._update_time = this._settings.get_int('update-time');

        this._utils = {
            sensors: new SensorsUtil.SensorsUtil(this._update_time)
        };

        this._sensorIcons = {
            'temperature' : Gio.icon_new_for_string(Me.path + '/icons/temperature.svg'),
            'memory' : Gio.icon_new_for_string(Me.path + '/icons/memory.svg'),
            'processor' : Gio.icon_new_for_string(Me.path + '/icons/cpu.svg'),
            'voltage' : Gio.icon_new_for_string(Me.path + '/icons/voltage.svg'),
            'fan' : Gio.icon_new_for_string(Me.path + '/icons/fan.svg')
        }

        this._menuLayout = new St.BoxLayout();
        this._hotLabels = {};
        this._hotIcons = {};

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

        let settings = ['unit', 'hot-sensors', 'use-higher-precision', 'show-fan', 'show-voltage', 'group-metrics', 'show-temperature', 'show-memory', 'show-processor', 'hide-zeros', 'alphabetize'];
        for (let setting of Object.values(settings)) {
            this._addSettingChangedSignal(setting, Lang.bind(this, this._querySensors));
        }

        this.connect('destroy', Lang.bind(this, this._onDestroy));

        // start off with fresh sensors
        this._querySensors();

        // used to query sensors and update display
        this._refreshTimeoutId = Mainloop.timeout_add_seconds(1, Lang.bind(this, function() {
            this._userInterfaceRefresh++;
            if (this._userInterfaceRefresh >= this._update_time) {
                this._querySensors();
            }

            this._updateDisplayIfNeeded();

            // read to update queue
            return true;
        }));
    },

    _createHotItem: function(key, showIcon, gicon) {
        if (showIcon) {
            let icon = this._defaultIcon(gicon);
            this._hotIcons[key] = icon;
            this._menuLayout.add(icon);
        }

        let label = new St.Label({
            text: '\u2026', /* ... */
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        this._hotLabels[key] = label;
        this._menuLayout.add(label);
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

    _updateTimeChanged : function() {
        this._update_time = this._settings.get_int('update-time');
        this._utils.sensors.update_time = this._update_time;
    },

    _addSettingChangedSignal : function(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    },

    _querySensors: function() {
        this._userInterfaceRefresh = 0;

        for (let sensor of Object.values(this._utils)) {
            if (sensor.available) {
                sensor.execute(Lang.bind(this, function() {
                    // we cannot change actor in background thread
                }));
            }
        }
    },

    _updateDisplayIfNeeded: function() {
        let needUpdate = false;
        for (let sensor of Object.values(this._utils)) {
            if (sensor.available && sensor.updated) {
                sensor.updated = false;
                needUpdate = true;
            }
        }

        if (needUpdate) {
            this._updateDisplay();
        }
    },

    _updateDisplay: function() {
        let sensors = [];
        let alphabetize = this._settings.get_boolean('alphabetize');
        let hideZeros = this._settings.get_boolean('hide-zeros');
        let headers = { 'avg': _('Average'), 'max': _('Maximum') };

        // grab lazy load desired sensors
        for (let sensorClass of Object.keys(this._sensorIcons)) {
            if (!this._settings.get_boolean('show-' + sensorClass)) continue;

            let sensorInfo = this._utils.sensors[sensorClass];
            if (sensorInfo['data'].length > 0) {
                if (alphabetize) {
                    sensorInfo['data'].sort(function(a, b) {
                        return a.label.localeCompare(b.label);
                    });
                }

                for (let header of Object.keys(headers)) {
                    if (typeof sensorInfo[header] != 'undefined' && sensorInfo[header]['value']) {
                        sensors.push({ type: sensorClass,
                                        key: '__' + sensorClass + '_' + header + '__',
                                      label: headers[header],
                                      value: this._formatValue(sensorInfo[header]['value'], sensorInfo[header]['format']) });
                    }
                }

                // loop over sensors and create single list
                for (let obj of Object.values(sensorInfo['data'])) {
                    if (hideZeros && obj.value == 0) {
                        global.log('************** skipping ' + obj.label);
                        continue;
                    }

                    sensors.push({ type: sensorClass,
                                  label: obj.label,
                                  value: this._formatValue(obj.value, obj.format) });
                }

                // add group for processor usage
                if (this._settings.get_boolean('group-metrics') && typeof sensorInfo['avg'] != 'undefined' && sensorInfo['avg']['value']) {
                    sensors.push({ type: sensorClass + '-group',
                                  label: sensorClass + '-group',
                                  value: this._formatValue(sensorInfo['avg']['value'], sensorInfo['avg']['format']) });
                }
            }
        }

        if (sensors.length > 0) {
            // apply text to menubar icons
            for (let sensor of Object.values(sensors)) {
                let label = this._hotLabels[sensor.key || sensor.label];
                if (label) label.set_text(sensor.value + ' ');
            }

            if (this._lastSensorsCount && this._lastSensorsCount == sensors.length) {
                for (let sensor of Object.values(sensors)) {
                    let item = this._sensorMenuItems[sensor.key || sensor.label];
                    if (item) {
                        if (sensor.type.includes('-group')) {
                            item.status.text = sensor.value;
                        } else {
                            item.value = sensor.value;
                            if (sensor.displayName)
                                item.display_name = sensor.displayName;
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

            item.connect('activate', function() {
                Util.spawn(["xdg-open", "https://github.com/corecoding/CoreStats"]);
            });

            this.menu.addMenuItem(item);
            this._appendSettingsMenuItem();
        }
    },

    _appendSettingsMenuItem : function() {
        let panelSystem = Main.panel.statusArea.aggregateMenu._system;
        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });

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

    _appendMenuItems : function(sensors) {
        this._lastSensorsCount = sensors.length;
        this._sensorMenuItems = {};

        let groups = {};
        let lastType = '';
        let showIcon = this._settings.get_boolean('show-icon-on-panel');

        for (let sensor of Object.values(sensors)) {
            // displays text next to group
            if (sensor.type.includes('-group')) {
                let parts = sensor.type.split('-');
                if (groups[parts[0]]) {
                    groups[parts[0]].status.text = sensor.value;
                    this._sensorMenuItems[sensor.type] = groups[parts[0]];
                }

                continue;
            }

            let key = sensor.key || sensor.label;
            let item = new CoreStatsItem.CoreStatsItem(this._sensorIcons[sensor.type], key, sensor.label, sensor.value, sensor.displayName || undefined);

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
                    this._createHotItem(self.key, showIcon, self.gicon);
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
            if (this._settings.get_boolean('group-metrics') && typeof this._sensorIcons[sensor.type] != 'undefined') {
                // groups associated sensors under accordion menu
                if (typeof groups[sensor.type] == 'undefined') {
                    groups[sensor.type] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(sensor.type)), true);
                    groups[sensor.type].icon.gicon = this._sensorIcons[sensor.type];

                    if (!groups[sensor.type].status) { // gnome 3.18 and higher
                        groups[sensor.type].status = this._defaultLabel();
                        groups[sensor.type].actor.insert_child_at_index(groups[sensor.type].status, 4);
                    }

                    this.menu.addMenuItem(groups[sensor.type]);
                }

                groups[sensor.type].menu.addMenuItem(item);
            } else {
                // add separator when not grouping metrics
                if (lastType && lastType != sensor.type && !this._settings.get_boolean('group-metrics'))
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                this.menu.addMenuItem(item);
            }

            lastType = sensor.type;
        }

        this._appendSettingsMenuItem();
    },

    _defaultLabel: function() {
        return new St.Label({
            style_class: 'popup-status-menu-item',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER });
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

        let format = '';
        let ending = '';
        let useHigherPrecision = this._settings.get_boolean('use-higher-precision');

        switch (sensorClass) {
            case 'percent':
                format = (useHigherPrecision)?'%.1f%s':'%d%s';
                ending = '%';
                break;
            case 'temp':
                let fahrenheit = (this._settings.get_string('unit') == 'fahrenheit');
                if (fahrenheit) value = this._toFahrenheit(value);
                format = (useHigherPrecision)?'%.1f%s':'%d%s';
                ending = (fahrenheit) ? "\u00b0F" : "\u00b0C";
                break;
            case 'storage':
                value = value / 1024 / 1024 / 1024;
                format = (useHigherPrecision)?'%.3f%s':'%.1f%s';
                ending = ' GiB';
                break;
            case 'rpm':
                format = '%d rpm';
                break;
            case 'volt':
                format = ((value >= 0) ? '+' : '-') + '%.2f%s';
                ending = 'V';
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

    _onDestroy: function() {
        Mainloop.source_remove(this._refreshTimeoutId);

        for (let signal of Object.values(this._settingChangedSignals)) {
            this._settings.disconnect(signal);
        };
    }
});

let coreStatsMenu;

function init(extensionMeta) {
    Convenience.initTranslations();
}

function enable() {
    coreStatsMenu = new CoreStatsMenuButton();
    let positionInPanel = coreStatsMenu.positionInPanel;
    Main.panel.addToStatusArea('coreStatsMenu', coreStatsMenu, positionInPanel == 'right' ? 0 : -1, positionInPanel);
}

function disable() {
    coreStatsMenu.destroy();
    coreStatsMenu = null;
}
