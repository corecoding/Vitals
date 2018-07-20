const Lang = imports.lang;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const FileModule = Me.imports.helpers.file;
const GTop = imports.gi.GTop;
const Gio = imports.gi.Gio;

const Sensors = new Lang.Class({
    Name: 'Sensors',

    _init: function(update_time) {
        this._update_time = update_time;

        this._mem = new GTop.glibtop_mem;

        // get number of cores
        this._cpu = new GTop.glibtop_cpu;
        this._cores = GTop.glibtop_get_sysinfo().ncpu;
        this._last_sensor_query = 0;
        this._network = { 'avg': { 'tx': 0, 'rx': 0 }};

        this._last_total = [];
        for (var i=0; i<this._cores; ++i) {
            this._last_total[i] = 0;
        }

        this._last_public_ip_check = 100;
    },

    execute: function(callback) {
        // figure out last run time
        let diff = this._update_time;
        let now = new Date().getTime();
        if (this._last_sensor_query) {
            diff = (now - this._last_sensor_query) / 1000;
            global.log('_____ Sensors last queried ' + diff + ' seconds ago _____');
        }

        this._last_sensor_query = now;

        // ****************************************
        // ***** temperature, voltage and fan *****
        // ****************************************

        // check temp, fan and voltage sensors
        let sensor_types = { 'temp': 'temperature',
                               'in': 'voltage',
                              'fan': 'fan' };
        let sensor_files = [ 'input', 'label' ];

        let hwbase = '/sys/class/hwmon/';

        new FileModule.File(hwbase).list().then(files => {
            for (let file of Object.values(files)) {
                new FileModule.File(hwbase + file).list().then(files2 => {
                    //global.log('*********** ' + file + ' ***********************************');

                    let trisensors = {};
                    for (let file2 of Object.values(files2)) {
                        let path = hwbase + file + '/' + file2;
                        //global.log('!!! ' + path + ' !!!');

                        for (let key of Object.values(sensor_files)) {
                            for (let sensor_type of Object.keys(sensor_types)) {
                                //global.log('1 comparing ' + file2.substr(0, sensor_type.length) + ' to ' + sensor_type);
                                //global.log('2 comparing ' + file2.substr(-6) + ' to _' + key);
                                if (file2.substr(0, sensor_type.length) == sensor_type && file2.substr(-6) == '_' + key) {
                                    let key2 = file + file2.substr(0, file2.indexOf('_'));

                                    if (typeof trisensors[key2] == 'undefined') {
                                        trisensors[key2] = { 'type': sensor_types[sensor_type], 'format': sensor_type, 'label': hwbase + file + '/name' };
                                    }

                                    //global.log('found ' + key + ' for ' + sensor_type + ' ' + file2 + ', ' + path + ', ' + hwbase);
                                    //global.log(key2 + ' = ' + key + ' for ' + sensor_type + ' ' + file2 + ', ' + path + ', ' + hwbase);

                                    trisensors[key2][key] = path;
                                }
                            }
                        }
                    }

                    for (let obj of Object.values(trisensors)) {
                        new FileModule.File(obj['label']).read().then(label => {
                            new FileModule.File(obj['input']).read().then(value => {
                                let extra = (obj['label'].indexOf('_label')==-1) ? ' ' + obj['input'].substr(obj['input'].lastIndexOf('/')+1).split('_')[0] : '';
                                callback(label + extra, value, obj['type'], obj['format']);
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

        // ******************
        // ***** memory *****
        // ******************

        // check memory usage
        GTop.glibtop_get_mem(this._mem);

        let mem_used = this._mem.user;
        if (this._mem.slab !== undefined) mem_used -= this._mem.slab;
        let utilized = mem_used / this._mem.total * 100;
        let mem_free = this._mem.total - mem_used;

        callback('Usage', utilized, 'memory', 'percent');
        callback('Physical', this._mem.total, 'memory', 'storage');
        callback('Allocated', mem_used, 'memory', 'storage');
        callback('Available', mem_free, 'memory', 'storage');

        // *********************
        // ***** processor *****
        // *********************

        // check processor load
        GTop.glibtop_get_cpu(this._cpu);

        let sum = 0, max = 0;
        for (var i=0; i<this._cores; ++i) {
            let total = this._cpu.xcpu_user[i];
            let delta = (total - this._last_total[i]) / diff;

            // first time poll runs risk of invalid numbers unless previous data exists
            if (this._last_total[i]) {
                callback('Core %s'.format(i), delta, 'processor', 'percent');
            }

            this._last_total[i] = total;

            // used for avg and max below
            sum += delta;
            if (delta > max) max = delta;
        }

        // don't output avg/max unless we have sensors
        //sensors['avg'] = { 'value': sum / this._cores, 'format': 'percent' };
        callback('Average', sum / this._cores, 'processor', 'percent');

        // check the public ip
        if (this._last_public_ip_check++ >= 100) {
            this._last_public_ip_check = 0;

            file = Gio.File.new_for_uri('http://corecoding.com/utilities/what-is-my-ip.php?ipOnly=true');
            if (file.query_exists(null)) {
                file.load_contents_async(null, Lang.bind(this, function(source, result) {
                    let ip = source.load_contents_finish(result)[1].toString().trim();
                    callback('Public IP', ip, 'network', 'string');
                }));
            }
        }

        // ******************
        // ***** system *****
        // ******************

        // check load average
        new FileModule.File('/proc/loadavg').read().then(contents => {
            let loadArray = contents.split(' ');
            let proc = loadArray[3].split('/');

            callback('Load 1m', loadArray[0], 'system', 'string');
            callback('Load 5m', loadArray[1], 'system', 'string');
            callback('Load 10m', loadArray[2], 'system', 'string');
            callback('Active', proc[0], 'system', 'string');
            callback('Total', proc[1], 'system', 'string');
        }).catch(err => {
            global.log(err);
        });

        // check uptime
        new FileModule.File('/proc/uptime').read().then(contents => {
            let upArray = contents.split(' ');
            callback('Uptime', upArray[0], 'system', 'duration');
        }).catch(err => {
            global.log(err);
        });

        // *******************
        // ***** network *****
        // *******************

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
                        callback(file + ' tx', speed, 'network', 'speed');
                    }

                    this._network[file]['tx'] = contents;
                }).catch(err => {
                    global.log(err);
                });

                new FileModule.File(netbase + file + '/statistics/rx_bytes').read().then(contents => {
                    if (typeof this._network[file]['rx'] != 'undefined') {
                        avg_rx = contents;
                        let speed = (contents - this._network[file]['rx']) / diff;
                        callback(file + ' rx', speed, 'network', 'speed');
                    }

                    this._network[file]['rx'] = contents;
                }).catch(err => {
                    global.log(err);
                });
            }

            //global.log('***** * * * * * * ' + avg_tx);

            let speed = (avg_tx - this._network['avg']['tx']) / diff;
            callback('avg tx', speed, 'network', 'speed');
            this._network['avg']['tx'] = avg_tx;

            speed = (avg_rx - this._network['avg']['rx']) / diff;
            callback('avg rx', speed, 'network', 'speed');
            this._network['avg']['tx'] = avg_rx;
        }).catch(err => {
            global.log(err);
        });

        // *******************
        // ***** storage *****
        // *******************

        // TBD
    },

    set update_time(update_time) {
        this._update_time = update_time;
    },
});
