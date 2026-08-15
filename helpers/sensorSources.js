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
        const fields = (source.fields || []).map(field => {
            const type = field.type;
            const label = field.label;
            return {
                ...field,
                key: field.key || fieldKey(type, label),
            };
        });
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

/** Hard-coded sources common across machines. Discovery appends more later. */
export function getStaticSources() {
    return [
        {
            id: 'proc-meminfo',
            path: '/proc/meminfo',
            group: 'memory',
            extract(text, _ctx, wantedKeys) {
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);

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
                const push = (label, value, type, format) => {
                    const key = fieldKey(type, label);
                    if (want(key))
                        rows.push({label, value, type, format});
                };

                push('Usage', utilized, 'memory', 'percent');
                push('memory', utilized, 'memory-group', 'percent');
                push('Physical', total, 'memory', 'memory');
                push('Available', avail, 'memory', 'memory');
                push('Allocated', used, 'memory', 'memory');
                push('Cached', cached, 'memory', 'memory');
                push('Free', memFree, 'memory', 'memory');
                push('Swap Total', swapTotal, 'memory', 'memory');
                push('Swap Free', swapFree, 'memory', 'memory');
                push('Swap Used', swapUsed, 'memory', 'memory');
                push('Swap Usage', swapUtilized, 'memory', 'percent');
                return rows;
            },
            fields: [
                {label: 'Usage', type: 'memory', format: 'percent'},
                {label: 'memory', type: 'memory-group', format: 'percent'},
                {label: 'Physical', type: 'memory', format: 'memory'},
                {label: 'Available', type: 'memory', format: 'memory'},
                {label: 'Allocated', type: 'memory', format: 'memory'},
                {label: 'Cached', type: 'memory', format: 'memory'},
                {label: 'Free', type: 'memory', format: 'memory'},
                {label: 'Swap Total', type: 'memory', format: 'memory'},
                {label: 'Swap Free', type: 'memory', format: 'memory'},
                {label: 'Swap Used', type: 'memory', format: 'memory'},
                {label: 'Swap Usage', type: 'memory', format: 'percent'},
            ],
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
            extract(parts, _ctx, wantedKeys) {
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);
                const proc = String(parts[3] || '').split('/');
                const rows = [];
                const push = (label, value, type, format) => {
                    if (want(fieldKey(type, label)))
                        rows.push({label, value, type, format});
                };
                push('Load 1m', parseFloat(parts[0]), 'system', 'load');
                push('system', parseFloat(parts[0]), 'system-group', 'load');
                push('Load 5m', parseFloat(parts[1]), 'system', 'load');
                push('Load 15m', parseFloat(parts[2]), 'system', 'load');
                push('Threads Active', proc[0], 'system', 'string');
                push('Threads Total', proc[1], 'system', 'string');
                return rows;
            },
            fields: [
                {label: 'Load 1m', type: 'system', format: 'load'},
                {label: 'system', type: 'system-group', format: 'load'},
                {label: 'Load 5m', type: 'system', format: 'load'},
                {label: 'Load 15m', type: 'system', format: 'load'},
                {label: 'Threads Active', type: 'system', format: 'string'},
                {label: 'Threads Total', type: 'system', format: 'string'},
            ],
        },
        {
            id: 'proc-uptime',
            path: '/proc/uptime',
            group: 'system',
            delimiter: ' ',
            extract(parts, ctx, wantedKeys) {
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);
                const rows = [];
                if (want(fieldKey('system', 'Uptime')))
                    rows.push({label: 'Uptime', value: parts[0], type: 'system', format: 'uptime'});

                // Process Time is typed as processor but sourced from uptime
                const processKey = fieldKey('processor', 'Process Time');
                let cores = (ctx.processor && ctx.processor.coreCount) || ctx.processorCores || 0;
                if (want(processKey) || (emitAll && cores > 0)) {
                    if (cores > 0 && (emitAll || want(processKey)))
                        rows.push({
                            label: 'Process Time',
                            value: parts[0] - parts[1] / cores,
                            type: 'processor',
                            format: 'uptime',
                        });
                }
                return rows;
            },
            fields: [
                {label: 'Uptime', type: 'system', format: 'uptime'},
                {label: 'Process Time', type: 'processor', format: 'uptime'},
            ],
        },
        {
            id: 'proc-zfs-arcstats',
            path: '/proc/spl/kstat/zfs/arcstats',
            group: 'storage',
            extract(text, _ctx, wantedKeys) {
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);
                let values = '', target = 0, maximum = 0, current = 0;
                if (values = text.match(/c(\s+)(\d+)(\s+)(\d+)/)) target = values[4];
                if (values = text.match(/c_max(\s+)(\d+)(\s+)(\d+)/)) maximum = values[4];
                if (values = text.match(/size(\s+)(\d+)(\s+)(\d+)/)) current = values[4];
                const rows = [];
                const push = (label, value) => {
                    if (want(fieldKey('storage', label)))
                        rows.push({label, value, type: 'storage', format: 'storage'});
                };
                push('ARC Target', target);
                push('ARC Maximum', maximum);
                push('ARC Current', current);
                return rows;
            },
            fields: [
                {label: 'ARC Target', type: 'storage', format: 'storage'},
                {label: 'ARC Maximum', type: 'storage', format: 'storage'},
                {label: 'ARC Current', type: 'storage', format: 'storage'},
            ],
        },
        {
            id: 'proc-net-wireless',
            path: '/proc/net/wireless',
            group: 'network',
            // Device max aggregate should not force a wireless read
            skipFullGroup: true,
            delimiter: '\n',
            stripHeader: true,
            extract(lines, _ctx, wantedKeys) {
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);
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
                if (want(fieldKey('network', 'WiFi Link Quality')))
                    rows.push({label: 'WiFi Link Quality', value: quality_pct, type: 'network', format: 'percent'});
                if (want(fieldKey('network', 'WiFi Signal Level')))
                    rows.push({label: 'WiFi Signal Level', value: signal, type: 'network', format: 'string'});
                return rows;
            },
            fields: [
                {label: 'WiFi Link Quality', type: 'network', format: 'percent'},
                {label: 'WiFi Signal Level', type: 'network', format: 'string'},
            ],
        },
        {
            id: 'proc-stat',
            path: '/proc/stat',
            group: 'processor',
            delimiter: '\n',
            matchKey: key => key.startsWith('_processor_') && key.includes('_core_'),
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
                            if (emitAll || wantedKeys.has(fieldKey('processor-group', 'processor')))
                                rows.push({label: 'processor', value: delta / 100, type: 'processor-group', format: 'percent'});
                            if (emitAll || wantedKeys.has(fieldKey('processor', 'Usage')))
                                rows.push({label: 'Usage', value: delta / 100, type: 'processor', format: 'percent'});
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
            fields: [
                {label: 'Usage', type: 'processor', format: 'percent'},
                {label: 'processor', type: 'processor-group', format: 'percent'},
            ],
        },
        {
            id: 'proc-cpuinfo-freq',
            group: 'processor',
            delimiter: '\n',
            getPath(ctx) {
                return (ctx.processor && ctx.processor.usesCpuInfo) ? '/proc/cpuinfo' : null;
            },
            extract(lines, _ctx, wantedKeys) {
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);
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
                if (want(fieldKey('processor', 'Frequency')))
                    rows.push({label: 'Frequency', value: (sum / freqs.length) * 1000 * 1000, type: 'processor', format: 'hertz'});
                if (want(fieldKey('processor', 'Max frequency')))
                    rows.push({label: 'Max frequency', value: freqs.reduce((a, b) => Math.max(a, b)) * 1000 * 1000, type: 'processor', format: 'hertz'});
                if (want(fieldKey('processor', 'Min frequency')))
                    rows.push({label: 'Min frequency', value: freqs.reduce((a, b) => Math.min(a, b)) * 1000 * 1000, type: 'processor', format: 'hertz'});
                return rows;
            },
            fields: [
                {label: 'Frequency', type: 'processor', format: 'hertz'},
                {label: 'Max frequency', type: 'processor', format: 'hertz'},
                {label: 'Min frequency', type: 'processor', format: 'hertz'},
            ],
        },
        createSysCpufreqSource(),
        {
            id: 'proc-diskstats',
            path: '/proc/diskstats',
            group: 'storage',
            delimiter: '\n',
            extract(lines, ctx, wantedKeys) {
                const st = ctx.storage;
                if (!st || !st.device)
                    return [];
                const dwell = ctx.dwell || 1;
                const emitAll = !wantedKeys;
                const want = key => emitAll || wantedKeys.has(key);
                const rows = [];
                for (let line of lines) {
                    let loadArray = line.trim().split(/\s+/);
                    if ('/dev/' + loadArray[2] != st.device)
                        continue;
                    var read = (loadArray[5] * 512);
                    var write = (loadArray[9] * 512);
                    if (want(fieldKey('storage', 'Read total')))
                        rows.push({label: 'Read total', value: read, type: 'storage', format: 'storage'});
                    if (want(fieldKey('storage', 'Write total')))
                        rows.push({label: 'Write total', value: write, type: 'storage', format: 'storage'});
                    if (want(fieldKey('storage', 'Read rate')))
                        rows.push({label: 'Read rate', value: (read - st.lastRead) / dwell, type: 'storage', format: 'storage'});
                    if (want(fieldKey('storage', 'Write rate')))
                        rows.push({label: 'Write rate', value: (write - st.lastWrite) / dwell, type: 'storage', format: 'storage'});
                    st.lastRead = read;
                    st.lastWrite = write;
                    break;
                }
                return rows;
            },
            fields: [
                {label: 'Read total', type: 'storage', format: 'storage'},
                {label: 'Write total', type: 'storage', format: 'storage'},
                {label: 'Read rate', type: 'storage', format: 'storage'},
                {label: 'Write rate', type: 'storage', format: 'storage'},
            ],
        },
    ];
}

const FREQ_FIELDS = [
    {label: 'Frequency', type: 'processor', format: 'hertz'},
    {label: 'Max frequency', type: 'processor', format: 'hertz'},
    {label: 'Min frequency', type: 'processor', format: 'hertz'},
];

export function createSysCpufreqSource() {
    const freqKeys = FREQ_FIELDS.map(field => fieldKey(field.type, field.label));
    return {
        id: 'sys-cpufreq',
        group: 'processor',
        fields: FREQ_FIELDS,
        poll(emit, wantedKeys, ctx) {
            const proc = ctx.processor;
            if (!proc || proc.usesCpuInfo)
                return;
            if (wantedKeys && !freqKeys.some(key => wantedKeys.has(key)))
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

            const emitAll = !wantedKeys;
            const want = key => emitAll || wantedKeys.has(key);
            let sum = speeds.reduce((a, b) => a + b);
            if (want(fieldKey('processor', 'Frequency')))
                emit('Frequency', (sum / speeds.length) * 1000, 'processor', 'hertz');
            if (want(fieldKey('processor', 'Max frequency')))
                emit('Max frequency', speeds.reduce((a, b) => Math.max(a, b)) * 1000, 'processor', 'hertz');
            if (want(fieldKey('processor', 'Min frequency')))
                emit('Min frequency', speeds.reduce((a, b) => Math.min(a, b)) * 1000, 'processor', 'hertz');
        },
    };
}

export function createPublicIpSource(state) {
    return {
        id: 'custom-network-public-ip',
        group: 'network',
        skipFullGroup: true,
        fields: [{label: 'Public IP', type: 'network', format: 'string'}],
        poll(emit, wantedKeys, ctx) {
            if (!ctx.settings.get_boolean('include-public-ip'))
                return;
            if (wantedKeys && !wantedKeys.has(fieldKey('network', 'Public IP')))
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
        emit('Public IP', ip, typeOut, 'string');
    }).catch(err => { });
}

export function createGtopStorageSource(state) {
    return {
        id: 'gtop-storage',
        group: 'storage',
        fields: [
            {label: 'Total', type: 'storage', format: 'storage'},
            {label: 'Used', type: 'storage', format: 'storage'},
            {label: 'Reserved', type: 'storage', format: 'storage'},
            {label: 'Free', type: 'storage', format: 'storage'},
            {label: 'Used %', type: 'storage', format: 'string'},
            {label: 'Free %', type: 'storage', format: 'string'},
            {label: 'storage', type: 'storage-group', format: 'storage'},
        ],
        poll(emit, wantedKeys, ctx) {
            if (!state.read)
                return;
            const emitAll = !wantedKeys;
            const want = key => emitAll || wantedKeys.has(key);
            const keys = [
                fieldKey('storage', 'Total'), fieldKey('storage', 'Used'),
                fieldKey('storage', 'Reserved'), fieldKey('storage', 'Free'),
                fieldKey('storage', 'Used %'), fieldKey('storage', 'Free %'),
                fieldKey('storage-group', 'storage'),
            ];
            if (wantedKeys && !keys.some(key => wantedKeys.has(key)))
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

            if (want(fieldKey('storage', 'Total')))
                emit('Total', total, 'storage', 'storage');
            if (want(fieldKey('storage', 'Used')))
                emit('Used', used, 'storage', 'storage');
            if (want(fieldKey('storage', 'Reserved')))
                emit('Reserved', reserved, 'storage', 'storage');
            if (want(fieldKey('storage', 'Free')))
                emit('Free', avail, 'storage', 'storage');
            if (want(fieldKey('storage', 'Used %')))
                emit('Used %', usedPercent + '%', 'storage', 'string');
            if (want(fieldKey('storage', 'Free %')))
                emit('Free %', freePercent + '%', 'storage', 'string');
            if (want(fieldKey('storage-group', 'storage')))
                emit('storage', avail, 'storage-group', 'storage');
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

export function createBatterySource(getSlot, batteryState) {
    return {
        id: 'sys-battery-uevent',
        group: 'battery',
        getPath(ctx) {
            let slot = getSlot(ctx);
            return '/sys/class/power_supply/' + BATTERY_PATHS[slot] + '/uevent';
        },
        delimiter: '\n',
        extract(lines, ctx, wantedKeys) {
            const emitAll = !wantedKeys;
            const want = key => emitAll || wantedKeys.has(key);
            const output = {};
            for (let line of lines) {
                let split = String(line).split('=');
                output[split[0].replace('POWER_SUPPLY_', '')] = split[1];
            }

            const rows = [];
            const push = (label, value, format) => {
                if (want(fieldKey('battery', label)))
                    rows.push({label, value, type: 'battery', format});
            };
            const pushGroup = (label, value, type, format) => {
                if (want(fieldKey(type, label)))
                    rows.push({label, value, type, format});
            };

            if ('STATUS' in output)
                push('State', output['STATUS'], '');
            if ('CYCLE_COUNT' in output)
                push('Cycles', output['CYCLE_COUNT'], '');
            if ('VOLTAGE_NOW' in output)
                push('Voltage', output['VOLTAGE_NOW'] / 1000, 'in');
            if ('CAPACITY_LEVEL' in output)
                push('Level', output['CAPACITY_LEVEL'], '');
            if ('CAPACITY' in output)
                push('Percentage', output['CAPACITY'] / 100, 'percent');

            if ('VOLTAGE_NOW' in output && 'CURRENT_NOW' in output && (!('POWER_NOW' in output)))
                output['POWER_NOW'] = (output['VOLTAGE_NOW'] * output['CURRENT_NOW']) / 1000000;

            if ('POWER_NOW' in output) {
                const powerValue = (
                    parseFloat(output['POWER_NOW']) * (output['STATUS'] === 'Discharging' ? -1 : 1)
                );
                push('Power Rate', powerValue, 'watt');
                pushGroup('battery', powerValue, 'battery-group', 'watt');
            }

            if ('CHARGE_FULL' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL' in output)))
                output['ENERGY_FULL'] = (output['CHARGE_FULL'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;

            if ('ENERGY_FULL' in output)
                push('Energy (full)', output['ENERGY_FULL'], 'watt-hour');

            if ('CHARGE_FULL_DESIGN' in output && 'VOLTAGE_MIN_DESIGN' in output && (!('ENERGY_FULL_DESIGN' in output)))
                output['ENERGY_FULL_DESIGN'] = (output['CHARGE_FULL_DESIGN'] * output['VOLTAGE_MIN_DESIGN']) / 1000000;

            if ('ENERGY_FULL_DESIGN' in output) {
                push('Energy (design)', output['ENERGY_FULL_DESIGN'], 'watt-hour');
                if ('ENERGY_FULL' in output)
                    push('Capacity', (output['ENERGY_FULL'] / output['ENERGY_FULL_DESIGN']), 'percent');
            }

            if ('VOLTAGE_MIN_DESIGN' in output && 'CHARGE_NOW' in output && (!('ENERGY_NOW' in output)))
                output['ENERGY_NOW'] = (output['VOLTAGE_MIN_DESIGN'] * output['CHARGE_NOW']) / 1000000;

            if ('ENERGY_NOW' in output)
                push('Energy (now)', output['ENERGY_NOW'], 'watt-hour');

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
                    push('Time left', parseInt(avg), 'runtime');
                }
            } else if ('STATUS' in output) {
                push('Time left', output['STATUS'], '');
            }

            return rows;
        },
        fields: [
            {label: 'State', type: 'battery', format: ''},
            {label: 'Cycles', type: 'battery', format: ''},
            {label: 'Voltage', type: 'battery', format: 'in'},
            {label: 'Level', type: 'battery', format: ''},
            {label: 'Percentage', type: 'battery', format: 'percent'},
            {label: 'Power Rate', type: 'battery', format: 'watt'},
            {label: 'battery', type: 'battery-group', format: 'watt'},
            {label: 'Energy (full)', type: 'battery', format: 'watt-hour'},
            {label: 'Energy (design)', type: 'battery', format: 'watt-hour'},
            {label: 'Capacity', type: 'battery', format: 'percent'},
            {label: 'Energy (now)', type: 'battery', format: 'watt-hour'},
            {label: 'Time left', type: 'battery', format: 'runtime'},
        ],
    };
}
