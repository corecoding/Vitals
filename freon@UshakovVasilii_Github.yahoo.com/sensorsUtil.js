const Lang = imports.lang;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;

const SensorsUtil = new Lang.Class({
    Name: 'SensorsUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    detect: function(){
        let path = GLib.find_program_in_path('sensors');
        this._argv = path ? [path] : null;
        return this._argv != null;
    },

    get temp() {
        let s = this._parseSensorsOutput(this._parseSensorsTemperatureLine);
        return s.filter(function(e){
            return e.temp > 0 && e.temp < 115;
        });
    },

    get rpm() {
        let s = this._parseSensorsOutput(this._parseFanRPMLine);
        return s.filter(function(e){
            return e.rpm > 0;
        });
    },

    get volt() {
        return this._parseSensorsOutput(this._parseVoltageLine);
    },

    _parseSensorsOutput: function(parser) {
        if(!this._output)
            return [];

        let feature_label = undefined;
        let feature_value = undefined;
        let sensors = [];
        //iterate through each lines
        for(let i = 0; i < this._output.length; i++){
            // ignore chipset driver name and 'Adapter:' line for now
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
