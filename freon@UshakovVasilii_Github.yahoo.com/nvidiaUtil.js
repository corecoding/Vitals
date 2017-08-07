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
        this._labels = [];
        if(this._argv){
            //     [0] ushakov-pc:0[gpu:0] (GeForce GTX 770)
            for each(let line in GLib.spawn_command_line_sync(path + " -q gpus")){
                let match = /.*\[gpu:[\d]\].*\(([\w\d\ ]+)\).*/.exec(line);
                if(match){
                    this._labels.push(match[1]);
                }
            }
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
        for(let i = 0; i< temps.length; i++){
            let label = null;
            if(this._labels.length == temps.length)
                label = this._lebels[i];
            else if(temps.length > 1)
                label = 'NVIDIA-' + (i + 1);
            else
                label = 'NVIDIA';
            gpus.push({ label: label, temp: temps[i] })
        }

        return gpus;
    }

});
