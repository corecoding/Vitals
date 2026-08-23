/* Built-in custom-command presets (shared by shell and preferences). */

const NVIDIA_QUERY_BASE =
    'name,' +
    'fan.speed,' +
    'temperature.gpu,temperature.memory,' +
    'memory.total,memory.used,memory.reserved,memory.free,' +
    'utilization.gpu,utilization.memory,utilization.encoder,utilization.decoder,' +
    'clocks.gr,clocks.mem,clocks.video,' +
    'power.draw.instant,power.draw.average,' +
    'pcie.link.gen.gpucurrent,pcie.link.width.current';

const NVIDIA_QUERY_STATIC =
    'temperature.gpu.tlimit,' +
    'power.limit,' +
    'pcie.link.gen.max,pcie.link.width.max,' +
    'addressing_mode,' +
    'driver_version,vbios_version,serial,' +
    'pci.domain,pci.bus,pci.device,pci.device_id,pci.sub_device_id';

const NVIDIA_FIELDS_BASE = [
    {name: 'Name', format: 'string'},
    {name: 'Fan', format: 'percent', scale: 0.01},
    {
        name: 'Temperature',
        format: 'temp',
        scale: 1000,
        also_type: 'temperature',
        also_label: 'GPU',
        also_label_numbered: true,
    },
    {name: 'Memory Temperature', format: 'temp', scale: 1000},
    {name: 'Memory Total', format: 'memory', scale: 1000},
    {name: 'Memory Used', format: 'memory', scale: 1000},
    {name: 'Memory Reserved', format: 'memory', scale: 1000},
    {name: 'Memory Free', format: 'memory', scale: 1000},
    {name: 'Utilization', format: 'percent', scale: 0.01},
    {name: 'Memory Utilization', format: 'percent', scale: 0.01},
    {name: 'Encoder Utilization', format: 'percent', scale: 0.01},
    {name: 'Decoder Utilization', format: 'percent', scale: 0.01},
    {name: 'Frequency', format: 'hertz', scale: 1000 * 1000},
    {name: 'Memory Frequency', format: 'hertz', scale: 1000 * 1000},
    {name: 'Encoder/Decoder Frequency', format: 'hertz', scale: 1000 * 1000},
    {name: 'Power', format: 'watt-gpu'},
    {name: 'Average Power', format: 'watt-gpu'},
    {name: 'Link Gen', format: 'string', hidden: true},
    {name: 'Link Width', format: 'string', hidden: true},
    {name: 'Memory Usage', format: 'percent', ratio: ['Memory Used', 'Memory Total']},
    {name: 'Link Speed', format: 'pcie', join: ['Link Gen', 'Link Width'], join_sep: 'x'},
];

const NVIDIA_FIELDS_STATIC = [
    {name: 'Temperature Limit', format: 'temp', scale: 1000, static: true},
    {name: 'Power Limit', format: 'watt-gpu', static: true},
    {name: 'Link Gen Max', format: 'string', hidden: true, static: true},
    {name: 'Link Width Max', format: 'string', hidden: true, static: true},
    {
        name: 'Maximum Link Speed',
        format: 'pcie',
        join: ['Link Gen Max', 'Link Width Max'],
        join_sep: 'x',
        static: true,
    },
    {name: 'Addressing Mode', format: 'string', static: true},
    {name: 'Driver Version', format: 'string', static: true},
    {name: 'vBIOS Version', format: 'string', static: true},
    {name: 'Serial Number', format: 'string', static: true},
    {name: 'Domain Number', format: 'string', static: true},
    {name: 'Bus Number', format: 'string', static: true},
    {name: 'Device Number', format: 'string', static: true},
    {name: 'Device ID', format: 'string', static: true},
    {name: 'Sub Device ID', format: 'string', static: true},
];

/**
 * @param {boolean} includeStatic - append static nvidia-smi query columns
 * @returns {object} command config suitable for custom-commands JSON
 */
export function buildNvidiaPreset(includeStatic = false) {
    const query = includeStatic
        ? NVIDIA_QUERY_BASE + ',' + NVIDIA_QUERY_STATIC
        : NVIDIA_QUERY_BASE;

    const fields = includeStatic
        ? NVIDIA_FIELDS_BASE.concat(NVIDIA_FIELDS_STATIC)
        : NVIDIA_FIELDS_BASE.slice();

    return {
        id: 'nvidia-smi',
        enabled: true,
        name: 'NVIDIA SMI',
        category: 'gpu',
        argv: [
            'nvidia-smi',
            '--query-gpu=' + query,
            '--format=csv,noheader,nounits',
            '-l',
            '{update_time}',
        ],
        mode: 'long_running',
        line_delimiter: '\n',
        field_delimiter: ',',
        multi_instance: true,
        group_header_field: 'Utilization',
        fields,
    };
}

export function blankCommandPreset() {
    return {
        id: 'custom-' + Date.now().toString(36),
        enabled: true,
        name: 'Custom command',
        category: 'gpu',
        argv: ['echo', 'value'],
        mode: 'oneshot',
        line_delimiter: '\n',
        field_delimiter: ',',
        multi_instance: false,
        group_header_field: '',
        fields: [{name: 'Value', format: 'string'}],
    };
}

export const PRESET_BUILDERS = {
    'nvidia-smi': buildNvidiaPreset,
};
