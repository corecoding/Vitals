/* Shared sensor catalog for shell and preferences. */
export const sensorCatalog = {
    'temperature' : { 'icon': 'temperature-symbolic.svg', colorFormats: ['temp'] },
        'voltage' : { 'icon': 'voltage-symbolic.svg' },
            'fan' : { 'icon': 'fan-symbolic.svg', colorFormats: ['fan'] },
         'memory' : { 'icon': 'memory-symbolic.svg', colorFormats: ['percent'] },
      'processor' : { 'icon': 'cpu-symbolic.svg', colorFormats: ['percent'] },
         'system' : { 'icon': 'system-symbolic.svg', colorFormats: ['load'] },
        'network' : { 'icon': 'network-symbolic.svg',
                   'icon-rx': 'network-download-symbolic.svg',
                   'icon-tx': 'network-upload-symbolic.svg'
        },
        'storage' : { 'icon': 'storage-symbolic.svg' },
        'battery' : { 'icon': 'battery-symbolic.svg', colorFormats: ['percent'] },
            'gpu' : { 'icon': 'gpu-symbolic.svg', colorFormats: ['percent'] }
        };

/** Display titles for menu groups (gpu → Graphics). */
export const categoryDisplayNames = {
    gpu: 'Graphics',
};

export function categoryTitle(category) {
    let base = sensorGroupFromType(category) || category;
    if (categoryDisplayNames[base])
        return categoryDisplayNames[base];
    if (!base)
        return '';
    return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Parse type keys like gpu#2 or storage#1-group → {category, instance} */
export function parseInstanceType(type) {
    let group = (type || '').replace(/-group$/, '');
    let m = group.match(/^(.*)#(\d+)$/);
    if (m)
        return {category: m[1], instance: parseInt(m[2], 10)};
    return {category: group, instance: 0};
}

export function sensorGroupFromType(type) {
    let group = (type || '').replace(/-group$/, '');
    return group.replace(/#\d+$/, '');
}

/** Formats available for custom-command field mapping. */
export const commandFieldFormats = [
    'string', 'percent', 'temp', 'fan', 'in', 'hertz', 'memory', 'storage',
    'speed', 'watt', 'watt-gpu', 'watt-hour', 'load', 'pcie', 'runtime', 'uptime',
];

export function colorSettingsKeys() {
    return Object.keys(sensorCatalog)
        .filter(group => sensorCatalog[group].colorFormats)
        .map(group => `${group}-colors`);
}

// GSettings key for threshold colors for a live sensor (shared by values + prefs).
export function colorsKeyForSensor(type, format) {
    // All temperatures share the temperature threshold UI, including GPU rows.
    if (format === 'temp')
        return 'temperature-colors';

    const group = sensorGroupFromType(type);
    const formats = sensorCatalog[group]?.colorFormats;
    if (formats && formats.includes(format))
        return `${group}-colors`;

    return null;
}

export function colorPageForSensor(type, format) {
    let key = colorsKeyForSensor(type, format);
    return key ? key.slice(0, -'-colors'.length) : null;
}
