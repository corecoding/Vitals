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

    _humanReadable: function(value, sensorClass, reduce = true) {
        if (value === null) return 'N/A';
        let use_higher_precision = this._settings.get_boolean('use-higher-precision');

        let format = '';
        let ending = '';
        let i = 0;

        let kilo = 1024;
        var sizes = [ 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB' ];
        var hertz = [ 'Hz', 'KHz', '\u3392', '\u3393', 'THz', 'PHz', 'EHz', 'ZHz' ];

        switch (sensorClass) {
            case 'percent':
                format = (use_higher_precision)?'%.1f%s':'%d%s';
                //ending = '%';
                ending = '\u0025';
                break;
            case 'temp':
                if (reduce) value = value / 1000;
                //ending = "\u00b0C";
                ending = '\u2103';

                // are we converting to fahrenheit?
                if (this._settings.get_int('unit') == 1) {
                    value = ((9 / 5) * value + 32);
                    //ending = "\u00b0F";
                    ending = '\u2109';
                }

                format = (use_higher_precision)?'%.1f%s':'%d%s';
                break;
            case 'fan':
                format = '%d %s';
                ending = 'RPM';
                break;
            case 'in': // voltage
                if (reduce) value = value / 1000;
                format = ((value >= 0) ? '+' : '-') + ((use_higher_precision)?'%.2f %s':'%.1f %s');
                ending = 'V';
                break;
            case 'hertz':
                if (value > 0) {
                    i = Math.floor(Math.log(value) / Math.log(1000));
                    value = parseFloat((value / Math.pow(1000, i)));
                }

                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                ending = hertz[i];
                break;
            case 'storage':
                if (value > 0) {
                    i = Math.floor(Math.log(value) / Math.log(kilo));
                    value = parseFloat((value / Math.pow(kilo, i)));
                }

                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                ending = sizes[i];
                break;
            case 'speed':
                if (value > 0) {
                    i = Math.floor(Math.log(value) / Math.log(kilo));
                    if (reduce) value = parseFloat((value / Math.pow(kilo, i)));
                }

                format = (use_higher_precision)?'%.1f %s':'%.0f %s';
                ending = sizes[i] + '/s';
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
            default:
                format = '%s';
                break;
        }

        return format.format(value, ending);
    },

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

    returnIfDifferent: function(label, value, type, format) {
        // only return sensors that are new or that need updating
        let key = '_' + type.split('-')[0] + '_' + label.replace(' ', '_').toLowerCase() + '_';

        value = this._humanReadable(value, format)
        let output = [];

        // is the value different from last time?
        if (this._getHistory(type, key) != value) {
            this._history[type][key] = value;

            output.push([label, value, type, key]);

            // process average values
            if (type == 'temperature' || type == 'voltage' || type == 'fan') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x));
                let sum = vals.reduce(function(a, b) { return a + b; });
                let avg = sum / vals.length;
                avg = this._humanReadable(avg, format, false);

                output.push(['Average', avg, type, '__' + type + '_avg__']);
                output.push([type, avg, type + '-group', '']);
            } else if ((type == 'network-download' || type == 'network-upload') && format == 'speed') {
                let vals = Object.values(this._history[type]).map(x => parseFloat(x));
                let max = Math.max(...vals);
                max = this._humanReadable(max, format, false);
                output.push(['Maximum ' + (type.includes('-upload')?'tx':'rx'), max, type, '__max_' + type + '__']);

                if (type == 'network-download')
                    output.push([type, max, type + '-group', '']);
            }
        }

        return output;
    },

    _getHistory: function(type, key) {
        if (typeof this._history[type][key] == 'undefined')
            return undefined;
        else
            return this._history[type][key];
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
