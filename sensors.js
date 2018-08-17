/*
  Copyright (c) 2018, Chris Monahan <chris@corecoding.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the GNOME nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

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

const Lang = imports.lang;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const FileModule = Me.imports.helpers.file;
const GTop = imports.gi.GTop;

var Sensors = new Lang.Class({
    Name: 'Sensors',

    _init: function(settings, sensorIcons, debug, update_time) {
        this._settings = settings;
        this._debug = debug;
        this._update_time = update_time;
        this._sensorIcons = sensorIcons;

        this.resetHistory();

        this._last_query = 0;
        this._last_cpu_user = {};
        this._network = {};
        this.storage = new GTop.glibtop_fsusage();
    },

    query: function(callback) {
        // figure out last run time
        let diff = this._update_time;
        let now = new Date().getTime();

        if (this._last_query) {
            diff = (now - this._last_query) / 1000;
            if (this._debug)
                global.log('_____ Sensors last queried ' + diff + ' seconds ago _____');
        }

        this._last_query = now;

        let sensor_types = {};
        if (this._settings.get_boolean('show-temperature'))
            sensor_types['temp'] = 'temperature';
        if (this._settings.get_boolean('show-voltage'))
            sensor_types['in'] = 'voltage';
        if (this._settings.get_boolean('show-fan'))
            sensor_types['fan'] = 'fan';

        if (Object.keys(sensor_types).length > 0)
            this._queryTempVoltFan(callback, sensor_types);

        for (let sensor in this._sensorIcons) {
            if (sensor == 'temperature' || sensor == 'voltage' || sensor == 'fan')
                continue;

            if (this._settings.get_boolean('show-' + sensor)) {
                let method = '_query' + sensor[0].toUpperCase() + sensor.slice(1);
                this[method](callback, diff);
            }
        }
    },

    _queryTempVoltFan: function(callback, sensor_types) {
        let sensor_files = [ 'input', 'label' ];
        let hwbase = '/sys/class/hwmon/';

        // a little informal, but this code has zero I/O block
        new FileModule.File(hwbase).list().then(files => {
            for (let file of Object.values(files)) {
                new FileModule.File(hwbase + file).list().then(files2 => {
                    let trisensors = {};
                    for (let file2 of Object.values(files2)) {
                        let path = hwbase + file + '/' + file2;
                        for (let key of Object.values(sensor_files)) {
                            for (let sensor_type in sensor_types) {
                                if (file2.substr(0, sensor_type.length) == sensor_type && file2.substr(-6) == '_' + key) {
                                    let key2 = file + file2.substr(0, file2.indexOf('_'));

                                    if (typeof trisensors[key2] == 'undefined') {
                                        trisensors[key2] = { 'type': sensor_types[sensor_type],
                                                           'format': sensor_type,
                                                            'label': hwbase + file + '/name' };
                                    }

                                    trisensors[key2][key] = path;
                                }
                            }
                        }
                    }

                    for (let obj of Object.values(trisensors)) {
                        new FileModule.File(obj['label']).read().then(label => {
                            new FileModule.File(obj['input']).read().then(value => {
                                let extra = (obj['label'].indexOf('_label')==-1) ? ' ' + obj['input'].substr(obj['input'].lastIndexOf('/')+1).split('_')[0] : '';

                                if (value > 0 || obj['type'] != 'fan' || (value == 0 && !this._settings.get_boolean('hide-zeros')))
                                    this._returnValue(callback, label + extra, value, obj['type'], obj['format']);
                            }).catch(err => {
                                global.log(err);
                            });
                        }).catch(err => {
                            global.log(err);
                        });
                    }
                });
            }
        }).catch(err => {
            global.log(err);
        });
    },

    _queryMemory: function(callback) {
        // check memory info
        new FileModule.File('/proc/meminfo').read().then(lines => {
            let total = 0, avail = 0, swapTotal = 0, swapFree = 0;

            let values = lines.match(/MemTotal:(\s+)(\d+) kB/);
            if (values) total = values[2] * 1024;

            values = lines.match(/MemAvailable:(\s+)(\d+) kB/);
            if (values) avail = values[2] * 1024;

            values = lines.match(/SwapTotal:(\s+)(\d+) kB/)
            if (values) swapTotal = values[2] * 1024;

            values = lines.match(/SwapFree:(\s+)(\d+) kB/)
            if (values) swapFree = values[2] * 1024;

            let used = total - avail
            let utilized = used / total * 100;

            this._returnValue(callback, 'Usage', utilized, 'memory', 'percent');
            this._returnValue(callback, 'memory', utilized, 'memory-group', 'percent');
            this._returnValue(callback, 'Physical', total, 'memory', 'storage');
            this._returnValue(callback, 'Available', avail, 'memory', 'storage');
            this._returnValue(callback, 'Allocated', used, 'memory', 'storage');
            this._returnValue(callback, 'Swap Used', swapTotal - swapFree, 'memory', 'storage');
        }).catch(err => {
            global.log(err);
        });
    },

    _queryProcessor: function(callback, diff) {
        let columns = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'guest', 'guest_nice'];

        // check processor usage
        new FileModule.File('/proc/stat').read().then(lines => {
            lines = lines.split("\n");
            let statistics = {};
            let reverse_data;

            for (let line of Object.values(lines)) {
                let reverse_data = line.match(/^(cpu\d*\s)(.+)/);
                if (reverse_data) {
                    let cpu = reverse_data[1].trim();
                    if (typeof statistics[cpu] == 'undefined')
                        statistics[cpu] = {};

                    if (typeof this._last_cpu_user[cpu] == 'undefined')
                        this._last_cpu_user[cpu] = {};

                    let stats = reverse_data[2].trim().split(' ').reverse();
                    for (let index in columns)
                        statistics[cpu][columns[index]] = stats.pop();
                }
            }

            for (let cpu in statistics) {
                let delta = (statistics[cpu]['user'] - this._last_cpu_user[cpu]) / diff;

                let label = cpu;
                if (cpu == 'cpu') {
                    delta = delta / (Object.keys(statistics).length - 1);
                    label = 'Average';
                    this._returnValue(callback, 'processor', delta, 'processor-group', 'percent');
                } else {
                    label = 'Core %s'.format(cpu.substr(3));
                }

                if (typeof this._last_cpu_user[cpu] != 'undefined') {
                    this._returnValue(callback, label, delta, 'processor', 'percent');
                }

                this._last_cpu_user[cpu] = statistics[cpu]['user'];
            }
        }).catch(err => {
            global.log(err);
        });

        // grab cpu frequency
        new FileModule.File('/proc/cpuinfo').read().then(lines => {
            lines = lines.split("\n");

            let freqs = [];
            for (let line of Object.values(lines)) {
                let value = line.match(/^cpu MHz(\s+): ([+-]?\d+(\.\d+)?)/);
                if (value) freqs.push(parseFloat(value[2]));
            }

            let sum = freqs.reduce(function(a, b) { return a + b; });
            let hertz = (sum / freqs.length) * 1000 * 1000;
            this._returnValue(callback, 'Frequency', hertz, 'processor', 'hertz');
        }).catch(err => {
            global.log(err);
        });
    },

    _querySystem: function(callback) {
        // check load average
        new FileModule.File('/proc/loadavg').read().then(contents => {
            let loadArray = contents.split(' ');
            let proc = loadArray[3].split('/');

            this._returnValue(callback, 'Load 1m', loadArray[0], 'system', 'string');
            this._returnValue(callback, 'system', loadArray[0], 'system-group', 'string');
            this._returnValue(callback, 'Load 5m', loadArray[1], 'system', 'string');
            this._returnValue(callback, 'Load 10m', loadArray[2], 'system', 'string');
            this._returnValue(callback, 'Threads Active', proc[0], 'system', 'string');
            this._returnValue(callback, 'Threads Total', proc[1], 'system', 'string');
        }).catch(err => {
            global.log(err);
        });

        // check uptime
        new FileModule.File('/proc/uptime').read().then(contents => {
            let upArray = contents.split(' ');
            this._returnValue(callback, 'Uptime', upArray[0], 'system', 'duration');

            let cores = Object.keys(this._last_cpu_user).length - 1;
            if (cores > 0) {
                this._returnValue(callback, 'Used Cycles', upArray[0] - upArray[1] / cores, 'system', 'duration');
            }
        }).catch(err => {
            global.log(err);
        });
    },

    _queryNetwork: function(callback, diff) {
        // check network speed
        let netbase = '/sys/class/net/';
        new FileModule.File(netbase).list().then(files => {
            for (let file of Object.values(files)) {
                if (typeof this._network[file] == 'undefined')
                    this._network[file] = {};

                new FileModule.File(netbase + file + '/statistics/tx_bytes').read().then(value => {
                    if (typeof this._network[file]['tx'] != 'undefined') {
                        let speed = (value - this._network[file]['tx']) / diff;
                        this._returnValue(callback, file + ' tx', speed, 'network-upload', 'speed');
                    }

                    if (value > 0 || (value == 0 && !this._settings.get_boolean('hide-zeros')))
                        this._network[file]['tx'] = value;
                }).catch(err => {
                    global.log(err);
                });

                new FileModule.File(netbase + file + '/statistics/rx_bytes').read().then(value => {
                    if (typeof this._network[file]['rx'] != 'undefined') {
                        let speed = (value - this._network[file]['rx']) / diff;
                        this._returnValue(callback, file + ' rx', speed, 'network-download', 'speed');
                    }

                    if (value > 0 || (value == 0 && !this._settings.get_boolean('hide-zeros')))
                        this._network[file]['rx'] = value;
                }).catch(err => {
                    global.log(err);
                });
            }
        }).catch(err => {
            global.log(err);
        });

        // check the public ip every hour or when waking from sleep
        if (this._next_public_ip_check <= 0) {
            this._next_public_ip_check = 3600;

            // check uptime
            new FileModule.File('http://corecoding.com/vitals.php').read().then(contents => {
                let obj = JSON.parse(contents);
                this._returnValue(callback, 'Public IP', obj['IPv4'], 'network', 'string');
            }).catch(err => {
                global.log(err);
            });
        }

        this._next_public_ip_check -= diff;
    },

    _queryStorage: function(callback) {
        GTop.glibtop_get_fsusage(this.storage, '/');

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
    },

    _returnValue: function(callback, label, value, type, format) {
        // only return sensors that are new or that need updating
        let key = '_' + type.split('-')[0] + '_' + label.replace(' ', '_').toLowerCase() + '_';
        if (typeof this._history[type][key] == 'undefined' || this._history[type][key] != value) {
            this._history[type][key] = value;
            callback(label, value, type, format, key);

            // process average values
            if (type == 'temperature' || type == 'voltage' || type == 'fan') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x));
                let sum = vals.reduce(function(a, b) { return a + b; });
                let avg = sum / vals.length;
                callback('Average', avg, type, format, '__' + type + '_avg__');
                callback(type, avg, type + '-group', format);
            } else if ((type == 'network-download' || type == 'network-upload') && format == 'speed') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x));
                let max = Math.max(...vals);
                callback('Maximum ' + (type.includes('-upload')?'tx':'rx'), max, type, format, '__max_' + type + '__');

                if (type == 'network-download')
                    callback(type, max, type + '-group', format);
            }
        }
    },

    set update_time(update_time) {
        this._update_time = update_time;
    },

    resetHistory: function() {
        this._history = {};
        for (let sensor in this._sensorIcons) {
            this._history[sensor] = {};
            this._history[sensor + '-group'] = {};

            if (sensor == 'network') {
                this._history[sensor + '-download'] = {};
                this._history[sensor + '-upload'] = {};
            }
        }

        this._next_public_ip_check = 0;
    }
});
