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

const cbFun = (d, c) => {
    let bb = d[1] % c[0],
        aa = (d[1] - bb) / c[0];
    aa = aa > 0 ? aa + c[1] : '';

    return [d[0] + aa, bb];
};

var Values = new Lang.Class({
    Name: 'Values',

    _init: function(settings, sensorIcons) {
        this._settings = settings;
        this._sensorIcons = sensorIcons;

        this.resetHistory();
    },

    _legible: function(value, sensorClass) {
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
    },

    // From: https://programming.guide/the-worlds-most-copied-so-snippet.html
/*
    _humanReadableByteCount: function(bytes, si) {
        int unit = (si) ? 1000 : 1024;
        long absBytes = bytes == Long.MIN_VALUE ? Long.MAX_VALUE : Math.abs(bytes);
        if (absBytes < unit) return bytes + " B";
        int exp = (int) (Math.log(absBytes) / Math.log(unit));
        long th = (long) (Math.pow(unit, exp) * (unit - 0.05));
        if (exp < 6 && absBytes >= th - ((th & 0xfff) == 0xd00 ? 52 : 0)) exp++;
        String pre = (si ? "kMGTPE" : "KMGTPE").charAt(exp - 1) + (si ? "" : "i");
        if (exp > 4) {
            bytes /= unit;
            exp -= 1;
        }
        return String.format("%.1f %sB", bytes / Math.pow(unit, exp), pre);
    },
*/

    _setProgress: function(amount) {
        let a = '00FF00';
        let b = 'FF0000';

        var ah = parseInt(a, 16),
            ar = ah >> 16, ag = ah >> 8 & 0xff, ab = ah & 0xff,
            bh = parseInt(b, 16),
            br = bh >> 16, bg = bh >> 8 & 0xff, bb = bh & 0xff,
            rr = ar + amount * (br - ar),
            rg = ag + amount * (bg - ag),
            rb = ab + amount * (bb - ab);

        return 'color:#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb | 0).toString(16).slice(1);
    },

    returnIfDifferent: function(label, value, type, format, key) {
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
/*
		if (type == 'fan') {
		  filtered = vals.filter(item => item !== 0);
		  vals = filtered;
		}
		else if (type == 'temperature') {
		  filtered = vals.filter(item => item >= 0 && item < 130000);
		  vals = filtered;
		}
*/
                let sum = vals.reduce(function(a, b) { return a + b; });
                let avg = sum / vals.length;
                avg = this._legible(avg, format);

                output.push(['Average', avg, type, '__' + type + '_avg__']);
                output.push([type, avg, type + '-group', '']);
            } else if ((type == 'network-download' || type == 'network-upload') && format == 'speed') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));
                let max = Math.getMaxOfArray(vals);
                max = this._legible(max, format);
                output.push(['Maximum ' + (type.includes('-upload')?'tx':'rx'), max, type, '__' + type + '_max__']);

                if (type == 'network-download')
                    output.push([type, max, type + '-group', '']);
            }
        }

        return output;
    },

    _getSensorValuesFor: function(type) {
        return this._history[type];
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
    }
});
