import Gio from 'gi://Gio';
import GLib from 'gi://GLib'

// convert Uint8Array into a literal string
function convertUint8ArrayToString(contents) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(contents).trim();
}

export function File(path) {
    if (path.indexOf('https://') == -1)
        this.file = Gio.File.new_for_path(path);
    else
        this.file = Gio.File.new_for_uri(path);
}

File.prototype.read = function(delimiter = '', strip_header = false) {
    return new Promise((resolve, reject) => {
        try {
            this.file.load_contents_async(null, function(file, res) {
                try {
                    // grab contents of file or website
                    let contents = file.load_contents_finish(res)[1];

                    // convert contents to string
                    contents = convertUint8ArrayToString(contents);

                    // split contents by delimiter if passed in
                    if (delimiter) contents = contents.split(delimiter);

                    // optionally strip header when converting to a list
                    if (strip_header) contents.shift();

                    // return results
                    resolve(contents);
                } catch (e) {
                    reject(e.message);
                }
            });
        } catch (e) {
            reject(e.message);
        }
    });
};

File.prototype.list = function() {
    return new Promise((resolve, reject) => {
        let max_items = 125, results = [];

        try {
            this.file.enumerate_children_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, function(file, res) {
                try {
                    let enumerator = file.enumerate_children_finish(res);

                    let callback = function(enumerator, res) {
                        try {
                            let files = enumerator.next_files_finish(res);
                            for (let i = 0; i < files.length; i++) {
                                results.push(files[i].get_attribute_as_string(Gio.FILE_ATTRIBUTE_STANDARD_NAME));
                            }

                            if (files.length == 0) {
                                enumerator.close_async(GLib.PRIORITY_LOW, null, function(){});
                                resolve(results);
                            } else {
                                enumerator.next_files_async(max_items, GLib.PRIORITY_LOW, null, callback);
                            }
                        } catch (e) {
                            reject(e.message);
                        }
                    };

                    enumerator.next_files_async(max_items, GLib.PRIORITY_LOW, null, callback);
                } catch (e) {
                    reject(e.message);
                }
            });
        } catch (e) {
            reject(e.message);
        }
    });
};
