const Lang = imports.lang;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;

const HddtempUtil = new Lang.Class({
    Name: 'HddtempUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    _init: function() {
        this.parent();
        let hddtempArgv = GLib.find_program_in_path('hddtemp');
        if(hddtempArgv) {
            // check if this user can run hddtemp directly.
            if(!GLib.spawn_command_line_sync(hddtempArgv)[3]){
                this._argv = [hddtempArgv];
                return;
            }
        }

        // doesn't seem to be the case… is it running as a daemon?
        // Check first for systemd
        let systemctl = GLib.find_program_in_path('systemctl');
        let pidof = GLib.find_program_in_path('pidof');
        let nc = GLib.find_program_in_path('nc');
        let pid = undefined;

        if(systemctl) {
            let activeState = GLib.spawn_command_line_sync(systemctl + " show hddtemp.service -p ActiveState")[1].toString().trim();
            if(activeState == "ActiveState=active") {
                let output = GLib.spawn_command_line_sync(systemctl + " show hddtemp.service -p MainPID")[1].toString().trim();

                if(output.length && output.split("=").length == 2)
                    pid = Number(output.split("=")[1].trim());
            }
        }

        // systemd isn't used on this system, try sysvinit instead
        if(!pid && pidof) {
            let output = GLib.spawn_command_line_sync("pidof hddtemp")[1].toString().trim();
            if(output.length)
                pid = Number(output.trim());
        }

        if(nc && pid) {
            // get daemon command line
            let cmdline = GLib.file_get_contents('/proc/'+pid+'/cmdline');
            // get port or assume default
            let match = /(-p\W*|--port=)(\d{1,5})/.exec(cmdline)
            let port = match ? parseInt(match[2]) : 7634;
            // use net cat to get data
            this._argv = [nc, 'localhost', port.toString()];
        }
    },

    get temp() {
        if(!this._output)
            return [];

        let sep = /nc$/.exec(this._argv[0]) ? '|' : ': ';
        let hddtempOutput = [];
        if (this._output.join().indexOf(sep+sep) > 0) {
            hddtempOutput = this._output.join().split(sep+sep);
        } else {
            hddtempOutput = this._output;
        }

        let sensors = [];
        for each(let line in hddtempOutput) {
            let fields = line.split(sep).filter(function(e){ return e; });
            let sensor = { label: fields[1], temp: parseFloat(fields[2])};
            //push only if the temp is a Number
            if (!isNaN(sensor.temp))
                sensors.push(sensor);
        }

        return sensors;
    }

});
