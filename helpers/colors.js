/* Threshold color entry helpers shared by prefs and values. */

// Entries: "threshold r g b" or "threshold r g b sensor:<key>"
// Trailing sensor tokens may contain spaces (legacy key quirk).
export function parseColorEntry(colorEntry) {
    if (typeof colorEntry !== 'string')
        return null;

    const parts = colorEntry.trim().split(' ');
    if (parts.length < 4)
        return null;

    const threshold = Number(parts[0]);
    const red = Number(parts[1]);
    const green = Number(parts[2]);
    const blue = Number(parts[3]);
    if (![threshold, red, green, blue].every(Number.isFinite))
        return null;

    let sensorKey = null;
    if (parts.length > 4) {
        const rest = parts.slice(4).join(' ');
        if (!rest.startsWith('sensor:') || rest.length <= 'sensor:'.length)
            return null;
        sensorKey = rest.slice('sensor:'.length);
        if (!sensorKey)
            return null;
    }

    return {threshold, red, green, blue, sensorKey};
}

export function formatColorEntry({threshold, red, green, blue, sensorKey = null}) {
    let entry = `${threshold} ${red} ${green} ${blue}`;
    if (sensorKey)
        entry += ` sensor:${sensorKey}`;
    return entry;
}

export function sanitizeAndSortColorEntries(colorsArray) {
    return (colorsArray || [])
        .map(parseColorEntry)
        .filter(Boolean)
        .sort((a, b) => {
            if (a.threshold !== b.threshold)
                return a.threshold - b.threshold;
            let aKey = a.sensorKey || '';
            let bKey = b.sensorKey || '';
            return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
        });
}

function normalizeColorComponent(component) {
    if (!Number.isFinite(component))
        return null;

    const scaled = component > 1 ? component : component * 255;
    return Math.max(0, Math.min(255, Math.round(scaled)));
}

function styleForEntries(value, entries) {
    const thresholds = entries
        .slice()
        .sort((a, b) => a.threshold - b.threshold)
        .map(entry => {
            const red = normalizeColorComponent(entry.red);
            const green = normalizeColorComponent(entry.green);
            const blue = normalizeColorComponent(entry.blue);
            if (red === null || green === null || blue === null)
                return null;

            return {
                threshold: entry.threshold,
                style: `color: rgb(${red}, ${green}, ${blue});`,
            };
        })
        .filter(Boolean);

    if (thresholds.length === 0)
        return '';

    for (let index = thresholds.length - 1; index >= 0; index--) {
        if (value >= thresholds[index].threshold)
            return thresholds[index].style;
    }

    return '';
}

// Prefer rules for sensorKey; otherwise group-wide rules (sensorKey == null).
// Unknown / other sensor keys are ignored — never throws.
export function getUsageColor(value, colors, sensorKey = null) {
    if (!colors || colors.length === 0 || !Number.isFinite(value))
        return '';

    const entries = colors.map(parseColorEntry).filter(Boolean);
    if (entries.length === 0)
        return '';

    if (sensorKey) {
        const specific = entries.filter(entry => entry.sensorKey === sensorKey);
        if (specific.length > 0)
            return styleForEntries(value, specific);
    }

    const groupWide = entries.filter(entry => !entry.sensorKey);
    return styleForEntries(value, groupWide);
}

export function sensorKeyFromTypeLabel(type, label) {
    let typeKey = (type || '').replace('-group', '');
    if (/^network-(?!rx$|tx$)/.test(typeKey))
        typeKey = 'network';
    return '_' + typeKey + '_' + String(label).replace(' ', '_').toLowerCase() + '_';
}

export function labelFromSensorKey(key) {
    if (typeof key !== 'string' || !key.startsWith('_') || key.length < 3)
        return key || '';

    let inner = key.endsWith('_') ? key.slice(1, -1) : key.slice(1);
    let parts = inner.split('_');
    if (parts.length === 0)
        return key;

    let typePart = parts[0];
    let label = parts.slice(1).join(' ').trim();
    if (typePart.startsWith('gpu') && label)
        return `${label} (${typePart})`;
    return label || typePart;
}

// Keys that belong on a given threshold-colors prefs page.
export function sensorKeyBelongsToColorPage(pageName, key) {
    if (typeof key !== 'string' || !key.startsWith('_') || key.startsWith('__'))
        return false;

    let inner = key.endsWith('_') ? key.slice(1, -1) : key.slice(1);
    let typePart = inner.split('_')[0] || '';

    if (pageName === 'temperature') {
        if (typePart === 'temperature')
            return true;
        // GPU temps also use temperature-colors.
        return typePart.startsWith('gpu') && /temp/i.test(key);
    }

    if (pageName === 'gpu') {
        if (!typePart.startsWith('gpu'))
            return false;
        return !/temp/i.test(key);
    }

    return typePart === pageName || typePart.startsWith(pageName + '#');
}
