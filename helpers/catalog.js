/* Shared sensor catalog for shell and preferences. */
export const sensorCatalog = {
    'temperature' : { 'icon': 'temperature-symbolic.svg', colorFormats: ['temp'], aggregate: true },
        'coolant' : { 'icon': 'water-droplet-symbolic.svg', colorFormats: ['temp'], aggregate: true,
                      unitSetting: 'coolant-unit' },
        'voltage' : { 'icon': 'voltage-symbolic.svg', aggregate: true },
            'fan' : { 'icon': 'fan-symbolic.svg', colorFormats: ['fan'], aggregate: true },
           'pump' : { 'icon': 'pump-symbolic.svg', colorFormats: ['fan'], aggregate: true },
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
    group = group.replace(/#\d+$/, '');

    // types may carry a suffix, eg 'network-rx' or 'network-us'. Every catalog
    // group is a single word, so fall back to the leading segment.
    if (!(group in sensorCatalog))
        group = group.split('-')[0];

    return group;
}

export function colorSettingsKeys() {
    return Object.keys(sensorCatalog)
        .filter(group => sensorCatalog[group].colorFormats)
        .map(group => `${group}-colors`);
}

// GSettings key for threshold colors for a live sensor (shared by values + prefs).
export function colorsKeyForSensor(type, format) {
    const group = sensorGroupFromType(type);
    const formats = sensorCatalog[group]?.colorFormats;
    if (formats && formats.includes(format))
        return `${group}-colors`;

    // remaining temperatures share the temperature threshold UI, including GPU rows
    if (format === 'temp')
        return 'temperature-colors';

    return null;
}

export function colorPageForSensor(type, format) {
    let key = colorsKeyForSensor(type, format);
    return key ? key.slice(0, -'-colors'.length) : null;
}

// groups discovered from hardware monitors and summarized by a group average
export function isAggregateGroup(group) {
    return !!sensorCatalog[group]?.aggregate;
}

// a group may pick its own temperature unit, eg coolant reads coolant-unit
export function unitSettingForType(type) {
    return sensorCatalog[sensorGroupFromType(type)]?.unitSetting ?? 'unit';
}
