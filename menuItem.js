//const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;

var MenuItem = class extends PopupMenu.PopupBaseMenuItem {
    // more info: https://gitlab.gnome.org/GNOME/gnome-shell/blob/master/HACKING.md#classes
    // and: https://github.com/HarlemSquirrel/gnome-shell-extension-sensory-perception/commit/50f3b6f8b310babf2be475d4af88d43f66ba0505#diff-92b4f6f0e289769a75760eb5ce859ba1
    constructor(icon, key, label, value) {
        super({ reactive: true });
        //this.actor.add_child(icon);
        //this.actor.add_child(label);

        this._checked = false;
        this._key = key;
        this._gIcon = icon;

        this._labelActor = new St.Label({ text: label });
        this.actor.add(new St.Icon({ style_class: 'popup-menu-icon', gicon : this._gIcon }));
        this.actor.add(this._labelActor, { x_fill: true, expand: true });
        this._valueLabel = new St.Label({ text: value });
        this.actor.add(this._valueLabel);
    }

    set checked(checked) {
        if (checked)
            this.setOrnament(PopupMenu.Ornament.CHECK);
        else
            this.setOrnament(PopupMenu.Ornament.NONE);

        this._checked = checked;
    }

    get checked() {
        return this._checked;
    }

    get key() {
        return this._key;
    }

    set display_name(text) {
        return this._labelActor.text = text;
    }

    get gicon() {
        return this._gIcon;
    }

    set value(value) {
        this._valueLabel.text = value;
    }

    get value() {
        return this._valueLabel.text;
    }
};
