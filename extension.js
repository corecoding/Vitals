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
const CoreStatsItem = Me.imports.coreStatsItem;

const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const GLib = imports.gi.GLib;
const GTop = imports.gi.GTop;
const FileModule = Me.imports.helpers.file;

const CoreStatsMenuButton = new Lang.Class({
    Name: 'CoreStatsMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(St.Align.START);

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

        this._sensors = {};
        this._groups = {};

        this._update_time = this._settings.get_int('update-time');
        this.mem = new GTop.glibtop_mem;

        // get number of cores
        this.cpu = new GTop.glibtop_cpu;
        this.cores = GTop.glibtop_get_sysinfo().ncpu;
        this._last_sensor_query = 0;
        this._network = { 'avg': 0 };

        this.last_total = [];
        for (var i=0; i<this.cores; ++i) {
            this.last_total[i] = 0;
        }

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

        let settings = ['unit', 'hot-sensors', 'use-higher-precision', 'show-fan', 'show-voltage', 'show-temp', 'show-memory', 'show-processor', 'hide-zeros', 'alphabetize'];
        for (let setting of Object.values(settings)) {
            this._addSettingChangedSignal(setting, Lang.bind(this, this._querySensors));
        }

        this.connect('destroy', Lang.bind(this, this._onDestroy));

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
            style_class: 'corestats-menu-button-container'
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

    _rerender: function() {
        this._sensorMenuItems = {};
        this._groups = {};
        this.menu.removeAll();
        this._querySensors();
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

/*
    _pullSensorData: function() {
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
                    if (hideZeros && obj.value == 0) continue;

                    sensors.push({ type: sensorClass,
                                  label: obj.label,
                                  value: this._formatValue(obj.value, obj.format) });
                }

                // add group value
                if (typeof sensorInfo['avg'] != 'undefined' && sensorInfo['avg']['value']) {
                    sensors.push({ type: sensorClass + '-group',
                                  label: sensorClass + '-group',
                                  value: this._formatValue(sensorInfo['avg']['value'], sensorInfo['avg']['format']) });
                }
            }
        }

        this._updateDisplay(sensors);
    },
*/

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

        let item = new CoreStatsItem.CoreStatsItem(this._sensorIcons[sensor.type], key, sensor.label, sensor.value);
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
        if (typeof this._sensorIcons[sensor.type] != 'undefined') {
            this._groups[sensor.type].menu.addMenuItem(item);
        } else {
            this.menu.addMenuItem(item);
        }
    },

    _defaultLabel: function() {
        return new St.Label({
            style_class: 'corestats-status-menu-item',
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

        let kilo = 1000;
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
    },

    _addSensor: function(label, value, type, format) {
        value = this._formatValue(value, format);

        global.log('label=' + label, 'value=' + value, 'type=' + type + ', format=' + format);

        // only store sensor and update UI when new or value has changed
        if (typeof this._sensors[label] == 'undefined' || this._sensors[label]['value'] != value) {
            let key = '__' + type + '_' + label + '__';
            let sensor = { 'value': value, 'type': type, 'label': label, 'key': key }
            this._sensors[label] = sensor;
            this._updateDisplay(sensor);
        }
    },

    _querySensors: function() {
        // ************************************
        // ***** figure out last run time *****
        // ************************************
        let diff = this._update_time;
        let now = new Date().getTime();
        if (this._last_sensor_query) {
            diff = (now - this._last_sensor_query) / 1000;
            global.log('sensor query diff=' + diff);
        }

        this._last_sensor_query = now;

        // ***********************************************
        // ***** check temp, fan and voltage sensors *****
        // ***********************************************
        let sensor_types = { 'temp': 'temperature',
                               'in': 'voltage',
                              'fan': 'fan' };

        let hwbase = '/sys/class/hwmon/';




        new FileModule.File(hwbase).list().then(files => {
            for (let file of Object.values(files)) {
//                global.log('***** ' + hwbase + file);

                new FileModule.File(hwbase + file).list().then(files2 => {
                    for (let file2 of Object.values(files2)) {
                        global.log('***** ' + hwbase + file + '/' + file2);
                    }
                });


/*
                if (typeof this._network[file] == 'undefined')
                    this._network[file] = {};

                new FileModule.File(hwbase + file + '/statistics/tx_bytes').read().then(contents => {
                    if (typeof this._network[file]['tx'] != 'undefined') {
                        let speed = (contents - this._network[file]['tx']) / diff;
                        this._addSensor(file + ' tx', speed, 'network', 'speed');
                    }

                    this._network[file]['tx'] = contents;
                }).catch(err => {
                    global.log(err);
                });


                new FileModule.File(hwbase + file + '/statistics/rx_bytes').read().then(contents => {
                    if (typeof this._network[file]['rx'] != 'undefined') {
                        let speed = (contents - this._network[file]['rx']) / diff;
                        this._addSensor(file + ' rx', speed, 'network', 'speed');
                    }

                    this._network[file]['rx'] = contents;
                }).catch(err => {
                    global.log(err);
                });
*/
            }
        }).catch(err => {
            global.log(err);
        });











        for (let s = 0; s < 15; s++) {
            let path = hwbase + 'hwmon' + s + '/';

            if (!GLib.file_test(path + 'name', 1 << 4))
                break;

            for (let sensor_type of Object.keys(sensor_types)) {
                for (let k = 0; k < 8; k++) {
                    let input = sensor_type + k + '_input';

                    let value = path + input;
                    if (!GLib.file_test(value, 1 << 4)) {
                        value = path + 'device/' + input;
                        if (!GLib.file_test(value, 1 << 4)) {
                            continue;
                        }
                    }

                    let usedLabel = true;
                    let label = path + sensor_type + k + '_label';
                    if (!GLib.file_test(label, 1 << 4)) {
                        usedLabel = false;
                        label = path + 'name';
                    }

                    let file = Gio.File.new_for_path(label);
                    file.load_contents_async(null, Lang.bind(this, function(file, result) {
                        //global.log('zzzzzzzzzzzzz reading ' + label);
                        let zabel = file.load_contents_finish(result)[1].toString().trim();
                        zabel = zabel + ((usedLabel)?'':' ' + input.split('_')[0]);

                        let file2 = Gio.File.new_for_path(value);
                        file2.load_contents_async(null, Lang.bind(this, function(file, result) {
                            let value = file.load_contents_finish(result)[1];
                            //global.log('!!!!!!!!!!!!!!! label=' + zabel + ', value=' + value);
                            this._addSensor(zabel, value, sensor_types[sensor_type], sensor_type);
                        }));
                    }));
                }
            }
        }

        // ******************************
        // ***** check load average *****
        // ******************************
        //if (GLib.file_test('/proc/loadavg', 1 << 4)) {
        let file = Gio.File.new_for_path('/proc/loadavg');
        if (file.query_exists(null)) {
            file.load_contents_async(null, Lang.bind(this, function(source, result) {
                let loadString = source.load_contents_finish(result)[1].toString().trim();
                let loadArray = loadString.split(' ');
                let proc = loadArray[3].split('/');

                this._addSensor('Load 1m', loadArray[0], 'system', 'string');
                this._addSensor('Load 5m', loadArray[1], 'system', 'string');
                this._addSensor('Load 10m', loadArray[2], 'system', 'string');
                this._addSensor('Active', proc[0], 'system', 'string');
                this._addSensor('Total', proc[1], 'system', 'string');
            }));
        }

        // ******************************
        // ***** check memory usage *****
        // ******************************
        GTop.glibtop_get_mem(this.mem);

        let mem_used = this.mem.user;
        if (this.mem.slab !== undefined) mem_used -= this.mem.slab;
        let utilized = mem_used / this.mem.total * 100;
        let mem_free = this.mem.total - mem_used;

        this._addSensor('Usage', utilized, 'memory', 'percent');
        this._addSensor('Physical', this.mem.total, 'memory', 'storage');
        this._addSensor('Allocated', mem_used, 'memory', 'storage');
        this._addSensor('Available', mem_free, 'memory', 'storage');

        // ********************************
        // ***** check processor load *****
        // ********************************
        GTop.glibtop_get_cpu(this.cpu);

        let sum = 0, max = 0;
        for (var i=0; i<this.cores; ++i) {
            let total = this.cpu.xcpu_user[i];
            let delta = (total - this.last_total[i]) / diff;

            // first time poll runs risk of invalid numbers unless previous data exists
            if (this.last_total[i]) {
                this._addSensor('Core %s'.format(i), delta, 'processor', 'percent');
            }

            this.last_total[i] = total;

            // used for avg and max below
            sum += delta;
            if (delta > max) max = delta;
        }

        // don't output avg/max unless we have sensors
        //sensors['avg'] = { 'value': sum / this.cores, 'format': 'percent' };
        this._addSensor('Average', sum / this.cores, 'processor', 'percent');

/*
        file = Gio.File.new_for_uri('http://corecoding.com/utilities/what-is-my-ip.php?ipOnly=true');
        if (file.query_exists(null)) {
            file.load_contents_async(null, Lang.bind(this, function(source, result) {
                let ip = source.load_contents_finish(result)[1].toString().trim();
                this._addSensor('Public IP', ip, 'network', 'string');
            }));
        }
*/

        // *******************************
        // ***** check network speed *****
        // *******************************

        let netbase = '/sys/class/net/';
        new FileModule.File(netbase).list().then(files => {
            let avg_rx = avg_tx = 0;
            for (let file of Object.values(files)) {
                if (typeof this._network[file] == 'undefined')
                    this._network[file] = {};

                new FileModule.File(netbase + file + '/statistics/tx_bytes').read().then(contents => {
                    if (typeof this._network[file]['tx'] != 'undefined') {
                        avg_tx += contents;
                        let speed = (contents - this._network[file]['tx']) / diff;
                        this._addSensor(file + ' tx', speed, 'network', 'speed');
                    }

                    this._network[file]['tx'] = contents;
                }).catch(err => {
                    global.log(err);
                });

                new FileModule.File(netbase + file + '/statistics/rx_bytes').read().then(contents => {
                    if (typeof this._network[file]['rx'] != 'undefined') {
                        avg_rx += contents;
                        let speed = (contents - this._network[file]['rx']) / diff;
                        this._addSensor(file + ' rx', speed, 'network', 'speed');
                    }

                    this._network[file]['rx'] = contents;
                }).catch(err => {
                    global.log(err);
                });
            }

            let speed = (avg_tx - this._network['avg']['tx']) / diff;
            this._addSensor('avg tx', speed, 'network', 'speed');
            this._network['avg']['tx'] = avg_tx;

            speed = (avg_rx - this._network['avg']['rx']) / diff;
            this._addSensor('avg rx', speed, 'network', 'speed');
            this._network['avg']['tx'] = avg_rx;

        }).catch(err => {
            global.log(err);
        });
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
