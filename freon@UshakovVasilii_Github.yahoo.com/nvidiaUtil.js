const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;

const NvidiaUtil = new Lang.Class({
    Name: 'NvidiaUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    _init: function() {
        this.parent();
        let path = GLib.find_program_in_path('nvidia-settings');
        this._argv = path ? [path, '-q', 'gpucoretemp', '-t'] : null;
        this._labels = [];
        if(this._argv){
            //     [0] ushakov-pc:0[gpu:0] (GeForce GTX 770)
            let [exit, pid, stdinFd, stdoutFd, stderrFd] =
                GLib.spawn_async_with_pipes(null, /* cwd */
                                            [path, '-q', 'gpus'], /* args */
                                            null, /* env */
                                            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                            null /* child_setup */);

            let stdout = new Gio.UnixInputStream({fd: stdoutFd, close_fd: true});
            let outReader = new Gio.DataInputStream({base_stream: stdout});

            GLib.close(stdinFd);
            GLib.close(stderrFd);
            let childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function(pid, status, requestObj) {
                  let output = [];
                  let [line, size] = [null, 0];

                  while (([line, size] = outReader.read_line(null)) != null && line != null) {
                      let match = /.*\[gpu:[\d]\].*\(([\w\d\ ]+)\).*/.exec(line.toString());
                      if(match){
                          this._labels.push(match[1]);
                      }
                  }

                  stdout.close(null);
                  GLib.source_remove(childWatch);
            }));
        }
    },

    get temp() {
        if(!this._output)
            return [];
        let temps = [];
        for each(let line in this._output) {
            if(!line)
                continue;
            temps.push(parseFloat(line));
        }

        let gpus = [];

        if(this._labels.length > 0 && this._labels.length == temps.length - 1){
			// usually we should skip first line (most popular case)
			for(let i = 0; i < this._labels.length; i++){
				gpus.push({ label: this._labels[i], temp: temps[i + 1] })
			}
        } else if(temps.length == 1 || temps.length == 2){
			// cannot parse GPU label, usually temp duplicated
			gpus.push({ label: 'NVIDIA', temp: temps[0] })
		} else {
            // I think it is not possible
		    for(let i = 0; i < temps.length; i++){
		        let label = 'NVIDIA-' + (i + 1);
		        gpus.push({ label: label, temp: temps[i] })
		    }
        }

        return gpus;
    }

});
