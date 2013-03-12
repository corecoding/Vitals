const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Pango = imports.gi.Pango;


const Gettext = imports.gettext.domain('gse-sensors');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const modelColumn = {
    label: 0,
    method: 1, 
    separator: 2
}

function init() {
    Convenience.initTranslations();
}

const SensorsPrefsWidget = new GObject.Class({
    Name: 'Sensors.Prefs.Widget',
    GTypeName: 'SensorsPrefsWidget',
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
           show_fan_rpm: {
                name: _("display-fan-rpm"),
                label: _("Display fan RPM"),
                help: _("Show the fan rotations per minute. (default: ON)")
           },
           show_voltage: {
                name: _("display-voltage"),
                label: _("Display voltage"),
                help: _("Show the voltage of various components. (default: ON)")
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

        //List of items of the ComboBox 
        this._model =  new Gtk.ListStore();
        this._model.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]);
        this._model.set (this._model.append(), [modelColumn.label, modelColumn.method], ['Average temperature', 'average']);
        this._model.set (this._model.append(), [modelColumn.label, modelColumn.method], ['Maximum temperature', 'maximum']);
        this._model.set (this._model.append(), [modelColumn.separator], [true]);

	//Fill the list
        this._getSensorsLabels();

        // ComboBox to select which sensor to show in panel
        this._sensorSelector = new Gtk.ComboBox({ model: this._model });
        this._sensorSelector.set_active_iter(this._getActiveSensorIter());
        this._sensorSelector.set_row_separator_func(Lang.bind(this, this._comboBoxSeparator), null, null);

        let renderer = new Gtk.CellRendererText();
        this._sensorSelector.pack_start(renderer, true);
        this._sensorSelector.add_attribute(renderer, 'text', modelColumn.label);
        this._sensorSelector.connect('changed', Lang.bind(this, this._onSelectorChanged));

        this.attach(new Gtk.Label({ label: "Show in panel" }), 0, ++counter, 1, 1);
        this.attach(this._sensorSelector, 1, counter , 1, 1);
    },

    _comboBoxSeparator: function(aaa, iter, data) {
        return this._model.get_value(iter, modelColumn.separator);
    },

    _getSensorsLabels: function() {
        this.sensorsPath = GLib.find_program_in_path('sensors');
        if (this.sensorsPath) {
           let sensors_output = GLib.spawn_command_line_sync(this.sensorsPath + ' -A');
           if(sensors_output[0]) {
                let sensors = sensors_output[1].toString().split('\n');
                for (let i in sensors) {
                    let line = sensors[i];
                    if(line.search(':') != -1)
                    {
                        let label = line.split(':')[0];
                        this._model.set (this._model.append(), [modelColumn.label, modelColumn.method], [label, 'sensor']);
                    }
                }
            }
        }
    },

    _getActiveSensorIter: function() {
        /* Get the first iter in the list */
        [success, iter] = this._model.get_iter_first();
        let sensorLabel = this._model.get_value(iter, 0);

        while (success)
        {
            /* Walk through the list, reading each row */
            let sensorLabel = this._model.get_value(iter, 0);
            if(sensorLabel == this._settings.get_string('sensor'))
               break;

            success = this._model.iter_next(iter);
        }
        return iter;
    },

    _onUpdateTimeChanged: function (update_time) {
        this._settings.set_int('update-time', update_time.get_value());
    },

    _onUnitChanged: function (unit) {
        if (unit.get_active()) {
            this._settings.set_string('unit', unit.label);
        }
    },

    _onSelectorChanged: function () {
        let [success, iter] = this._sensorSelector.get_active_iter();
        if (!success)
            return;

        let label = this._model.get_value(iter, modelColumn.label);
        let method = this._model.get_value(iter, modelColumn.method);

        this._settings.set_string('show-in-panel', method);
        this._settings.set_string('sensor', label);
    },

});

function buildPrefsWidget() {
    let widget = new SensorsPrefsWidget();
    widget.show_all();
    return widget;
}
