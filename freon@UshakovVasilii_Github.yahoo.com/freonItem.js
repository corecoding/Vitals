const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;

const FreonItem = new Lang.Class({
    Name: 'FreonItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(gIcon, label, value) {
        this.parent();
        this._main = false;
        this._label = label;
        this._gIcon = gIcon;

        this.actor.add(new St.Icon({ style_class: 'system-status-icon', gicon : gIcon}));
        this.actor.add(new St.Label({text: label}), {x_fill: true, expand: true});
        this._valueLabel = new St.Label({text: value});
        this.actor.add(this._valueLabel);
    },

    set main(main) {
        if(main)
            this.setOrnament(PopupMenu.Ornament.DOT);
        else
            this.setOrnament(PopupMenu.Ornament.NONE);
        this._main = main;
    },

    get main() {
        return this._main;
    },

    get label() {
        return this._label;
    },

    get gicon() {
        return this._gIcon;
    },

    set value(value) {
        this._valueLabel.text = value;
    }
});
