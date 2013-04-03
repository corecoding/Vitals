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
const Gio = imports.gi.Gio;
const Utilities = Me.imports.utilities

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

        this._sensorsOutput = '';
        this._hddtempOutput = '';

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

        this.sensorsArgv = Utilities.detectSensors();

        if (display_hdd_temp){
            this.hddtempArgv = Utilities.detectHDDTemp();
        }
        this.command=["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-sensors/issues/"];
        this.title = 'Error';
        if(this.sensorsArgv){
            this.content='Run sensors-detect as root. If it doesn\'t help, click here to report with your sensors output!';
        }
        else{
            this.content='Please install lm_sensors. If it doesn\'t help, click here to report with your sensors output!';
        }

        this._querySensors();

        event = GLib.timeout_add_seconds(0, update_time, Lang.bind(this, function () {
            this._querySensors();
            return true;
        }));
    },

    _sensorsReadStdout: function(){
        this._sensorsDataStdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
            if (stream.fill_finish(result) == 0){
                try{
                    this._sensorsOutput = stream.peek_buffer().toString();
                    this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
                }catch(e){
                    global.log(e.toString());
                }
                this._sensorsStdout.close(null);
                return;
            }

            stream.set_buffer_size(2 * stream.get_buffer_size());
            this._sensorsReadStdout();
        }));
    },

    _hddtempReadStdout: function(){
        this._hddtempDataStdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
            if (stream.fill_finish(result) == 0){
                try{
                    this._hddtempOutput = stream.peek_buffer().toString();
                    this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
                }catch(e){
                    global.log(e.toString());
                }
                this._hddtempStdout.close(null);
                return;
            }

            stream.set_buffer_size(2 * stream.get_buffer_size());
            this._hddtempReadStdout();
        }));
    },

    _querySensors: function(){
        if (this.sensorsArgv){
            try{
                let [exit, pid, stdin, stdout, stderr] =
                    GLib.spawn_async_with_pipes(null, /* cwd */
                                                this.sensorsArgv, /* args */
                                                null, /* env */
                                                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                null /* child_setup */);
                this._sensorsStdout = new Gio.UnixInputStream({fd: stdout, close_fd: true});
                this._sensorsDataStdout = new Gio.DataInputStream({base_stream: this._sensorsStdout});
                new Gio.UnixOutputStream({fd: stdin, close_fd: true}).close(null);
                new Gio.UnixInputStream({fd: stderr, close_fd: true}).close(null);

                this._sensorsChildWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
                    Shell.util_wifexited(status);
                    GLib.source_remove(this._sensorsChildWatch);
                }));

                this._sensorsReadStdout();
            } catch(e){
                global.log(e.toString());
            }
        }

        if (this.hddtempArgv){
            try{
                let [exit, pid, stdin, stdout, stderr] =
                    GLib.spawn_async_with_pipes(null, /* cwd */
                                                this.hddtempArgv, /* args */
                                                null, /* env */
                                                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                null /* child_setup */);
                this._hddtempStdout = new Gio.UnixInputStream({fd: stdout, close_fd: true});
                this._hddtempDataStdout = new Gio.DataInputStream({base_stream: this._hddtempStdout});
                new Gio.UnixOutputStream({fd: stdin, close_fd: true}).close(null);
                new Gio.UnixInputStream({fd: stderr, close_fd: true}).close(null);

                this._hddtempChildWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
                    Shell.util_wifexited(status);
                    GLib.source_remove(this._hddtempChildWatch);
                }));

                this._hddtempReadStdout();
            } catch(e){
                global.log(e.toString());
            }
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
