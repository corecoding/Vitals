const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Shell = imports.gi.Shell;
const Utilities = Me.imports.utilities

let settings;
let metadata = Me.metadata;

const SensorsItem = new Lang.Class({
    Name: 'SensorsItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(label, value) {
        this.parent({reactive: false});
        this._label = label;
        this._value = value;

        this.addActor(new St.Label({text: label}));
        this.addActor(new St.Label({text: value}), {align: St.Align.END});
    },

    getPanelString: function() {
        if(settings.get_boolean('display-label'))
            return '%s: %s'.format(this._label, this._value);
        else
            return this._value;
    },
});

const SensorsMenuButton = new Lang.Class({
    Name: 'SensorsMenuButton',

    Extends: PanelMenu.SystemStatusButton,

    _init: function(){
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'sensorsMenu');

        this._sensorsOutput = '';
        this._hddtempOutput = '';

        this.statusLabel = new St.Label({ text: '\u2026' });

        // destroy all previously created children, and add our statusLabel
        this.actor.get_children().forEach(function(c) {
            c.destroy()
        });
        this.actor.add_actor(this.statusLabel);

        this.sensorsArgv = Utilities.detectSensors();

        if (settings.get_boolean('display-hdd-temp')){
            this.hddtempArgv = Utilities.detectHDDTemp();
        }

        this._settingsChanged = settings.connect("changed", Lang.bind(this,function(){ this._querySensors(false); }));

        this._querySensors(true);
    },

    disconnectSignals: function(){
        settings.disconnect(this._settingsChanged);
    },

    _querySensors: function(recurse){
        if (this.sensorsArgv){
            this._sensorsFuture = new Utilities.Future(this.sensorsArgv, Lang.bind(this,function(stdout){
                this._sensorsOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
                this._sensorsFuture = undefined;
            }));
        }

        if (this.hddtempArgv){
            this._hddtempFuture = new Utilities.Future(this.hddtempArgv, Lang.bind(this,function(stdout){
                this._hddtempOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
                this._hddtempFuture = undefined;
            }));
        }

        if(recurse){
            Mainloop.timeout_add_seconds(settings.get_int('update-time'), Lang.bind(this, function (){
                this._querySensors(true);
            }));
        }
    },

    _updateDisplay: function(sensors_output, hddtemp_output){
        let display_fan_rpm = settings.get_boolean('display-fan-rpm');
        let display_voltage = settings.get_boolean('display-voltage');

        let tempInfo = Array();
        let fanInfo = Array();
        let voltageInfo = Array();

        tempInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseSensorsTemperatureLine);
        tempInfo = tempInfo.filter(Utilities.filterTemperature);
        if (display_fan_rpm){
            fanInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseFanRPMLine);
            fanInfo = fanInfo.filter(Utilities.filterFan);
        }
        if (display_voltage){
            voltageInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseVoltageLine);
        }

        if(this.hddtempArgv)
            tempInfo = tempInfo.concat(Utilities.parseHddTempOutput(hddtemp_output, !(/nc$/.exec(this.hddtempArgv[0])) ? ': ' : '|'));

        tempInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
        fanInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
        voltageInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });

        this.menu.box.get_children().forEach(function(c) {
            c.destroy()
        });
        let section = new PopupMenu.PopupMenuSection("Temperature");
        if (tempInfo.length > 0){
            let item;
            let sum = 0; //sum
            let max = 0; //max temp
            let sel = 'N/A'; //selected sensor temp
            for each (let temp in tempInfo){
                sum += temp['temp'];
                if (temp['temp'] > max)
                    max = temp['temp'];
                item = new SensorsItem(temp['label'], this._formatTemp(temp['temp']));
                if (temp['label'] == settings.get_string('sensor'))
                    sel = item;
                section.addMenuItem(item);
            }
            if (tempInfo.length > 0 && (fanInfo.length > 0 || voltageInfo.length > 0)){
                section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            for each (let fan in fanInfo){
                item = new SensorsItem(fan['label'], '%drpm'.format(fan['rpm']));
                if (settings.get_string('sensor') == fan['label'])
                    sel = item;
                section.addMenuItem(item);
            }
            if (fanInfo.length > 0 && voltageInfo.length > 0){
                section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            for each (let voltage in voltageInfo){
                item = new SensorsItem(voltage['label'], '%s%.2fV'.format(((voltage['volt'] >= 0) ? '+' : '-'), voltage['volt']));
                if (settings.get_string('sensor') == voltage['label'])
                    sel = item;
                section.addMenuItem(item);
            }

            let mainSensor = '';

            switch (settings.get_string('show-in-panel')) {
                case 'maximum':
                    if(settings.get_boolean('display-label'))
                        mainSensor = "Maximum: %s".format(this._formatTemp(max));
                    else
                        mainSensor = this._formatTemp(max);//or the maximum temp
                    break;
                case 'sensor':
                    mainSensor = sel.getPanelString();//or temperature from a selected sensor
                    break;
                case 'average':
                default:
                    if(settings.get_boolean('display-label'))
                        mainSensor = "Average: %s".format(this._formatTemp(sum/tempInfo.length));
                    else
                        mainSensor = this._formatTemp(sum/tempInfo.length);//average as default
                    break;
            }
            this.statusLabel.set_text(mainSensor);
        }else{
            this.statusLabel.set_text('Error');

            let item = new PopupMenu.PopupMenuItem(
                (this.sensorsArgv ? 'Please run sensors-detect as root.' : 'Please install lm_sensors.') + 'If it doesn\'t help, click here to report with your sensors output!'
            );
            item.connect('activate',function() {
                Util.spawn(["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-sensors/issues/"]);
            });
            section.addMenuItem(item);
        }

        let _appSys = Shell.AppSystem.get_default();
        let _gsmPrefs = _appSys.lookup_app('gnome-shell-extension-prefs.desktop');

        // separator
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupMenuItem(_("Sensors Settings"));
        item.connect('activate', function () {
            if (_gsmPrefs.get_state() == _gsmPrefs.SHELL_APP_STATE_RUNNING){
                _gsmPrefs.activate();
            } else {
                _gsmPrefs.launch(global.display.get_current_time_roundtrip(),
                                 [metadata.uuid],-1,null);
            }
        });
        section.addMenuItem(item);
        this.menu.addMenuItem(section);
    },


    _toFahrenheit: function(c){
        return ((9/5)*c+32);
    },

    _formatTemp: function(value) {
        if (settings.get_string('unit')=='Fahrenheit'){
            value = this._toFahrenheit(value);
        }
        let format = '%.1f';
        if (!settings.get_boolean('display-decimal-value')){
            //ret = Math.round(value);
            format = '%d';
        }
        if (settings.get_boolean('display-degree-sign')) {
            format += '%s';
        }
        return format.format(value, (settings.get_string('unit')=='Fahrenheit') ? "\u00b0F" : "\u00b0C");
    }
});

let sensorsMenu;

function init(extensionMeta) {
    settings = Convenience.getSettings();
}

function enable() {
    sensorsMenu = new SensorsMenuButton();
    Main.panel.addToStatusArea('sensorsMenu', sensorsMenu);
}

function disable() {
    sensorsMenu.disconnectSignals();
    sensorsMenu.destroy();
}
