const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Me = imports.misc.extensionUtils.getCurrentExtension();
Me.imports.helpers.polyfills;
const ByteArray = imports.byteArray;

function contentsCleaner(contents) {
    // are we running gnome 3.30 or higher?
    if (contents instanceof Uint8Array)
        return ByteArray.toString(contents).trim();
    else
        return contents.toString().trim();
}

function getcontents(filename) {
    let handle = Gio.File.new_for_path(filename);
    let contents = handle.load_contents(null)[1];
    return contentsCleaner(contents);
}

function File(path) {
    if (path.indexOf('https://') == -1)
        this.file = Gio.File.new_for_path(path);
    else
        this.file = Gio.File.new_for_uri(path);
}

File.prototype.read = function() {
    return new Promise((resolve, reject) => {
        try {
            this.file.load_contents_async(null, function(file, res) {
                try {
                    let contents = file.load_contents_finish(res)[1];
                    resolve(contentsCleaner(contents));
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
        let max_items = 100, results = [];

        try {
            this.file.enumerate_children_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, function(file, res) {
                try {
                    let enumerator = file.enumerate_children_finish(res);

                    let callback = function(enumerator, res) {
                        try {
                            let files = enumerator.next_files_finish(res);
                            for (let i = 0; i < files.length; i++) {
                                let file_info = files[i];
                                results.push(file_info.get_attribute_as_string(Gio.FILE_ATTRIBUTE_STANDARD_NAME));
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
