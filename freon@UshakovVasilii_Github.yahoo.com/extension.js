const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Utilities = Me.imports.utilities;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

let settings;

const FreonItem = new Lang.Class({
    Name: 'FreonItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(gIcon, label, value) {
        this.parent();
        this._hasMainDot = false;

        this.connect('activate', function () {
            settings.set_string('main-sensor', label);
        });
        this._label = label;
        this._value = value;

        this.actor.add(new St.Icon({ style_class: 'system-status-icon', gicon : gIcon}));
        this.actor.add(new St.Label({text: label}), {x_fill: true, expand: true});
        this._valueLabel = new St.Label({text: value});
        this.actor.add(this._valueLabel);
    },

    addMainDot: function() {
        this.setOrnament(PopupMenu.Ornament.DOT);
        this._hasMainDot = true;
    },

    hasMainDot: function() {
        return this._hasMainDot;
    },

    removeMainDot: function() {
        this._hasMainDot = false;
        this.setOrnament(PopupMenu.Ornament.NONE);
    },

    setValue: function(value) {
        this._valueLabel.text = value;
    }
});

const FreonMenuButton = new Lang.Class({
    Name: 'FreonMenuButton',

    Extends: PanelMenu.Button,

    _init: function(){
        this.parent(null, 'sensorMenu');

        this._sensorMenuItems = {};

        this._sensorsOutput = '';
        this._hddtempOutput = '';
        this._aticonfigOutput = '';

        this._sensorIcons = {
            temperature : Gio.icon_new_for_string(Me.path + '/icons/sensors-temperature-symbolic.svg'),
            voltage : Gio.icon_new_for_string(Me.path + '/icons/sensors-voltage-symbolic.svg'),
            fan : Gio.icon_new_for_string(Me.path + '/icons/sensors-fan-symbolic.svg')
        }

        this.statusLabel = new St.Label({ text: '\u2026', y_expand: true, y_align: Clutter.ActorAlign.CENTER });

        this.actor.add_actor(this.statusLabel);

        this.sensorsArgv = Utilities.detectSensors();
        if(settings.get_boolean('show-hdd-temp'))
            this.hddtempArgv = Utilities.detectHDDTemp();
        if(settings.get_boolean('show-aticonfig-temp'))
            this.aticonfigArgv = Utilities.detectAtiConfig();

        this.udisksProxies = [];
        Utilities.UDisks.get_drive_ata_proxies(Lang.bind(this, function(proxies) {
            this.udisksProxies = proxies;
            this._updateDisplay(this._sensorsOutput, this._hddtempOutput, this._aticonfigOutput);
        }));

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('unit', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-label', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('main-sensor', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-decimal-value', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-hdd-temp', Lang.bind(this, this._showHddTempChanged));
        this._addSettingChangedSignal('show-fan-rpm', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-voltage', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-aticonfig-temp', Lang.bind(this, this._showAtiConfigChanged));

        this.connect('destroy', Lang.bind(this, this._onDestroy));

        // don't postprone the first call by update-time.
        this._querySensors();

        this._addTimer();
    },

    _updateTimeChanged : function(){
        //global.log('[FREON] readd timer');

        Mainloop.source_remove(this._timeoutId);
        this._addTimer();
    },

    _showHddTempChanged : function(){
        this.hddtempArgv = settings.get_boolean('show-hdd-temp') ? Utilities.detectHDDTemp() : undefined;
        this._querySensors();
    },

    _showAtiConfigChanged : function(){
        this.aticonfigArgv = settings.get_boolean('show-aticonfig-temp') ? Utilities.detectAtiConfig() : undefined;
        this._querySensors();
    },

    _addTimer : function(){
        this._timeoutId = Mainloop.timeout_add_seconds(settings.get_int('update-time'), Lang.bind(this, function (){
            this._querySensors();
            // readd to update queue
            return true;
        }));
    },

    _addSettingChangedSignal : function(key, callback){
        this._settingChangedSignals.push(settings.connect('changed::' + key, callback));
    },

    _onDestroy: function(){
        for each (let proxy in this.udisksProxies){
            if(proxy.drive){
                proxy.drive.run_dispose();
            }
            if(proxy.ata){
                proxy.ata.run_dispose();
            }
        }
        
        Mainloop.source_remove(this._timeoutId);

        for each (let signal in this._settingChangedSignals){
            settings.disconnect(signal);
        };
    },

    _querySensors: function(){

        if (this.sensorsArgv){
            new Utilities.Future(this.sensorsArgv, Lang.bind(this,function(stdout){
                this._sensorsOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput, this._aticonfigOutput);
            }));
        }

        if (settings.get_boolean('show-hdd-temp') && this.hddtempArgv){
            new Utilities.Future(this.hddtempArgv, Lang.bind(this,function(stdout){
                this._hddtempOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput, this._aticonfigOutput);
            }));
        }

        if (settings.get_boolean('show-aticonfig-temp') && this.aticonfigArgv){
            new Utilities.Future(this.aticonfigArgv, Lang.bind(this,function(stdout){
                this._aticonfigOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput, this._aticonfigOutput);
            }));
        }
    },

    _updateDisplay: function(sensors_output, hddtemp_output, aticonfig_output){
        let tempInfo = [];
        let fanInfo = [];
        let voltageInfo = [];

        tempInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseSensorsTemperatureLine);
        tempInfo = tempInfo.filter(Utilities.filterTemperature);
        if (settings.get_boolean('show-fan-rpm')){
            fanInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseFanRPMLine);
            fanInfo = fanInfo.filter(Utilities.filterFan);
        }
        if (settings.get_boolean('show-voltage')){
            voltageInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseVoltageLine);
        }

        if(settings.get_boolean('show-hdd-temp') && this.hddtempArgv)
            tempInfo = tempInfo.concat(Utilities.parseHddTempOutput(hddtemp_output, !(/nc$/.exec(this.hddtempArgv[0])) ? ': ' : '|'));

        if(settings.get_boolean('show-aticonfig-temp') && this.aticonfigArgv)
            tempInfo = tempInfo.concat(Utilities.parseAtiConfigOutput(aticonfig_output));

        tempInfo = tempInfo.concat(Utilities.UDisks.create_list_from_proxies(this.udisksProxies));

        tempInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
        fanInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
        voltageInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });

        if (this.sensorsArgv && tempInfo.length > 0){
            let sum = 0; //sum
            let max = 0; //max temp
            for each (let temp in tempInfo){
                sum += temp['temp'];
                if (temp['temp'] > max)
                    max = temp['temp'];
            }

            let sensorsList = [];

            for each (let temp in tempInfo){
                sensorsList.push({type:'temperature', label:temp['label'], value:this._formatTemp(temp['temp'])});
            }

            if (tempInfo.length > 0){
                sensorsList.push({type : 'separator'});

                // Add average and maximum entries
                sensorsList.push({type:'temperature', label:_("Average"), value:this._formatTemp(sum/tempInfo.length)});
                sensorsList.push({type:'temperature', label:_("Maximum"), value:this._formatTemp(max)});

                if(fanInfo.length > 0 || voltageInfo.length > 0)
                    sensorsList.push({type : 'separator'});
            }

            for each (let fan in fanInfo){
                sensorsList.push({type:'fan',label:fan['label'], value:_("%drpm").format(fan['rpm'])});
            }
            if (fanInfo.length > 0 && voltageInfo.length > 0){
                sensorsList.push({type : 'separator'});
            }
            for each (let voltage in voltageInfo){
                sensorsList.push({type : 'voltage', label:voltage['label'], value:_("%s%.2fV").format(((voltage['volt'] >= 0) ? '+' : '-'), voltage['volt'])});
            }

            let needAppendMenuItems = false;
            let mainSensor = settings.get_string('main-sensor');
            let sensorCount = 0;
            for each (let s in sensorsList) {
                if(s.type != 'separator') {
                    sensorCount++;
                    if (mainSensor == s.label) {
                        if(settings.get_boolean('show-label'))
                            this.statusLabel.set_text('%s: %s'.format(s.label, s.value));
                        else
                            this.statusLabel.set_text(s.value);

                        let item = this._sensorMenuItems[s.label];
                        if(item) {
                            if(!item.hasMainDot()){
                                global.log('[FREON] Change active sensor');
                                for each (let i in this._sensorMenuItems){
                                    i.removeMainDot();
                                }
                                item.addMainDot();
                            }
                        } else {
                            needAppendMenuItems = true;
                        }
                    }
                }
            }

            if(Object.keys(this._sensorMenuItems).length==sensorCount){
                for each (let s in sensorsList) {
                    if(s.type != 'separator') {
                        let item = this._sensorMenuItems[s.label];
                        if(item) {
                            item.setValue(s.value);
                        } else {
                            needAppendMenuItems = true;
                        }
                    }
                }
            } else {
                needAppendMenuItems = true;
            }

            if(needAppendMenuItems){
                global.log('[FREON] Render all MenuItems');
                this.menu.removeAll();
                this._appendMenuItems(sensorsList);
            }
        } else {
            this._sensorMenuItems = {};
            this.menu.removeAll();
            this.statusLabel.set_text(_("Error"));

            let item = new PopupMenu.PopupMenuItem(
                (this.sensorsArgv
                    ? _("Please run sensors-detect as root.")
                    : _("Please install lm_sensors.")) + "\n" + _("If this doesn\'t help, click here to report with your sensors output!")
            );
            item.connect('activate',function() {
                Util.spawn(["xdg-open", "https://github.com/UshakovVasilii/gnome-shell-extension-freon/issues"]);
            });
            this.menu.addMenuItem(item);
        }
    },

    _appendMenuItems : function(sensorsList){
        this._sensorMenuItems = {};
        let mainSensor = settings.get_string('main-sensor');
        for each (let s in sensorsList){
            if(s.type == 'separator'){
                 this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            } else {
                let item = new FreonItem(this._sensorIcons[s.type], s.label, s.value);
                if (mainSensor == s.label)
                    item.addMainDot();
                this._sensorMenuItems[s.label] = item;
                this.menu.addMenuItem(item);
            }
        }

        // separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupBaseMenuItem();
        // HACK: span and expand parameters don't work as expected on Label, so add an invisible
        // Label to switch columns and not totally break the layout.
        item.actor.add(new St.Label({ text: '' }));
        item.actor.add(new St.Label({ text: _("Sensors Settings") }));

        item.connect('activate', function () {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });

        this.menu.addMenuItem(item);
    },


    _toFahrenheit: function(c){
        return ((9/5)*c+32);
    },

    _formatTemp: function(value) {
        if (settings.get_string('unit')=='fahrenheit'){
            value = this._toFahrenheit(value);
        }
        let format = '%.1f';
        if (!settings.get_boolean('show-decimal-value')){
            //ret = Math.round(value);
            format = '%d';
        }
        format += '%s';
        return format.format(value, (settings.get_string('unit')=='fahrenheit') ? "\u00b0F" : "\u00b0C");
    }
});

let freonMenu;

function init(extensionMeta) {
    Convenience.initTranslations();
    settings = Convenience.getSettings();
}

function enable() {
    freonMenu = new FreonMenuButton();
    Main.panel.addToStatusArea('freonMenu', freonMenu);
}

function disable() {
    freonMenu.destroy();
    freonMenu = null;
}
