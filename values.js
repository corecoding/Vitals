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

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {colorsKeyForSensor} from './helpers/catalog.js';
import {getUsageColor} from './helpers/colors.js';

const cbFun = (d, c) => {
    let bb = d[1] % c[0],
        aa = (d[1] - bb) / c[0];
    aa = aa > 0 ? aa + c[1] : '';

    return [d[0] + aa, bb];
};

const ESSENTIAL_SERIES_KEYS = new Set([
    '_processor_usage_',
    '_memory_usage_',
    '__network-rx_max__',
    '__network-tx_max__',
]);

function isEssentialSeriesKey(key) {
    if (ESSENTIAL_SERIES_KEYS.has(key))
        return true;
    return /^_gpu#\d+_usage_$/.test(key);
}

export const Values = GObject.registerClass({
       GTypeName: 'Values',
}, class Values extends GObject.Object {

    _init(settings, sensorIcons) {
        this._settings = settings;
        this._sensorIcons = sensorIcons;

        this._networkSpeedOffset = {};
        this._networkSpeeds = {};

        this._history = {};
        this._timeSeries = {};
        this._timeSeriesFormat = {};
        this._graphableFormats = ['temp', 'in', 'fan', 'percent', 'hertz', 'memory', 'speed', 'storage', 'watt', 'watt-gpu', 'milliamp', 'milliamp-hour', 'load'];
        this.resetHistory();
        this._recordHistoryChart = this._settings.get_boolean('show-history-chart');
    }

    setRecordHistoryChart(enabled) {
        this._recordHistoryChart = !!enabled;
    }

    get historyCachePath() {
        return GLib.build_filenamev([GLib.get_user_cache_dir(), 'vitals', 'history.json']);
    }

    _getHistoryDurationSeconds() {
        if (this._settings && this._settings.get_int)
            return Math.max(60, this._settings.get_int('history-duration'));
        return 3600;
    }

    _pushTimePoint(key, value, format) {
        if (!this._recordHistoryChart) return;
        if (!this._graphableFormats.includes(format)) return;
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (num !== num) return;
        this._timeSeriesFormat[key] = format;
        const now = Date.now() / 1000;
        if (!(key in this._timeSeries)) this._timeSeries[key] = [];
        const buf = this._timeSeries[key];
        const interval = Math.max(1, this._settings.get_int('update-time'));
        const minInterval = interval - 0.5;
        if (buf.length > 0 && buf[buf.length - 1].v !== null && (now - buf[buf.length - 1].t) < minInterval) {
            buf[buf.length - 1].v = num;
            return;
        }
        if (buf.length > 0) {
            const lastT = buf[buf.length - 1].t;
            const gap = now - lastT;
            if (gap > interval * 3) {
                let fillT = lastT + interval;
                while (fillT < now - interval * 0.5) {
                    buf.push({ t: fillT, v: null });
                    fillT += interval;
                }
            }
        }
        buf.push({ t: now, v: num });
        const maxAge = this._getHistoryDurationSeconds();
        while (buf.length > 0 && buf[0].t < now - maxAge) buf.shift();
        const maxPoints = 200;
        if (buf.length > maxPoints * 1.5)
            this._timeSeries[key] = this._downsample(buf, maxPoints);
    }

    _downsample(buf, targetLen) {
        const result = [];
        const bucketSize = buf.length / targetLen;
        for (let b = 0; b < targetLen; b++) {
            const iStart = Math.floor(b * bucketSize);
            const iEnd = Math.floor((b + 1) * bucketSize);
            let maxVal = -Infinity, count = 0;
            for (let i = iStart; i < iEnd; i++) {
                if (buf[i].v !== null) {
                    if (buf[i].v > maxVal) maxVal = buf[i].v;
                    count++;
                }
            }
            const midT = (buf[iStart].t + buf[Math.min(iEnd - 1, buf.length - 1)].t) / 2;
            if (count > 0)
                result.push({ t: midT, v: maxVal });
            else
                result.push({ t: midT, v: null });
        }
        return result;
    }

    clearTimeSeries(cachePath) {
        this._timeSeries = {};
        this._timeSeriesFormat = {};
        const path = cachePath || this.historyCachePath;
        try {
            const file = Gio.File.new_for_path(path);
            if (file.query_exists(null))
                file.delete(null);
        } catch (e) {
            // ignore
        }
    }

    saveTimeSeries(path) {
        try {
            const dest = path || this.historyCachePath;
            const obj = {
                version: 1,
                timeSeries: this._timeSeries,
                timeSeriesFormat: this._timeSeriesFormat
            };
            const json = JSON.stringify(obj);
            const dir = GLib.path_get_dirname(dest);
            GLib.mkdir_with_parents(dir, 0o755);
            GLib.file_set_contents(dest, json);
        } catch (e) {
            // ignore write failures
        }
    }

    loadTimeSeries(path) {
        try {
            const dest = path || this.historyCachePath;
            const file = Gio.File.new_for_path(dest);
            if (!file.query_exists(null)) return;
            const [ok, contents] = GLib.file_get_contents(dest);
            if (!ok) return;
            const decoder = new TextDecoder('utf-8');
            const json = decoder.decode(contents);
            const obj = JSON.parse(json);
            if (!obj || obj.version !== 1) return;
            if (obj.timeSeries && typeof obj.timeSeries === 'object')
                this._timeSeries = obj.timeSeries;
            if (obj.timeSeriesFormat && typeof obj.timeSeriesFormat === 'object')
                this._timeSeriesFormat = obj.timeSeriesFormat;
            const now = Date.now() / 1000;
            const maxAge = this._getHistoryDurationSeconds();
            const cutoff = now - maxAge;
            for (const key in this._timeSeries) {
                const buf = this._timeSeries[key];
                if (!Array.isArray(buf)) {
                    delete this._timeSeries[key];
                    continue;
                }
                while (buf.length > 0 && buf[0].t < cutoff)
                    buf.shift();
                while (buf.length > 0 && buf[0].v === null)
                    buf.shift();
                if (buf.length === 0) {
                    delete this._timeSeries[key];
                    delete this._timeSeriesFormat[key];
                }
            }
        } catch (e) {
            // ignore corrupt or missing file
        }
    }

    getTimeSeries(key) {
        if (!(key in this._timeSeries)) return [];
        return this._timeSeries[key].slice();
    }

    getEssentialSeries() {
        return {
            cpu: this.getTimeSeries('_processor_usage_'),
            memory: this.getTimeSeries('_memory_usage_'),
            networkRx: this.getTimeSeries('__network-rx_max__'),
            networkTx: this.getTimeSeries('__network-tx_max__'),
            gpu: this.getTimeSeries('_gpu#1_usage_'),
        };
    }

    formatSeriesValue(key, rawValue) {
        if (rawValue === null || rawValue === undefined)
            return '—';
        const format = key in this._timeSeriesFormat ? this._timeSeriesFormat[key] : 'percent';
        return this._legible(rawValue, format, null, key).text;
    }

    formatDuration(seconds) {
        seconds = Math.round(Math.abs(seconds));
        if (seconds < 60) return seconds + 's';
        const m = Math.floor(seconds / 60);
        if (m < 60) return m + 'm';
        const h = Math.floor(m / 60);
        const rm = m % 60;
        if (rm === 0) return h + 'h';
        return h + 'h ' + rm + 'm';
    }

    formatClock(unixSeconds) {
        const date = new Date(unixSeconds * 1000);
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    _legible(value, sensorClass, type, sensorKey = null) {
        let unit = 1000;
        if (value === null)
            return { text: 'N/A', style: '' };
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
                    exp = Math.max(0, Math.floor(Math.log(value) / Math.log(unit)));
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
                let fixed_unit = this._settings.get_int('network-speed-unit');

                if (value > 0) {
                    if (use_bps) value *= 8;

                    if (fixed_unit > 0) {
                        // fixed unit: force to K (exp=1) or M (exp=2)
                        exp = fixed_unit;
                        value = parseFloat((value / Math.pow(unit, exp)));
                    } else {
                        // auto: current behavior
                        exp = Math.floor(Math.log(value) / Math.log(unit));
                        if (value >= Math.pow(unit, exp) * (unit - 0.05)) exp++;
                        value = parseFloat((value / Math.pow(unit, exp)));
                    }
                } else {
                    exp = 0;
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
                format = (
                    ((value > 0) ? '+' : '') + ((use_higher_precision)?'%.2f %s':'%.1f %s')
                );
                value = value / 1000000;
                ending = 'W';
                break;
            case 'watt-gpu':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                ending = 'W';
                break;
            case 'watt-hour':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                value = value / 1000000;
                ending = 'Wh';
                break;
            case 'load':
                format = (use_higher_precision)?'%.2f %s':'%.1f %s';
                value = parseFloat(value);
                break;
            case 'pcie':
                let split = value.split('x');
                value = 'PCIe ' + parseInt(split[0]) + (split.length > 1 ? ' x' + parseInt(split[1]) : '');
                format = '%s';
                break;
            default:
                format = '%s';
                break;
        }

        let numeric = (typeof value === 'number' && Number.isFinite(value)) ? value : null;
        return {
            text: format.format(value, ending).trim(),
            style: this._styleFor(numeric, type, sensorClass, sensorKey),
        };
    }

    _styleFor(numeric, type, format, sensorKey = null) {
        let colorsKey = colorsKeyForSensor(type, format);
        if (!colorsKey || numeric === null || !Number.isFinite(numeric))
            return '';

        return getUsageColor(numeric, this._settings.get_strv(colorsKey), sensorKey);
    }

    returnIfDifferent(dwell, label, value, type, format, key) {
        let output = [];

        // Use one history bucket for network-<cc> types (geo IP), except for rx/tx.
        let historyType = (/^network-(?!rx$|tx$)[a-z]{2}(?:-group)?$/.test(type)) ? 'network' : type;

        // make sure the keys exist
        if (!(historyType in this._history)) this._history[historyType] = {};

        // Record essential series every poll even when the displayed value is unchanged
        if (this._recordHistoryChart && isEssentialSeriesKey(key) &&
            historyType != 'network-rx' && historyType != 'network-tx' &&
            typeof value === 'number') {
            this._pushTimePoint(key, value, format);
        }

        // no sense in continuing when the raw value has not changed
        if (historyType != 'network-rx' && historyType != 'network-tx' &&
            key in this._history[historyType] && this._history[historyType][key][1] == value)
                return output;

        // is the value different from last time?
        let legible = this._legible(value, format, type, key);

        // don't return early when dealing with network traffic
        if (historyType != 'network-rx' && historyType != 'network-tx') {
            // only update when we are coming through for the first time, or if a value has changed
            if (key in this._history[historyType] && this._history[historyType][key][0] == legible.text)
                return output;

            // add label as it was sent from sensors class; type stays e.g. network-us for display/icons
            output.push({ label, value: legible.text, style: legible.style, type, key });

            if (this._recordHistoryChart && !isEssentialSeriesKey(key))
                this._pushTimePoint(key, value, format);
        }

        // save previous values to update screen on changes only
        let previousValue = this._history[historyType][key];
        this._history[historyType][key] = [legible.text, value];

        // process average, min and max values
        if (type == 'temperature' || type == 'voltage' || type == 'fan') {
            let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));

            // show value in group even if there is one value present
            let sum = vals.reduce((a, b) => a + b);
            let avg = this._legible(sum / vals.length, format, type, null);
            output.push({
                label: type,
                value: avg.text,
                style: avg.style,
                type: type + '-group',
                key: '',
            });

            // If only one value is present, don't display avg, min and max
            if (vals.length > 1) {
                let avgKey = '__' + type + '_avg__';
                avg = this._legible(sum / vals.length, format, type, avgKey);
                output.push({
                    label: 'Average',
                    value: avg.text,
                    style: avg.style,
                    type,
                    key: avgKey,
                });

                // calculate Minimum value
                let min = Math.min(...vals);
                let minKey = '__' + type + '_min__';
                let minFormatted = this._legible(min, format, type, minKey);
                output.push({
                    label: 'Minimum',
                    value: minFormatted.text,
                    style: minFormatted.style,
                    type,
                    key: minKey,
                });

                // calculate Maximum value
                let max = Math.max(...vals);
                let maxKey = '__' + type + '_max__';
                let maxFormatted = this._legible(max, format, type, maxKey);
                output.push({
                    label: 'Maximum',
                    value: maxFormatted.text,
                    style: maxFormatted.style,
                    type,
                    key: maxKey,
                });
            }
        } else if (type == 'network-rx' || type == 'network-tx') {
            let direction = type.split('-')[1];

            // appends total upload and download for all interfaces for #216
            let vals = Object.values(this._history[type]).map(x => parseFloat(x[1]));
            let sum = vals.reduce((partialSum, a) => partialSum + a, 0);
            let bootKey = '__' + type + '_boot__';
            let boot = this._legible(sum, format, type, bootKey);
            output.push({
                label: 'Boot ' + direction,
                value: boot.text,
                style: boot.style,
                type,
                key: bootKey,
            });

            // keeps track of session start point
            if (!(key in this._networkSpeedOffset) || this._networkSpeedOffset[key] <= 0)
                this._networkSpeedOffset[key] = sum;

            // outputs session upload and download for all interfaces for #234
            let sessionKey = '__' + type + '_ses__';
            let session = this._legible(sum - this._networkSpeedOffset[key], format, type, sessionKey);
            output.push({
                label: 'Session ' + direction,
                value: session.text,
                style: session.style,
                type,
                key: sessionKey,
            });

            // calculate speed for this interface
            let speed = 0;
            if (previousValue)
                speed = (value - previousValue[1]) / dwell;
            let speedFormatted = this._legible(speed, 'speed', type, key);
            output.push({
                label,
                value: speedFormatted.text,
                style: speedFormatted.style,
                type,
                key,
            });
            this._pushTimePoint(key, speed, 'speed');

            // store speed for Device report
            if (!(direction in this._networkSpeeds)) this._networkSpeeds[direction] = {};
            if (!(label in this._networkSpeeds[direction])) this._networkSpeeds[direction][label] = 0;

            // store value for next go around
            if (value > 0 || (value == 0 && !this._settings.get_boolean('hide-zeros')))
                this._networkSpeeds[direction][label] = speed;

            // calculate total upload and download device speed
            for (let dir in this._networkSpeeds) {
                let sumNum = 0;
                for (let iface in this._networkSpeeds[dir])
                    sumNum += parseFloat(this._networkSpeeds[dir][iface]);

                let deviceKey = '__network-' + dir + '_max__';
                let device = this._legible(sumNum, 'speed', 'network-' + dir, deviceKey);
                output.push({
                    label: 'Device ' + dir,
                    value: device.text,
                    style: device.style,
                    type: 'network-' + dir,
                    key: deviceKey,
                });
                this._pushTimePoint(deviceKey, sumNum, 'speed');
                // append download speed to group itself
                if (dir == 'rx') {
                    output.push({
                        label: type,
                        value: device.text,
                        style: device.style,
                        type: type + '-group',
                        key: '',
                    });
                }
            }
        }

        return output;
    }

    resetHistory(numGpus) {
        // don't call this._history = {}, as we want to keep network-rx and network-tx
        // otherwise network history statistics will start over
        for (let sensor in this._sensorIcons) {
            //each gpu has it's own sensor name and thus must be handled separately
            if(sensor === 'gpu') continue;

            this._history[sensor] = {};
            this._history[sensor + '-group'] = {};
        }

        for(let i = 1; i <= numGpus; i++){
            this._history['gpu#' + i] = {};
            this._history['gpu#' + i + '-group'] = {};
        }
    }
});
