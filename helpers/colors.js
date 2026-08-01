/*
  Shared threshold-color helpers for Vitals preferences and runtime.
  Entries are stored as: "threshold r g b" (r/g/b as 0–1 floats or 0–255).
*/

import {sensorGroups, sensorGroupFromType} from './sensorGroups.js';

export function parseColorEntry(colorEntry, separator = ' ') {
    if (typeof colorEntry !== 'string')
        return null;

    const parts = colorEntry.split(separator);
    if (parts.length !== 4)
        return null;

    const [threshold, red, green, blue] = parts.map(Number);
    if (![threshold, red, green, blue].every(Number.isFinite))
        return null;

    return {threshold, red, green, blue};
}

export function formatColorEntry({threshold, red, green, blue}, separator = ' ') {
    return `${threshold}${separator}${red}${separator}${green}${separator}${blue}`;
}

export function sanitizeAndSortColorEntries(colorsArray, separator = ' ') {
    return colorsArray
        .map(entry => parseColorEntry(entry, separator))
        .filter(Boolean)
        .sort((a, b) => a.threshold - b.threshold);
}

function normalizeColorComponent(component) {
    if (!Number.isFinite(component))
        return null;

    const scaled = component > 1 ? component : component * 255;
    return Math.max(0, Math.min(255, Math.round(scaled)));
}

export function getUsageColor(value, colors, separator = ' ') {
    if (!colors || colors.length === 0)
        return '';

    const normalizedValue = Array.isArray(value)
        ? Math.max(...value.filter(Number.isFinite))
        : value;

    if (!Number.isFinite(normalizedValue))
        return '';

    const thresholds = sanitizeAndSortColorEntries(colors, separator)
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
        if (normalizedValue > thresholds[index].threshold)
            return thresholds[index].style;
    }

    return '';
}

// Map sensor type + format to a GSettings colors key, or null when unsupported.
export function colorsKeyForSensor(type, format) {
    // All temperatures share the temperature threshold UI, including GPU rows.
    if (format === 'temp')
        return 'temperature-colors';

    const group = sensorGroupFromType(type);
    const formats = sensorGroups[group]?.colorFormats;
    if (formats && formats.includes(format))
        return `${group}-colors`;

    return null;
}
