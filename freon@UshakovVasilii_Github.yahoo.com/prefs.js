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
        this.attach(updateTime, 1, i++, 1, 1);
        this._settings.bind('update-time', updateTime, 'value', Gio.SettingsBindFlags.DEFAULT);

        this._addSwitch({key : 'show-decimal-value', y : i, x : 0,
            label : _('Show Decimal Value'),
            help : _("Show one digit after decimal")});

        this._addComboBox({
            items : {centigrade : "\u00b0C", fahrenheit : "\u00b0F"},
            key: 'unit', y : i++, x : 2,
            label: _('Temperature Unit')
        });

        this._addComboBox({
            items : {left : 'Left', center : 'Center', right : 'Right'},
            key: 'position-in-panel', y : i, x : 0,
            label: _('Position in Panel')
        });

        this._addSwitch({key : 'show-icon-on-panel', y : i++, x : 2,
            label : _('Show Icon on Panel')});

        this._addSwitch({key : 'show-fan-rpm', y : i, x : 0,
            label : _('Show Fan Speed')});

        this._addSwitch({key : 'show-voltage', y : i++, x : 2,
            label : _('Show Power Supply Voltage')});

        this._addSwitch({key : 'group-temperature', y : i, x : 0,
            label : _('Group Temperature Items'),
            help : _("Works if you have more than three temperature sensors")});

        this._addSwitch({key : 'group-voltage', y : i++, x : 2,
            label : _('Group Voltage Items'),
            help : _("Works if you have more than three voltage sensors")});

        this._addComboBox({
            items : {none : 'None', hddtemp : 'Hddtemp', udisks2 : 'UDisks2'},
            key: 'drive-utility', y : i, x : 0,
            label: _('HDD/SSD Temperature Utility')
        });

        this._addComboBox({
            items : {
                'none' : _('None'),
                'nvidia-settings' : _('NVIDIA'),
                'aticonfig' : _('Catalyst'),
                'bumblebee-nvidia-smi': _('Bumblebee + NVIDIA') },
            key: 'gpu-utility', y : i, x : 2,
            label: _('Video Card Temperature Utility')
        });
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
    },

    _addComboBox : function(params){
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING]);

        let combobox = new Gtk.ComboBox({model: model});
        let renderer = new Gtk.CellRendererText();
        combobox.pack_start(renderer, true);
        combobox.add_attribute(renderer, 'text', 1);

        for(let k in params.items){
            model.set(model.append(), [0, 1], [k, params.items[k]]);
        }

        combobox.set_active(Object.keys(params.items).indexOf(this._settings.get_string(params.key)));
        
        combobox.connect('changed', Lang.bind(this, function(entry) {
            let [success, iter] = combobox.get_active_iter();
            if (!success)
                return;
            this._settings.set_string(params.key, model.get_value(iter, 0))
        }));

        this.attach(new Gtk.Label({ label: params.label, halign : Gtk.Align.END}), params.x, params.y, 1, 1);
        this.attach(combobox, params.x + 1, params.y, 1, 1);
    }

});

function buildPrefsWidget() {
    let w = new FreonPrefsWidget();
    w.show_all();
    return w;
}
