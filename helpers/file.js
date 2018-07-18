const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Promise = Me.imports.helpers.promise.Promise;

function File(path) {
    this.file = Gio.File.new_for_path(path);
}

File.prototype.exists = function() {
    return new Promise(resolve => resolve(this.file.query_exists(null)));
};

File.prototype.read = function() {
    return new Promise((resolve, reject) => {
        try {
            this.file.load_contents_async(null, function(file, res) {
                try {
                    let contents = file.load_contents_finish(res)[1].toString().trim();
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

File.prototype.create = function(text, replace) {
    return new Promise(resolve => {
        let outputstream = this.file.create(Gio.FileCreateFlags[replace ? "REPLACE_DESTINATION" : "NONE"], null);

        outputstream.write_all(typeof text === "string" ? text : "", null);

        outputstream.close(null);

        resolve();
    });
};

File.prototype.append = function(text) {
    return new Promise(resolve => {
        let outputstream = this.file.append_to(Gio.FileCreateFlags.NONE, null);

        outputstream.write_all(text, null);

        outputstream.close(null);

        resolve();
    });
};

File.prototype.copyto = function(path, replace) {
    return new Promise(resolve => resolve(this.file.copy(new File(path).file, Gio.FileCopyFlags[replace ? "OVERWRITE" : "NONE"], null, null)));
};

File.prototype.moveto = function(path) {
    return new Promise(resolve => resolve(this.file.move(new File(path).file, Gio.FileCopyFlags.NONE, null, null)));
};

File.prototype.rename = function(name) {
    return new Promise(resolve => {
        this.file.set_display_name_async(name, GLib.PRIORITY_DEFAULT, null, (source, res) => resolve(source.set_display_name_finish(res)));
    });
};

File.prototype.delete = function() {
    return new Promise(resolve => {
        this.file.delete_async(GLib.PRIORITY_DEFAULT, null, (source, res) => resolve(source.delete_finish(res)));
    });
};

File.prototype.mkdir = function() {
    return new Promise(resolve => {
        this.file.make_directory_async(GLib.PRIORITY_DEFAULT, null, (source, res) => resolve(source.make_directory_finish(res)));
    });
};

File.prototype.symlinkto = function(path) {
    return new Promise(resolve => resolve(this.file.make_symbolic_link(path, null)));
};
