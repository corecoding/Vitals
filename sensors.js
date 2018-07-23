const Lang = imports.lang;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const FileModule = Me.imports.helpers.file;
const GTop = imports.gi.GTop;

const Sensors = new Lang.Class({
    Name: 'Sensors',

    _init: function(update_time) {
        this._update_time = update_time;

        this._history = {};
        this._last_query = 0;
        this._last_cpu_user = {};
        this._network = { 'avg': { 'tx': 0, 'rx': 0 }};
        this._last_public_ip_check = 100;
        this.storage = new GTop.glibtop_fsusage();
    },

    query: function(callback) {
        // figure out last run time
        let diff = this._update_time;
        let now = new Date().getTime();
        if (this._last_query) {
            diff = (now - this._last_query) / 1000;
            global.log('_____ Sensors last queried ' + diff + ' seconds ago _____');
        }

        this._last_query = now;


        let sensor_types = {};
        sensor_types['temp'] = 'temperature';
        sensor_types['in'] = 'voltage';
        sensor_types['fan'] = 'fan';

        this._queryTempVoltFan(callback, sensor_types);

        this._queryMemory(callback);

        this._queryProcessor(callback, diff);

        this._querySystem(callback);

        this._queryNetwork(callback, diff);

        this._queryStorage(callback);
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
            let total = 0, avail = 0, swap = 0;
            let values;

            if (values = lines.match(/MemTotal:(\s+)(\d+) kB/))
                total = values[2] * 1024;

            if (values = lines.match(/MemAvailable:(\s+)(\d+) kB/))
                avail = values[2] * 1024;

            if (values = lines.match(/SwapCached:(\s+)(\d+) kB/))
                swap = values[2] * 1024;

            let used = total - avail
            let utilized = used / total * 100;

            this._returnValue(callback, 'Usage', utilized, 'memory', 'percent');
            this._returnValue(callback, 'Physical', total, 'memory', 'storage');
            this._returnValue(callback, 'Available', avail, 'memory', 'storage');
            this._returnValue(callback, 'Allocated', used, 'memory', 'storage');
            this._returnValue(callback, 'Swap Used', swap, 'memory', 'storage');
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
                if (reverse_data = line.match(/^(cpu\d*\s)(.+)/)) {
                    let cpu = reverse_data[1].trim();
                    if (typeof statistics[cpu] == 'undefined')
                        statistics[cpu] = {};

                    let stats = reverse_data[2].trim().split(' ').reverse();
                    for (let index in columns) {
                        statistics[cpu][columns[index]] = stats.pop();
                    }
                }
            }

            for (let cpu in statistics) {
                let delta = (statistics[cpu]['user'] - this._last_cpu_user[cpu]) / diff;

                let label = cpu;
                if (cpu == 'cpu') {
                    delta = delta / (Object.keys(statistics).length - 1);
                    label = 'Average';
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
    },

    _querySystem: function(callback) {
        // check load average
        new FileModule.File('/proc/loadavg').read().then(contents => {
            let loadArray = contents.split(' ');
            let proc = loadArray[3].split('/');

            this._returnValue(callback, 'Load 1m', loadArray[0], 'system', 'string');
            this._returnValue(callback, 'Load 5m', loadArray[1], 'system', 'string');
            this._returnValue(callback, 'Load 10m', loadArray[2], 'system', 'string');
            this._returnValue(callback, 'Active Threads', proc[0], 'system', 'string');
            this._returnValue(callback, 'Total Threads', proc[1], 'system', 'string');
        }).catch(err => {
            global.log(err);
        });

        // check uptime
        new FileModule.File('/proc/uptime').read().then(contents => {
            let upArray = contents.split(' ');
            this._returnValue(callback, 'Uptime', upArray[0], 'system', 'duration');

            let cores = Object.keys(this._last_cpu_user).length - 1;
            if (cores > 0) {
                this._returnValue(callback, 'Idle', upArray[1] / cores, 'system', 'duration');
            }
        }).catch(err => {
            global.log(err);
        });
    },

    _queryNetwork: function(callback, diff) {
        // check network speed
        let netbase = '/sys/class/net/';
        new FileModule.File(netbase).list().then(files => {
            let avg_rx = 0;
            let avg_tx = 0;

            for (let file of Object.values(files)) {
                if (typeof this._network[file] == 'undefined')
                    this._network[file] = {};

                new FileModule.File(netbase + file + '/statistics/tx_bytes').read().then(contents => {
                    if (typeof this._network[file]['tx'] != 'undefined') {
                        avg_tx = contents;
                        let speed = (contents - this._network[file]['tx']) / diff;
                        this._returnValue(callback, file + ' tx', speed, 'network', 'speed');
                    }

                    this._network[file]['tx'] = contents;
                }).catch(err => {
                    global.log(err);
                });

                new FileModule.File(netbase + file + '/statistics/rx_bytes').read().then(contents => {
                    if (typeof this._network[file]['rx'] != 'undefined') {
                        avg_rx = contents;
                        let speed = (contents - this._network[file]['rx']) / diff;
                        this._returnValue(callback, file + ' rx', speed, 'network', 'speed');
                    }

                    this._network[file]['rx'] = contents;
                }).catch(err => {
                    global.log(err);
                });
            }

            let speed = (avg_tx - this._network['avg']['tx']) / diff;
            this._returnValue(callback, 'avg tx', speed, 'network', 'speed');
            this._network['avg']['tx'] = avg_tx;

            speed = (avg_rx - this._network['avg']['rx']) / diff;
            this._returnValue(callback, 'avg rx', speed, 'network', 'speed');
            this._network['avg']['tx'] = avg_rx;
        }).catch(err => {
            global.log(err);
        });

        // check the public ip
        if (this._last_public_ip_check++ >= 100) {
            this._last_public_ip_check = 0;

            // check uptime
            new FileModule.File('http://corecoding.com/utilities/what-is-my-ip.php?ipOnly=true').read().then(ip => {
                this._returnValue(callback, 'Public IP', ip, 'network', 'string');
            }).catch(err => {
                global.log(err);
            });
        }
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
    },

    _returnValue: function(callback, label, value, type, format) {
        // only return sensors that are new or that need updating
        let key = '_' + type + '_' + label.replace(' ','_').toLowerCase() + '_';
        if (typeof this._history[key] == 'undefined' || this._history[key] != value) {
          this._history[key] = value;
          callback(label, value, type, format, key);
        }
    },

    set update_time(update_time) {
        this._update_time = update_time;
    },

    clearHistory: function() {
        this._history = {};
    }
});
