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

        this.attach(new Gtk.Label({ label: 'Show in panel' }), 0, counter+1, 1, 1);
        let averageRadio = new Gtk.RadioButton({ group: null, label: "Average", valign: Gtk.Align.START });
        let maximumRadio = new Gtk.RadioButton({ group: averageRadio, label: "Maximum", valign: Gtk.Align.START });
        let sensorRadio = new Gtk.RadioButton({ group: averageRadio, label: "Sensor", valign: Gtk.Align.START });
        averageRadio.connect('toggled', Lang.bind(this, this._onMethodChanged));
        maximumRadio.connect('toggled', Lang.bind(this, this._onMethodChanged));
        sensorRadio.connect('toggled', Lang.bind(this, this._onMethodChanged));
        switch(this._settings.get_string('show-in-panel'))
        {
            case 'Maximum':
                maximumRadio.active = true;
                break;
            case 'Sensor':
                sensorRadio.active = true;
                break;
            case 'Average':
            default:    //average temp is default
                averageRadio.active = true;
                break;
        }

        this.attach(averageRadio, 1, counter + 1, 1, 1);
        this.attach(maximumRadio, 2, counter + 1, 1, 1);
        this.attach(sensorRadio, 3, ++counter, 1, 1);

        // ComboBox to select which sensor to show in panel

        this._getSensorsLabels();
        this._sensorSelector = new Gtk.ComboBox({ model: this._listStore });
        this._sensorSelector.set_active_iter(this._getActiveSensorIter());

        let renderer = new Gtk.CellRendererText();
        this._sensorSelector.pack_start(renderer, true);
        this._sensorSelector.add_attribute(renderer, 'text', 0);
        this._sensorSelector.connect('changed', Lang.bind(this, this._onSelectorChanged));

        this.attach(new Gtk.Label({ label: 'Sensor to show' }), 0, ++counter, 1, 1);
        this.attach(this._sensorSelector, 1, counter , 1, 1);

        if(!sensorRadio.active)
            this._sensorSelector.set_sensitive(false);
    },

    _getSensorsLabels: function() {
        this._listStore =  new Gtk.ListStore();
        this._listStore.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING]);
        this.sensorsPath = GLib.find_program_in_path('sensors');
        if (this.sensorsPath) {
            let sensors_output = GLib.spawn_command_line_sync(this.sensorsPath + ' -A');
            if(sensors_output[0]) {
                sensors = sensors_output[1].toString().split('\n').sort();
                for (let i in sensors) {
                    line = sensors[i];
                    if(line.search(':') != -1)
                    {
                        let label = line.split(':')[0];
                        let iter = this._listStore.append();
                        this._listStore.set (iter, [0, 1], [label, i]);
                    }
                }
            }
        }
    },

    _getActiveSensorIter: function() {
        /* Get the first iter in the list */
        [success, iter] = this._listStore.get_iter_first();
        let sensorLabel = this._listStore.get_value(iter, 0);

        while (success)
        {
            /* Walk through the list, reading each row */
            let sensorLabel = this._listStore.get_value(iter, 0);
            if(sensorLabel == this._settings.get_string('sensor'))
            break;

            success = this._listStore.iter_next(iter);
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

    _onMethodChanged: function (method) {
        if (method.get_active()){
            this._settings.set_string('show-in-panel', method.label);
        }

        if(method.label == 'Sensor')
        {
            this._sensorSelector.set_sensitive(true);
            let [success, iter] = this._sensorSelector.get_active_iter();
            if (!success)
                return;

            let sensorLabel = this._listStore.get_value(iter, 0);
            this._settings.set_string('sensor', sensorLabel);
        }
        else
            this._sensorSelector.set_sensitive(false);
    },

    _onSelectorChanged: function () {
        let [success, iter] = this._sensorSelector.get_active_iter();
        if (!success)
            return;

        let sensorLabel = this._listStore.get_value(iter, 0);
        this._settings.set_string('sensor', sensorLabel);
    },

});

function buildPrefsWidget() {
    let widget = new CPUTemperaturePrefsWidget();
    widget.show_all();
    return widget;
}
