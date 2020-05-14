const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const GObject = imports.gi.GObject;
const Clutter = imports.gi.Clutter;

// https://gitlab.gnome.org/GNOME/gnome-shell/issues/1069
// https://wiki.gnome.org/Projects/GnomeShell/Extensions/MigratingShellClasses
var MenuItem = GObject.registerClass({
    Signals: {
        'activate': { param_types: [GObject.TYPE_BOOLEAN] },
        'sensitive-changed': {},
        'active-changed': { param_types: [GObject.TYPE_BOOLEAN] }
    },

}, class MenuItem extends PopupMenu.PopupBaseMenuItem {

    _init(that, icon, key, label, value) {
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

        //item.connect('activate', Lang.bind(this, function(self) 
        this.signal = this.connect('activate', (self) => {
            let hotSensors = that._settings.get_strv('hot-sensors');

            if (self.checked) {
                self.checked = false;

                // remove selected sensor from panel
                hotSensors.splice(hotSensors.indexOf(self.key), 1);
                that._removeHotLabel(self.key);
                that._removeHotIcon(self.key);
            } else {
                self.checked = true;

                // add selected sensor to panel
                hotSensors.push(self.key);
                that._createHotItem(self.key, self.gicon, self.value);
            }

            if (hotSensors.length <= 0) {
                // add generic icon to panel when no sensors are selected
                hotSensors.push('_default_icon_');
                that._createHotItem('_default_icon_');
            } else {
                let defIconPos = hotSensors.indexOf('_default_icon_');
                if (defIconPos >= 0) {
                    // remove generic icon from panel when sensors are selected
                    hotSensors.splice(defIconPos, 1);
                    that._removeHotIcon('_default_icon_');
                }
            }

            // removes any sensors that may not currently be available
            hotSensors = that._removeMissingHotSensors(hotSensors);

            // this code is called asynchronously - make sure to save it for next round
            that._saveHotSensors(hotSensors);

            return true;
        });
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

    /*
    destroy() {
        global.log('destroying');
        this.disconnect(this.signal);
        super.destroy();
    }
    */
});
