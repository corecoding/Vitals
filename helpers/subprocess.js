import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { convertUint8ArrayToString } from './bytes.js';

const READ_CHUNK = 8192;

export function SubProcess(command) {
    this.sub_process = Gio.Subprocess.new(command, Gio.SubprocessFlags.STDOUT_PIPE);
    this.stdout = this.sub_process.get_stdout_pipe();
    this._buffer = '';
}

/**
 * Read available stdout, optionally splitting on delimiter.
 * With a delimiter, incomplete trailing fragments stay buffered until a later read.
 */
SubProcess.prototype.read = function(delimiter = '') {
    return new Promise((resolve, reject) => {
        if (!this.stdout) {
            resolve(delimiter ? [] : '');
            return;
        }

        this.stdout.read_bytes_async(READ_CHUNK, GLib.PRIORITY_LOW, null, (stdout, res) => {
            try {
                let read_bytes = stdout.read_bytes_finish(res).get_data();
                let read_str = convertUint8ArrayToString(read_bytes);

                if (!delimiter) {
                    resolve(read_str);
                    return;
                }

                this._buffer += read_str;

                if (read_str === '') {
                    // EOF: flush remainder as a final line if present
                    if (this._buffer.length) {
                        let rest = this._buffer;
                        this._buffer = '';
                        resolve([rest]);
                    } else {
                        resolve([]);
                    }
                    return;
                }

                let parts = this._buffer.split(delimiter);
                this._buffer = parts.pop();
                resolve(parts);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING)) {
                    // previous read still waiting; ignore duplicate attempt
                    resolve(delimiter ? [] : '');
                } else {
                    reject(e.message);
                }
            }
        });
    });
};

/** Drain stdout until EOF (for oneshot helpers that wrap SubProcess). */
SubProcess.prototype.readAll = function() {
    let chunks = [];
    let self = this;

    function step() {
        return self.read('').then(chunk => {
            if (chunk === '')
                return chunks.join('');
            chunks.push(chunk);
            return step();
        });
    }

    return step();
};

SubProcess.prototype.terminate = function() {
    if (!this.sub_process)
        return;

    const SIGINT = 2;
    try {
        this.sub_process.send_signal(SIGINT);
    } catch (e) { /* already exited */ }
    this.sub_process = null;
    if (this.stdout) {
        this.stdout.close_async(GLib.PRIORITY_LOW, null, null);
        this.stdout = null;
    }
    this._buffer = '';
};

/**
 * Run argv once and return full stdout string.
 * @param {string[]} argv
 * @returns {Promise<string>}
 */
export function runOnce(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) {
            reject(e);
            return;
        }

        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                let [, stdout] = p.communicate_utf8_finish(res);
                resolve(stdout || '');
            } catch (e) {
                reject(e);
            }
        });
    });
}
