const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
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
    if (txt.indexOf((sep+sep), txt.length - (sep+sep).length))
    {
        hddtemp_output = txt.split(sep+sep);
    }
	else
    {
        hddtemp_output = txt.split("\n");
    }

    hddtemp_output = hddtemp_output.filter(function(e){ return e; });

    let sensors = new Array();
    for each(let line in hddtemp_output)
    {
        let sensor = new Array();
        let fields = line.split(sep).filter(function(e){ return e; });
        sensor['label'] = _("Drive %s").format(fields[0].split('/').pop());
        sensor['temp'] = parseFloat(fields[2]);
        //push only if the temp is a Number
        if (!isNaN(sensor['temp']))
            sensors.push(sensor);
    }
    return sensors;
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
            let [exit, pid, stdin, stdout, stderr] =
                GLib.spawn_async_with_pipes(null, /* cwd */
                                            argv, /* args */
                                            null, /* env */
                                            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                            null /* child_setup */);
            this._stdout = new Gio.UnixInputStream({fd: stdout, close_fd: true});
            this._dataStdout = new Gio.DataInputStream({base_stream: this._stdout});
            new Gio.UnixOutputStream({fd: stdin, close_fd: true}).close(null);
            new Gio.UnixInputStream({fd: stderr, close_fd: true}).close(null);

            this._childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
                GLib.source_remove(this._childWatch);
            }));

            this._readStdout();
        } catch(e){
            global.log(e.toString());
        }
    },

    _readStdout: function(){
        this._dataStdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
            if (stream.fill_finish(result) == 0){
                try{
                    this._callback(stream.peek_buffer().toString());
                }catch(e){
                    global.log(e.toString());
                }
                this._stdout.close(null);
                return;
            }

            stream.set_buffer_size(2 * stream.get_buffer_size());
            this._readStdout();
        }));
    }
});

// Poor man's async.js
const Async = {
    // mapping will be done in parallel
    map: function(arr, mapClb /* function(in, successClb)) */, resClb /* function(result) */) {
        let counter = arr.length;
        let result = [];
        for (let i = 0; i < arr.length; ++i) {
            mapClb(arr[i], (function(i, newVal) {
                result[i] = newVal;
                if (--counter == 0) resClb(result);
            }).bind(null, i)); // i needs to be bound since it will be changed during the next iteration
        }
    }
}

function debug(str){
    //tail -f -n100 ~/.cache/gdm/session.log | grep temperature
    print ('LOG temperature@xtranophilist: ' + str);
}

// routines for handling of udisks2
const UDisks = {
    // creates a list of sensor objects from the list of proxies given
    create_list_from_proxies: function(proxies) {
        return proxies.filter(function(proxy) {
            // 0K means no data available
            return proxy.ata.SmartTemperature > 0;
        }).map(function(proxy) {
            return {
                label: proxy.drive.Model,
                temp: proxy.ata.SmartTemperature - 272.15
            };
        });
    },

    // calls callback with [{ drive: UDisksDriveProxy, ata: UDisksDriveAtaProxy }, ... ] for every drive that implements both interfaces
    get_drive_ata_proxies: function(callback) {
        Gio.DBusObjectManagerClient.new(Gio.DBus.system, 0, "org.freedesktop.UDisks2", "/org/freedesktop/UDisks2", null, null, function(src, res) {
            try {
                let objMgr = Gio.DBusObjectManagerClient.new_finish(res); //might throw

                let objPaths = objMgr.get_objects().filter(function(o) {
                    return o.get_interface("org.freedesktop.UDisks2.Drive") != null
                        && o.get_interface("org.freedesktop.UDisks2.Drive.Ata") != null;
                }).map(function(o) { return o.get_object_path() });

                // now create the proxy objects, log and ignore every failure
                Async.map(objPaths, function(obj, callback) {
                    // create the proxies object
                    let driveProxy = new UDisksDriveProxy(Gio.DBus.system, "org.freedesktop.UDisks2", obj, function(res, error) {
                        if (error) { //very unlikely - we even checked the interfaces before!
                            debug("Could not create proxy on "+obj+":"+error);
                            callback(null);
                            return;
                        }
                        let ataProxy = new UDisksDriveAtaProxy(Gio.DBus.system, "org.freedesktop.UDisks2", obj, function(res, error) {
                            if (error) {
                                debug("Could not create proxy on "+obj+":"+error);
                                callback(null);
                                return;
                            }

                            callback({ drive: driveProxy, ata: ataProxy });
                        });
                    });
                }, function(proxies) {
                    // filter out failed attempts == null values
                    callback(proxies.filter(function(a) { return a != null; }));
                });
            } catch (e) {
                debug("Could not find UDisks objects: "+e);
            }
        });
    }
};

const UDisksDriveInterface = <interface name="org.freedesktop.UDisks2.Drive">
    <method name="Eject">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="SetConfiguration">
        <arg type="a{sv}" name="value" direction="in"/>
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="PowerOff">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <property type="s" name="Vendor" access="read"/>
    <property type="s" name="Model" access="read"/>
    <property type="s" name="Revision" access="read"/>
    <property type="s" name="Serial" access="read"/>
    <property type="s" name="WWN" access="read"/>
    <property type="s" name="Id" access="read"/>
    <property type="a{sv}" name="Configuration" access="read"/>
    <property type="s" name="Media" access="read"/>
    <property type="as" name="MediaCompatibility" access="read"/>
    <property type="b" name="MediaRemovable" access="read"/>
    <property type="b" name="MediaAvailable" access="read"/>
    <property type="b" name="MediaChangeDetected" access="read"/>
    <property type="t" name="Size" access="read"/>
    <property type="t" name="TimeDetected" access="read"/>
    <property type="t" name="TimeMediaDetected" access="read"/>
    <property type="b" name="Optical" access="read"/>
    <property type="b" name="OpticalBlank" access="read"/>
    <property type="u" name="OpticalNumTracks" access="read"/>
    <property type="u" name="OpticalNumAudioTracks" access="read"/>
    <property type="u" name="OpticalNumDataTracks" access="read"/>
    <property type="u" name="OpticalNumSessions" access="read"/>
    <property type="i" name="RotationRate" access="read"/>
    <property type="s" name="ConnectionBus" access="read"/>
    <property type="s" name="Seat" access="read"/>
    <property type="b" name="Removable" access="read"/>
    <property type="b" name="Ejectable" access="read"/>
    <property type="s" name="SortKey" access="read"/>
    <property type="b" name="CanPowerOff" access="read"/>
    <property type="s" name="SiblingId" access="read"/>
</interface>;
const UDisksDriveProxy = Gio.DBusProxy.makeProxyWrapper(UDisksDriveInterface);

const UDisksDriveAtaInterface = <interface name="org.freedesktop.UDisks2.Drive.Ata">
    <method name="SmartUpdate">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="SmartGetAttributes">
        <arg type="a{sv}" name="options" direction="in"/>
        <arg type="a(ysqiiixia{sv})" name="attributes" direction="out"/>
    </method>
    <method name="SmartSelftestStart">
        <arg type="s" name="type" direction="in"/>
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="SmartSelftestAbort">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="SmartSetEnabled">
        <arg type="b" name="value" direction="in"/>
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="PmGetState">
        <arg type="a{sv}" name="options" direction="in"/>
        <arg type="y" name="state" direction="out"/>
    </method>
    <method name="PmStandby">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="PmWakeup">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <method name="SecurityEraseUnit">
        <arg type="a{sv}" name="options" direction="in"/>
    </method>
    <property type="b" name="SmartSupported" access="read"/>
    <property type="b" name="SmartEnabled" access="read"/>
    <property type="t" name="SmartUpdated" access="read"/>
    <property type="b" name="SmartFailing" access="read"/>
    <property type="t" name="SmartPowerOnSeconds" access="read"/>
    <property type="d" name="SmartTemperature" access="read"/>
    <property type="i" name="SmartNumAttributesFailing" access="read"/>
    <property type="i" name="SmartNumAttributesFailedInThePast" access="read"/>
    <property type="x" name="SmartNumBadSectors" access="read"/>
    <property type="s" name="SmartSelftestStatus" access="read"/>
    <property type="i" name="SmartSelftestPercentRemaining" access="read"/>
    <property type="b" name="PmSupported" access="read"/>
    <property type="b" name="PmEnabled" access="read"/>
    <property type="b" name="ApmSupported" access="read"/>
    <property type="b" name="ApmEnabled" access="read"/>
    <property type="b" name="AamSupported" access="read"/>
    <property type="b" name="AamEnabled" access="read"/>
    <property type="i" name="AamVendorRecommendedValue" access="read"/>
    <property type="b" name="WriteCacheSupported" access="read"/>
    <property type="b" name="WriteCacheEnabled" access="read"/>
    <property type="i" name="SecurityEraseUnitMinutes" access="read"/>
    <property type="i" name="SecurityEnhancedEraseUnitMinutes" access="read"/>
    <property type="b" name="SecurityFrozen" access="read"/>
</interface>;
const UDisksDriveAtaProxy = Gio.DBusProxy.makeProxyWrapper(UDisksDriveAtaInterface);
