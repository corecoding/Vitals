const Lang = imports.lang;
const GLib = imports.gi.GLib;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const CommandLineUtil = Me.imports.commandLineUtil;

const NvidiaUtil = new Lang.Class({
    Name: 'NvidiaUtil',
    Extends: CommandLineUtil.CommandLineUtil,

    detect: function(){
        let path = GLib.find_program_in_path('nvidia-settings');
        this._argv = path ? [path, '-q', 'gpucoretemp', '-t'] : null;
        return this._argv != null;
    },

    get temp() {
        if(!this._output)
            return [];
        for each(let line in this._output) {
            if(!line)
                continue;
            return [{label: 'Nvidia', temp: parseFloat(line)}];
        }

        return [];
    }

});
