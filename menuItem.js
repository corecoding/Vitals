const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const GObject = imports.gi.GObject;
const Clutter = imports.gi.Clutter;

// https://gitlab.gnome.org/GNOME/gnome-shell/issues/1069
// https://wiki.gnome.org/Projects/GnomeShell/Extensions/MigratingShellClasses
var MenuItem = GObject.registerClass(
  class MenuItem extends PopupMenu.PopupBaseMenuItem {

    _init(icon, key, label, value) {
        super._init({ reactive: true });

        this._checked = false;
        this._key = key;
        this._gIcon = icon;

        // add icon
        this.add(new St.Icon({ style_class: 'popup-menu-icon', gicon : this._gIcon }));

        // add label
        this._labelActor = new St.Label({ text: label });
        this.add(this._labelActor);

        // add value
        this._valueLabel = new St.Label({ text: value });
        this._valueLabel.set_x_align(Clutter.ActorAlign.END);
        this._valueLabel.set_x_expand(true);
        this._valueLabel.set_y_expand(true);
        this.add(this._valueLabel);

        this.actor._delegate = this;
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
});
