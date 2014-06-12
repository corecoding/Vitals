const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const modelColumn = {
    label: 0,
    separator: 1
}

function init() {
    Convenience.initTranslations();
}

const FreonPrefsWidget = new GObject.Class({
    Name: 'Freon.Prefs.Widget',
    GTypeName: 'FreonPrefsWidget',
    Extends: Gtk.Grid,

    _init: function(params) {
        this.parent(params);
        this.margin = this.row_spacing = this.column_spacing = 20;

        this._settings = Convenience.getSettings();

        let i = 0;

        this.attach(new Gtk.Label({ label: _('Poll Sensors Every (sec)'), halign : Gtk.Align.END}), 0, i, 1, 1);
        let updateTime = Gtk.SpinButton.new_with_range (1, 60, 1);
        this.attach(updateTime, 1, i, 1, 1);
        this._settings.bind('update-time', updateTime, 'value', Gio.SettingsBindFlags.DEFAULT);

        this._addSwitch({key : 'show-label', y : i++, x : 2,
            label : _('Show Sensor Label')});

        this._addSwitch({key : 'show-decimal-value', y : i, x : 0,
            label : _('Show Decimal Value'),
            help : _("Show one digit after decimal")});

        // Temperature Unit ComboBox
        let tUnitModel = new Gtk.ListStore();
        tUnitModel.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING]);

        let tUnit = new Gtk.ComboBox({model: tUnitModel});
        let tUnitRenderer = new Gtk.CellRendererText();
        tUnit.pack_start(tUnitRenderer, true);
        tUnit.add_attribute(tUnitRenderer, 'text', 1);

        let tUnitItems = ["centigrade", "fahrenheit"];

        tUnitModel.set(tUnitModel.append(), [0, 1], [tUnitItems[0], "\u00b0C"]);
        tUnitModel.set(tUnitModel.append(), [0, 1], [tUnitItems[1], "\u00b0F"]);

        tUnit.set_active(tUnitItems.indexOf(this._settings.get_string('unit')));
        
        tUnit.connect('changed', Lang.bind(this, function(entry) {
            let [success, iter] = tUnit.get_active_iter();
            if (!success)
                return;
            this._settings.set_string('unit', tUnitModel.get_value(iter, 0))
        }));

        this.attach(new Gtk.Label({ label: _('Temperature Unit'), halign : Gtk.Align.END}), 2, i, 1, 1);
        this.attach(tUnit, 3, i++, 1, 1);

        //


        this._addSwitch({key : 'show-hdd-temp', y : i, x : 0,
            label : _('Show Drive Temperature')});

        this._addSwitch({key : 'show-fan-rpm', y : i++, x : 2,
            label : _('Show Fan Speed')});

        this._addSwitch({key : 'show-voltage', y : i, x : 0,
            label : _('Show Power Supply Voltage')});

    },

    _addSwitch : function(params){
        let lbl = new Gtk.Label({label: params.label,halign : Gtk.Align.END});
        this.attach(lbl, params.x, params.y, 1, 1);
        let sw = new Gtk.Switch({halign : Gtk.Align.END, valign : Gtk.Align.CENTER});
        this.attach(sw, params.x + 1, params.y, 1, 1);
        if(params.help){
            lbl.set_tooltip_text(params.help);
            sw.set_tooltip_text(params.help);
        }
        this._settings.bind(params.key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
    }

});

function buildPrefsWidget() {
    let w = new FreonPrefsWidget();
    w.show_all();
    return w;
}
