/*
  Copyright (c) 2018, Chris Monahan <chris@corecoding.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the GNOME nor the names of its contributors may be
      used to endorse or promote products derived from this software without
      specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const GObject = imports.gi.GObject;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const FileModule = Me.imports.helpers.file;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
const NM = imports.gi.NM;

let GTop, hasGTop = true;
try {
    GTop = imports.gi.GTop;
} catch (e) {
    global.log(e);
    hasGTop = false;
}

var Sensors = GObject.registerClass({
    GTypeName: 'Sensors',
}, class Sensors extends GObject.Object {
    _init(settings, sensorIcons) {
        this._settings = settings;
        this._sensorIcons = sensorIcons;

        this.resetHistory();

        this._last_processor = { 'core': {}, 'speed': [] };

        if (hasGTop) {
            this.storage = new GTop.glibtop_fsusage();
            this._storageDevice = '';
            this._findStorageDevice();

            this._lastRead = 0;
            this._lastWrite = 0;
        }
    }

    _refreshIPAddress(callback) {
        // check IP address
        new FileModule.File('https://corecoding.com/vitals.php').read().then(contents => {
            let obj = JSON.parse(contents);
            this._returnValue(callback, 'Public IP', obj['IPv4'], 'network', 'string');
        }).catch(err => { });
    }

    _findStorageDevice() {
        new FileModule.File('/proc/mounts').read("\n").then(lines => {
            for (let line of lines) {
                let loadArray = line.trim().split(/\s+/);
                if (loadArray[1] == this._settings.get_string('storage-path')) {
                    this._storageDevice = loadArray[0];
                    break;
                }
            }
        }).catch(err => { });
    }

    query(callback, dwell) {
        if (!this._hardware_detected) {
            // we could set _hardware_detected in discoverHardwareMonitors, but by
            // doing it here, we guarantee avoidance of race conditions
            this._hardware_detected = true;
            this._discoverHardwareMonitors(callback);
        }

        for (let sensor in this._sensorIcons) {
            if (this._settings.get_boolean('show-' + sensor)) {
                if (sensor == 'temperature' || sensor == 'voltage' || sensor == 'fan') {
                    // for temp, volt, fan, we have a shared handler
                    this._queryTempVoltFan(callback, sensor);
                } else {
                    // directly call queryFunction below
                    let method = '_query' + sensor[0].toUpperCase() + sensor.slice(1);
                    this[method](callback, dwell);
                }
            }
        }
    }

    _queryTempVoltFan(callback, type) {
        for (let label in this._tempVoltFanSensors[type]) {
            let sensor = this._tempVoltFanSensors[type][label];

            new FileModule.File(sensor['path']).read().then(value => {
                this._returnValue(callback, label, value, type, sensor['format']);
            }).catch(err => {
                this._returnValue(callback, label, 'disabled', type, sensor['format']);
            });
        }
    }

    _queryMemory(callback) {
        // check memory info
        new FileModule.File('/proc/meminfo').read().then(lines => {
            let values = '', total = 0, avail = 0, swapTotal = 0, swapFree = 0, cached = 0, memFree = 0;

            if (values = lines.match(/MemTotal:(\s+)(\d+) kB/)) total = values[2];
            if (values = lines.match(/MemAvailable:(\s+)(\d+) kB/)) avail = values[2];
            if (values = lines.match(/SwapTotal:(\s+)(\d+) kB/)) swapTotal = values[2];
            if (values = lines.match(/SwapFree:(\s+)(\d+) kB/)) swapFree = values[2];
            if (values = lines.match(/Cached:(\s+)(\d+) kB/)) cached = values[2];
            if (values = lines.match(/MemFree:(\s+)(\d+) kB/)) memFree = values[2];

            let used = total - avail
            let utilized = used / total;

            this._returnValue(callback, 'Usage', utilized, 'memory', 'percent');
            this._returnValue(callback, 'memory', utilized, 'memory-group', 'percent');
            this._returnValue(callback, 'Physical', total, 'memory', 'memory');
            this._returnValue(callback, 'Available', avail, 'memory', 'memory');
            this._returnValue(callback, 'Allocated', used, 'memory', 'memory');
            this._returnValue(callback, 'Cached', cached, 'memory', 'memory');
            this._returnValue(callback, 'Free', memFree, 'memory', 'memory');
            this._returnValue(callback, 'Swap', swapTotal - swapFree, 'memory', 'memory');
        }).catch(err => { });
    }

    _queryProcessor(callback, dwell) {
        let columns = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'guest', 'guest_nice'];

        // check processor usage
        new FileModule.File('/proc/stat').read("\n").then(lines => {
            let statistics = {};

            for (let line of lines) {
                let reverse_data = line.match(/^(cpu\d*\s)(.+)/);
                if (reverse_data) {
                    let cpu = reverse_data[1].trim();

                    if (!(cpu in statistics))
                        statistics[cpu] = {};

                    if (!(cpu in this._last_processor['core']))
                        this._last_processor['core'][cpu] = 0;

                    let stats = reverse_data[2].trim().split(' ').reverse();
                    for (let column of columns)
                        statistics[cpu][column] = parseInt(stats.pop());
                }
            }

            let cores = Object.keys(statistics).length - 1;

            for (let cpu in statistics) {
                let total = statistics[cpu]['user'] + statistics[cpu]['nice'] + statistics[cpu]['system'];

                // make sure we have data to report
                if (this._last_processor['core'][cpu] > 0) {
                    let delta = (total - this._last_processor['core'][cpu]) / dwell;

                    // /proc/stat provides overall usage for us under the 'cpu' heading
                    if (cpu == 'cpu') {
                        delta = delta / cores;
                        this._returnValue(callback, 'processor', delta / 100, 'processor-group', 'percent');
                        this._returnValue(callback, 'Usage', delta / 100, 'processor', 'percent');
                    } else {
                        this._returnValue(callback, _('Core %d').format(cpu.substr(3)), delta / 100, 'processor', 'percent');
                    }
                }

                this._last_processor['core'][cpu] = total;
            }

            // if frequency scaling is enabled, gather cpu-freq values
            if (!this._processor_uses_cpu_info) {
                for (let core = 0; core <= cores; core++) {
                    new FileModule.File('/sys/devices/system/cpu/cpu' + core + '/cpufreq/scaling_cur_freq').read().then(value => {
                        this._last_processor['speed'][core] = parseInt(value);
                    }).catch(err => { });
                }
            }
        }).catch(err => { });

        // if frequency scaling is disabled, use cpuinfo for speed
        if (this._processor_uses_cpu_info) {
            // grab CPU frequency
            new FileModule.File('/proc/cpuinfo').read("\n").then(lines => {
                let freqs = [];
                for (let line of lines) {
                    // grab megahertz
                    let value = line.match(/^cpu MHz(\s+): ([+-]?\d+(\.\d+)?)/);
                    if (value) freqs.push(parseFloat(value[2]));
                }

                let sum = freqs.reduce((a, b) => a + b);
                let hertz = (sum / freqs.length) * 1000 * 1000;
                this._returnValue(callback, 'Frequency', hertz, 'processor', 'hertz');

                //let max_hertz = Math.getMaxOfArray(freqs) * 1000 * 1000;
                //this._returnValue(callback, 'Boost', max_hertz, 'processor', 'hertz');
            }).catch(err => { });
        // if frequency scaling is enabled, cpu-freq reports
        } else if (Object.values(this._last_processor['speed']).length > 0) {
            let sum = this._last_processor['speed'].reduce((a, b) => a + b);
            let hertz = (sum / this._last_processor['speed'].length) * 1000;
            this._returnValue(callback, 'Frequency', hertz, 'processor', 'hertz');
            //let max_hertz = Math.getMaxOfArray(this._last_processor['speed']) * 1000;
            //this._returnValue(callback, 'Boost', max_hertz, 'processor', 'hertz');
        }
    }

    _querySystem(callback) {
        // check load average
        new FileModule.File('/proc/sys/fs/file-nr').read("\t").then(loadArray => {
            this._returnValue(callback, 'Open Files', loadArray[0], 'system', 'string');
        }).catch(err => { });

        // check load average
        new FileModule.File('/proc/loadavg').read(' ').then(loadArray => {
            let proc = loadArray[3].split('/');

            this._returnValue(callback, 'Load 1m', loadArray[0], 'system', 'load');
            this._returnValue(callback, 'system', loadArray[0], 'system-group', 'load');
            this._returnValue(callback, 'Load 5m', loadArray[1], 'system', 'load');
            this._returnValue(callback, 'Load 15m', loadArray[2], 'system', 'load');
            this._returnValue(callback, 'Threads Active', proc[0], 'system', 'string');
            this._returnValue(callback, 'Threads Total', proc[1], 'system', 'string');
        }).catch(err => { });

        // check uptime
        new FileModule.File('/proc/uptime').read(' ').then(upArray => {
            this._returnValue(callback, 'Uptime', upArray[0], 'system', 'uptime');

            let cores = Object.keys(this._last_processor['core']).length - 1;
            if (cores > 0)
                this._returnValue(callback, 'Process Time', upArray[0] - upArray[1] / cores, 'processor', 'uptime');
        }).catch(err => { });
    }

    _queryNetwork(callback, dwell) {
        // check network speed
        let directions = ['tx', 'rx'];
        let netbase = '/sys/class/net/';

        new FileModule.File(netbase).list().then(interfaces => {
            for (let iface of interfaces) {
                for (let direction of directions) {
                    // lo tx and rx are the same
                    if (iface == 'lo' && direction == 'rx') continue;

                    new FileModule.File(netbase + iface + '/statistics/' + direction + '_bytes').read().then(value => {
                        // issue #217 - don't include 'lo' traffic in Maximum calculations in values.js
                        // by not using network-rx or network-tx
                        let name = iface + ((iface == 'lo')?'':' ' + direction);

                        let type = 'network' + ((iface=='lo')?'':'-' + direction);
                        this._returnValue(callback, name, value, type, 'storage');
                    }).catch(err => { });
                }
            }
        }).catch(err => { });

        // some may not want public ip checking
        if (this._settings.get_boolean('include-public-ip')) {
            // check the public ip every hour or when waking from sleep
            if (this._next_public_ip_check <= 0) {
                this._next_public_ip_check = 3600;

                this._refreshIPAddress(callback);
            }

            this._next_public_ip_check -= dwell;
        }

        // wireless interface statistics
        new FileModule.File('/proc/net/wireless').read("\n", true).then(lines => {
            // wireless has two headers - first is stripped in helper function
            lines.shift();

            // if multiple wireless device, we use the last one
            for (let line of lines) {
                let netArray = line.trim().split(/\s+/);
                let quality_pct = netArray[2].substr(0, netArray[2].length-1) / 70;
                let signal = netArray[3].substr(0, netArray[3].length-1);

                this._returnValue(callback, 'WiFi Link Quality', quality_pct, 'network', 'percent');
                this._returnValue(callback, 'WiFi Signal Level', signal, 'network', 'string');
            }
        }).catch(err => { });
    }

    _queryStorage(callback, dwell) {
        // display zfs arc status, if available
        new FileModule.File('/proc/spl/kstat/zfs/arcstats').read().then(lines => {
            let values = '', target = 0, maximum = 0, current = 0;

            if (values = lines.match(/c(\s+)(\d+)(\s+)(\d+)/)) target = values[4];
            if (values = lines.match(/c_max(\s+)(\d+)(\s+)(\d+)/)) maximum = values[4];
            if (values = lines.match(/size(\s+)(\d+)(\s+)(\d+)/)) current = values[4];

            // ZFS statistics
            this._returnValue(callback, 'ARC Target', target, 'storage', 'storage');
            this._returnValue(callback, 'ARC Maximum', maximum, 'storage', 'storage');
            this._returnValue(callback, 'ARC Current', current, 'storage', 'storage');
        }).catch(err => { });

        // check disk performance stats
        new FileModule.File('/proc/diskstats').read("\n").then(lines => {
            for (let line of lines) {
                let loadArray = line.trim().split(/\s+/);
                if ('/dev/' + loadArray[2] == this._storageDevice) {
                    var read = (loadArray[5] * 512);
                    var write = (loadArray[9] * 512);
                    this._returnValue(callback, 'Read total', read, 'storage', 'storage');
                    this._returnValue(callback, 'Write total', write, 'storage', 'storage');
                    this._returnValue(callback, 'Read rate', (read - this._lastRead) / dwell, 'storage', 'storage');
                    this._returnValue(callback, 'Write rate', (write - this._lastWrite) / dwell, 'storage', 'storage');
                    this._lastRead = read;
                    this._lastWrite = write;
                    break;
                }
            }
        }).catch(err => { });

        // skip rest of stats if gtop not available
        if (!hasGTop) return;

        GTop.glibtop_get_fsusage(this.storage, this._settings.get_string('storage-path'));

        let total = this.storage.blocks * this.storage.block_size;
        let avail = this.storage.bavail * this.storage.block_size;
        let free = this.storage.bfree * this.storage.block_size;
        let used = total - free;
        let reserved = (total - avail) - used;

        this._returnValue(callback, 'Total', total, 'storage', 'storage');
        this._returnValue(callback, 'Used', used, 'storage', 'storage');
        this._returnValue(callback, 'Reserved', reserved, 'storage', 'storage');
        this._returnValue(callback, 'Free', avail, 'storage', 'storage');
        this._returnValue(callback, 'storage', avail, 'storage-group', 'storage');
    }

    _queryBattery(callback) {
        let battery_slot = this._settings.get_int('battery-slot');

        // addresses issue #161
        let battery_key = 'BAT';
        if (battery_slot == 3) {
            battery_key = 'CMB';
            battery_slot = 0;
        }

        // uevent has all necessary fields, no need to read individual files
        let battery_path = '/sys/class/power_supply/' + battery_key + battery_slot + '/uevent';
        new FileModule.File(battery_path).read("\n").then(lines => {
            let output = {};
            for (let line of lines) {
                let split = line.split('=');
                output[split[0].replace('POWER_SUPPLY_', '')] = split[1];
            }

            if ('STATUS' in output) {
                this._returnValue(callback, 'State', output['STATUS'], 'battery', '');
            }

            if ('CYCLE_COUNT' in output) {
                this._returnValue(callback, 'Cycles', output['CYCLE_COUNT'], 'battery', '');
            }

            if ('VOLTAGE_NOW' in output) {
                this._returnValue(callback, 'Voltage', output['VOLTAGE_NOW'] / 1000, 'battery', 'in');
            }

            if ('CAPACITY_LEVEL' in output) {
                this._returnValue(callback, 'Level', output['CAPACITY_LEVEL'], 'battery', '');
            }

            if ('CAPACITY' in output) {
                this._returnValue(callback, 'Percentage', output['CAPACITY'] / 100, 'battery', 'percent');
            }

            if ('VOLTAGE_NOW' in output && 'CURRENT_NOW' in output && (!('POWER_NOW' in output))) {
                output['POWER_NOW'] = (output['VOLTAGE_NOW'] * output['CURRENT_NOW']) / 1000000;
            }

            if ('POWER_NOW' in output) {
                this._returnValue(callback, 'Rate', output['POWER_NOW'], 'battery', 'watt');
                this._returnValue(callback, 'battery', output['POWER_NOW'], 'battery-group', 'watt');
            }

            if ('CHARGE_FULL' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL' in output))) {
                output['ENERGY_FULL'] = (output['CHARGE_FULL'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;
            }

            if ('ENERGY_FULL' in output) {
                this._returnValue(callback, 'Energy (full)', output['ENERGY_FULL'], 'battery', 'watt-hour');
            }

            if ('CHARGE_FULL_DESIGN' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL_DESIGN' in output))) {
                output['ENERGY_FULL_DESIGN'] = (output['CHARGE_FULL_DESIGN'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;
            }

            if ('ENERGY_FULL_DESIGN' in output) {
                this._returnValue(callback, 'Energy (design)', output['ENERGY_FULL_DESIGN'], 'battery', 'watt-hour');

                if ('ENERGY_FULL' in output) {
                    this._returnValue(callback, 'Capacity', (output['ENERGY_FULL'] / output['ENERGY_FULL_DESIGN']), 'battery', 'percent');
                }
            }

            if ('VOLTAGE_MIN_DESIGN' in output && 'CHARGE_NOW' in output && (!('ENERGY_NOW' in output))) {
                output['ENERGY_NOW'] = (output['VOLTAGE_MIN_DESIGN'] * output['CHARGE_NOW']) / 1000000;
            }

            if ('ENERGY_NOW' in output) {
                this._returnValue(callback, 'Energy (now)', output['ENERGY_NOW'], 'battery', 'watt-hour');
            }

            if ('ENERGY_FULL' in output && 'ENERGY_NOW' in output && 'POWER_NOW' in output && output['POWER_NOW'] > 0 && 'STATUS' in output && (output['STATUS'] == 'Charging' || output['STATUS'] == 'Discharging')) {

                let timeLeft = 0;

                // two different formulas depending on if we are charging or discharging
                if (output['STATUS'] == 'Charging') {
                    timeLeft = ((output['ENERGY_FULL'] - output['ENERGY_NOW']) / output['POWER_NOW']);
                } else {
                    timeLeft = (output['ENERGY_NOW'] / output['POWER_NOW']);
                }

                // don't process Infinity values
                if (timeLeft !== Infinity) {
                    if (this._battery_charge_status != output['STATUS']) {
                        // clears history due to state change
                        this._battery_time_left_history = [];

                        // clear time left history when laptop goes in and out of charging
                        this._battery_charge_status = output['STATUS'];
                    }

                    // add latest time left estimate to our history
                    this._battery_time_left_history.push(parseInt(timeLeft * 3600));

                    // keep track of last 15 time left estimates by erasing the first
                    if (this._battery_time_left_history.length > 10)
                        this._battery_time_left_history.shift();

                    // sum up and create average of our time left history
                    let sum = this._battery_time_left_history.reduce((a, b) => a + b);
                    let avg = sum / this._battery_time_left_history.length;

                    // use time left history to update screen
                    this._returnValue(callback, 'Time left', parseInt(avg), 'battery', 'runtime');
                }
            } else {
                this._returnValue(callback, 'Time left', output['STATUS'], 'battery', '');
            }
        }).catch(err => { });
    }

    _returnValue(callback, label, value, type, format) {
        // don't return if value is not a number - will revisit later
        //if (isNaN(value)) return;
        callback(label, value, type, format);
    }

    _discoverHardwareMonitors(callback) {
        this._tempVoltFanSensors = { 'temperature': {}, 'voltage': {}, 'fan': {} };

        let hwbase = '/sys/class/hwmon/';

        // process sensor_types now so it is not called multiple times below
        let sensor_types = {};

        if (this._settings.get_boolean('show-temperature'))
            sensor_types['temp'] = 'temperature';

        if (this._settings.get_boolean('show-voltage'))
            sensor_types['in'] = 'voltage';

        if (this._settings.get_boolean('show-fan'))
            sensor_types['fan'] = 'fan';

        // a little informal, but this code has zero I/O block
        new FileModule.File(hwbase).list().then(files => {
            for (let file of files) {
                // grab name of sensor
                new FileModule.File(hwbase + file + '/name').read().then(name => {
                    // are we dealing with a CPU?
                    if (name == 'coretemp') {
                        // determine which processor (socket) we are dealing with
                        new FileModule.File(hwbase + file + '/temp1_label').read().then(prefix => {
                            this._processTempVoltFan(callback, sensor_types, prefix, hwbase + file, file);
                        }).catch(err => {
                            // this shouldn't be necessary, but just in case temp1_label doesn't exist
                            // attempt to fix #266
                            this._processTempVoltFan(callback, sensor_types, name, hwbase + file, file);
                        });
                    } else {
                        // not a CPU, process all other sensors
                        this._processTempVoltFan(callback, sensor_types, name, hwbase + file, file);
                    }
                }).catch(err => {
                    new FileModule.File(hwbase + file + '/device/name').read().then(name => {
                        this._processTempVoltFan(callback, sensor_types, name, hwbase + file + '/device', file);
                    }).catch(err => { });
                });
            }
        }).catch(err => { });

        // does this system support cpu scaling? if so we will use it to grab Frequency and Boost below
        new FileModule.File('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq').read().then(value => {
            this._processor_uses_cpu_info = false;
        }).catch(err => { });

        // is static CPU information enabled?
        if (this._settings.get_boolean('include-static-info')) {
            // grab static CPU information
            new FileModule.File('/proc/cpuinfo').read("\n").then(lines => {
                let vendor_id = '';
                let bogomips = '';
                let sockets = {};
                let cache = '';

                for (let line of lines) {
                    let value = '';

                    // grab cpu vendor
                    if (value = line.match(/^vendor_id(\s+): (\w+.*)/)) vendor_id = value[2];

                    // grab bogomips
                    if (value = line.match(/^bogomips(\s+): (\d*\.?\d*)$/)) bogomips = value[2];

                    // grab processor count
                    if (value = line.match(/^physical id(\s+): (\d+)$/)) sockets[value[2]] = 1;

                    // grab cache
                    if (value = line.match(/^cache size(\s+): (\d+) KB$/)) cache = value[2];
                }

                this._returnValue(callback, 'Vendor', vendor_id, 'processor', 'string');
                this._returnValue(callback, 'Bogomips', bogomips, 'processor', 'string');
                this._returnValue(callback, 'Sockets', Object.keys(sockets).length, 'processor', 'string');
                this._returnValue(callback, 'Cache', cache, 'processor', 'memory');
            }).catch(err => { });

            // grab static CPU information
            new FileModule.File('/proc/version').read(' ').then(kernelArray => {
                this._returnValue(callback, 'Kernel', kernelArray[2], 'system', 'string');
            }).catch(err => { });
        }
    }

    _processTempVoltFan(callback, sensor_types, name, path, file) {
        let sensor_files = [ 'input', 'label' ];

        // grab files from directory
        new FileModule.File(path).list().then(files2 => {
            let trisensors = {};

            // loop over files from directory
            for (let file2 of Object.values(files2)) {
                // simple way of processing input and label (from above)
                for (let key of Object.values(sensor_files)) {
                    // process toggled on sensors from extension preferences
                    for (let sensor_type in sensor_types) {
                        if (file2.substr(0, sensor_type.length) == sensor_type && file2.substr(-(key.length+1)) == '_' + key) {
                            let key2 = file + file2.substr(0, file2.indexOf('_'));

                            if (!(key2 in trisensors)) {
                                trisensors[key2] = {
                                    'type': sensor_types[sensor_type],
                                  'format': sensor_type,
                                   'label': path + '/name'
                                };
                            }

                            trisensors[key2][key] = path + '/' + file2;
                        }
                    }
                }
            }

            for (let obj of Object.values(trisensors)) {
                if (!('input' in obj))
                    continue;

                new FileModule.File(obj['input']).read().then(value => {
                    let extra = (obj['label'].indexOf('_label')==-1) ? ' ' + obj['input'].substr(obj['input'].lastIndexOf('/')+1).split('_')[0] : '';

                    if (value > 0 || !this._settings.get_boolean('hide-zeros') || obj['type'] == 'fan') {
                        new FileModule.File(obj['label']).read().then(label => {
                            this._addTempVoltFan(callback, obj, name, label, extra, value);
                        }).catch(err => {
                            let tmpFile = obj['label'].substr(0, obj['label'].lastIndexOf('/')) + '/name';
                            new FileModule.File(tmpFile).read().then(label => {
                                this._addTempVoltFan(callback, obj, name, label, extra, value);
                            }).catch(err => { });
                        });
                    }
                }).catch(err => { });
            }
        }).catch(err => { });
    }

    _addTempVoltFan(callback, obj, name, label, extra, value) {
        // prepend module that provided sensor data
        if (name != label) label = name + ' ' + label;

        //if (label == 'nvme Composite') label = 'NVMe';
        //if (label == 'nouveau') label = 'Nvidia';

        label = label + extra;

        // in the future we will read /etc/sensors3.conf
        if (label == 'acpitz temp1') label = 'ACPI Thermal Zone';
        if (label == 'pch_cannonlake temp1') label = 'Platform Controller Hub';
        if (label == 'iwlwifi_1 temp1') label = 'Wireless Adapter';
        if (label == 'Package id 0') label = 'Processor 0';
        if (label == 'Package id 1') label = 'Processor 1';
        label = label.replace('Package id', 'CPU');

        let types = [ 'temperature', 'voltage', 'fan' ];
        for (let type of types) {
            // check if this label already exists
            if (label in this._tempVoltFanSensors[type]) {
                for (let i = 2; i <= 9; i++) {
                    // append an incremented number to end
                    let new_label = label + ' ' + i;

                    // if new label is available, use it
                    if (!(new_label in this._tempVoltFanSensors[type])) {
                        label = new_label;
                        break;
                    }
                }
            }
        }

        // update screen on initial build to prevent delay on update
        this._returnValue(callback, label, value, obj['type'], obj['format']);

        this._tempVoltFanSensors[obj['type']][label] = {
          'format': obj['format'],
            'path': obj['input']
        };
    }

    resetHistory() {
        this._next_public_ip_check = 0;
        this._hardware_detected = false;
        this._processor_uses_cpu_info = true;
        this._battery_time_left_history = [];
        this._battery_charge_status = '';
    }
});
