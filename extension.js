const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Shell = imports.gi.Shell;

let settings;
let metadata = Me.metadata;

function Sensors() {
    this._init.apply(this, arguments);
}

const SensorsItem = new Lang.Class({
    Name: 'Sensors.SensorsItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(label, value) {
        this.parent({reactive: false});

        this.addActor(new St.Label({text: label}));
        this.addActor(new St.Label({text: value}), {align: St.Align.END});
    }
});

Sensors.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,

    _init: function(){
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'sensors');

        this.statusLabel = new St.Label({
            text: "--",
            style_class: "sensors-label"
        });

        // destroy all previously created children, and add our statusLabel
        this.actor.get_children().forEach(function(c) {
            c.destroy()
        });
        this.actor.add_actor(this.statusLabel);


        let update_time  = settings.get_int('update-time');
        let display_hdd_temp  = settings.get_boolean('display-hdd-temp');

        this.sensorsPath = GLib.find_program_in_path('sensors');

        if (display_hdd_temp){
            this.hddtempPath = this._detectHDDTemp();
        }
        this.command=["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-sensors/issues/"];
        this.title = 'Error';
        if(this.sensorsPath){
            this.content='Run sensors-detect as root. If it doesn\'t help, click here to report with your sensors output!';
        }
        else{
            this.content='Please install lm_sensors. If it doesn\'t help, click here to report with your sensors output!';
        }

        this._parseFanRPMLine();
        this._parseSensorsTemperatureLine();
        this._updateDisplay();

        event = GLib.timeout_add_seconds(0, update_time, Lang.bind(this, function () {
            this._updateDisplay();
            return true;
        }));
    },

    _detectHDDTemp: function(){
        let hddtempPath = GLib.find_program_in_path('hddtemp');
        if(hddtempPath) {
            // check if this user can run hddtemp directly.
            if(!GLib.spawn_command_line_sync(hddtempPath)[3])
                return hddtempPath;
        }

        // doesn't seem to be the case… is it running as a daemon?
        let pid = GLib.spawn_command_line_sync("pidof hddtemp");
        if(pid[1].length) {
            // get daemon command line
            let cmdline = GLib.spawn_command_line_sync("ps --pid=" + pid[1] + " -o args=")[1].toString();
            // get port or assume default
            let port = (r=/(-p\W*|--port=)(\d{1,5})/.exec(cmdline)) ? parseInt(r[2]) : 7634;
            // use net cat to get data
            hddtempPath = 'nc localhost ' + port;
        }
        else
            hddtempPath = '';

        return hddtempPath;
    },

    _updateDisplay: function() {
        let display_fan_rpm  = settings.get_boolean('display-fan-rpm');
        let display_voltage  = settings.get_boolean('display-voltage');
        let tempInfo = Array();
        let fanInfo = Array();
        let voltageInfo = Array();

        if (this.sensorsPath){
            //get the output of the sensors command
            let sensors_output = GLib.spawn_command_line_sync(this.sensorsPath);
            if (sensors_output[0]){
                tempInfo = this._parseSensorsOutput(sensors_output[1].toString(),this._parseSensorsTemperatureLine.bind(this));//get temperature from sensors
                tempInfo = tempInfo.filter(function(a) { return a['temp'] > 0 && a['temp'] < 115; });
            }
            if (display_fan_rpm && sensors_output[0]){
                fanInfo = this._parseSensorsOutput(sensors_output[1].toString(),this._parseFanRPMLine.bind(this));//get fan rpm from sensors
                fanInfo = fanInfo.filter(function(a) { return a['rpm'] > 0; });
            }
            if (display_voltage && sensors_output[0]){
                voltageInfo = this._parseSensorsOutput(sensors_output[1].toString(),this._parseVoltageLine.bind(this));//get voltage from sensors
            }
        }

        if (this.hddtempPath){
            let hddtemp_output = GLib.spawn_command_line_sync(this.hddtempPath);//get the output of the hddtemp command
            if(hddtemp_output[0]){
                //get temperature from hddtemp
                tempInfo = tempInfo.concat(this._findTemperatureFromHDDTempOutput(hddtemp_output[1].toString(), (this.hddtempPath.substring(0,2) != 'nc') ? ': ' : '|'));
            }
        }

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
                if (temp['label'] == settings.get_string('sensor'))
                    sel = this._formatTemp(temp['temp']);
                item = new SensorsItem(temp['label'], this._formatTemp(temp['temp']));
                section.addMenuItem(item);
            }
            if (tempInfo.length > 0 && (fanInfo.length > 0 || voltageInfo.length > 0)){
                section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            for each (let fan in fanInfo){
                if (settings.get_string('sensor') == fan['label'])
                    sel = '%drpm'.format(fan['rpm']);
                item = new SensorsItem(fan['label'], '%drpm'.format(fan['rpm']));
                section.addMenuItem(item);
            }
            if (fanInfo.length > 0 && voltageInfo.length > 0){
                section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            for each (let voltage in voltageInfo){
               if (settings.get_string('sensor') == voltage['label'])
                    sel = '%s%.2fV'.format(((voltage['volt'] >= 0) ? '+' : '-'), voltage['volt']);
                item = new SensorsItem(voltage['label'], '%s%.2fV'.format(((voltage['volt'] >= 0) ? '+' : '-'), voltage['volt']));
                section.addMenuItem(item);
            }
            switch (settings.get_string('show-in-panel'))
            {
                case 'maximum':
                    this.title = this._formatTemp(max);//or the maximum temp
                    break;
                case 'sensor':
                    this.title = sel;//or temperature from a selected sensor
                    break;
                case 'average':
                default:
                    this.title = this._formatTemp(sum/tempInfo.length);//average as default
                    break;
            }
            this.statusLabel.set_text(this.title);
        }else{
            let command=this.command;
            let item = new PopupMenu.PopupMenuItem(this.content);
            item.connect('activate',function() {
                Util.spawn(command);
            });
            section.addMenuItem(item);
        }

        let _appSys = Shell.AppSystem.get_default();
        let _gsmPrefs = _appSys.lookup_app('gnome-shell-extension-prefs.desktop');

        // separator
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupMenuItem(_("Preferences\u2026"));
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

    _parseSensorsOutput: function(txt,parser){
        let sensors_output=txt.split("\n");
        let feature_label=undefined;
        let feature_value=undefined;
        let s= new Array();
        let n=0,c=0;
        let f;
        //iterate through each lines
        for(let i = 0; i < sensors_output.length; i++) {
            // ignore chipset driver name and 'Adapter:' line for now
            i+=2;
            // get every feature of the chip
            while(sensors_output[i]){
               // if it is not a continutation of a feature line
               if(sensors_output[i].indexOf(' ') != 0){
                  let feature = parser(feature_label, feature_value);
                  if (feature) {
                      s[n++] = feature;
                      feature = undefined;
                  }
                  [feature_label, feature_value]=sensors_output[i].split(':');
               }
               else{
                  feature_value += sensors_output[i];
               }
               i++;
            }
        }
        let feature = parser(feature_label, feature_value);
        if (feature) {
            s[n++] = feature;
            feature = undefined;
        }
        return s;
    },

    _parseSensorsTemperatureLine: function(label, value) {
        let s = undefined;
        if(label != undefined && value != undefined) {
            let curValue = value.trim().split('  ')[0];
            // does the current value look like a temperature unit (°C)?
            if(curValue.indexOf("C", curValue.length - "C".length) !== -1){
                s = new Array();
                let r;
                s['label'] = label.trim();
                s['temp'] = parseFloat(curValue.split(' ')[0]);
                s['low']  = (r = /low=\+(\d{1,3}.\d)/.exec(value))  ? parseFloat(r[1]) : undefined;
                s['high'] = (r = /high=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
                s['crit'] = (r = /crit=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
                s['hyst'] = (r = /hyst=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            }
        }
        return s;
    },

    _parseFanRPMLine: function(label, value) {
        let s = undefined;
        if(label != undefined && value != undefined) {
            let curValue = value.trim().split('  ')[0];
            // does the current value look like a temperature unit (°C)?
            if(curValue.indexOf("RPM", curValue.length - "RPM".length) !== -1){
                s = new Array();
                let r;
                s['label'] = label.trim();
                s['rpm'] = parseFloat(curValue.split(' ')[0]);
                s['min'] = (r = /min=(\d{1,5})/.exec(value)) ? parseFloat(r[1]) : undefined;
            }
        }
        return s;
    },

    _parseVoltageLine: function(label, value) {
        let s = undefined;
        if(label != undefined && value != undefined) {
            let curValue = value.trim().split('  ')[0];
            // does the current value look like a voltage unit (°C)?
            if(curValue.indexOf("V", curValue.length - "V".length) !== -1){
                s = new Array();
                let r;
                s['label'] = label.trim();
                s['volt'] = parseFloat(curValue.split(' ')[0]);
                s['min'] = (r = /min=(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
                s['max'] = (r = /max=(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            }
        }
        return s;
    },

    _findTemperatureFromHDDTempOutput: function(txt,sep){
        let hddtemp_output = txt.split("\n");
        let s = new Array();
        let n=0;
        for(let i = 0; i < hddtemp_output.length; i++)
        {
            if(hddtemp_output[i]){
                s[++n] = new Array();
                let fields = hddtemp_output[i].split(sep).filter(function(e){ return e; });
                s[n]['label'] = fields[0].split('/');
                s[n]['label'] = 'Disk %s'.format(s[n]['label'][s[n]['label'].length - 1]);
                s[n]['temp'] = parseFloat(fields[2]);
            }
        }
        return s;
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
}

function init(extensionMeta) {
    settings = Convenience.getSettings();
}

let indicator;
let event=null;

function enable() {
    indicator = new Sensors();
    Main.panel.addToStatusArea('sensors', indicator);
    //TODO catch preference change signals with settings.connect('changed::
}

function disable() {
    indicator.destroy();
    Mainloop.source_remove(event);
    indicator = null;
}
