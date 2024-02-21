import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// convert Uint8Array into a literal string
function convertUint8ArrayToString(contents) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(contents).trim();
}

export function SubProcess(command) {
    this.sub_process = Gio.Subprocess.new(command, Gio.SubprocessFlags.STDOUT_PIPE);
    this.stdout = this.sub_process.get_stdout_pipe();
}

SubProcess.prototype.read = function(delimiter = '') {
    return new Promise((resolve, reject) => {
        this.stdout.read_bytes_async(512, GLib.PRIORITY_LOW, null, function(stdout, res) {
            try {
                let read_bytes = stdout.read_bytes_finish(res).get_data();

                // convert contents to string
                let read_str = convertUint8ArrayToString(read_bytes);

                // split read_str by delimiter if passed in
                if (delimiter) {
                    if (read_str == '')
                        read_str = []; // EOF, ''.split(delimiter) would return ['']
                    else
                        read_str = read_str.split(delimiter);
                }

                // return results
                resolve(read_str);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PENDING)) {
                    // previous read attempt is still waiting for something from stdout
                    // ignore second attempt, return empty data (like EOF)
                    if (delimiter) resolve([]);
                    else resolve('');
                } else {
                    reject(e.message);
                }
            }
        });
    });
};

SubProcess.prototype.terminate = function() {
    const SIGINT = 2;
    this.sub_process.send_signal(SIGINT);
    this.sub_process = null;
    this.stdout.close_async(GLib.PRIORITY_LOW, null, null);
    this.stdout = null;
};
