import * as SubProcessModule from './subprocess.js';
import {buildNvidiaPreset} from './presets.js';
import {sensorCatalog} from './catalog.js';

function isDerivedField(field) {
    return !!(field.ratio || field.join);
}

function substituteArgv(argv, updateTime) {
    let token = String(updateTime);
    return argv.map(arg => String(arg).split('{update_time}').join(token));
}

function parseCommandsJson(raw) {
    try {
        let parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Vitals: invalid custom-commands JSON');
        return [];
    }
}

function applyScale(raw, field) {
    if (field.format === 'string' || field.format === 'pcie' || field.format === '')
        return typeof raw === 'string' ? raw.trim() : raw;

    let text = String(raw).trim();
    if (text === '' || text === 'N/A' || text === '[N/A]')
        return null;

    let num = parseFloat(text);
    if (!Number.isFinite(num))
        return field.format === 'string' ? text : null;

    if (typeof field.scale === 'number')
        num *= field.scale;
    return num;
}

/**
 * Loads custom-commands from settings, runs enabled tools, emits sensor values.
 */
export class CommandSensors {
    constructor(settings) {
        this._settings = settings;
        this._processes = new Map(); // id -> SubProcess
        this._labels = new Map(); // id -> [{label, type, format}]
        this._badSplitCounts = new Map();
        this._instanceCounts = {};
        this._gpuCommandActive = false;
        this._oneshotBusy = new Set();
        this._signals = [];

        this._maybeSeed();
        this.reconfigure();

        this._signals.push(this._settings.connect('changed::custom-commands', () => this.reconfigure()));
        this._signals.push(this._settings.connect('changed::update-time', () => this.reconfigure()));
        this._signals.push(this._settings.connect('changed::include-static-gpu-info', () => this.reconfigure()));
        for (let cat of Object.keys(sensorCatalog))
            this._signals.push(this._settings.connect('changed::show-' + cat, () => this.reconfigure()));
    }

    _maybeSeed() {
        if (this._settings.get_boolean('custom-commands-seeded'))
            return;

        let commands = parseCommandsJson(this._settings.get_string('custom-commands'));
        if (commands.length === 0 && this._settings.get_boolean('show-gpu'))
            commands = [buildNvidiaPreset(this._settings.get_boolean('include-static-gpu-info'))];

        this._settings.set_string('custom-commands', JSON.stringify(commands));
        this._settings.set_boolean('custom-commands-seeded', true);
    }

    getCommands() {
        return parseCommandsJson(this._settings.get_string('custom-commands'));
    }

    /**
     * Resolve runtime config for a stored command (nvidia preset expands with static flag).
     */
    resolveCommand(cmd) {
        if (cmd.id === 'nvidia-smi' || cmd.preset === 'nvidia-smi') {
            let built = buildNvidiaPreset(this._settings.get_boolean('include-static-gpu-info'));
            return Object.assign({}, built, {
                enabled: cmd.enabled !== false,
                name: cmd.name || built.name,
                id: cmd.id || 'nvidia-smi',
            });
        }
        return cmd;
    }

    hasActiveGpuCommand() {
        return this._gpuCommandActive;
    }

    instanceCounts() {
        return Object.assign({}, this._instanceCounts);
    }

    reconfigure() {
        this._terminateAll();
        this._gpuCommandActive = false;
        this._instanceCounts = {};

        let updateTime = Math.max(this._settings.get_int('update-time'), 1);

        for (let raw of this.getCommands()) {
            if (raw.enabled === false)
                continue;

            let cmd = this.resolveCommand(raw);
            if (!cmd.argv || !cmd.argv.length)
                continue;

            let category = cmd.category || 'gpu';
            if (!this._settings.get_boolean('show-' + category))
                continue;

            if (category === 'gpu')
                this._gpuCommandActive = true;

            if (cmd.mode === 'long_running') {
                try {
                    let argv = substituteArgv(cmd.argv, updateTime);
                    this._processes.set(cmd.id, new SubProcessModule.SubProcess(argv));
                    this._badSplitCounts.set(cmd.id, 0);
                } catch (e) {
                    console.warn(`Vitals: failed to start command ${cmd.id}: ${e}`);
                    this._processes.delete(cmd.id);
                }
            }
        }
    }

    /**
     * Poll enabled commands and emit values through callback(label, value, type, format).
     */
    query(callback) {
        for (let raw of this.getCommands()) {
            if (raw.enabled === false)
                continue;

            let cmd = this.resolveCommand(raw);
            let category = cmd.category || 'gpu';
            if (!this._settings.get_boolean('show-' + category))
                continue;

            if (cmd.mode === 'long_running')
                this._queryLongRunning(cmd, callback);
            else
                this._queryOneshot(cmd, callback);
        }
    }

    _queryLongRunning(cmd, callback) {
        let proc = this._processes.get(cmd.id);
        if (!proc) {
            this._disableLabels(cmd.id, callback);
            return;
        }

        let delim = cmd.line_delimiter || '\n';
        proc.read(delim).then(lines => {
            if (!lines.length)
                return;
            this._parseLines(cmd, lines, callback);
        }).catch(err => {
            console.warn(`Vitals: command ${cmd.id} read failed: ${err}`);
            this._disableLabels(cmd.id, callback);
            this._restartLongRunning(cmd);
        });
    }

    _queryOneshot(cmd, callback) {
        if (this._oneshotBusy.has(cmd.id))
            return;

        this._oneshotBusy.add(cmd.id);
        let updateTime = Math.max(this._settings.get_int('update-time'), 1);
        let argv = substituteArgv(cmd.argv, updateTime);

        SubProcessModule.runOnce(argv).then(stdout => {
            this._oneshotBusy.delete(cmd.id);
            let delim = cmd.line_delimiter || '\n';
            let lines = stdout.split(delim).filter(l => l.length > 0);
            if (!lines.length) {
                this._disableLabels(cmd.id, callback);
                return;
            }
            this._parseLines(cmd, lines, callback);
        }).catch(err => {
            this._oneshotBusy.delete(cmd.id);
            console.warn(`Vitals: command ${cmd.id} failed: ${err}`);
            this._disableLabels(cmd.id, callback);
        });
    }

    _restartLongRunning(cmd) {
        let old = this._processes.get(cmd.id);
        if (old)
            old.terminate();
        this._processes.delete(cmd.id);

        try {
            let updateTime = Math.max(this._settings.get_int('update-time'), 1);
            let argv = substituteArgv(cmd.argv, updateTime);
            this._processes.set(cmd.id, new SubProcessModule.SubProcess(argv));
            this._badSplitCounts.set(cmd.id, 0);
        } catch (e) {
            console.warn(`Vitals: failed to restart command ${cmd.id}: ${e}`);
        }
    }

    _csvFields(cmd) {
        return (cmd.fields || []).filter(f => !isDerivedField(f));
    }

    _expectedWidth(cmd) {
        return this._csvFields(cmd).length;
    }

    _parseLines(cmd, lines, callback) {
        let fieldDelim = cmd.field_delimiter !== undefined ? cmd.field_delimiter : ',';
        let expected = this._expectedWidth(cmd);
        let multi = !!cmd.multi_instance;
        let validLines = [];

        for (let line of lines) {
            if (!line || !String(line).trim())
                continue;
            let cols = String(line).split(fieldDelim).map(c => c.trim());
            if (expected > 0 && cols.length < expected) {
                let bad = (this._badSplitCounts.get(cmd.id) || 0) + 1;
                this._badSplitCounts.set(cmd.id, bad);
                if (cmd.mode === 'long_running') {
                    if (bad === 2)
                        this._restartLongRunning(cmd);
                    else if (bad >= 3) {
                        let proc = this._processes.get(cmd.id);
                        if (proc)
                            proc.terminate();
                        this._processes.delete(cmd.id);
                        this._disableLabels(cmd.id, callback);
                    }
                }
                continue;
            }
            this._badSplitCounts.set(cmd.id, 0);
            validLines.push(cols);
        }

        if (!validLines.length)
            return;

        let category = cmd.category || 'gpu';
        let count = multi ? validLines.length : 1;
        this._instanceCounts[category] = Math.max(this._instanceCounts[category] || 1, count);

        for (let i = 0; i < validLines.length; i++) {
            let instance = multi ? (i + 1) : 0;
            this._emitRow(cmd, validLines[i], instance, multi && validLines.length > 1, callback);
        }
    }

    _typeName(cmd, instance, multi) {
        let category = cmd.category || 'gpu';
        if (cmd.multi_instance || multi)
            return category + '#' + (instance || 1);
        return category;
    }

    _emitRow(cmd, cols, instance, multiLabel, callback) {
        let typeName = this._typeName(cmd, instance, cmd.multi_instance);
        let byName = {};
        let csvFields = this._csvFields(cmd);
        let labels = this._labels.get(cmd.id);
        if (!labels)
            this._labels.set(cmd.id, labels = []);

        function track(label, type, format) {
            let key = label + '\0' + type;
            if (!labels._index)
                labels._index = {};
            if (!labels._index[key]) {
                labels._index[key] = true;
                labels.push({label, type, format});
            }
        }

        function emit(label, value, type, format) {
            if (value === null || value === undefined)
                return;
            if (format !== 'string' && format !== 'pcie' && format !== '' &&
                typeof value === 'number' && !Number.isFinite(value))
                return;
            track(label, type, format);
            callback(label, value, type, format);
        }

        for (let i = 0; i < csvFields.length; i++) {
            let field = csvFields[i];
            let value = applyScale(cols[i], field);
            byName[field.name] = value;

            if (field.hidden)
                continue;

            emit(field.name, value, typeName, field.format || 'string');

            if (field.also_type && value !== null) {
                let alsoLabel = field.also_label || field.name;
                if (field.also_label_numbered && multiLabel)
                    alsoLabel = alsoLabel + ' ' + instance;
                emit(alsoLabel, value, field.also_type, field.format || 'string');
            }
        }

        for (let field of (cmd.fields || [])) {
            if (!isDerivedField(field))
                continue;

            let value = null;
            if (field.ratio) {
                let a = byName[field.ratio[0]];
                let b = byName[field.ratio[1]];
                if (typeof a === 'number' && typeof b === 'number' && b !== 0)
                    value = a / b;
            } else if (field.join) {
                let parts = field.join.map(n => byName[n]);
                if (parts.every(p => p !== null && p !== undefined && p !== ''))
                    value = parts.join(field.join_sep || '');
            }

            if (field.hidden)
                continue;

            byName[field.name] = value;
            emit(field.name, value, typeName, field.format || 'string');
        }

        let headerField = cmd.group_header_field;
        if (headerField && byName[headerField] !== undefined && byName[headerField] !== null)
            emit(headerField, byName[headerField], typeName + '-group',
                (csvFields.find(f => f.name === headerField) ||
                 (cmd.fields || []).find(f => f.name === headerField) ||
                 {format: 'percent'}).format || 'percent');
    }

    _disableLabels(cmdId, callback) {
        let labels = this._labels.get(cmdId);
        if (!labels)
            return;
        for (let labelObj of labels)
            callback(labelObj.label, 'disabled', labelObj.type, labelObj.format);
    }

    _terminateAll() {
        for (let proc of this._processes.values())
            proc.terminate();
        this._processes.clear();
        this._badSplitCounts.clear();
    }

    destroy() {
        this._terminateAll();
        for (let id of this._signals)
            this._settings.disconnect(id);
        this._signals = [];
        this._labels.clear();
    }
}
