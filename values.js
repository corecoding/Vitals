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
            case 'duration':
                let scale = [24, 60, 60];
                let units = ['d ', 'h ', 'm '];

                // show seconds on higher precision or if value under a minute
                if (use_higher_precision || value < 60) {
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
                value = value / 1000000000000;
                ending = 'W';
                break;
            case 'watt-hour':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                value = value / 1000000000000;
                ending = 'Wh';
                break;
            default:
                format = '%s';
                break;
        }

        return format.format(value, ending);
    }

    returnIfDifferent(label, value, type, format, key) {
        let output = [];

        // no sense in continuing when the raw value has not changed
        if (typeof this._history[type][key] != 'undefined' && this._history[type][key][1] == value)
            return output;

        // is the value different from last time?
        let legible = this._legible(value, format);
        if (typeof this._history[type][key] == 'undefined' || this._history[type][key][0] != legible) {
            this._history[type][key] = [legible, value];

            output.push([label, legible, type, key]);

            // process average values
            if (type == 'temperature' || type == 'voltage' || type == 'fan') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));
                let sum = vals.reduce((a, b) => a + b);
                let avg = sum / vals.length;
                avg = this._legible(avg, format);

                output.push(['Average', avg, type, '__' + type + '_avg__']);
                output.push([type, avg, type + '-group', '']);
            } else if ((type == 'network-rx' || type == 'network-tx') && format == 'speed') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));

                // get highest bandwidth using interface
                let max = this._legible(Math.getMaxOfArray(vals), format);

                // appends rx or tx to Maximum
                output.push(['Maximum ' + type.split('-')[1], max, type, '__' + type + '_max__']);

                // append download speed to group itself
                if (type == 'network-rx')
                    output.push([type, max, type + '-group', '']);

                // appends total upload and download for all interfaces for #216
                let sum = this._legible(vals.reduce((partialSum, a) => partialSum + a, 0), format);
                output.push(['Total ' + type.split('-')[1], sum, type, '__' + type + '_sum__']);

            }
        }

        return output;
    }

    _getSensorValuesFor(type) {
        return this._history[type];
    }

    resetHistory() {
        this._history = {};

        for (let sensor in this._sensorIcons) {
            this._history[sensor] = {};
            this._history[sensor + '-group'] = {};

            if (sensor == 'network') {
                this._history[sensor + '-rx'] = {};
                this._history[sensor + '-tx'] = {};
            }
        }
    }
});
