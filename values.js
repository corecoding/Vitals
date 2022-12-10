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

const cbFun = (d, c) => {
    let bb = d[1] % c[0],
        aa = (d[1] - bb) / c[0];
    aa = aa > 0 ? aa + c[1] : '';

    return [d[0] + aa, bb];
};

var Values = GObject.registerClass({
       GTypeName: 'Values',
}, class Values extends GObject.Object {

    _init(settings, sensorIcons) {
        this._settings = settings;
        this._sensorIcons = sensorIcons;

        this._networkSpeedOffset = {};
        this._networkSpeeds = {};

        this._history = {};
        //this._history2 = {};
        this.resetHistory();
    }

    _legible(value, sensorClass) {
        let unit = 1000;
        if (value === null) return 'N/A';
        let use_higher_precision = this._settings.get_boolean('use-higher-precision');
        let memory_measurement = this._settings.get_int('memory-measurement')
        let storage_measurement = this._settings.get_int('storage-measurement')
        let use_bps = (this._settings.get_int('network-speed-format') == 1);

        let format = '';
        let ending = '';
        let exp = 0;

        var decimal = [ 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];
        var binary = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB' ];
        var hertz = [ 'Hz', 'KHz', 'MHz', 'GHz', 'THz', 'PHz', 'EHz', 'ZHz' ];

        switch (sensorClass) {
            case 'percent':
                format = (use_higher_precision)?'%.1f%s':'%d%s';
                value = value * 100;
                if (value > 100) value = 100;
                ending = '%';
                break;
            case 'temp':
                value = value / 1000;
                ending = '°C';

                // are we converting to fahrenheit?
                if (this._settings.get_int('unit') == 1) {
                    value = ((9 / 5) * value + 32);
                    ending = '°F';
                }

                format = (use_higher_precision)?'%.1f%s':'%d%s';
                break;
            case 'fan':
                format = '%d %s';
                ending = 'RPM';
                break;
            case 'in': // voltage
                value = value / 1000;
                format = ((value >= 0) ? '+' : '-') + ((use_higher_precision)?'%.2f %s':'%.1f %s');
                ending = 'V';
                break;
            case 'hertz':
                if (value > 0) {
                    exp = Math.floor(Math.log(value) / Math.log(unit));
                    if (value >= Math.pow(unit, exp) * (unit - 0.05)) exp++;
                    value = parseFloat((value / Math.pow(unit, exp)));
                }

                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                ending = hertz[exp];
                break;
            case 'memory':
                unit = (memory_measurement)?1000:1024;

                if (value > 0) {
                    value *= unit;
                    exp = Math.floor(Math.log(value) / Math.log(unit));
                    if (value >= Math.pow(unit, exp) * (unit - 0.05)) exp++;
                    value = parseFloat((value / Math.pow(unit, exp)));
                }

                format = (use_higher_precision)?'%.2f %s':'%.1f %s';

                if (memory_measurement)
                    ending = decimal[exp];
                else
                    ending = binary[exp];

                break;
            case 'storage':
                unit = (storage_measurement)?1000:1024;

                if (value > 0) {
                    exp = Math.floor(Math.log(value) / Math.log(unit));
                    if (value >= Math.pow(unit, exp) * (unit - 0.05)) exp++;
                    value = parseFloat((value / Math.pow(unit, exp)));
                }

                format = (use_higher_precision)?'%.2f %s':'%.1f %s';

                if (storage_measurement)
                    ending = decimal[exp];
                else
                    ending = binary[exp];

                break;
            case 'speed':
                if (value > 0) {
                    if (use_bps) value *= 8;
                    exp = Math.floor(Math.log(value) / Math.log(unit));
                    if (value >= Math.pow(unit, exp) * (unit - 0.05)) exp++;
                    value = parseFloat((value / Math.pow(unit, exp)));
                }

                format = (use_higher_precision)?'%.1f %s':'%.0f %s';

                if (use_bps) {
                    ending = decimal[exp].replace('B', 'bps');
                } else {
                    ending = decimal[exp] + '/s';
                }

                break;
            case 'runtime':
            case 'uptime':
                let scale = [24, 60, 60];
                let units = ['d ', 'h ', 'm '];

                // show seconds on higher precision or if value under a minute
                if (sensorClass != 'runtime' && (use_higher_precision || value < 60)) {
                    scale.push(1);
                    units.push('s ');
                }

                let rslt = scale.map((d, i, a) => a.slice(i).reduce((d, c) => d * c))
                    .map((d, i) => ([d, units[i]]))
                    .reduce(cbFun, ['', value]);

                value = rslt[0].trim();

                format = '%s';
                break;
            case 'milliamp':
                format = (use_higher_precision)?'%.1f %s':'%d %s';
                value = value / 1000;
                ending = 'mA';
                break;
            case 'milliamp-hour':
                format = (use_higher_precision)?'%.1f %s':'%d %s';
                value = value / 1000;
                ending = 'mAh';
                break;
            case 'watt':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                value = value / 1000000;
                ending = 'W';
                break;
            case 'watt-hour':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                value = value / 1000000;
                ending = 'Wh';
                break;
            case 'load':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                break;
            default:
                format = '%s';
                break;
        }

        return format.format(value, ending);
    }

    returnIfDifferent(dwell, label, value, type, format, key) {
        let output = [];

        // make sure the keys exist
        if (!(type in this._history)) this._history[type] = {};

        // no sense in continuing when the raw value has not changed
        if (type != 'network-rx' && type != 'network-tx' &&
            key in this._history[type] && this._history[type][key][1] == value)
                return output;

        // is the value different from last time?
        let legible = this._legible(value, format);

        // don't return early when dealing with network traffic
        if (type != 'network-rx' && type != 'network-tx') {
            // only update when we are coming through for the first time, or if a value has changed
            if (key in this._history[type] && this._history[type][key][0] == legible)
                return output;

            // add label as it was sent from sensors class
            output.push([label, legible, type, key]);
        }

        // save previous values to update screen on changes only
        let previousValue = this._history[type][key];
        this._history[type][key] = [legible, value];

        // process average, min and max values
        if (type == 'temperature' || type == 'voltage' || type == 'fan') {
            let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));

            // show value in group even if there is one value present
            let sum = vals.reduce((a, b) => a + b);
            let avg = this._legible(sum / vals.length, format);
            output.push([type, avg, type + '-group', '']);

            // If only one value is present, don't display avg, min and max
            if (vals.length > 1) {
                output.push(['Average', avg, type, '__' + type + '_avg__']);

                // calculate Minimum value
                let min = Math.min(...vals);
                min = this._legible(min, format);
                output.push(['Minimum', min, type, '__' + type + '_min__']);

                // calculate Maximum value
                let max = Math.max(...vals);
                max = this._legible(max, format);
                output.push(['Maximum', max, type, '__' + type + '_max__']);
            }
        } else if (type == 'network-rx' || type == 'network-tx') {
            let direction = type.split('-')[1];

            // appends total upload and download for all interfaces for #216
            let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));
            let sum = vals.reduce((partialSum, a) => partialSum + a, 0);
            output.push(['Boot ' + direction, this._legible(sum, format), type, '__' + type + '_boot__']);

            // keeps track of session start point
            if (!(key in this._networkSpeedOffset) || this._networkSpeedOffset[key] <= 0)
                this._networkSpeedOffset[key] = sum;

            // outputs session upload and download for all interfaces for #234
            output.push(['Session ' + direction, this._legible(sum - this._networkSpeedOffset[key], format), type, '__' + type + '_ses__']);

            // calculate speed for this interface
            let speed = (value - previousValue[1]) / dwell;
            output.push([label, this._legible(speed, 'speed'), type, key]);

            // store speed for Device report
            if (!(direction in this._networkSpeeds)) this._networkSpeeds[direction] = {};
            if (!(label in this._networkSpeeds[direction])) this._networkSpeeds[direction][label] = 0;

            // store value for next go around
            if (value > 0 || (value == 0 && !this._settings.get_boolean('hide-zeros')))
                this._networkSpeeds[direction][label] = speed;

            // calculate total upload and download device speed
            for (let direction in this._networkSpeeds) {
                let sum = 0;
                for (let iface in this._networkSpeeds[direction])
                    sum += parseFloat(this._networkSpeeds[direction][iface]);

                sum = this._legible(sum, 'speed');
                output.push(['Device ' + direction, sum, 'network-' + direction, '__network-' + direction + '_max__']);
                // append download speed to group itself
                if (direction == 'rx') output.push([type, sum, type + '-group', '']);
            }
        }

/*
        global.log('before', JSON.stringify(output));
        for (let i = output.length - 1; i >= 0; i--) {
            let sensor = output[i];
            // sensor[0]=label, sensor[1]=value, sensor[2]=type, sensor[3]=key)

            //["CPU Core 5","46°C","temperature","_temperature_hwmon8temp7_"]

            // make sure the keys exist
            if (!(sensor[2] in this._history2)) this._history2[sensor[2]] = {};

            if (sensor[3] in this._history2[sensor[2]]) {
                if (this._history2[sensor[2]][sensor[3]] == sensor[1]) {
                    output.splice(i, 1);
                }
            }

            this._history2[sensor[2]][sensor[3]] = sensor[1];
        }

        global.log(' after', JSON.stringify(output));
        global.log('***************************');
*/

        return output;
    }

    resetHistory() {
        // don't call this._history = {}, as we want to keep network-rx and network-tx
        // otherwise network history statistics will start over
        for (let sensor in this._sensorIcons) {
            this._history[sensor] = {};
            this._history[sensor + '-group'] = {};
            //this._history2[sensor] = {};
            //this._history2[sensor + '-group'] = {};
        }
    }
});
