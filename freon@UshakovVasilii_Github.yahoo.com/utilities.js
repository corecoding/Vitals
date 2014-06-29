const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

function detectSensors() {
    let path = GLib.find_program_in_path('sensors');
    return path ? [path] : undefined;
}

function detectHDDTemp() {
    let hddtempArgv = GLib.find_program_in_path('hddtemp');
    if(hddtempArgv) {
        // check if this user can run hddtemp directly.
        if(!GLib.spawn_command_line_sync(hddtempArgv)[3])
            return [hddtempArgv];
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

            if(output.length && output.split("=").length == 2) {
                pid = Number(output.split("=")[1].trim());
            }
        }
    }

    // systemd isn't used on this system, try sysvinit instead
    if(!pid && pidof) {
        let output = GLib.spawn_command_line_sync("pidof hddtemp")[1].toString().trim();

        if(output.length) {
            pid = Number(output.trim());
        }
    }

    if(nc && pid)
    {
        // get daemon command line
        let cmdline = GLib.file_get_contents('/proc/'+pid+'/cmdline');
        // get port or assume default
        let match = /(-p\W*|--port=)(\d{1,5})/.exec(cmdline)
        let port = match ? parseInt(match[2]) : 7634;
        // use net cat to get data
        return [nc, 'localhost', port.toString()];
    }

    // not found
    return undefined;
}

function detectAtiConfig() {
    let path = GLib.find_program_in_path('aticonfig');
    return path ? [path, '--odgt'] : undefined;
}

function parseSensorsOutput(txt,parser) {
    let sensors_output = txt.split("\n");
    let feature_label = undefined;
    let feature_value = undefined;
    let sensors = new Array();
    //iterate through each lines
    for(let i = 0; i < sensors_output.length; i++){
        // ignore chipset driver name and 'Adapter:' line for now
        i += 2;
        // get every feature of the chip
        while(sensors_output[i]){
           // if it is not a continutation of a feature line
           if(sensors_output[i].indexOf(' ') != 0){
              let feature = parser(feature_label, feature_value);
              if (feature){
                  sensors.push(feature);
                  feature = undefined;
              }
              [feature_label, feature_value] = sensors_output[i].split(':');
           }
           else{
              feature_value += sensors_output[i];
           }
           i++;
        }
    }
    let feature = parser(feature_label, feature_value);
    if (feature) {
        sensors.push(feature);
        feature = undefined;
    }
    return sensors;
}

function parseSensorsTemperatureLine(label, value) {
    let sensor = undefined;
    if(label != undefined && value != undefined) {
        let curValue = value.trim().split('  ')[0];
        // does the current value look like a temperature unit (°C)?
        if(curValue.indexOf("C", curValue.length - "C".length) !== -1){
            sensor = new Array();
            let r;
            sensor['label'] = label.trim();
            sensor['temp'] = parseFloat(curValue.split(' ')[0]);
            sensor['low']  = (r = /low=\+(\d{1,3}.\d)/.exec(value))  ? parseFloat(r[1]) : undefined;
            sensor['high'] = (r = /high=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            sensor['crit'] = (r = /crit=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            sensor['hyst'] = (r = /hyst=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
        }
    }
    return sensor;
}

function parseFanRPMLine(label, value) {
    let sensor = undefined;
    if(label != undefined && value != undefined) {
        let curValue = value.trim().split('  ')[0];
        // does the current value look like a fan rpm line?
        if(curValue.indexOf("RPM", curValue.length - "RPM".length) !== -1){
            sensor = new Array();
            let r;
            sensor['label'] = label.trim();
            sensor['rpm'] = parseFloat(curValue.split(' ')[0]);
            sensor['min'] = (r = /min=(\d{1,5})/.exec(value)) ? parseFloat(r[1]) : undefined;
        }
    }
    return sensor;
}

function parseVoltageLine(label, value) {
    let sensor = undefined;
    if(label != undefined && value != undefined) {
        let curValue = value.trim().split('  ')[0];
        // does the current value look like a voltage line?
        if(curValue.indexOf("V", curValue.length - "V".length) !== -1){
            sensor = new Array();
            let r;
            sensor['label'] = label.trim();
            sensor['volt'] = parseFloat(curValue.split(' ')[0]);
            sensor['min'] = (r = /min=(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            sensor['max'] = (r = /max=(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
        }
    }
    return sensor;
}

function parseHddTempOutput(txt, sep) {
    let hddtemp_output = [];
    if (txt.indexOf(sep+sep) > 0) {
        hddtemp_output = txt.split(sep+sep);
    } else {
        hddtemp_output = txt.split("\n");
    }

    hddtemp_output = hddtemp_output.filter(function(e){ return e; });

    let sensors = [];
    for each(let line in hddtemp_output) {
        let fields = line.split(sep).filter(function(e){ return e; });
        let sensor = { label: fields[1], temp: parseFloat(fields[2])};
        //push only if the temp is a Number
        if (!isNaN(sensor.temp))
            sensors.push(sensor);
    }
    return sensors;
}

/*
Default Adapter - AMD Radeon R9 200 Series     
                  Sensor 0: Temperature - 37.00 C
*/
function parseAtiConfigOutput(txt) {
    if(!txt)
        return [];
    let output = txt.split('\n');
    let label = null;
    let temp = null;
    for each(let line in output) {
        if(!line)
            continue;
        let r;
        if(line.indexOf('Adapter') > 0)
            label = (r = /Adapter \- (.*)/.exec(line)) ? r[1] : undefined;
        if(line.indexOf('Temperature') > 0)
            temp = (r = /Temperature \- (\d{1,3}.\d{1,2})/.exec(line)) ? parseFloat(r[1]) : undefined;
    }

    if(!label || !temp)
        return [];

    return [{ label : label.trim(), temp : temp}];
}

function filterTemperature(tempInfo) {
    return tempInfo['temp'] > 0 && tempInfo['temp'] < 115;
}

function filterFan(fanInfo) {
    return fanInfo['rpm'] > 0;
}

function filterVoltage(voltageInfo) {
    return true;
}

const Future = new Lang.Class({
    Name: 'Future',

    _init: function(argv, callback) {
        try{
            this._callback = callback;
            let [exit, pid, stdinFd, stdoutFd, stderrFd] =
                GLib.spawn_async_with_pipes(null, /* cwd */
                                            argv, /* args */
                                            null, /* env */
                                            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                            null /* child_setup */);
            let stdout = new Gio.UnixInputStream({fd: stdoutFd, close_fd: true});
            let outReader = new Gio.DataInputStream({base_stream: stdout});

            GLib.close(stdinFd);
            GLib.close(stderrFd);

            let childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
                let output = '';
                let [line, size] = [null, 0];
                while (([line, size] = outReader.read_line(null)) != null && line != null) {
                    output += line.toString() + '\n';
                }

                stdout.close(null);
                GLib.source_remove(childWatch);
                callback(output);
            }));
        } catch(e){
            global.log(e.toString());
        }
    }
});

