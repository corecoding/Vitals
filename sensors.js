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
import * as SubProcessModule from './helpers/subprocess.js';
import * as FileModule from './helpers/file.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import NM from 'gi://NM';

let GTop, hasGTop = true;
try {
    ({default: GTop} = await import('gi://GTop'));
} catch (err) {
    log(err);
    hasGTop = false;
};

export const Sensors = GObject.registerClass({
    GTypeName: 'Sensors',
}, class Sensors extends GObject.Object {
    _init(settings, sensorIcons) {
        this._settings = settings;
        this._sensorIcons = sensorIcons;

        this.resetHistory();

        this._last_processor = { 'core': {}, 'speed': [] };

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('show-gpu', this._reconfigureNvidiaSmiProcess.bind(this));
        this._addSettingChangedSignal('update-time', this._reconfigureNvidiaSmiProcess.bind(this));
        //this._addSettingChangedSignal('include-static-gpu-info', this._reconfigureNvidiaSmiProcess.bind(this));

        this._nvidia_smi_process = null;
        this._nvidia_labels = [];
        this._bad_split_count = 0;

        if (hasGTop) {
            this.storage = new GTop.glibtop_fsusage();
            this._storageDevice = '';
            this._findStorageDevice();

            this._lastRead = 0;
            this._lastWrite = 0;
        }
    }

    _addSettingChangedSignal(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    }

    _refreshIPAddress(callback) {
        // check IP address
        new FileModule.File('https://corecoding.com/vitals.php').read().then(contents => {
            let obj = JSON.parse(contents);
            this._returnValue(callback, 'Public IP', obj['IPv4'], 'network', 'string');
        }).catch(err => { });
    }

    _findStorageDevice() {
        new FileModule.File('/proc/mounts').read("\n").then(lines => {
            for (let line of lines) {
                let loadArray = line.trim().split(/\s+/);
                if (loadArray[1] == this._settings.get_string('storage-path')) {
                    this._storageDevice = loadArray[0];
                    break;
                }
            }
        }).catch(err => { });
    }

    query(callback, dwell) {
        if (!this._hardware_detected) {
            // we could set _hardware_detected in discoverHardwareMonitors, but by
            // doing it here, we guarantee avoidance of race conditions
            this._hardware_detected = true;
            this._discoverHardwareMonitors(callback);
        }

        for (let sensor in this._sensorIcons) {
            if (this._settings.get_boolean('show-' + sensor)) {
                if (sensor == 'temperature' || sensor == 'voltage' || sensor == 'fan') {
                    // for temp, volt, fan, we have a shared handler
                    this._queryTempVoltFan(callback, sensor);
                } else {
                    // directly call queryFunction below
                    let method = '_query' + sensor[0].toUpperCase() + sensor.slice(1);
                    this[method](callback, dwell);
                }
            }
        }
    }

    _queryTempVoltFan(callback, type) {
        for (let label in this._tempVoltFanSensors[type]) {
            let sensor = this._tempVoltFanSensors[type][label];

            new FileModule.File(sensor['path']).read().then(value => {
                this._returnValue(callback, label, value, type, sensor['format']);
            }).catch(err => {
                this._returnValue(callback, label, 'disabled', type, sensor['format']);
            });
        }
    }

    _queryMemory(callback) {
        // check memory info
        new FileModule.File('/proc/meminfo').read().then(lines => {
            let values = '', total = 0, avail = 0, swapTotal = 0, swapFree = 0, cached = 0, memFree = 0;

            if (values = lines.match(/MemTotal:(\s+)(\d+) kB/)) total = values[2];
            if (values = lines.match(/MemAvailable:(\s+)(\d+) kB/)) avail = values[2];
            if (values = lines.match(/SwapTotal:(\s+)(\d+) kB/)) swapTotal = values[2];
            if (values = lines.match(/SwapFree:(\s+)(\d+) kB/)) swapFree = values[2];
            if (values = lines.match(/Cached:(\s+)(\d+) kB/)) cached = values[2];
            if (values = lines.match(/MemFree:(\s+)(\d+) kB/)) memFree = values[2];

            let used = total - avail
            let utilized = used / total;
            let swapUsed = swapTotal - swapFree
            let swapUtilized = swapUsed / swapTotal;

            this._returnValue(callback, 'Usage', utilized, 'memory', 'percent');
            this._returnValue(callback, 'memory', utilized, 'memory-group', 'percent');
            this._returnValue(callback, 'Physical', total, 'memory', 'memory');
            this._returnValue(callback, 'Available', avail, 'memory', 'memory');
            this._returnValue(callback, 'Allocated', used, 'memory', 'memory');
            this._returnValue(callback, 'Cached', cached, 'memory', 'memory');
            this._returnValue(callback, 'Free', memFree, 'memory', 'memory');
            this._returnValue(callback, 'Swap Total', swapTotal, 'memory', 'memory');
            this._returnValue(callback, 'Swap Free', swapFree, 'memory', 'memory');
            this._returnValue(callback, 'Swap Used', swapUsed, 'memory', 'memory');
            this._returnValue(callback, 'Swap Usage', swapUtilized, 'memory', 'percent');
        }).catch(err => { });
    }

    _queryProcessor(callback, dwell) {
        let columns = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'guest', 'guest_nice'];

        // check processor usage
        new FileModule.File('/proc/stat').read("\n").then(lines => {
            let statistics = {};

            for (let line of lines) {
                let reverse_data = line.match(/^(cpu\d*\s)(.+)/);
                if (reverse_data) {
                    let cpu = reverse_data[1].trim();

                    if (!(cpu in statistics))
                        statistics[cpu] = {};

                    if (!(cpu in this._last_processor['core']))
                        this._last_processor['core'][cpu] = 0;

                    let stats = reverse_data[2].trim().split(' ').reverse();
                    for (let column of columns)
                        statistics[cpu][column] = parseInt(stats.pop());
                }
            }

            let cores = Object.keys(statistics).length - 1;

            for (let cpu in statistics) {
                let total = statistics[cpu]['user'] + statistics[cpu]['nice'] + statistics[cpu]['system'];

                // make sure we have data to report
                if (this._last_processor['core'][cpu] > 0) {
                    let delta = (total - this._last_processor['core'][cpu]) / dwell;

                    // /proc/stat provides overall usage for us under the 'cpu' heading
                    if (cpu == 'cpu') {
                        delta = delta / cores;
                        this._returnValue(callback, 'processor', delta / 100, 'processor-group', 'percent');
                        this._returnValue(callback, 'Usage', delta / 100, 'processor', 'percent');
                    } else {
                        this._returnValue(callback, _('Core %d').format(cpu.substr(3)), delta / 100, 'processor', 'percent');
                    }
                }

                this._last_processor['core'][cpu] = total;
            }

            // if frequency scaling is enabled, gather cpu-freq values
            if (!this._processor_uses_cpu_info) {
                for (let core = 0; core <= cores; core++) {
                    new FileModule.File('/sys/devices/system/cpu/cpu' + core + '/cpufreq/scaling_cur_freq').read().then(value => {
                        this._last_processor['speed'][core] = parseInt(value);
                    }).catch(err => { });
                }
            }
        }).catch(err => { });

        // if frequency scaling is disabled, use cpuinfo for speed
        if (this._processor_uses_cpu_info) {
            // grab CPU frequency
            new FileModule.File('/proc/cpuinfo').read("\n").then(lines => {
                let freqs = [];
                for (let line of lines) {
                    // grab megahertz
                    let value = line.match(/^cpu MHz(\s+): ([+-]?\d+(\.\d+)?)/);
                    if (value) freqs.push(parseFloat(value[2]));
                }

                let sum = freqs.reduce((a, b) => a + b);
                let hertz = (sum / freqs.length) * 1000 * 1000;
                this._returnValue(callback, 'Frequency', hertz, 'processor', 'hertz');

                //let max_hertz = Math.getMaxOfArray(freqs) * 1000 * 1000;
                //this._returnValue(callback, 'Boost', max_hertz, 'processor', 'hertz');
            }).catch(err => { });
        // if frequency scaling is enabled, cpu-freq reports
        } else if (Object.values(this._last_processor['speed']).length > 0) {
            let sum = this._last_processor['speed'].reduce((a, b) => a + b);
            let hertz = (sum / this._last_processor['speed'].length) * 1000;
            this._returnValue(callback, 'Frequency', hertz, 'processor', 'hertz');
            //let max_hertz = Math.getMaxOfArray(this._last_processor['speed']) * 1000;
            //this._returnValue(callback, 'Boost', max_hertz, 'processor', 'hertz');
        }
    }

    _querySystem(callback) {
        // check load average
        new FileModule.File('/proc/sys/fs/file-nr').read("\t").then(loadArray => {
            this._returnValue(callback, 'Open Files', loadArray[0], 'system', 'string');
        }).catch(err => { });

        // check load average
        new FileModule.File('/proc/loadavg').read(' ').then(loadArray => {
            let proc = loadArray[3].split('/');

            this._returnValue(callback, 'Load 1m', loadArray[0], 'system', 'load');
            this._returnValue(callback, 'system', loadArray[0], 'system-group', 'load');
            this._returnValue(callback, 'Load 5m', loadArray[1], 'system', 'load');
            this._returnValue(callback, 'Load 15m', loadArray[2], 'system', 'load');
            this._returnValue(callback, 'Threads Active', proc[0], 'system', 'string');
            this._returnValue(callback, 'Threads Total', proc[1], 'system', 'string');
        }).catch(err => { });

        // check uptime
        new FileModule.File('/proc/uptime').read(' ').then(upArray => {
            this._returnValue(callback, 'Uptime', upArray[0], 'system', 'uptime');

            let cores = Object.keys(this._last_processor['core']).length - 1;
            if (cores > 0)
                this._returnValue(callback, 'Process Time', upArray[0] - upArray[1] / cores, 'processor', 'uptime');
        }).catch(err => { });
    }

    _queryNetwork(callback, dwell) {
        // check network speed
        let directions = ['tx', 'rx'];
        let netbase = '/sys/class/net/';

        new FileModule.File(netbase).list().then(interfaces => {
            for (let iface of interfaces) {
                for (let direction of directions) {
                    // lo tx and rx are the same
                    if (iface == 'lo' && direction == 'rx') continue;

                    new FileModule.File(netbase + iface + '/statistics/' + direction + '_bytes').read().then(value => {
                        // issue #217 - don't include 'lo' traffic in Maximum calculations in values.js
                        // by not using network-rx or network-tx
                        let name = iface + ((iface == 'lo')?'':' ' + direction);

                        let type = 'network' + ((iface=='lo')?'':'-' + direction);
                        this._returnValue(callback, name, value, type, 'storage');
                    }).catch(err => { });
                }
            }
        }).catch(err => { });

        // some may not want public ip checking
        if (this._settings.get_boolean('include-public-ip')) {
            // check the public ip every hour or when waking from sleep
            if (this._next_public_ip_check <= 0) {
                this._next_public_ip_check = 3600;

                this._refreshIPAddress(callback);
            }

            this._next_public_ip_check -= dwell;
        }

        // wireless interface statistics
        new FileModule.File('/proc/net/wireless').read("\n", true).then(lines => {
            // wireless has two headers - first is stripped in helper function
            lines.shift();

            // if multiple wireless device, we use the last one
            for (let line of lines) {
                let netArray = line.trim().split(/\s+/);
                let quality_pct = netArray[2].substr(0, netArray[2].length-1) / 70;
                let signal = netArray[3].substr(0, netArray[3].length-1);

                this._returnValue(callback, 'WiFi Link Quality', quality_pct, 'network', 'percent');
                this._returnValue(callback, 'WiFi Signal Level', signal, 'network', 'string');
            }
        }).catch(err => { });
    }

    _queryStorage(callback, dwell) {
        // display zfs arc status, if available
        new FileModule.File('/proc/spl/kstat/zfs/arcstats').read().then(lines => {
            let values = '', target = 0, maximum = 0, current = 0;

            if (values = lines.match(/c(\s+)(\d+)(\s+)(\d+)/)) target = values[4];
            if (values = lines.match(/c_max(\s+)(\d+)(\s+)(\d+)/)) maximum = values[4];
            if (values = lines.match(/size(\s+)(\d+)(\s+)(\d+)/)) current = values[4];

            // ZFS statistics
            this._returnValue(callback, 'ARC Target', target, 'storage', 'storage');
            this._returnValue(callback, 'ARC Maximum', maximum, 'storage', 'storage');
            this._returnValue(callback, 'ARC Current', current, 'storage', 'storage');
        }).catch(err => { });

        // check disk performance stats
        new FileModule.File('/proc/diskstats').read("\n").then(lines => {
            for (let line of lines) {
                let loadArray = line.trim().split(/\s+/);
                if ('/dev/' + loadArray[2] == this._storageDevice) {
                    var read = (loadArray[5] * 512);
                    var write = (loadArray[9] * 512);
                    this._returnValue(callback, 'Read total', read, 'storage', 'storage');
                    this._returnValue(callback, 'Write total', write, 'storage', 'storage');
                    this._returnValue(callback, 'Read rate', (read - this._lastRead) / dwell, 'storage', 'storage');
                    this._returnValue(callback, 'Write rate', (write - this._lastWrite) / dwell, 'storage', 'storage');
                    this._lastRead = read;
                    this._lastWrite = write;
                    break;
                }
            }
        }).catch(err => { });

        // skip rest of stats if gtop not available
        if (!hasGTop) return;

        GTop.glibtop_get_fsusage(this.storage, this._settings.get_string('storage-path'));

        let total = this.storage.blocks * this.storage.block_size;
        let avail = this.storage.bavail * this.storage.block_size;
        let free = this.storage.bfree * this.storage.block_size;
        let used = total - free;
        let reserved = (total - avail) - used;

        this._returnValue(callback, 'Total', total, 'storage', 'storage');
        this._returnValue(callback, 'Used', used, 'storage', 'storage');
        this._returnValue(callback, 'Reserved', reserved, 'storage', 'storage');
        this._returnValue(callback, 'Free', avail, 'storage', 'storage');
        this._returnValue(callback, 'storage', avail, 'storage-group', 'storage');
    }

    _queryBattery(callback) {
        let battery_slot = this._settings.get_int('battery-slot');

        // addresses issue #161
        let battery_key = 'BAT'; // BAT0, BAT1 and BAT2
        if (battery_slot == 3) {
            battery_slot = 'T';
        } else if (battery_slot == 4) {
            battery_key = 'CMB'; // CMB0
            battery_slot = 0;
        } else if (battery_slot == 5) {
            battery_key = 'macsmc-battery'; // supports Asahi linux
            battery_slot = '';
        }

        // uevent has all necessary fields, no need to read individual files
        let battery_path = '/sys/class/power_supply/' + battery_key + battery_slot + '/uevent';
        new FileModule.File(battery_path).read("\n").then(lines => {
            let output = {};
            for (let line of lines) {
                let split = line.split('=');
                output[split[0].replace('POWER_SUPPLY_', '')] = split[1];
            }

            if ('STATUS' in output) {
                this._returnValue(callback, 'State', output['STATUS'], 'battery', '');
            }

            if ('CYCLE_COUNT' in output) {
                this._returnValue(callback, 'Cycles', output['CYCLE_COUNT'], 'battery', '');
            }

            if ('VOLTAGE_NOW' in output) {
                this._returnValue(callback, 'Voltage', output['VOLTAGE_NOW'] / 1000, 'battery', 'in');
            }

            if ('CAPACITY_LEVEL' in output) {
                this._returnValue(callback, 'Level', output['CAPACITY_LEVEL'], 'battery', '');
            }

            if ('CAPACITY' in output) {
                this._returnValue(callback, 'Percentage', output['CAPACITY'] / 100, 'battery', 'percent');
            }

            if ('VOLTAGE_NOW' in output && 'CURRENT_NOW' in output && (!('POWER_NOW' in output))) {
                output['POWER_NOW'] = (output['VOLTAGE_NOW'] * output['CURRENT_NOW']) / 1000000;
            }

            if ('POWER_NOW' in output) {
                this._returnValue(callback, 'Rate', output['POWER_NOW'], 'battery', 'watt');
                this._returnValue(callback, 'battery', output['POWER_NOW'], 'battery-group', 'watt');
            }

            if ('CHARGE_FULL' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL' in output))) {
                output['ENERGY_FULL'] = (output['CHARGE_FULL'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;
            }

            if ('ENERGY_FULL' in output) {
                this._returnValue(callback, 'Energy (full)', output['ENERGY_FULL'], 'battery', 'watt-hour');
            }

            if ('CHARGE_FULL_DESIGN' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL_DESIGN' in output))) {
                output['ENERGY_FULL_DESIGN'] = (output['CHARGE_FULL_DESIGN'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;
            }

            if ('ENERGY_FULL_DESIGN' in output) {
                this._returnValue(callback, 'Energy (design)', output['ENERGY_FULL_DESIGN'], 'battery', 'watt-hour');

                if ('ENERGY_FULL' in output) {
                    this._returnValue(callback, 'Capacity', (output['ENERGY_FULL'] / output['ENERGY_FULL_DESIGN']), 'battery', 'percent');
                }
            }

            if ('VOLTAGE_MIN_DESIGN' in output && 'CHARGE_NOW' in output && (!('ENERGY_NOW' in output))) {
                output['ENERGY_NOW'] = (output['VOLTAGE_MIN_DESIGN'] * output['CHARGE_NOW']) / 1000000;
            }

            if ('ENERGY_NOW' in output) {
                this._returnValue(callback, 'Energy (now)', output['ENERGY_NOW'], 'battery', 'watt-hour');
            }

            if ('ENERGY_FULL' in output && 'ENERGY_NOW' in output && 'POWER_NOW' in output && output['POWER_NOW'] > 0 && 'STATUS' in output && (output['STATUS'] == 'Charging' || output['STATUS'] == 'Discharging')) {

                let timeLeft = 0;

                // two different formulas depending on if we are charging or discharging
                if (output['STATUS'] == 'Charging') {
                    timeLeft = ((output['ENERGY_FULL'] - output['ENERGY_NOW']) / output['POWER_NOW']);
                } else {
                    timeLeft = (output['ENERGY_NOW'] / output['POWER_NOW']);
                }

                // don't process Infinity values
                if (timeLeft !== Infinity) {
                    if (this._battery_charge_status != output['STATUS']) {
                        // clears history due to state change
                        this._battery_time_left_history = [];

                        // clear time left history when laptop goes in and out of charging
                        this._battery_charge_status = output['STATUS'];
                    }

                    // add latest time left estimate to our history
                    this._battery_time_left_history.push(parseInt(timeLeft * 3600));

                    // keep track of last 15 time left estimates by erasing the first
                    if (this._battery_time_left_history.length > 10)
                        this._battery_time_left_history.shift();

                    // sum up and create average of our time left history
                    let sum = this._battery_time_left_history.reduce((a, b) => a + b);
                    let avg = sum / this._battery_time_left_history.length;

                    // use time left history to update screen
                    this._returnValue(callback, 'Time left', parseInt(avg), 'battery', 'runtime');
                }
            } else {
                this._returnValue(callback, 'Time left', output['STATUS'], 'battery', '');
            }
        }).catch(err => { });
    }

    _queryGpu(callback) {
        if (!this._nvidia_smi_process) {
            this._disableGpuLabels(callback);
            return;
        }
        
        this._nvidia_smi_process.read('\n').then(lines => {
            /// for debugging multi-gpu on systems with only one gpu
            /// duplicates the first gpu's data 3 times, for 4 total gpus
            ///if(lines.length == 0) return;
            ///for(let _gpuNum = 1; _gpuNum <= 3; _gpuNum++)
            ///    lines.push(lines[0]);

            for (let i = 0; i < lines.length; i++) {
                this._parseNvidiaSmiLine(callback, lines[i], i + 1, lines.length > 1);
            }
            

            // if we've already updated the static info during the last parse, then stop doing so. 
            // this is so the _parseNvidiaSmiLine function won't return static info anymore 
            // and the nvidia-smi commmand won't be queried for static info either
            if(!this._nvidia_static_returned) {
                this._nvidia_static_returned = true;
                //reconfigure the process to stop querying static info
                this._reconfigureNvidiaSmiProcess();
            }
        }).catch(err => {
            this._disableGpuLabels(callback);
            this._terminateNvidiaSmiProcess();
        });
    }

    _parseNvidiaSmiLine(callback, csv, gpuNum, multiGpu) {
        const expectedSplitLength = 19;
        let csv_split = csv.split(',');

        // occasionally the nvidia-smi command can get cut off before it can be fully read, thus the parse function only gets part of a line
        // hence we count the number of bad splits and only terminate the process after a few bad splits in a row
        // this prevents anomalous readings from terminating the process
        if (csv_split.length < expectedSplitLength) {
            this._bad_split_count++;
            //if we've had 2 bad splits/reads in a row, try to restart the process
            if (this._bad_split_count == 2) this._reconfigureNvidiaSmiProcess();
            //if we still get a bad read after that, then it's not an anomaly; terminate the process
            else if (this._bad_split_count >= 3) this._terminateNvidiaSmiProcess();
            return;
        }
        this._bad_split_count = 0;

        let [
            label, 
            fan_speed_pct,
            temp_gpu, temp_mem, 
            mem_total, mem_used, mem_reserved, mem_free,
            util_gpu, util_mem, util_encoder, util_decoder,
            clock_gpu, clock_mem, clock_encode_decode,
            power, power_avg, 
            link_gen_current, link_width_current
        ] = csv_split;

        const staticNames = [
            'temp_limit', 'power_limit',
            'link_gen_max', 'link_width_max',
            'addressing_mode',
            'driver_version', 'vbios', 'serial',
            'domain_num', 'bus_num', 'device_num', 'device_id', 'sub_device_id'
        ];
        let staticInfo = {};

        // if we have queried static info this time around, populate our static info object
        if(csv_split.length == (expectedSplitLength + staticNames.length)){
            for(let i = 0; i < staticNames.length; i++) {
                //set the static info to a default (0) if it's undefined
                const value = csv_split[expectedSplitLength + i];
                staticInfo[staticNames[i]] = (typeof value !== "undefined") ? value : 0;
            }
        }


        const typeName = 'gpu#' + gpuNum;
        const globalLabel = 'GPU' + (multiGpu ? ' ' + gpuNum : '');
        
        const memTempValid = !isNaN(parseInt(temp_mem));
        

        this._returnGpuValue(callback, 'Graphics', parseInt(util_gpu) * 0.01, typeName + '-group', 'percent');

        this._returnGpuValue(callback, 'Name', label, typeName, '');

        this._returnGpuValue(callback, globalLabel, parseInt(fan_speed_pct) * 0.01, 'fan', 'percent');
        this._returnGpuValue(callback, 'Fan', parseInt(fan_speed_pct) * 0.01, typeName, 'percent');

        this._returnGpuValue(callback, globalLabel, parseInt(temp_gpu) * 1000, 'temperature', 'temp');
        this._returnGpuValue(callback, 'Temperature', parseInt(temp_gpu) * 1000, typeName, 'temp');
        this._returnGpuValue(callback, 'Memory Temperature', parseInt(temp_mem) * 1000, typeName, 'temp', memTempValid);
        this._returnStaticGpuValue(callback, 'Temperature Limit', parseInt(staticInfo['temp_limit']) * 1000, typeName, 'temp');

        this._returnGpuValue(callback, 'Memory Usage', parseInt(mem_used) / parseInt(mem_total), typeName, 'percent');
        this._returnGpuValue(callback, 'Memory Total', parseInt(mem_total) * 1000, typeName, 'memory');
        this._returnGpuValue(callback, 'Memory Used', parseInt(mem_used) * 1000, typeName, 'memory');
        this._returnGpuValue(callback, 'Memory Reserved', parseInt(mem_reserved) * 1000, typeName, 'memory');
        this._returnGpuValue(callback, 'Memory Free', parseInt(mem_free) * 1000, typeName, 'memory');

        this._returnGpuValue(callback, 'Memory Utilization', parseInt(util_mem) * 0.01, typeName, 'percent');
        this._returnGpuValue(callback, 'Utilization', parseInt(util_gpu) * 0.01, typeName, 'percent');
        this._returnGpuValue(callback, 'Encoder Utilization', parseInt(util_encoder) * 0.01, typeName, 'percent');
        this._returnGpuValue(callback, 'Decoder Utilization', parseInt(util_decoder) * 0.01, typeName, 'percent');

        this._returnGpuValue(callback, 'Frequency', parseInt(clock_gpu) * 1000 * 1000, typeName, 'hertz');
        this._returnGpuValue(callback, 'Memory Frequency', parseInt(clock_mem) * 1000 * 1000, typeName, 'hertz');
        this._returnGpuValue(callback, 'Encoder/Decoder Frequency', parseInt(clock_encode_decode) * 1000 * 1000, typeName, 'hertz');

        //this._returnGpuValue(callback, 'Encoder Sessions', parseInt(encoder_sessions), typeName, 'string');

        this._returnGpuValue(callback, 'Power', power, typeName, 'watt-gpu');
        this._returnGpuValue(callback, 'Average Power', power_avg, typeName, 'watt-gpu');
        this._returnStaticGpuValue(callback, 'Power Limit', parseInt(staticInfo['power_limit']), typeName, 'watt-gpu');

        this._returnGpuValue(callback, 'Link Speed', link_gen_current + 'x' + link_width_current, typeName, 'pcie');
        this._returnStaticGpuValue(callback, 'Maximum Link Speed', staticInfo['link_gen_max'] + 'x' + staticInfo['link_width_max'], typeName, 'pcie');

        this._returnStaticGpuValue(callback, 'Addressing Mode', staticInfo['addressing_mode'], typeName, 'string');

        this._returnStaticGpuValue(callback, 'Driver Version', staticInfo['driver_version'], typeName, 'string');
        this._returnStaticGpuValue(callback, 'vBIOS Version', staticInfo['vbios'], typeName, 'string');
        this._returnStaticGpuValue(callback, 'Serial Number', staticInfo['serial'], typeName, 'string');

        this._returnStaticGpuValue(callback, 'Domain Number', staticInfo['domain_num'], typeName, 'string');
        this._returnStaticGpuValue(callback, 'Bus Number', staticInfo['bus_num'], typeName, 'string');
        this._returnStaticGpuValue(callback, 'Device Number', staticInfo['device_num'], typeName, 'string');
        this._returnStaticGpuValue(callback, 'Device ID', staticInfo['device_id'], typeName, 'string');
        this._returnStaticGpuValue(callback, 'Sub Device ID', staticInfo['sub_device_id'], typeName, 'string');
    }

    _disableGpuLabels(callback) {
        for (let labelObj of this._nvidia_labels)
            this._returnValue(callback, labelObj.label, 'disabled', labelObj.type, labelObj.format);
    }

    _returnStaticGpuValue(callback, label, value, type, format) {
        //if we've already tried to return existing static info before or if the option isn't enabled, then do nothing.
        if (this._nvidia_static_returned || !this._settings.get_boolean('include-static-gpu-info')) 
            return;

        //we don't need to disable static info labels, so just use ordinary returnValue function
        this._returnValue(callback, label, value, type, format);
    }

    _returnGpuValue(callback, label, value, type, format, display = true) {
        if(!display) return;

        if(value === 'N/A' || value === '[N/A]' || isNaN(value)) return;

        let nvidiaLabel = {'label': label, 'type': type, 'format': format};
        if (!this._nvidia_labels.includes(nvidiaLabel))
            this._nvidia_labels.push(nvidiaLabel);

        this._returnValue(callback, label, value, type, format);
    }

    _returnValue(callback, label, value, type, format) {
        // don't return if value is not a number - will revisit later
        //if (isNaN(value)) return;
        callback(label, value, type, format);
    }

    _discoverHardwareMonitors(callback) {
        this._tempVoltFanSensors = { 'temperature': {}, 'voltage': {}, 'fan': {} };

        let hwbase = '/sys/class/hwmon/';

        // process sensor_types now so it is not called multiple times below
        let sensor_types = {};

        if (this._settings.get_boolean('show-temperature'))
            sensor_types['temp'] = 'temperature';

        if (this._settings.get_boolean('show-voltage'))
            sensor_types['in'] = 'voltage';

        if (this._settings.get_boolean('show-fan'))
            sensor_types['fan'] = 'fan';

        // a little informal, but this code has zero I/O block
        new FileModule.File(hwbase).list().then(files => {
            for (let file of files) {
                // grab name of sensor
                new FileModule.File(hwbase + file + '/name').read().then(name => {
                    // are we dealing with a CPU?
                    if (name == 'coretemp') {
                        // determine which processor (socket) we are dealing with
                        new FileModule.File(hwbase + file + '/temp1_label').read().then(prefix => {
                            this._processTempVoltFan(callback, sensor_types, prefix, hwbase + file, file);
                        }).catch(err => {
                            // this shouldn't be necessary, but just in case temp1_label doesn't exist
                            // attempt to fix #266
                            this._processTempVoltFan(callback, sensor_types, name, hwbase + file, file);
                        });
                    } else {
                        // not a CPU, process all other sensors
                        this._processTempVoltFan(callback, sensor_types, name, hwbase + file, file);
                    }
                }).catch(err => {
                    new FileModule.File(hwbase + file + '/device/name').read().then(name => {
                        this._processTempVoltFan(callback, sensor_types, name, hwbase + file + '/device', file);
                    }).catch(err => { });
                });
            }
        }).catch(err => { });

        // does this system support cpu scaling? if so we will use it to grab Frequency and Boost below
        new FileModule.File('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq').read().then(value => {
            this._processor_uses_cpu_info = false;
        }).catch(err => { });

        // is static CPU information enabled?
        if (this._settings.get_boolean('include-static-info')) {
            // grab static CPU information
            new FileModule.File('/proc/cpuinfo').read("\n").then(lines => {
                let vendor_id = '';
                let bogomips = '';
                let sockets = {};
                let cache = '';

                for (let line of lines) {
                    let value = '';

                    // grab cpu vendor
                    if (value = line.match(/^vendor_id(\s+): (\w+.*)/)) vendor_id = value[2];

                    // grab bogomips
                    if (value = line.match(/^bogomips(\s+): (\d*\.?\d*)$/)) bogomips = value[2];

                    // grab processor count
                    if (value = line.match(/^physical id(\s+): (\d+)$/)) sockets[value[2]] = 1;

                    // grab cache
                    if (value = line.match(/^cache size(\s+): (\d+) KB$/)) cache = value[2];
                }

                this._returnValue(callback, 'Vendor', vendor_id, 'processor', 'string');
                this._returnValue(callback, 'Bogomips', bogomips, 'processor', 'string');
                this._returnValue(callback, 'Sockets', Object.keys(sockets).length, 'processor', 'string');
                this._returnValue(callback, 'Cache', cache, 'processor', 'memory');
            }).catch(err => { });

            // grab static CPU information
            new FileModule.File('/proc/version').read(' ').then(kernelArray => {
                this._returnValue(callback, 'Kernel', kernelArray[2], 'system', 'string');
            }).catch(err => { });
        }

        // Launch nvidia-smi subprocess if nvidia querying is enabled
        this._reconfigureNvidiaSmiProcess();
    }

    // The nvidia-smi subprocess will keep running and print new sensor data to stdout every
    // `update_time` seconds. _queryNvidiaSmi() will be called at roughly the same interval and
    // read from the subprocess's stdout to get new sensor data.

    // Regarding "keeping main process & sub process in sync", there are two possible scenarios:
    // - For some reason, nvidia-smi prints at a somewhat higher frequency than we call
    //   _queryNvidiaSmi() to read data. This is okay, eventually one call to _queryNvidiaSmi()
    //   will read two sensor data updates in a single call.
    // - For some reason, _queryNvidiaSmi() is called at a somewhat higher frequency than
    //   nvidia-smi prints data. This is the more likely scenario with user actions triggering
    //   additional reads. This eventually triggers an "IO PENDING" error while attempting to
    //   read, because the previous async read is still waiting. To solve this, the subprocess
    //   module simply ignores PENDING errors. After ignoring the error, the earlier read will
    //   eventually return and sensor data will be updated, so this scenario is handled correctly.

    // Generally speaking, the call to _queryNvidiaSmi() and nvidia-smi's printing to stdout do
    // not happen at the same time. So the async call in _queryNvidiaSmi() will usually have to
    // wait up to `update_time` seconds before getting any results and reporting them through the
    // callback.
    _reconfigureNvidiaSmiProcess() {
        if (this._settings.get_boolean('show-gpu')) {
            this._terminateNvidiaSmiProcess();
            
            try {
                let update_time = this._settings.get_int('update-time');
                let query_interval = Math.max(update_time, 1);
                let command = [
                    'nvidia-smi',
                    '--query-gpu=name,' +
                    'fan.speed,' +
                    'temperature.gpu,temperature.memory,' +
                    'memory.total,memory.used,memory.reserved,memory.free,' +
                    'utilization.gpu,utilization.memory,utilization.encoder,utilization.decoder,' +
                    'clocks.gr,clocks.mem,clocks.video,' +
                    'power.draw.instant,power.draw.average,' +
                    'pcie.link.gen.gpucurrent,pcie.link.width.current,' +
                    (!this._nvidia_static_returned && this._settings.get_boolean('include-static-gpu-info') ? 
                        'temperature.gpu.tlimit,' +
                        'power.limit,' +
                        'pcie.link.gen.max,pcie.link.width.max,'   +
                        'addressing_mode,'+
                        'driver_version,vbios_version,serial,' +
                        'pci.domain,pci.bus,pci.device,pci.device_id,pci.sub_device_id,' 
                    : ''),
                    '--format=csv,noheader,nounits',
                    '-l', query_interval.toString()
                ];

                this._nvidia_smi_process = new SubProcessModule.SubProcess(command);
            } catch(e) {
                // proprietary nvidia driver not installed
                this._terminateNvidiaSmiProcess();
            }
        } else {
            this._terminateNvidiaSmiProcess();
        }
    }

    _terminateNvidiaSmiProcess() {
        if (this._nvidia_smi_process) {
            this._nvidia_smi_process.terminate();
            this._nvidia_smi_process = null;
        }
    }

    _processTempVoltFan(callback, sensor_types, name, path, file) {
        let sensor_files = [ 'input', 'label' ];

        // grab files from directory
        new FileModule.File(path).list().then(files2 => {
            let trisensors = {};

            // loop over files from directory
            for (let file2 of Object.values(files2)) {
                // simple way of processing input and label (from above)
                for (let key of Object.values(sensor_files)) {
                    // process toggled on sensors from extension preferences
                    for (let sensor_type in sensor_types) {
                        if (file2.substr(0, sensor_type.length) == sensor_type && file2.substr(-(key.length+1)) == '_' + key) {
                            let key2 = file + file2.substr(0, file2.indexOf('_'));

                            if (!(key2 in trisensors)) {
                                trisensors[key2] = {
                                    'type': sensor_types[sensor_type],
                                  'format': sensor_type,
                                   'label': path + '/name'
                                };
                            }

                            trisensors[key2][key] = path + '/' + file2;
                        }
                    }
                }
            }

            for (let obj of Object.values(trisensors)) {
                if (!('input' in obj))
                    continue;

                new FileModule.File(obj['input']).read().then(value => {
                    let extra = (obj['label'].indexOf('_label')==-1) ? ' ' + obj['input'].substr(obj['input'].lastIndexOf('/')+1).split('_')[0] : '';

                    if (value > 0 || !this._settings.get_boolean('hide-zeros') || obj['type'] == 'fan') {
                        new FileModule.File(obj['label']).read().then(label => {
                            this._addTempVoltFan(callback, obj, name, label, extra, value);
                        }).catch(err => {
                            let tmpFile = obj['label'].substr(0, obj['label'].lastIndexOf('/')) + '/name';
                            new FileModule.File(tmpFile).read().then(label => {
                                this._addTempVoltFan(callback, obj, name, label, extra, value);
                            }).catch(err => { });
                        });
                    }
                }).catch(err => { });
            }
        }).catch(err => { });
    }

    _addTempVoltFan(callback, obj, name, label, extra, value) {
        // prepend module that provided sensor data
        if (name != label) label = name + ' ' + label;

        //if (label == 'nvme Composite') label = 'NVMe';
        //if (label == 'nouveau') label = 'Nvidia';

        label = label + extra;

        // in the future we will read /etc/sensors3.conf
        if (label == 'acpitz temp1') label = 'ACPI Thermal Zone';
        if (label == 'pch_cannonlake temp1') label = 'Platform Controller Hub';
        if (label == 'iwlwifi_1 temp1') label = 'Wireless Adapter';
        if (label == 'Package id 0') label = 'Processor 0';
        if (label == 'Package id 1') label = 'Processor 1';
        label = label.replace('Package id', 'CPU');

        let types = [ 'temperature', 'voltage', 'fan' ];
        for (let type of types) {
            // check if this label already exists
            if (label in this._tempVoltFanSensors[type]) {
                for (let i = 2; i <= 9; i++) {
                    // append an incremented number to end
                    let new_label = label + ' ' + i;

                    // if new label is available, use it
                    if (!(new_label in this._tempVoltFanSensors[type])) {
                        label = new_label;
                        break;
                    }
                }
            }
        }

        // update screen on initial build to prevent delay on update
        this._returnValue(callback, label, value, obj['type'], obj['format']);

        this._tempVoltFanSensors[obj['type']][label] = {
          'format': obj['format'],
            'path': obj['input']
        };
    }

    resetHistory() {
        this._next_public_ip_check = 0;
        this._hardware_detected = false;
        this._nvidia_static_returned = false;
        this._processor_uses_cpu_info = true;
        this._battery_time_left_history = [];
        this._battery_charge_status = '';
        this._nvidia_labels = [];
        this._bad_split_count = 0;
    }

    destroy() {
        this._terminateNvidiaSmiProcess();

        for (let signal of Object.values(this._settingChangedSignals))
            this._settings.disconnect(signal);
    }
});
