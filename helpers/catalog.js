/* Shared sensor catalog for shell and preferences. */
// colorFormats take both "All sensors" and per-sensor scales.
// sensorColorFormats take per-sensor scales only: an "All sensors" usage
// scale (0–100 %) must not color a frequency (GHz).
export const sensorCatalog = {
    'temperature' : { 'icon': 'temperature-symbolic.svg', colorFormats: ['temp'] },
        'voltage' : { 'icon': 'voltage-symbolic.svg' },
            'fan' : { 'icon': 'fan-symbolic.svg', colorFormats: ['fan'] },
          'power' : { 'icon': 'power-symbolic.svg' },
         'memory' : { 'icon': 'memory-symbolic.svg', 'icon-swap': 'swap-symbolic.svg', colorFormats: ['percent'] },
      'processor' : { 'icon': 'cpu-symbolic.svg', colorFormats: ['percent'], sensorColorFormats: ['hertz'] },
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
    const sensorFormats = sensorCatalog[group]?.sensorColorFormats;
    if (formats?.includes(format) || sensorFormats?.includes(format))
        return `${group}-colors`;

    return null;
}

// Whether "All sensors" scales apply to this sensor, or only its own scale.
export function groupColorsApply(type, format) {
    if (format === 'temp')
        return true;

    return sensorCatalog[sensorGroupFromType(type)]?.colorFormats?.includes(format) ?? false;
}

// Unit of the thresholds when it is not the unit shown in the panel.
export function colorThresholdUnit(format) {
    return format === 'hertz' ? 'GHz' : null;
}

export function colorPageForSensor(type, format) {
    let key = colorsKeyForSensor(type, format);
    return key ? key.slice(0, -'-colors'.length) : null;
}
