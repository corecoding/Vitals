const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Me = imports.misc.extensionUtils.getCurrentExtension();
Me.imports.helpers.polyfills;
const ByteArray = imports.byteArray;

var Decoder;
try {
    Decoder = new TextDecoder('utf-8');
} catch(error) {}

// convert Uint8Array into a literal string
function convertUint8ArrayToString(contents) {
    // Starting with Gnome 41, we use TextDecoder as ByteArray is deprecated
    if (Decoder)
        return Decoder.decode(contents).trim();

    // Supports ByteArray on Gnome 40
    // fixes #304, replaces invalid character
    contents[contents.indexOf(208)] = 0;
    return ByteArray.toString(contents).trim();
}

function SubProcess(command) {
    this.sub_process = Gio.Subprocess.new(command, Gio.SubprocessFlags.STDOUT_PIPE);
    this.stdout = this.sub_process.get_stdout_pipe();
}

SubProcess.prototype.read = function(delimiter = '') {
    return new Promise((resolve, reject) => {
        this.stdout.read_bytes_async(512, GLib.PRIORITY_LOW, null, function(stdout, res) {
            try {
                let read_bytes = stdout.read_bytes_finish(res).get_data();

                // convert contents to string
                read_str = convertUint8ArrayToString(read_bytes);

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