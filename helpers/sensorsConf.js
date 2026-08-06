/**
 * Parse libsensors configuration files (/etc/sensors3.conf, /etc/sensors.d)
 * enough to resolve chip feature label overrides.
 *
 * See sensors.conf(5).
 */

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
        if (/\\$/.test(line)) {
            buf += line.slice(0, -1);
            continue;
        }
        lines.push(buf + line);
        buf = '';
    }

    if (buf)
        lines.push(buf);

    return lines;
}

/**
 * @param {string} text
 * @returns {{patterns: string[], labels: Object.<string, string>}[]}
 */
export function parseSensorsConf(text) {
    let blocks = [];
    let current = null;

    for (let line of logicalLines(text)) {
        line = line.trim();
        if (!line)
            continue;

        let tokens = tokenize(line);
        if (!tokens.length)
            continue;

        let stmt = tokens[0].toLowerCase();

        if (stmt === 'chip') {
            current = { patterns: tokens.slice(1), labels: {} };
            blocks.push(current);
        } else if (stmt === 'label' && current && tokens.length >= 3) {
            // last matching label for a feature wins across files
            current.labels[tokens[1]] = tokens[2];
        }
        // bus / compute / ignore / set and unknown statements are ignored
    }

    return blocks;
}

function wildcardMatch(pattern, value) {
    let re = '^' + pattern
        .replace(/([.+^${}()|[\]\\])/g, '\\$1')
        .replace(/\*/g, '.*') + '$';
    return new RegExp(re).test(value);
}

/**
 * Match a sensors.conf chip pattern against an hwmon chip name
 * (e.g. "nct6775") when the full type-bus-address id is unknown.
 */
export function chipPatternMatches(pattern, chipName) {
    if (!pattern || !chipName)
        return false;

    // Synthesize ids so common patterns like "chip-*" still match.
    let candidates = [
        chipName,
        chipName + '-*',
        chipName + '-*-*'
    ];

    return candidates.some(id => wildcardMatch(pattern, id));
}

/**
 * Return the last sensors.conf label for chipName + feature, or null.
 */
export function lookupLabel(blocks, chipName, feature) {
    if (!blocks || !chipName || !feature)
        return null;

    let label = null;
    for (let block of blocks) {
        if (!block.patterns.some(p => chipPatternMatches(p, chipName)))
            continue;
        if (Object.prototype.hasOwnProperty.call(block.labels, feature))
            label = block.labels[feature];
    }
    return label;
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
    }).catch(() => []);
}
