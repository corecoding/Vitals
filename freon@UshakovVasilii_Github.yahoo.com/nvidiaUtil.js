const Lang = imports.lang;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;

const NvidiaUtil = new Lang.Class({
    Name: 'NvidiaUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    _init: function() {
        this.parent();
        let path = GLib.find_program_in_path('nvidia-settings');
        this._argv = path ? [path, '-q', 'gpucoretemp', '-t'] : null;
        this._label = 'NVIDIA';
        if(this._argv){
            //     [0] ushakov-pc:0[gpu:0] (GeForce GTX 770)
            for each(let line in GLib.spawn_command_line_sync(path + " -q gpus")){
                let match = /.*\[gpu:[\d]\].*\(([\w\d\ ]+)\).*/.exec(line);
                if(match){
                    this._label = match[1];
                    break;
                }
            }
        }
    },

    get temp() {
        if(!this._output)
            return [];
        for each(let line in this._output) {
            if(!line)
                continue;
            return [{label: this._label, temp: parseFloat(line)}];
        }

        return [];
    }

});
