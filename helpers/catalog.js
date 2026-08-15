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

export function sensorGroupFromType(type) {
    let group = (type || '').replace(/-group$/, '');
    if (group.startsWith('gpu'))
        return 'gpu';
    if (group.startsWith('network-'))
        return 'network';
    return group.replace(/#\d+$/, '');
}

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
