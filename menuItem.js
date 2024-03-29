import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const MenuItem = GObject.registerClass({

    Signals: {
        'toggle': { param_types: [Clutter.Event.$gtype] },
    },

}, class MenuItem extends PopupMenu.PopupBaseMenuItem {

    _init(icon, key, label, value, checked) {
        super._init({ reactive: true });

        this._checked = checked;
        this._updateOrnament();

        this._key = key;
        this._gIcon = icon;

        // add icon
        this.add_child(new St.Icon({ style_class: 'popup-menu-icon', gicon : this._gIcon }));

        // add label
        this._labelActor = new St.Label({ text: label });
        this.add_child(this._labelActor);

        // add value
        this._valueLabel = new St.Label({ text: value });
        this._valueLabel.set_x_align(Clutter.ActorAlign.END);
        this._valueLabel.set_x_expand(true);
        this._valueLabel.set_y_expand(true);
        this.add_child(this._valueLabel);

        this.actor._delegate = this;
    }

    get checked() {
        return this._checked;
    }

    get key() {
        return this._key;
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

    // prevents menu from being closed
    activate(event) {
    this._checked = !this._checked;
        this._updateOrnament();
        this.emit('toggle', event);
    }

    _updateOrnament() {
        if (this._checked)
            this.setOrnament(PopupMenu.Ornament.CHECK);
        else
            this.setOrnament(PopupMenu.Ornament.NONE);
    }

    get label() {
        return this._labelActor.text;
    }
});
