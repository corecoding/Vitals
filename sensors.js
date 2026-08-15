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

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as SubProcessModule from './helpers/subprocess.js';
import * as FileModule from './helpers/file.js';
import {
    createSensorRegistry,
    getStaticSources,
    createBatterySource,
    createPublicIpSource,
    createGtopStorageSource,
    sensorField,
    emitField,
} from './helpers/sensorSources.js';
import {sensorGroupFromType} from './helpers/catalog.js';

// Shell and prefs hosts expose gettext on different module paths.
let _;
try {
    ({gettext: _} = await import('resource:///org/gnome/shell/extensions/extension.js'));
} catch (err) {
    try {
        ({gettext: _} = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'));
    } catch (err2) {
        _ = (s) => s;
    }
}

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

        this._processor = { last: { core: {}, speed: [] }, coreCount: 0, usesCpuInfo: true };
        this._storageState = { device: '', lastRead: 0, lastWrite: 0 };
        this._publicIpState = { nextCheck: 0 };

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('show-gpu', this._reconfigureNvidiaSmiProcess.bind(this));
        this._addSettingChangedSignal('update-time', this._reconfigureNvidiaSmiProcess.bind(this));
        this._addSettingChangedSignal('network-public-ip-interval', () => {this._publicIpState.nextCheck = 0;});
        this._addSettingChangedSignal('network-public-ip-provider', () => {this._publicIpState.nextCheck = 0;});
        //this._addSettingChangedSignal('include-static-gpu-info', this._reconfigureNvidiaSmiProcess.bind(this));

        this._gpu_drm_vendors = null;
        this._gpu_drm_indices = null;
        this._nvidia_smi_process = null;
        this._nvidia_labels = [];
        this._bad_split_count = 0;

        this._frameMonitorSignalId = 0;
        this._frameMonitorLastTime = 0;
        this._frameMonitorFrameCount = 0;
        this._frameMonitorAccTime = 0;
        this._frameMonitorCurrentHz = 0;

        // Path-centric registry: static catalog + discovery appends (hwmon, net, …)
        this._registry = createSensorRegistry();
        this._hwmonLabels = {temperature: {}, voltage: {}, fan: {}};
        this._batteryState = {timeLeftHistory: [], chargeStatus: ''};
        for (let source of getStaticSources())
            this._registry.registerSource(source);
        this._registry.registerSource(createBatterySource(
            () => this._settings.get_int('battery-slot'),
            this._batteryState));
        this._findStorageDevice();
        if (hasGTop)
            this.storage = new GTop.glibtop_fsusage();
        this._registerHookSources();
        this._rebuildHotFromSettings();
        this._addSettingChangedSignal('hot-sensors', this._rebuildHotFromSettings.bind(this));
    }

    _addSettingChangedSignal(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    }

    _findStorageDevice() {
        new FileModule.File('/proc/mounts').read("\n").then(lines => {
            for (let line of lines) {
                let loadArray = line.trim().split(/\s+/);
                if (loadArray[1] == this._settings.get_string('storage-path')) {
                    this._storageState.device = loadArray[0];
                    break;
                }
            }
        }).catch(err => { });
    }

    _rebuildHotFromSettings() {
        this._registry.rebuildHot(this._settings.get_strv('hot-sensors'));
    }

    getHotFullGroups() {
        return this._registry.hotFullGroups;
    }

    /**
     * Poll sensors. Closed menu uses the cached hot subset; open menu uses the full catalog.
     * Defaults to a full query so prefs discovery still enumerates every source.
     */
    query(callback, dwell, menuOpen = true) {
        if (menuOpen)
            console.log('Vitals: query start full');
        else
            console.log(`Vitals: query start hot n=${this._registry.hot.length}`);

        if (!this._hardware_detected) {
            // we could set _hardware_detected in discoverHardwareMonitors, but by
            // doing it here, we guarantee avoidance of race conditions
            this._hardware_detected = true;
            console.log('Vitals: discovering hardware monitors');
            this._discoverHardwareMonitors(callback);
        }

        const showGroup = group => {
            return this._settings.get_boolean('show-' + sensorGroupFromType(group));
        };

        this._registry.poll(
            this._returnValue.bind(this),
            callback,
            !!menuOpen,
            {
                showGroup,
                settings: this._settings,
                dwell,
                _: _,
                processor: this._processor,
                processorCores: this._processor.coreCount,
                storage: this._storageState,
            });
    }

    _registerHookSources() {
        this._registry.registerSource(createPublicIpSource(this._publicIpState));
        if (hasGTop) {
            this._registry.registerSource(createGtopStorageSource({
                read: () => {
                    GTop.glibtop_get_fsusage(this.storage, this._settings.get_string('storage-path'));
                    return this.storage;
                },
            }));
        }
        this._registry.registerSource({
            id: 'custom-gpu',
            group: 'gpu',
            matchGroup: true,
            poll: (emit) => {
                this._pollGpu(emit);
            },
        });
    }

    _discoverNetworkIfaces() {
        let netbase = '/sys/class/net/';
        new FileModule.File(netbase).list().then(interfaces => {
            const directions = ['tx', 'rx'];
            for (let iface of interfaces) {
                for (let direction of directions) {
                    if (iface == 'lo' && direction == 'rx')
                        continue;

                    let name = iface + ((iface == 'lo') ? '' : ' ' + direction);
                    let type = 'network' + ((iface == 'lo') ? '' : '-' + direction);
                    let path = netbase + iface + '/statistics/' + direction + '_bytes';

                    this._registry.registerSource({
                        id: 'net-iface:' + path,
                        path,
                        group: 'network',
                        parse: 'raw',
                        fields: [{label: name, type, format: 'storage'}],
                    }, {discovered: true});
                }
            }
        }).catch(err => { });
    }

    _initFrameMonitor() {
        // Prefs has no gnome-shell `global`; skip refresh-rate sampling there.
        if (typeof global === 'undefined' || !global.stage)
            return;

        if (this._frameMonitorSignalId) return;
        this._frameMonitorLastTime = 0;
        this._frameMonitorFrameCount = 0;
        this._frameMonitorAccTime = 0;
        this._frameMonitorCurrentHz = 0;
        this._frameMonitorSignalId = global.stage.connect('after-paint', () => {
            this._onAfterPaint();
        });
    }

    _destroyFrameMonitor() {
        if (typeof global === 'undefined' || !global.stage) {
            this._frameMonitorSignalId = 0;
            this._frameMonitorLastTime = 0;
            this._frameMonitorCurrentHz = 0;
            return;
        }
        if (this._frameMonitorSignalId) {
            global.stage.disconnect(this._frameMonitorSignalId);
            this._frameMonitorSignalId = 0;
        }
        this._frameMonitorLastTime = 0;
        this._frameMonitorCurrentHz = 0;
    }

    _onAfterPaint() {
        const now = GLib.get_monotonic_time();

        if (this._frameMonitorLastTime === 0) {
            this._frameMonitorLastTime = now;
            return;
        }

        const delta = now - this._frameMonitorLastTime;
        this._frameMonitorLastTime = now;

        this._frameMonitorFrameCount++;
        this._frameMonitorAccTime += delta;

        if (this._frameMonitorAccTime >= 500000) {
            this._frameMonitorCurrentHz = this._frameMonitorFrameCount / (this._frameMonitorAccTime / 1000000);
            this._frameMonitorFrameCount = 0;
            this._frameMonitorAccTime = 0;
        }
    }

    _pollGpu(emit) {
        if (this._frameMonitorCurrentHz > 0)
            emit('Refresh Rate', this._frameMonitorCurrentHz, 'gpu#1', 'hertz');

        if (!this._nvidia_smi_process) {
            if (!this._gpu_drm_indices) {
                if (this._frameMonitorCurrentHz > 0)
                    emit('Refresh Rate', this._frameMonitorCurrentHz, 'gpu#1-group', 'hertz');
                this._disableGpuLabels(emit);
            }
            return;
        }

        this._nvidia_smi_process.read('\n').then(lines => {
            for (let i = 0; i < lines.length; i++) {
                this._parseNvidiaSmiLine(emit, lines[i], i + 1, lines.length > 1);
            }

            if(!this._nvidia_static_returned) {
                this._nvidia_static_returned = true;
                this._reconfigureNvidiaSmiProcess();
            }
        }).catch(err => {
            this._disableGpuLabels(emit);
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

        if(format !== "string" && (value === 'N/A' || value === '[N/A]' || isNaN(value))) return;

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
        this._registry.clearDiscovered();
        this._hwmonLabels = { 'temperature': {}, 'voltage': {}, 'fan': {} };

        // One-time net iface discovery (poll only reads the registered byte files)
        this._discoverNetworkIfaces();

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
            this._processor.usesCpuInfo = false;
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
        this._discoverGpuDrm();
        this._initFrameMonitor();
    }

    _discoverGpuDrm() {
        // use DRM only if nvidia-smi is not used
        if (this._settings.get_boolean('show-gpu') && this._nvidia_smi_process == null) {
            for (let i = 0; i < 10; i++) {
                const card = i;
                new FileModule.File('/sys/class/drm/card' + card + '/device/vendor').read().then(vendor => {
                    if (!this._gpu_drm_indices) {
                        this._gpu_drm_indices = [];
                        this._gpu_drm_vendors = [];
                    }
                    this._gpu_drm_indices.push(card);
                    this._gpu_drm_vendors.push(vendor);
                    this._registerDrmSources(card, vendor);
                }).catch(err => { });
            }
        } else {
            this._gpu_drm_vendors = null;
            this._gpu_drm_indices = null;
        }
    }

    _registerDrmSources(card, vendor) {
        const typeName = 'gpu#' + card;
        const base = '/sys/class/drm/card' + card + '/device/';

        if (vendor === '0x1002') {
            const busy = {
                graphics: sensorField('Graphics', typeName + '-group', 'percent'),
                vendor: sensorField('Vendor', typeName, 'string'),
                usage: sensorField('Usage', typeName, 'percent'),
            };
            this._registry.registerSource({
                id: 'drm:' + base + 'gpu_busy_percent',
                path: base + 'gpu_busy_percent',
                group: 'gpu',
                parse: 'raw',
                fields: Object.values(busy),
                extract(contents, _ctx, wantedKeys) {
                    let usage = parseInt(contents) * 0.01;
                    const rows = [];
                    emitField(rows, busy.graphics, usage, wantedKeys);
                    emitField(rows, busy.vendor, 'AMD', wantedKeys);
                    emitField(rows, busy.usage, usage, wantedKeys);
                    return rows;
                },
            }, {discovered: true});

            const memUsed = sensorField('Memory Used', typeName, 'memory');
            this._registry.registerSource({
                id: 'drm:' + base + 'mem_info_vram_used',
                path: base + 'mem_info_vram_used',
                group: 'gpu',
                parse: 'raw',
                fields: [memUsed],
                extract: (contents, ctx, wantedKeys) => {
                    let unit = ctx.settings.get_int('memory-measurement') ? 1000 : 1024;
                    const rows = [];
                    emitField(rows, memUsed, parseInt(contents) / unit, wantedKeys);
                    return rows;
                },
            }, {discovered: true});

            const memTotal = sensorField('Memory Total', typeName, 'memory');
            this._registry.registerSource({
                id: 'drm:' + base + 'mem_info_vram_total',
                path: base + 'mem_info_vram_total',
                group: 'gpu',
                parse: 'raw',
                fields: [memTotal],
                extract: (contents, ctx, wantedKeys) => {
                    let unit = ctx.settings.get_int('memory-measurement') ? 1000 : 1024;
                    const rows = [];
                    emitField(rows, memTotal, parseInt(contents) / unit, wantedKeys);
                    return rows;
                },
            }, {discovered: true});
            return;
        }

        let vendorName;
        switch (vendor) {
            case '0x10DE': vendorName = 'NVIDIA'; break;
            case '0x13B5': vendorName = 'ARM'; break;
            case '0x5143': vendorName = 'Qualcomm'; break;
            case '0x8086': vendorName = 'Intel'; break;
            default: vendorName = 'Unknown ' + vendor;
        }
        const graphics = sensorField('Graphics', typeName + '-group', 'string');
        this._registry.registerSource({
            id: 'drm:' + base + 'vendor',
            path: base + 'vendor',
            group: 'gpu',
            parse: 'raw',
            fields: [graphics],
            extract(_contents, _ctx, wantedKeys) {
                const rows = [];
                emitField(rows, graphics, vendorName, wantedKeys);
                return rows;
            },
        }, {discovered: true});
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

        label = label + extra;

        // in the future we will read /etc/sensors3.conf
        if (label == 'acpitz temp1') label = 'ACPI Thermal Zone';
        if (label == 'pch_cannonlake temp1') label = 'Platform Controller Hub';
        if (label == 'iwlwifi_1 temp1') label = 'Wireless Adapter';
        if (label == 'Package id 0') label = 'Processor 0';
        if (label == 'Package id 1') label = 'Processor 1';
        label = label.replace('Package id', 'CPU');

        let type = obj['type'];
        // check if this label already exists
        if (label in this._hwmonLabels[type]) {
            for (let i = 2; i <= 9; i++) {
                let new_label = label + ' ' + i;
                if (!(new_label in this._hwmonLabels[type])) {
                    label = new_label;
                    break;
                }
            }
        }

        this._hwmonLabels[type][label] = true;

        // update screen on initial build to prevent delay on update
        this._returnValue(callback, label, value, type, obj['format']);

        // Append into the shared registry (same shape as static /proc sources)
        this._registry.registerSource({
            id: 'hwmon:' + obj['input'],
            path: obj['input'],
            group: type,
            parse: 'raw',
            fields: [{label, type, format: obj['format']}],
        }, {discovered: true});
    }

    resetHistory() {
        this._hardware_detected = false;
        this._nvidia_static_returned = false;
        this._batteryState = {timeLeftHistory: [], chargeStatus: ''};
        if (this._processor) {
            this._processor.usesCpuInfo = true;
            this._processor.coreCount = 0;
            this._processor.last = { core: {}, speed: [] };
        }
        if (this._publicIpState)
            this._publicIpState.nextCheck = 0;
        if (this._storageState) {
            this._storageState.lastRead = 0;
            this._storageState.lastWrite = 0;
        }
        // Re-bind battery source state after reset
        if (this._registry) {
            this._registry.clearDiscovered();
            this._registry.unregisterSource('sys-battery-uevent');
            this._registry.registerSource(createBatterySource(
                () => this._settings.get_int('battery-slot'),
                this._batteryState));
        }
        this._hwmonLabels = {temperature: {}, voltage: {}, fan: {}};
        this._nvidia_labels = [];
        this._bad_split_count = 0;
        this._frameMonitorLastTime = 0;
        this._frameMonitorFrameCount = 0;
        this._frameMonitorAccTime = 0;
    }

    destroy() {
        this._destroyFrameMonitor();
        this._terminateNvidiaSmiProcess();

        for (let signal of Object.values(this._settingChangedSignals))
            this._settings.disconnect(signal);
    }
});
