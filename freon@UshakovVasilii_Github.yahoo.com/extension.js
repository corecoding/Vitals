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
const Utilities = Me.imports.utilities;
const UDisks2 = Me.imports.udisks2;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const FreonItem = new Lang.Class({
    Name: 'FreonItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(gIcon, label, value) {
        this.parent();
        this._hasMainDot = false;
        this._label = label;
        this._gIcon = gIcon;

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

    getLabel: function() {
        return this._label;
    },

    getGIcon: function() {
        return this._gIcon;
    },

    setValue: function(value) {
        this._valueLabel.text = value;
    }
});

const FreonMenuButton = new Lang.Class({
    Name: 'FreonMenuButton',
    Extends: PanelMenu.Button,

    _init: function(){
        this.parent(St.Align.START);

        this._sensorMenuItems = {};

        this._sensorsOutput = '';
        this._hddtempOutput = '';
        this._aticonfigOutput = '';

        this._settings = Convenience.getSettings();

        this._sensorIcons = {
            temperature : Gio.icon_new_for_string(Me.path + '/icons/sensors-temperature-symbolic.svg'),
            voltage : Gio.icon_new_for_string(Me.path + '/icons/sensors-voltage-symbolic.svg'),
            fan : Gio.icon_new_for_string(Me.path + '/icons/sensors-fan-symbolic.svg')
        }

        this._menuLayout = new St.BoxLayout();
        if(this._settings.get_boolean('show-icon-on-panel')){
            this._icon = new St.Icon({ style_class: 'system-status-icon'});
            this._menuLayout.add(this._icon);
        }

        this.statusLabel = new St.Label({ text: '\u2026', y_expand: true, y_align: Clutter.ActorAlign.CENTER });
	this._menuLayout.add(this.statusLabel);

        this.actor.add_actor(this._menuLayout);

        this.sensorsArgv = Utilities.detectSensors();
        this._initDriveUtility();
        if(this._settings.get_boolean('show-aticonfig-temp'))
            this.aticonfigArgv = Utilities.detectAtiConfig();

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('unit', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-icon-on-panel', Lang.bind(this, this._showIconOnPanelChanged));
        this._addSettingChangedSignal('main-sensor', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-decimal-value', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-fan-rpm', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-voltage', Lang.bind(this, this._querySensors));
        this._addSettingChangedSignal('show-aticonfig-temp', Lang.bind(this, this._showAtiConfigChanged));
        this._addSettingChangedSignal('drive-utility', Lang.bind(this, this._driveUtilityChanged));

        this.connect('destroy', Lang.bind(this, this._onDestroy));

        // don't postprone the first call by update-time.
        this._querySensors();

        this._addTimer();
    },

    _showIconOnPanelChanged : function(){
        if(this._settings.get_boolean('show-icon-on-panel')) {
            this._icon = new St.Icon({ style_class: 'system-status-icon'});
            if(this._lastActiveItem)
                this._icon.gicon = this._lastActiveItem.getGIcon();
            this._menuLayout.insert_child_at_index(this._icon, 0);
        } else {
            this._icon.destroy();
            this._icon = null;
        }
    },

    _driveUtilityChanged : function(){
        this._destroyDriveUtility();
        this._initDriveUtility();
        this._querySensors();
    },

    _initDriveUtility : function(){
        switch(this._settings.get_string('drive-utility')){
            case 'hddtemp':
                this.hddtempArgv = Utilities.detectHDDTemp();
                break;
            case 'udisks2':
                this._udisks2 = new UDisks2.UDisks2(Lang.bind(this, function() {
                    this._updateDisplay();
                }));
                break;
        }
    },

    _destroyDriveUtility : function(){
        if(this._udisks2){
            this._udisks2.destroy();
            this._udisks2 = null;
        }
        this.hddtempArgv = null;
    },

    _updateTimeChanged : function(){
        Mainloop.source_remove(this._timeoutId);
        this._addTimer();
    },

    _showAtiConfigChanged : function(){
        this.aticonfigArgv = this._settings.get_boolean('show-aticonfig-temp') ? Utilities.detectAtiConfig() : undefined;
        this._querySensors();
    },

    _addTimer : function(){
        this._timeoutId = Mainloop.timeout_add_seconds(this._settings.get_int('update-time'), Lang.bind(this, function (){
            this._querySensors();
            // readd to update queue
            return true;
        }));
    },

    _addSettingChangedSignal : function(key, callback){
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    },

    _onDestroy: function(){
        this._destroyDriveUtility();
        Mainloop.source_remove(this._timeoutId);

        for each (let signal in this._settingChangedSignals){
            this._settings.disconnect(signal);
        };
    },

    _querySensors: function(){

        if (this.sensorsArgv){
            new Utilities.Future(this.sensorsArgv, Lang.bind(this,function(stdout){
                this._sensorsOutput = stdout;
                this._updateDisplay();
            }));
        }

        if (this._settings.get_string('drive-utility') == 'hddtemp' && this.hddtempArgv){
            new Utilities.Future(this.hddtempArgv, Lang.bind(this,function(stdout){
                this._hddtempOutput = stdout;
                this._updateDisplay();
            }));
        }

        if (this._settings.get_boolean('show-aticonfig-temp') && this.aticonfigArgv){
            new Utilities.Future(this.aticonfigArgv, Lang.bind(this,function(stdout){
                this._aticonfigOutput = stdout;
                this._updateDisplay();
            }));
        }
    },

    _updateDisplay: function(){
        let tempInfo = [];
        let fanInfo = [];
        let voltageInfo = [];

        tempInfo = Utilities.parseSensorsOutput(this._sensorsOutput,Utilities.parseSensorsTemperatureLine);
        tempInfo = tempInfo.filter(Utilities.filterTemperature);
        if (this._settings.get_boolean('show-fan-rpm')){
            fanInfo = Utilities.parseSensorsOutput(this._sensorsOutput,Utilities.parseFanRPMLine);
            fanInfo = fanInfo.filter(Utilities.filterFan);
        }
        if (this._settings.get_boolean('show-voltage')){
            voltageInfo = Utilities.parseSensorsOutput(this._sensorsOutput,Utilities.parseVoltageLine);
        }

        if(this._settings.get_string('drive-utility') == 'hddtemp' && this.hddtempArgv) {
            tempInfo = tempInfo.concat(Utilities.parseHddTempOutput(this._hddtempOutput, !(/nc$/.exec(this.hddtempArgv[0])) ? ': ' : '|'));
        } else if(this._settings.get_string('drive-utility') == 'udisks2'){
            tempInfo = tempInfo.concat(this._udisks2.getHDDTemp());
        }

        if(this._settings.get_boolean('show-aticonfig-temp') && this.aticonfigArgv)
            tempInfo = tempInfo.concat(Utilities.parseAtiConfigOutput(this._aticonfigOutput));

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
            let mainSensor = this._settings.get_string('main-sensor');
            let sensorCount = 0;
            for each (let s in sensorsList) {
                if(s.type != 'separator') {
                    sensorCount++;
                    if (mainSensor == s.label) {
                        this.statusLabel.set_text(s.value);

                        let item = this._sensorMenuItems[s.label];
                        if(item) {
                            if(!item.hasMainDot()){
                                global.log('[FREON] Change active sensor');
                                if(this._lastActiveItem) {
                                    this._lastActiveItem.removeMainDot();
                                }
                                this._lastActiveItem = item;
                                item.addMainDot();
                                if(this._icon)
                                    this._icon.gicon = item.getGIcon();
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
        let mainSensor = this._settings.get_string('main-sensor');
        for each (let s in sensorsList){
            if(s.type == 'separator'){
                 this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            } else {
                let item = new FreonItem(this._sensorIcons[s.type], s.label, s.value);
                item.connect('activate', Lang.bind(this, function (self) {
                    this._settings.set_string('main-sensor', self.getLabel());
                }));
                if (mainSensor == s.label) {
                    this._lastActiveItem = item;
                    item.addMainDot();
                    if(this._icon)
                        this._icon.gicon = item.getGIcon();
                }
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
        if (this._settings.get_string('unit')=='fahrenheit'){
            value = this._toFahrenheit(value);
        }
        let format = '%.1f';
        if (!this._settings.get_boolean('show-decimal-value')){
            //ret = Math.round(value);
            format = '%d';
        }
        format += '%s';
        return format.format(value, (this._settings.get_string('unit')=='fahrenheit') ? "\u00b0F" : "\u00b0C");
    }
});

let freonMenu;

function init(extensionMeta) {
    Convenience.initTranslations();
}

function enable() {
    freonMenu = new FreonMenuButton();
    Main.panel.addToStatusArea('freonMenu', freonMenu);
}

function disable() {
    freonMenu.destroy();
    freonMenu = null;
}
