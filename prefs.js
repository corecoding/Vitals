const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;


const Gettext = imports.gettext.domain('cpu-temperature');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

function init() {
    Convenience.initTranslations();
}

const CPUTemperaturePrefsWidget = new GObject.Class({
    Name: 'CPUTemperature.Prefs.Widget',
    GTypeName: 'CPUTemperaturePrefsWidget',
    Extends: Gtk.Grid,

    _init: function(params) {
        this.parent(params);
            this.margin = this.row_spacing = this.column_spacing = 20;

        this._settings = Convenience.getSettings();

        this.attach(new Gtk.Label({ label: 'Seconds before next update' }), 0, 0, 1, 1);
        let update_time = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 5, 100, 5);
            update_time.set_value(this._settings.get_int('update-time'));
            update_time.set_digits(0);
            update_time.set_hexpand(true);
            update_time.connect('value-changed', Lang.bind(this, this._onUpdateTimeChanged));
        this.attach(update_time, 1, 0, 1, 1);
        

		this.attach(new Gtk.Label({ label: 'Unit' }), 0, 2, 1, 1);
        let centigradeRadio = new Gtk.RadioButton({ group: null, label: "Centigrade", valign: Gtk.Align.START });
        let fahrenheitRadio = new Gtk.RadioButton({ group: centigradeRadio, label: "Fahrenheit", valign: Gtk.Align.START });
        fahrenheitRadio.connect('toggled', Lang.bind(this, this._onUnitChanged));
        centigradeRadio.connect('toggled', Lang.bind(this, this._onUnitChanged));
        if (this._settings.get_string('unit')=='Centigrade') centigradeRadio.active = true;
            else fahrenheitRadio.active = true;
        this.attach(centigradeRadio, 1, 2, 1, 1);
        this.attach(fahrenheitRadio, 2, 2, 1, 1);

        let boolSettings = {
            display_degree_sign: {
                name: _("display-degree-sign"),
                label: _("Display degree sign"),
                help: _("Show degree sign in panel and menu. (default: ON)")
            },
            display_decimal_value: {
                name: _("display-decimal-value"),
                label: _("Display decimal value"),
                help: _("Show one digit after decimal. (default: ON)")
           },
           show_hdd_temp: {
                name: _("display-hdd-temp"),
                label: _("Display hard disk temperature"),
                help: _("Requires hddtemp installed. (default: ON)")
           },
        }

        let counter = 3;

        for (boolSetting in boolSettings){
            let setting = boolSettings[boolSetting];
            let settingLabel = new Gtk.Label({ label: setting.label });
            let settingSwitch = new Gtk.Switch({active: this._settings.get_boolean(setting.name)});
            let settings = this._settings;
            settingSwitch.connect('notify::active', function(button) {
             settings.set_boolean(setting.name, button.active);
             });

            if (setting.help) {
               settingLabel.set_tooltip_text(setting.help);
               settingSwitch.set_tooltip_text(setting.help);
            }

            this.attach(settingLabel, 0, counter, 1, 1);
            this.attach(settingSwitch, 1, counter++, 1, 1);

        }

        this.attach(new Gtk.Label({ label: 'Show in panel' }), 0, counter+1, 1, 1);
        let averageRadio = new Gtk.RadioButton({ group: null, label: "Average", valign: Gtk.Align.START });
        let maximumRadio = new Gtk.RadioButton({ group: averageRadio, label: "Maximum", valign: Gtk.Align.START });
        averageRadio.connect('toggled', Lang.bind(this, this._onMethodChanged));
        maximumRadio.connect('toggled', Lang.bind(this, this._onMethodChanged));
        if (this._settings.get_string('show-in-panel')=='Average') averageRadio.active = true;
            else maximumRadio.active = true;
        this.attach(averageRadio, 1, counter + 1, 1, 1);
        this.attach(maximumRadio, 2, counter + 1, 1, 1);

    },

    _onUpdateTimeChanged: function (update_time) {
        this._settings.set_int('update-time', update_time.get_value());
    },

	_onUnitChanged: function (unit) {
        if (unit.get_active()){
        	  this._settings.set_string('unit', unit.label);
          }
    },

    _onMethodChanged: function (method) {
        if (method.get_active()){
              this._settings.set_string('show-in-panel', method.label);
          }
    },

});

function buildPrefsWidget() {
    let widget = new CPUTemperaturePrefsWidget();
    widget.show_all();
    return widget;
}
