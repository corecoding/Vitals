/*
  Path-centric sensor source registry.

  Static catalog entries are registered at Sensors init. Discovery (hwmon, net
  ifaces, …) appends more sources in the same shape. rebuildHot() tags sources
  when pins change; closed-menu poll iterates that snapshot only.
*/

import * as FileModule from './file.js';
import {sensorKeyFromTypeLabel, parseSensorKey, aliasHotSensorKey} from './colors.js';
import {sensorGroupFromType} from './catalog.js';

export function fieldKey(type, label) {
    return sensorKeyFromTypeLabel(type, label);
}

export function sensorField(label, type, format, extra) {
    return Object.assign({label, type, format: format || '', key: fieldKey(type, label)}, extra || {});
}

export function emitField(sink, field, value, wantedKeys, overrides) {
    if (wantedKeys && !wantedKeys.has(field.key))
        return;
    const type = (overrides && overrides.type) || field.type;
    const format = (overrides && 'format' in overrides) ? overrides.format : (field.format || '');
    if (Array.isArray(sink))
        sink.push({label: field.label, value, type, format});
    else
        sink(field.label, value, type, format);
}

export function wantsAny(fields, wantedKeys) {
    if (!wantedKeys)
        return true;
    return fields.some(field => wantedKeys.has(field.key));
}

/**
 * @typedef {object} SensorField
 * @property {string} label
 * @property {string} type
 * @property {string} [format]
 * @property {string} [key] - defaults from type+label
 */

/**
 * @typedef {object} SensorSource
 * @property {string} id
 * @property {string} group - catalog group (memory, temperature, …)
 * @property {string} [path]
 * @property {function} [getPath] - (ctx) => path
 * @property {string} [parse] - raw | regex | split | uevent | custom
 * @property {string|RegExp} [delimiter] - for File.read
 * @property {boolean} [stripHeader]
 * @property {SensorField[]} fields
 * @property {boolean} [hot] - true when included in the closed-menu snapshot
 * @property {Set<string>|null} [wantedKeys] - null emits all fields
 * @property {function} [extract] - (contents, ctx, wantedKeys) => emit rows
 * @property {function} [poll] - leftover query: (callback, wantedKeys, ctx)
 * @property {function} [matchKey] - extra pin-key matcher (dynamic cores, …)
 * @property {boolean} [matchGroup] - hot when any pin is this catalog group
 * @property {boolean} [skipFullGroup] - exclude from aggregate full-group reads
 * @property {boolean} [discovered]
 */

export function createSensorRegistry() {
    /** @type {Map<string, SensorSource>} */
    const sources = new Map();
    const discoveredIds = new Set();
    let lastHotKeys = null;
    let hot = [];
    let hotFullGroups = new Set();

    function normalizeSource(source) {
        const fields = source.fields || [];
        for (let field of fields) {
            if (!field.key)
                field.key = fieldKey(field.type, field.label);
        }
        return {...source, fields, hot: false, wantedKeys: null};
    }

    function registerSource(source, options = {}) {
        const normalized = normalizeSource(source);
        sources.set(normalized.id, normalized);
        if (options.discovered)
            discoveredIds.add(normalized.id);
        if (lastHotKeys)
            rebuildHot();
        return normalized;
    }

    function unregisterSource(id) {
        sources.delete(id);
        discoveredIds.delete(id);
        if (lastHotKeys)
            rebuildHot();
    }

    function clearDiscovered() {
        for (let id of discoveredIds)
            sources.delete(id);
        discoveredIds.clear();
        if (lastHotKeys)
            rebuildHot();
    }

    function allSources() {
        return [...sources.values()];
    }

    function sourcesForGroup(group) {
        return allSources().filter(source => source.group === group);
    }

    function normalizeHotKey(key) {
        key = aliasHotSensorKey(key);
        if (key == '_default_icon_')
            return null;
        return key;
    }

    function groupFromPinKey(key) {
        let agg = key.match(/^__(.+?)_(avg|min|max|boot|ses)__$/);
        if (agg)
            return sensorGroupFromType(agg[1]);
        let parsed = parseSensorKey(key);
        if (!parsed || !parsed.typePart)
            return '';
        return sensorGroupFromType(parsed.typePart);
    }

    function rebuildHot(hotKeys) {
        if (hotKeys)
            lastHotKeys = hotKeys;
        if (!lastHotKeys)
            lastHotKeys = [];

        const keys = new Set();
        for (let key of lastHotKeys) {
            key = normalizeHotKey(key);
            if (key)
                keys.add(key);
        }

        hotFullGroups = new Set();
        const pinGroups = new Set();
        for (let key of keys) {
            let group = groupFromPinKey(key);
            if (!group)
                continue;
            if (/^__(.+?)_(avg|min|max|boot|ses)__$/.test(key))
                hotFullGroups.add(group);
            else
                pinGroups.add(group);
        }

        for (let source of sources.values()) {
            source.hot = false;
            source.wantedKeys = null;

            const matching = [];
            for (let field of source.fields) {
                if (keys.has(field.key))
                    matching.push(field.key);
            }
            if (typeof source.matchKey === 'function') {
                for (let key of keys) {
                    if (source.matchKey(key))
                        matching.push(key);
                }
            }

            const isFull = hotFullGroups.has(source.group) && !source.skipFullGroup;
            const isGroup = source.matchGroup && pinGroups.has(source.group);
            if (isFull) {
                source.hot = true;
                source.wantedKeys = null;
            } else if (isGroup) {
                source.hot = true;
                source.wantedKeys = null;
            } else if (matching.length) {
                source.hot = true;
                source.wantedKeys = new Set(matching);
            }
        }

        hot = [...sources.values()].filter(source => source.hot);
    }

    function shouldEmitField(field, wantedKeys) {
        if (!wantedKeys)
            return true;
        return wantedKeys.has(field.key);
    }

    function defaultExtract(source, contents, _ctx, wantedKeys) {
        const rows = [];

        if (source.parse === 'raw') {
            const field = source.fields[0];
            if (field && shouldEmitField(field, wantedKeys)) {
                rows.push({
                    label: field.label,
                    value: contents,
                    type: field.type,
                    format: field.format || '',
                });
            }
            return rows;
        }

        if (source.parse === 'regex') {
            const text = typeof contents === 'string' ? contents : String(contents);
            for (let field of source.fields) {
                if (!shouldEmitField(field, wantedKeys))
                    continue;
                if (!field.match)
                    continue;
                let m = text.match(field.match);
                if (!m)
                    continue;
                let value = field.capture != null ? m[field.capture] : m[1];
                if (field.number)
                    value = parseFloat(value);
                if (field.scale)
                    value = value * field.scale;
                rows.push({
                    label: field.label,
                    value,
                    type: field.type,
                    format: field.format || '',
                });
            }
            return rows;
        }

        if (source.parse === 'split') {
            const parts = Array.isArray(contents) ? contents : String(contents).split(source.splitOn || ' ');
            for (let field of source.fields) {
                if (!shouldEmitField(field, wantedKeys))
                    continue;
                let value = parts[field.index];
                if (field.number)
                    value = parseFloat(value);
                rows.push({
                    label: field.label,
                    value,
                    type: field.type,
                    format: field.format || '',
                });
            }
            return rows;
        }

        if (source.parse === 'uevent') {
            const lines = Array.isArray(contents) ? contents : String(contents).split('\n');
            const map = {};
            for (let line of lines) {
                let split = line.split('=');
                if (split.length < 2)
                    continue;
                map[split[0].replace('POWER_SUPPLY_', '')] = split.slice(1).join('=');
            }
            for (let field of source.fields) {
                if (!shouldEmitField(field, wantedKeys))
                    continue;
                if (!(field.ueventKey in map))
                    continue;
                let value = map[field.ueventKey];
                if (field.number)
                    value = parseFloat(value);
                if (field.scale)
                    value = value * field.scale;
                rows.push({
                    label: field.label,
                    value,
                    type: field.type,
                    format: field.format || '',
                });
            }
            return {rows, map};
        }

        return rows;
    }

    function poll(returnValue, callback, menuOpen, ctx) {
        const showGroup = ctx.showGroup || (() => true);
        const list = menuOpen ? sources.values() : hot;

        for (let source of list) {
            if (menuOpen && !showGroup(source.group))
                continue;

            const wantedKeys = menuOpen ? null : source.wantedKeys;
            if (typeof source.poll === 'function') {
                const emit = (label, value, type, format) =>
                    returnValue(callback, label, value, type, format);
                source.poll(emit, wantedKeys, ctx);
                continue;
            }

            const path = source.getPath ? source.getPath(ctx) : source.path;
            if (!path)
                continue;
            const delimiter = source.delimiter != null ? source.delimiter : '';
            const stripHeader = !!source.stripHeader;

            new FileModule.File(path).read(delimiter, stripHeader).then(contents => {
                let rows;
                if (typeof source.extract === 'function') {
                    rows = source.extract(contents, ctx, wantedKeys) || [];
                } else {
                    const extracted = defaultExtract(source, contents, ctx, wantedKeys);
                    if (extracted && extracted.rows) {
                        rows = extracted.rows;
                        if (typeof source.afterExtract === 'function')
                            rows = rows.concat(source.afterExtract(extracted.map, ctx, wantedKeys) || []);
                    } else {
                        rows = extracted || [];
                    }
                }

                for (let row of rows) {
                    if (!row)
                        continue;
                    returnValue(callback, row.label, row.value, row.type, row.format || '');
                }
            }).catch(err => {
                if (source.parse === 'raw' && source.fields[0]) {
                    const field = source.fields[0];
                    if (shouldEmitField(field, wantedKeys))
                        returnValue(callback, field.label, 'disabled', field.type, field.format || '');
                }
            });
        }
    }

    return {
        registerSource,
        unregisterSource,
        clearDiscovered,
        allSources,
        sourcesForGroup,
        rebuildHot,
        poll,
        get hot() { return hot; },
        get hotFullGroups() { return hotFullGroups; },
    };
}

const FREQ = {
    frequency: sensorField('Frequency', 'processor', 'hertz'),
    max: sensorField('Max frequency', 'processor', 'hertz'),
    min: sensorField('Min frequency', 'processor', 'hertz'),
};
const FREQ_FIELDS = Object.values(FREQ);

/** Hard-coded sources common across machines. Discovery appends more later. */
export function getStaticSources() {
    const MEM = {
        usage: sensorField('Usage', 'memory', 'percent'),
        group: sensorField('memory', 'memory-group', 'percent'),
        physical: sensorField('Physical', 'memory', 'memory'),
        available: sensorField('Available', 'memory', 'memory'),
        allocated: sensorField('Allocated', 'memory', 'memory'),
        cached: sensorField('Cached', 'memory', 'memory'),
        free: sensorField('Free', 'memory', 'memory'),
        swapTotal: sensorField('Swap Total', 'memory', 'memory'),
        swapFree: sensorField('Swap Free', 'memory', 'memory'),
        swapUsed: sensorField('Swap Used', 'memory', 'memory'),
        swapUsage: sensorField('Swap Usage', 'memory', 'percent'),
    };
    const LOAD = {
        load1m: sensorField('Load 1m', 'system', 'load'),
        group: sensorField('system', 'system-group', 'load'),
        load5m: sensorField('Load 5m', 'system', 'load'),
        load15m: sensorField('Load 15m', 'system', 'load'),
        threadsActive: sensorField('Threads Active', 'system', 'string'),
        threadsTotal: sensorField('Threads Total', 'system', 'string'),
    };
    const UPTIME = {
        uptime: sensorField('Uptime', 'system', 'uptime'),
        processTime: sensorField('Process Time', 'processor', 'uptime'),
    };
    const ZFS = {
        target: sensorField('ARC Target', 'storage', 'storage'),
        maximum: sensorField('ARC Maximum', 'storage', 'storage'),
        current: sensorField('ARC Current', 'storage', 'storage'),
    };
    const WIFI = {
        quality: sensorField('WiFi Link Quality', 'network', 'percent'),
        signal: sensorField('WiFi Signal Level', 'network', 'string'),
    };
    const STAT = {
        usage: sensorField('Usage', 'processor', 'percent'),
        group: sensorField('processor', 'processor-group', 'percent'),
    };
    const DISK = {
        readTotal: sensorField('Read total', 'storage', 'storage'),
        writeTotal: sensorField('Write total', 'storage', 'storage'),
        readRate: sensorField('Read rate', 'storage', 'storage'),
        writeRate: sensorField('Write rate', 'storage', 'storage'),
    };

    return [
        {
            id: 'proc-meminfo',
            path: '/proc/meminfo',
            group: 'memory',
            fields: Object.values(MEM),
            extract(text, _ctx, wantedKeys) {
                let values = '', total = 0, avail = 0, swapTotal = 0, swapFree = 0, cached = 0, memFree = 0;
                if (values = text.match(/MemTotal:(\s+)(\d+) kB/)) total = values[2];
                if (values = text.match(/MemAvailable:(\s+)(\d+) kB/)) avail = values[2];
                if (values = text.match(/SwapTotal:(\s+)(\d+) kB/)) swapTotal = values[2];
                if (values = text.match(/SwapFree:(\s+)(\d+) kB/)) swapFree = values[2];
                if (values = text.match(/Cached:(\s+)(\d+) kB/)) cached = values[2];
                if (values = text.match(/MemFree:(\s+)(\d+) kB/)) memFree = values[2];

                let used = total - avail;
                let utilized = used / total;
                let swapUsed = swapTotal - swapFree;
                let swapUtilized = swapUsed / swapTotal;

                const rows = [];
                emitField(rows, MEM.usage, utilized, wantedKeys);
                emitField(rows, MEM.group, utilized, wantedKeys);
                emitField(rows, MEM.physical, total, wantedKeys);
                emitField(rows, MEM.available, avail, wantedKeys);
                emitField(rows, MEM.allocated, used, wantedKeys);
                emitField(rows, MEM.cached, cached, wantedKeys);
                emitField(rows, MEM.free, memFree, wantedKeys);
                emitField(rows, MEM.swapTotal, swapTotal, wantedKeys);
                emitField(rows, MEM.swapFree, swapFree, wantedKeys);
                emitField(rows, MEM.swapUsed, swapUsed, wantedKeys);
                emitField(rows, MEM.swapUsage, swapUtilized, wantedKeys);
                return rows;
            },
        },
        {
            id: 'proc-file-nr',
            path: '/proc/sys/fs/file-nr',
            group: 'system',
            delimiter: '\t',
            parse: 'split',
            splitOn: '\t',
            fields: [
                {label: 'Open Files', type: 'system', format: 'string', index: 0},
            ],
        },
        {
            id: 'proc-loadavg',
            path: '/proc/loadavg',
            group: 'system',
            delimiter: ' ',
            fields: Object.values(LOAD),
            extract(parts, _ctx, wantedKeys) {
                const proc = String(parts[3] || '').split('/');
                const rows = [];
                emitField(rows, LOAD.load1m, parseFloat(parts[0]), wantedKeys);
                emitField(rows, LOAD.group, parseFloat(parts[0]), wantedKeys);
                emitField(rows, LOAD.load5m, parseFloat(parts[1]), wantedKeys);
                emitField(rows, LOAD.load15m, parseFloat(parts[2]), wantedKeys);
                emitField(rows, LOAD.threadsActive, proc[0], wantedKeys);
                emitField(rows, LOAD.threadsTotal, proc[1], wantedKeys);
                return rows;
            },
        },
        {
            id: 'proc-uptime',
            path: '/proc/uptime',
            group: 'system',
            delimiter: ' ',
            fields: Object.values(UPTIME),
            extract(parts, ctx, wantedKeys) {
                const rows = [];
                emitField(rows, UPTIME.uptime, parts[0], wantedKeys);

                // Process Time is typed as processor but sourced from uptime
                let cores = (ctx.processor && ctx.processor.coreCount) || ctx.processorCores || 0;
                if (cores > 0)
                    emitField(rows, UPTIME.processTime, parts[0] - parts[1] / cores, wantedKeys);
                return rows;
            },
        },
        {
            id: 'proc-zfs-arcstats',
            path: '/proc/spl/kstat/zfs/arcstats',
            group: 'storage',
            fields: Object.values(ZFS),
            extract(text, _ctx, wantedKeys) {
                let values = '', target = 0, maximum = 0, current = 0;
                if (values = text.match(/c(\s+)(\d+)(\s+)(\d+)/)) target = values[4];
                if (values = text.match(/c_max(\s+)(\d+)(\s+)(\d+)/)) maximum = values[4];
                if (values = text.match(/size(\s+)(\d+)(\s+)(\d+)/)) current = values[4];
                const rows = [];
                emitField(rows, ZFS.target, target, wantedKeys);
                emitField(rows, ZFS.maximum, maximum, wantedKeys);
                emitField(rows, ZFS.current, current, wantedKeys);
                return rows;
            },
        },
        {
            id: 'proc-net-wireless',
            path: '/proc/net/wireless',
            group: 'network',
            // Device max aggregate should not force a wireless read
            skipFullGroup: true,
            delimiter: '\n',
            stripHeader: true,
            fields: Object.values(WIFI),
            extract(lines, _ctx, wantedKeys) {
                // wireless has two headers - first stripped by File.read
                if (Array.isArray(lines))
                    lines = lines.slice();
                else
                    lines = String(lines).split('\n');
                lines.shift();

                let quality_pct = null, signal = null;
                for (let line of lines) {
                    if (!line || !String(line).trim())
                        continue;
                    let netArray = String(line).trim().split(/\s+/);
                    quality_pct = netArray[2].substr(0, netArray[2].length - 1) / 70;
                    signal = netArray[3].substr(0, netArray[3].length - 1);
                }
                if (quality_pct == null)
                    return [];

                const rows = [];
                emitField(rows, WIFI.quality, quality_pct, wantedKeys);
                emitField(rows, WIFI.signal, signal, wantedKeys);
                return rows;
            },
        },
        {
            id: 'proc-stat',
            path: '/proc/stat',
            group: 'processor',
            delimiter: '\n',
            matchKey: key => key.startsWith('_processor_') && key.includes('_core_'),
            fields: Object.values(STAT),
            extract(lines, ctx, wantedKeys) {
                const proc = ctx.processor;
                if (!proc)
                    return [];
                const dwell = ctx.dwell || 1;
                const emitAll = !wantedKeys;
                const needsCores = emitAll || [...wantedKeys].some(k => k.includes('_core_'));
                const formatCore = ctx._ || (s => s);
                const columns = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'guest', 'guest_nice'];
                const statistics = {};
                let cores = 0;

                for (let line of lines) {
                    let reverse_data = line.match(/^(cpu\d*\s)(.+)/);
                    if (!reverse_data)
                        continue;

                    let cpu = reverse_data[1].trim();
                    if (cpu !== 'cpu')
                        cores++;

                    if (!needsCores && cpu !== 'cpu')
                        continue;

                    if (!(cpu in statistics))
                        statistics[cpu] = {};
                    if (!(cpu in proc.last.core))
                        proc.last.core[cpu] = 0;

                    let stats = reverse_data[2].trim().split(' ').reverse();
                    for (let column of columns)
                        statistics[cpu][column] = parseInt(stats.pop());
                }

                if (cores > 0)
                    proc.coreCount = cores;
                else
                    cores = proc.coreCount || 0;
                ctx.processorCores = proc.coreCount || cores;

                const rows = [];
                for (let cpu in statistics) {
                    let total = statistics[cpu]['user'] + statistics[cpu]['nice'] + statistics[cpu]['system'];
                    if (proc.last.core[cpu] > 0) {
                        let delta = (total - proc.last.core[cpu]) / dwell;
                        if (cpu == 'cpu') {
                            delta = delta / (cores || 1);
                            emitField(rows, STAT.group, delta / 100, wantedKeys);
                            emitField(rows, STAT.usage, delta / 100, wantedKeys);
                        } else {
                            let label = formatCore('Core %d').format(cpu.substr(3));
                            if (emitAll || wantedKeys.has(fieldKey('processor', label)))
                                rows.push({label, value: delta / 100, type: 'processor', format: 'percent'});
                        }
                    }
                    proc.last.core[cpu] = total;
                }
                return rows;
            },
        },
        {
            id: 'proc-cpuinfo-freq',
            group: 'processor',
            delimiter: '\n',
            fields: FREQ_FIELDS,
            getPath(ctx) {
                return (ctx.processor && ctx.processor.usesCpuInfo) ? '/proc/cpuinfo' : null;
            },
            extract(lines, _ctx, wantedKeys) {
                let freqs = [];
                for (let line of lines) {
                    let value = line.match(/^cpu MHz(\s+): ([+-]?\d+(\.\d+)?)/);
                    if (value)
                        freqs.push(parseFloat(value[2]));
                }
                if (!freqs.length)
                    return [];
                let sum = freqs.reduce((a, b) => a + b);
                const rows = [];
                emitField(rows, FREQ.frequency, (sum / freqs.length) * 1000 * 1000, wantedKeys);
                emitField(rows, FREQ.max, freqs.reduce((a, b) => Math.max(a, b)) * 1000 * 1000, wantedKeys);
                emitField(rows, FREQ.min, freqs.reduce((a, b) => Math.min(a, b)) * 1000 * 1000, wantedKeys);
                return rows;
            },
        },
        createSysCpufreqSource(),
        {
            id: 'proc-diskstats',
            path: '/proc/diskstats',
            group: 'storage',
            delimiter: '\n',
            fields: Object.values(DISK),
            extract(lines, ctx, wantedKeys) {
                const st = ctx.storage;
                if (!st || !st.device)
                    return [];
                const dwell = ctx.dwell || 1;
                const rows = [];
                for (let line of lines) {
                    let loadArray = line.trim().split(/\s+/);
                    if ('/dev/' + loadArray[2] != st.device)
                        continue;
                    var read = (loadArray[5] * 512);
                    var write = (loadArray[9] * 512);
                    emitField(rows, DISK.readTotal, read, wantedKeys);
                    emitField(rows, DISK.writeTotal, write, wantedKeys);
                    emitField(rows, DISK.readRate, (read - st.lastRead) / dwell, wantedKeys);
                    emitField(rows, DISK.writeRate, (write - st.lastWrite) / dwell, wantedKeys);
                    st.lastRead = read;
                    st.lastWrite = write;
                    break;
                }
                return rows;
            },
        },
    ];
}

export function createSysCpufreqSource() {
    return {
        id: 'sys-cpufreq',
        group: 'processor',
        fields: FREQ_FIELDS,
        poll(emit, wantedKeys, ctx) {
            const proc = ctx.processor;
            if (!proc || proc.usesCpuInfo)
                return;
            if (!wantsAny(FREQ_FIELDS, wantedKeys))
                return;

            const cores = proc.coreCount || 0;
            for (let core = 0; core < cores; core++) {
                new FileModule.File('/sys/devices/system/cpu/cpu' + core + '/cpufreq/scaling_cur_freq').read().then(value => {
                    proc.last.speed[core] = parseInt(value);
                }).catch(err => { });
            }

            const speeds = Object.values(proc.last.speed);
            if (!speeds.length)
                return;

            let sum = speeds.reduce((a, b) => a + b);
            emitField(emit, FREQ.frequency, (sum / speeds.length) * 1000, wantedKeys);
            emitField(emit, FREQ.max, speeds.reduce((a, b) => Math.max(a, b)) * 1000, wantedKeys);
            emitField(emit, FREQ.min, speeds.reduce((a, b) => Math.min(a, b)) * 1000, wantedKeys);
        },
    };
}

const PUBLIC_IP = sensorField('Public IP', 'network', 'string');

export function createPublicIpSource(state) {
    return {
        id: 'custom-network-public-ip',
        group: 'network',
        skipFullGroup: true,
        fields: [PUBLIC_IP],
        poll(emit, wantedKeys, ctx) {
            if (!ctx.settings.get_boolean('include-public-ip'))
                return;
            if (wantedKeys && !wantedKeys.has(PUBLIC_IP.key))
                return;

            if (state.nextCheck <= 0) {
                let intervalMinutes = ctx.settings.get_int('network-public-ip-interval');
                state.nextCheck = intervalMinutes * 60;
                refreshPublicIp(emit, ctx.settings);
            }
            state.nextCheck -= ctx.dwell || 0;
        },
    };
}

function refreshPublicIp(emit, settings) {
    const provider = settings.get_int('network-public-ip-provider');
    let url;
    if (provider === 1)
        url = 'https://api.myip.com';
    else if (provider === 2)
        url = 'https://api.ipify.org?format=json';
    else
        url = 'https://ipv4.corecoding.com';

    new FileModule.File(url).read().then(contents => {
        let obj = JSON.parse(contents);
        let cc = '';
        let ip = '';
        if (provider === 1) {
            cc = (obj && typeof obj['cc'] === 'string') ? obj['cc'].trim().toLowerCase() : '';
            if (cc === 'xx') cc = '';
            ip = (obj && typeof obj['ip'] === 'string') ? obj['ip'].trim() : '';
        } else if (provider === 2) {
            ip = (obj && typeof obj['ip'] === 'string') ? obj['ip'].trim() : '';
        } else {
            cc = (obj && typeof obj['countryCode'] === 'string') ? obj['countryCode'].trim().toLowerCase() : '';
            ip = (obj && typeof obj['IPv4'] === 'string') ? obj['IPv4'].trim() : '';
        }
        const showFlag = settings.get_boolean('network-public-ip-show-flag');
        let typeOut = (showFlag && /^[a-z]{2}$/.test(cc)) ? ('network-' + cc) : 'network';
        emitField(emit, PUBLIC_IP, ip, null, {type: typeOut});
    }).catch(err => { });
}

const GTOP = {
    total: sensorField('Total', 'storage', 'storage'),
    used: sensorField('Used', 'storage', 'storage'),
    reserved: sensorField('Reserved', 'storage', 'storage'),
    free: sensorField('Free', 'storage', 'storage'),
    usedPercent: sensorField('Used %', 'storage', 'string'),
    freePercent: sensorField('Free %', 'storage', 'string'),
    group: sensorField('storage', 'storage-group', 'storage'),
};

export function createGtopStorageSource(state) {
    const fields = Object.values(GTOP);
    return {
        id: 'gtop-storage',
        group: 'storage',
        fields,
        poll(emit, wantedKeys, ctx) {
            if (!state.read)
                return;
            if (!wantsAny(fields, wantedKeys))
                return;

            const usage = state.read();
            let total = usage.blocks * usage.block_size;
            let avail = usage.bavail * usage.block_size;
            let free = usage.bfree * usage.block_size;
            let used = total - free;
            let reserved = (total - avail) - used;
            let freePercent = 0;
            let usedPercent = 0;
            if (total > 0) {
                freePercent = Math.round((free / total) * 100);
                usedPercent = Math.round((used / total) * 100);
            }

            emitField(emit, GTOP.total, total, wantedKeys);
            emitField(emit, GTOP.used, used, wantedKeys);
            emitField(emit, GTOP.reserved, reserved, wantedKeys);
            emitField(emit, GTOP.free, avail, wantedKeys);
            emitField(emit, GTOP.usedPercent, usedPercent + '%', wantedKeys);
            emitField(emit, GTOP.freePercent, freePercent + '%', wantedKeys);
            emitField(emit, GTOP.group, avail, wantedKeys);
        },
    };
}

export const BATTERY_PATHS = {
    0: 'BAT0',
    1: 'BAT1',
    2: 'BAT2',
    3: 'BATT',
    4: 'CMB0',
    5: 'CMB1',
    6: 'CMB2',
    7: 'macsmc-battery',
};

const BATTERY = {
    state: sensorField('State', 'battery', ''),
    cycles: sensorField('Cycles', 'battery', ''),
    voltage: sensorField('Voltage', 'battery', 'in'),
    level: sensorField('Level', 'battery', ''),
    percentage: sensorField('Percentage', 'battery', 'percent'),
    powerRate: sensorField('Power Rate', 'battery', 'watt'),
    group: sensorField('battery', 'battery-group', 'watt'),
    energyFull: sensorField('Energy (full)', 'battery', 'watt-hour'),
    energyDesign: sensorField('Energy (design)', 'battery', 'watt-hour'),
    capacity: sensorField('Capacity', 'battery', 'percent'),
    energyNow: sensorField('Energy (now)', 'battery', 'watt-hour'),
    timeLeft: sensorField('Time left', 'battery', 'runtime'),
};

export function createBatterySource(getSlot, batteryState) {
    return {
        id: 'sys-battery-uevent',
        group: 'battery',
        fields: Object.values(BATTERY),
        getPath(ctx) {
            let slot = getSlot(ctx);
            return '/sys/class/power_supply/' + BATTERY_PATHS[slot] + '/uevent';
        },
        delimiter: '\n',
        extract(lines, ctx, wantedKeys) {
            const output = {};
            for (let line of lines) {
                let split = String(line).split('=');
                output[split[0].replace('POWER_SUPPLY_', '')] = split[1];
            }

            const rows = [];

            if ('STATUS' in output)
                emitField(rows, BATTERY.state, output['STATUS'], wantedKeys);
            if ('CYCLE_COUNT' in output)
                emitField(rows, BATTERY.cycles, output['CYCLE_COUNT'], wantedKeys);
            if ('VOLTAGE_NOW' in output)
                emitField(rows, BATTERY.voltage, output['VOLTAGE_NOW'] / 1000, wantedKeys);
            if ('CAPACITY_LEVEL' in output)
                emitField(rows, BATTERY.level, output['CAPACITY_LEVEL'], wantedKeys);
            if ('CAPACITY' in output)
                emitField(rows, BATTERY.percentage, output['CAPACITY'] / 100, wantedKeys);

            if ('VOLTAGE_NOW' in output && 'CURRENT_NOW' in output && (!('POWER_NOW' in output)))
                output['POWER_NOW'] = (output['VOLTAGE_NOW'] * output['CURRENT_NOW']) / 1000000;

            if ('POWER_NOW' in output) {
                const powerValue = (
                    parseFloat(output['POWER_NOW']) * (output['STATUS'] === 'Discharging' ? -1 : 1)
                );
                emitField(rows, BATTERY.powerRate, powerValue, wantedKeys);
                emitField(rows, BATTERY.group, powerValue, wantedKeys);
            }

            if ('CHARGE_FULL' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL' in output)))
                output['ENERGY_FULL'] = (output['CHARGE_FULL'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;

            if ('ENERGY_FULL' in output)
                emitField(rows, BATTERY.energyFull, output['ENERGY_FULL'], wantedKeys);

            if ('CHARGE_FULL_DESIGN' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL_DESIGN' in output)))
                output['ENERGY_FULL_DESIGN'] = (output['CHARGE_FULL_DESIGN'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;

            if ('ENERGY_FULL_DESIGN' in output) {
                emitField(rows, BATTERY.energyDesign, output['ENERGY_FULL_DESIGN'], wantedKeys);
                if ('ENERGY_FULL' in output)
                    emitField(rows, BATTERY.capacity, (output['ENERGY_FULL'] / output['ENERGY_FULL_DESIGN']), wantedKeys);
            }

            if ('VOLTAGE_MIN_DESIGN' in output && 'CHARGE_NOW' in output && (!('ENERGY_NOW' in output)))
                output['ENERGY_NOW'] = (output['VOLTAGE_MIN_DESIGN'] * output['CHARGE_NOW']) / 1000000;

            if ('ENERGY_NOW' in output)
                emitField(rows, BATTERY.energyNow, output['ENERGY_NOW'], wantedKeys);

            if ('ENERGY_FULL' in output && 'ENERGY_NOW' in output && 'POWER_NOW' in output &&
                output['POWER_NOW'] !== 0 && 'STATUS' in output &&
                (output['STATUS'] == 'Charging' || output['STATUS'] == 'Discharging')) {

                let timeLeft = 0;
                if (output['STATUS'] == 'Charging')
                    timeLeft = ((output['ENERGY_FULL'] - output['ENERGY_NOW']) / output['POWER_NOW']);
                else
                    timeLeft = (output['ENERGY_NOW'] / Math.abs(output['POWER_NOW']));

                if (timeLeft !== Infinity) {
                    if (batteryState.chargeStatus != output['STATUS']) {
                        batteryState.timeLeftHistory = [];
                        batteryState.chargeStatus = output['STATUS'];
                    }
                    batteryState.timeLeftHistory.push(parseInt(timeLeft * 3600));
                    if (batteryState.timeLeftHistory.length > 10)
                        batteryState.timeLeftHistory.shift();
                    let sum = batteryState.timeLeftHistory.reduce((a, b) => a + b);
                    let avg = sum / batteryState.timeLeftHistory.length;
                    emitField(rows, BATTERY.timeLeft, parseInt(avg), wantedKeys);
                }
            } else if ('STATUS' in output) {
                emitField(rows, BATTERY.timeLeft, output['STATUS'], wantedKeys, {format: ''});
            }

            return rows;
        },
    };
}
