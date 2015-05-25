const Lang = imports.lang;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;

const SensorsUtil = new Lang.Class({
    Name: 'SensorsUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    _init: function() {
        this.parent();
        let path = GLib.find_program_in_path('sensors');
        this._argv = path ? [path] : null;
    },

    get temp() {
        let s = this._parseGenericSensorsOutput(this._parseSensorsTemperatureLine);
        return s.filter(function(e){
            return e.temp > 0 && e.temp < 115;
        });
    },

    get gpu() {
        let s = this._parseGpuSensorsOutput(this._parseSensorsTemperatureLine);
        return s.filter(function(e){
            return e.temp > 0 && e.temp < 115;
        });
    },

    get rpm() {
        // 0 is normal value for turned off fan
        return this._parseGenericSensorsOutput(this._parseFanRPMLine);
    },

    get volt() {
        return this._parseGenericSensorsOutput(this._parseVoltageLine);
    },

    _parseGenericSensorsOutput: function(parser) {
        return this._parseSensorsOutput(parser, false);
    },

    _parseGpuSensorsOutput: function(parser) {
        return this._parseSensorsOutput(parser, true);
    },

    _parseSensorsOutput: function(parser, gpuFlag) {
        if(!this._output)
            return [];

        let feature_label = undefined;
        let feature_value = undefined;
        let sensors = [];
        //iterate through each lines
        for(let i = 0; i < this._output.length; i++){

            let isGpuDriver = this._output[i].indexOf("radeon") != -1
                                || this._output[i].indexOf("nouveau") != -1;

            if (gpuFlag != isGpuDriver) {
                // skip driver if gpu requested and driver is not a gpu or the opposite
                continue;
            }

            // skip chipset driver name and 'Adapter:' lines
            i += 2;

            // get every feature of the chip
            while(this._output[i]){
               // if it is not a continutation of a feature line
               if(this._output[i].indexOf(' ') != 0){
                  let feature = parser(feature_label, feature_value);
                  if (feature){
                      sensors.push(feature);
                      feature = undefined;
                  }
                  [feature_label, feature_value] = this._output[i].split(':');
               } else{
                  feature_value += this._output[i];
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
    },

    _parseSensorsTemperatureLine: function(label, value) {
        if(label == undefined || value == undefined)
            return undefined;
        let curValue = value.trim().split('  ')[0];
        // does the current value look like a temperature unit (°C)?
        if(curValue.indexOf("C", curValue.length - "C".length) !== -1){
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
        if(label == undefined || value == undefined)
            return undefined;

        let curValue = value.trim().split('  ')[0];
        // does the current value look like a fan rpm line?
        if(curValue.indexOf("RPM", curValue.length - "RPM".length) !== -1){
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
        if(label == undefined || value == undefined)
            return undefined;

        let curValue = value.trim().split('  ')[0];
        // does the current value look like a voltage line?
        if(curValue.indexOf("V", curValue.length - "V".length) !== -1){
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
