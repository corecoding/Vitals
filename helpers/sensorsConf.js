/**
 * Parse libsensors configuration files (/etc/sensors3.conf, /etc/sensors.d)
 * enough to resolve chip feature labels and ignores.
 *
 * Chip naming and matching follow lm-sensors lib/sysfs.c and lib/data.c.
 * See sensors.conf(5).
 */

const ANY = -1;
const NEVER = -2;
const BUSES_WITH_NR = ['i2c', 'spi', 'hid', 'scsi'];
const BUSES = ['isa', 'pci', 'virtual', 'acpi', 'mdio', 'sdio', ...BUSES_WITH_NR];

// hwmon devices with no device link, or no ancestor of a known bus type
export const VIRTUAL_DEVICE = Object.freeze({ bus: 'virtual', nr: ANY, addr: 0 });

function stripComment(line) {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\'))
            inQuote = !inQuote;
        else if (line[i] === '#' && !inQuote)
            return line.slice(0, i);
    }
    return line;
}

function tokenize(line) {
    let tokens = [];
    let i = 0;

    while (i < line.length) {
        while (i < line.length && /\s/.test(line[i]))
            i++;
        if (i >= line.length)
            break;

        if (line[i] === '"') {
            i++;
            let s = '';
            while (i < line.length && line[i] !== '"') {
                if (line[i] === '\\' && i + 1 < line.length) {
                    let esc = line[i + 1];
                    let map = { 'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\' };
                    s += (map[esc] !== undefined) ? map[esc] : esc;
                    i += 2;
                } else {
                    s += line[i++];
                }
            }
            if (i < line.length)
                i++;
            tokens.push(s);
        } else {
            let s = '';
            while (i < line.length && !/\s/.test(line[i]))
                s += line[i++];
            tokens.push(s);
        }
    }

    return tokens;
}

function logicalLines(text) {
    let lines = [];
    let buf = '';

    for (let raw of text.split(/\r?\n/)) {
        let line = stripComment(raw);
        if (/\\\s*$/.test(line)) {
            buf += line.replace(/\\\s*$/, ' ');
            continue;
        }
        lines.push(buf + line);
        buf = '';
    }

    if (buf)
        lines.push(buf);

    return lines;
}

function parseNumber(s, base) {
    if (s === undefined || s === '*')
        return ANY;
    let n = parseInt(s, base);
    return isNaN(n) ? null : n;
}

/**
 * Parse a chip pattern such as "nct6775-*", "*-isa-*" or "spd5118-i2c-3-51".
 * @returns {{prefix, bus, nr, addr}|null} null when the pattern is invalid
 */
export function parseChipName(name) {
    let parts = name.split('-');
    if (parts.length < 2)
        return null;

    let chip = { prefix: parts[0] === '*' ? ANY : parts[0], bus: ANY, nr: ANY, addr: ANY };
    if (parts.length === 2 && parts[1] === '*')
        return chip;

    chip.bus = parts[1];
    if (!BUSES.includes(chip.bus))
        return null;

    let addrPart = parts[2];
    if (BUSES_WITH_NR.includes(chip.bus)) {
        chip.nr = parseNumber(parts[2], 10);
        addrPart = parts[3];
    }
    chip.addr = parseNumber(addrPart, 16);

    if (chip.nr === null || chip.addr === null)
        return null;
    return chip;
}

/**
 * Bus type and address libsensors would assign to a device, from the
 * basename of its sysfs path and of its subsystem link.
 * @returns {{bus, nr, addr}|null} null when the device type is unknown (check the parent)
 */
export function classifyDevice(subsystem, devName) {
    let m;

    if ((!subsystem || subsystem === 'i2c') && (m = devName.match(/^(-?\d+)-([0-9a-f]+)/i))) {
        let nr = parseInt(m[1], 10);
        if (nr === 9191)
            return { bus: 'isa', nr: ANY, addr: parseInt(m[2], 16) };
        return { bus: 'i2c', nr, addr: parseInt(m[2], 16) };
    }
    if ((!subsystem || subsystem === 'spi') && (m = devName.match(/^spi(-?\d+)\.(-?\d+)/)))
        return { bus: 'spi', nr: parseInt(m[1], 10), addr: parseInt(m[2], 10) };
    if ((!subsystem || subsystem === 'pci') && (m = devName.match(/^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)\.([0-9a-f]+)/i))) {
        let [domain, bus, slot, fn] = m.slice(1).map(v => parseInt(v, 16));
        return { bus: 'pci', nr: ANY, addr: domain * 0x10000 + (bus << 8) + (slot << 3) + fn };
    }
    if (!subsystem || subsystem === 'platform' || subsystem === 'of_platform') {
        let addr = 0;
        if ((m = devName.match(/^[A-Za-z0-9_-]+[.:](-?\d+)/)))
            addr = parseInt(m[1], 10);
        else if ((m = devName.match(/^([0-9a-f]+)\.\S/i)))
            addr = parseInt(m[1], 16);
        return { bus: 'isa', nr: ANY, addr };
    }
    if (subsystem === 'acpi')
        return { bus: 'acpi', nr: ANY, addr: 0 };
    if (subsystem === 'hid' && (m = devName.match(/^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)\.([0-9a-f]+)/i)))
        return { bus: 'hid', nr: parseInt(m[1], 16), addr: parseInt(m[4], 16) };
    if (subsystem === 'mdio_bus') {
        m = devName.match(/^[^:]*:(-?\d+)/);
        return { bus: 'mdio', nr: ANY, addr: m ? parseInt(m[1], 10) : 0 };
    }
    if (subsystem === 'scsi' && (m = devName.match(/^(-?\d+):(-?\d+):(-?\d+):([0-9a-f]+)/i))) {
        let [host, channel, id] = m.slice(1, 4).map(v => parseInt(v, 10));
        return { bus: 'scsi', nr: host, addr: (channel << 8) + (id << 4) + parseInt(m[4], 16) };
    }
    if (subsystem === 'sdio' && (m = devName.match(/^mmc([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)/i)))
        return { bus: 'sdio', nr: parseInt(m[1], 16), addr: (parseInt(m[2], 16) << 3) + parseInt(m[3], 16) };

    return null;
}

/**
 * @returns {{patterns: Object[], labels: Object.<string, string>, ignores: Set<string>, busses: Object.<string, string>}[]}
 */
export function parseSensorsConf(text) {
    let blocks = [];
    let current = null;
    // bus statements apply to every chip statement in the same file
    let busses = {};

    for (let line of logicalLines(text)) {
        let tokens = tokenize(line.trim());
        if (!tokens.length)
            continue;

        let stmt = tokens[0].toLowerCase();

        if (stmt === 'chip') {
            let patterns = tokens.slice(1).map(parseChipName).filter(Boolean);
            current = { patterns, labels: {}, ignores: new Set(), busses };
            blocks.push(current);
        } else if (stmt === 'label' && current && tokens.length >= 3) {
            // first label for a feature within a block wins, as in libsensors
            if (!(tokens[1] in current.labels))
                current.labels[tokens[1]] = tokens[2];
        } else if (stmt === 'ignore' && current && tokens.length >= 2) {
            current.ignores.add(tokens[1]);
        } else if (stmt === 'bus' && tokens.length >= 3) {
            busses[tokens[1]] = tokens[2];
        }
        // compute / set and unknown statements are not used
    }

    return blocks;
}

/**
 * Rewrite i2c bus numbers declared with "bus" statements to the system's
 * current number for that adapter name.
 * @param {Object.<string, number>} adapters adapter name -> i2c bus number
 */
export function substituteBusses(blocks, adapters) {
    for (let block of blocks) {
        for (let pattern of block.patterns) {
            if (pattern.bus !== 'i2c' || pattern.nr === ANY)
                continue;

            let adapter = block.busses['i2c-' + pattern.nr];
            if (adapter !== undefined)
                pattern.nr = (adapter in adapters) ? adapters[adapter] : NEVER;
        }
    }
}

function chipMatches(pattern, chip) {
    return (pattern.prefix === ANY || pattern.prefix === chip.prefix) &&
        (pattern.bus === ANY || pattern.bus === chip.bus) &&
        (pattern.nr === ANY || chip.nr === ANY || pattern.nr === chip.nr) &&
        (pattern.addr === ANY || pattern.addr === chip.addr);
}

/**
 * @param {{prefix, bus, nr, addr}} chip bus is null when the device type is unknown
 * @param {string} feature e.g. "temp1", "in0", "fan2", "power1"
 * @returns {{label: string|null, ignored: boolean}}
 */
export function resolveFeature(blocks, chip, feature) {
    let result = { label: null, ignored: false };
    if (!blocks || !chip || !feature)
        return result;

    // later blocks override earlier ones
    for (let i = blocks.length - 1; i >= 0; i--) {
        let block = blocks[i];
        if (!block.patterns.some(p => chipMatches(p, chip)))
            continue;
        if (block.ignores.has(feature))
            result.ignored = true;
        if (result.label === null && feature in block.labels)
            result.label = block.labels[feature];
    }

    return result;
}

function loadI2cAdapters(FileCtor) {
    let base = '/sys/class/i2c-adapter/';
    return new FileCtor(base).list().then(entries => {
        let adapters = {};
        let reads = entries.map(entry => {
            let m = entry.match(/^i2c-(\d+)$/);
            if (!m)
                return Promise.resolve();
            return new FileCtor(base + entry + '/name').read().then(name => {
                adapters[name.trim()] = parseInt(m[1], 10);
            }).catch(() => {});
        });
        return Promise.all(reads).then(() => adapters);
    }).catch(() => ({}));
}

/**
 * Load /etc/sensors3.conf (else sensors.conf) plus /etc/sensors.d/*.
 * @param {function} FileCtor helpers/file.js File constructor
 */
export function loadSensorsConf(FileCtor) {
    let tryRead = path => new FileCtor(path).read().then(text => parseSensorsConf(text)).catch(() => null);

    return tryRead('/etc/sensors3.conf').then(main => {
        if (main)
            return main;

        return tryRead('/etc/sensors.conf').then(fallback => fallback || []);
    }).then(blocks => {
        return new FileCtor('/etc/sensors.d').list().then(files => {
            files = files.filter(f => f && f[0] !== '.').sort();
            let chain = Promise.resolve();
            let all = blocks.slice();

            for (let file of files) {
                chain = chain.then(() => tryRead('/etc/sensors.d/' + file)).then(parsed => {
                    if (parsed)
                        all.push(...parsed);
                });
            }

            return chain.then(() => all);
        }).catch(() => blocks);
    }).then(blocks => {
        if (!blocks.some(b => Object.keys(b.busses).length))
            return blocks;

        return loadI2cAdapters(FileCtor).then(adapters => {
            substituteBusses(blocks, adapters);
            return blocks;
        });
    }).catch(() => []);
}
