const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;
const GTop = imports.gi.GTop;

const SensorsUtil = new Lang.Class({
    Name: 'SensorsUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    _init: function() {
        this.parent();
        let path = GLib.find_program_in_path('sensors');
        this._argv = path ? [path, '-A'] : null;
        this.mem = new GTop.glibtop_mem;
        this.cpu = new GTop.glibtop_cpu;
        this._update_time = 10;

        // get number of cores
        this.cores = 1;

        try {
            this.cores = GTop.glibtop_get_sysinfo().ncpu;
        } catch(e) {
            global.logError(e);
        }

        //this.last_total = new Array(this.cores);
        this.last_total = [];
        for (var i=0; i<this.cores; ++i) {
            this.last_total[i] = 0;
        }
    },

    get temp() {
        return this._parseSensorsOutput(this._parseSensorsTemperatureLine);
        // wrong lm_sensors not problem of this application #16
        // return s.filter(function(e) {
        //     return e.temp > 0 && e.temp < 115;
        // });
    },

    get rpm() {
        // 0 is normal value for turned off fan
        return this._parseSensorsOutput(this._parseFanRPMLine);
    },

    get volt() {
        return this._parseSensorsOutput(this._parseVoltageLine);
    },

    get memory() {
        let sensors = [];
        GTop.glibtop_get_mem(this.mem);

        let mem_used = this.mem.user;
        if (this.mem.slab !== undefined) mem_used -= this.mem.slab;
        let utilized = mem_used / this.mem.total * 100;
        let mem_free = this.mem.total - mem_used;

        sensors.push({ label: 'Usage', value: utilized, format: 'percent' });
        sensors.push({ label: 'Physical', value: this.mem.total, format: 'storage' });
        sensors.push({ label: 'Allocated', value: mem_used, format: 'storage' });
        sensors.push({ label: 'Available', value: mem_free, format: 'storage' });

        return sensors;
    },

    set update_time(update_time) {
        this._update_time = update_time;
    },

    get processor() {
        let sensors = [];
        GTop.glibtop_get_cpu(this.cpu);

        for (var i=0; i<this.cores; ++i) {
            let total = this.cpu.xcpu_user[i];

            let delta = (total - this.last_total[i]) / this._update_time;

            sensors.push({ label: "Core %s".format(i), value: delta });

            this.last_total[i] = total;
        }

        return sensors;
    },

    _parseSensorsOutput: function(parser) {
        if (!this._output)
            return [];

        let feature_label = undefined;
        let feature_value = undefined;
        let sensors = [];
        let header;

        // iterate through each lines
        for (let line of this._output) {
            // if it is not a continutation of a feature line
            if (!line) {
                header = '';
            } else if (line && !header) {
                // remove text up to first dash
                header = line.substring(0, line.indexOf('-'));
            } else if (line.indexOf(' ') != -1) {
                [feature_label, feature_value] = line.split(':');

                let feature = parser(header + ' ' + feature_label, feature_value);
                if (feature) {
                    sensors.push(feature);
                    feature = undefined;
                }
            } else {
                // not used?
                feature_value += line;
            }
        }

        return sensors;
    },

    _parseSensorsTemperatureLine: function(label, value) {
        if (label == undefined || value == undefined)
            return undefined;
        let curValue = value.trim().split('  ')[0];
        // does the current value look like a temperature unit (°C)?
        if (curValue.indexOf("C", curValue.length - "C".length) !== -1) {
            return {
                label: label.trim(),
                temp: parseFloat(curValue.split(' ')[0])
            };
            // let r;
            // sensor['low']  = (r = /low=\+(\d{1,3}.\d)/.exec(value))  ? parseFloat(r[1]) : undefined;
            // sensor['high'] = (r = /high=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            // sensor['crit'] = (r = /crit=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            // sensor['hyst'] = (r = /hyst=\+(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
        }
        return undefined;
    },

    _parseFanRPMLine: function(label, value) {
        if (label == undefined || value == undefined)
            return undefined;

        let curValue = value.trim().split('  ')[0];
        // does the current value look like a fan rpm line?
        if (curValue.indexOf("RPM", curValue.length - "RPM".length) !== -1) {
            return {
                label: label.trim(),
                rpm: parseFloat(curValue.split(' ')[0])
            };
            // let r;
            // sensor['min'] = (r = /min=(\d{1,5})/.exec(value)) ? parseFloat(r[1]) : undefined;
        }
        return undefined;
    },

    _parseVoltageLine: function(label, value) {
        if (label == undefined || value == undefined)
            return undefined;

        let curValue = value.trim().split('  ')[0];
        // does the current value look like a voltage line?
        if (curValue.indexOf("V", curValue.length - "V".length) !== -1) {
            return {
                label: label.trim(),
                volt: parseFloat(curValue.split(' ')[0])
            };
            // let r;
            // sensor['min'] = (r = /min=(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
            // sensor['max'] = (r = /max=(\d{1,3}.\d)/.exec(value)) ? parseFloat(r[1]) : undefined;
        }
        return undefined;
    }
});
