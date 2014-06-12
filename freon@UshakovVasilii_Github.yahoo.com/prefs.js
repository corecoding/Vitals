const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Utilities = Me.imports.utilities;
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

        this.attach(new Gtk.Label({ label: _('Poll sensors every (sec)'), halign : Gtk.Align.END}), 0, i, 1, 1);
        let updateTime = Gtk.SpinButton.new_with_range (1, 60, 1);
        this.attach(updateTime, 1, i++, 1, 1);
        this._settings.bind('update-time', updateTime, 'value', Gio.SettingsBindFlags.DEFAULT);

        this.attach(new Gtk.Label({ label: _("Temperature unit"), halign : Gtk.Align.END}), 0, i, 1, 1);
        let centigradeRadio = new Gtk.RadioButton({ group: null, label: _("Centigrade"), valign: Gtk.Align.START });
        let fahrenheitRadio = new Gtk.RadioButton({ group: centigradeRadio, label: _("Fahrenheit"), valign: Gtk.Align.START });
        fahrenheitRadio.connect('toggled', Lang.bind(this, this._onUnitChanged));
        centigradeRadio.connect('toggled', Lang.bind(this, this._onUnitChanged));
        if (this._settings.get_string('unit')=='Centigrade')
            centigradeRadio.active = true;
        else
            fahrenheitRadio.active = true;
        this.attach(centigradeRadio, 1, i, 1, 1);
        this.attach(fahrenheitRadio, 2, i++, 1, 1);

        // Switches
        this._addSwitch({key : 'display-degree-sign', y : i, x : 0,
            label : _('Display temperature unit'),
            help : _("Show temperature unit in panel and menu")});
        this._addSwitch({key : 'display-decimal-value', y : i++, x : 2,
            label : _('Display decimal value'),
            help : _("Show one digit after decimal")});
        this._addSwitch({key : 'display-hdd-temp', y : i, x : 0,
            label : _('Display drive temperature')});
        this._addSwitch({key : 'display-fan-rpm', y : i++, x : 2,
            label : _('Display fan speed')});
        this._addSwitch({key : 'display-voltage', y : i++, x : 0,
            label : _('Display power supply voltage')});

        //List of items of the ComboBox
        this._model =  new Gtk.ListStore();
        this._model.set_column_types([GObject.TYPE_STRING, GObject.TYPE_BOOLEAN]);
        this._appendItem(_("Average"));
        this._appendItem(_("Maximum"));
        this._appendSeparator();

        //Get current options
        this._display_fan_rpm = this._settings.get_boolean('display-fan-rpm');
        this._display_voltage = this._settings.get_boolean('display-voltage');
        this._display_hdd_temp = this._settings.get_boolean('display-hdd-temp');

        //Fill the list
        this._getSensorsLabels();
        this._getUdisksLabels();

        if(this._display_hdd_temp) {
            this._appendSeparator();
            this._getHddTempLabels();
        }

        // ComboBox to select which sensor to show in panel
        this._sensorSelector = new Gtk.ComboBox({ model: this._model });
        this._sensorSelector.set_active_iter(this._getActiveSensorIter());
        this._sensorSelector.set_row_separator_func(Lang.bind(this, this._comboBoxSeparator), null, null);

        let renderer = new Gtk.CellRendererText();
        this._sensorSelector.pack_start(renderer, true);
        this._sensorSelector.add_attribute(renderer, 'text', modelColumn.label);
        this._sensorSelector.connect('changed', Lang.bind(this, this._onSelectorChanged));

        this.attach(new Gtk.Label({ label: _("Sensor in panel"), halign : Gtk.Align.END}), 0, ++i, 1, 1);
        this.attach(this._sensorSelector, 1, i , 1, 1);

        let settings = this._settings;
        let checkButton = new Gtk.CheckButton({label: _("Display sensor label")});
        checkButton.set_active(settings.get_boolean('display-label'));
        checkButton.connect('toggled', function () {
            settings.set_boolean('display-label', checkButton.get_active());
        });
        this.attach(checkButton, 2, i , 1, 1);
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

    _comboBoxSeparator: function(model, iter, data) {
        return model.get_value(iter, modelColumn.separator);
    },

    _appendItem: function(label) {
        this._model.set(this._model.append(), [modelColumn.label], [label]);
    },

    _appendMultipleItems: function(sensorInfo) {
        for each (let sensor in sensorInfo) {
            this._model.set(this._model.append(), [modelColumn.label], [sensor['label']]);
        }
    },

    _appendSeparator: function() {
        this._model.set (this._model.append(), [modelColumn.separator], [true]);
    },

    _getSensorsLabels: function() {
        let sensors_cmd = Utilities.detectSensors();
        if(sensors_cmd) {
            let sensors_output = GLib.spawn_command_line_sync(sensors_cmd.join(' '));
            if(sensors_output[0])
            {
                let output = sensors_output[1].toString();
                let tempInfo = Utilities.parseSensorsOutput(output,Utilities.parseSensorsTemperatureLine);
                tempInfo = tempInfo.filter(Utilities.filterTemperature);
                this._appendMultipleItems(tempInfo);

                if (this._display_fan_rpm){
                    let fanInfo = Utilities.parseSensorsOutput(output,Utilities.parseFanRPMLine);
                    fanInfo = fanInfo.filter(Utilities.filterFan);
                    this._appendMultipleItems(fanInfo);
                }
                if (this._display_voltage){
                    let voltageInfo = Utilities.parseSensorsOutput(output,Utilities.parseVoltageLine);
                    this._appendMultipleItems(voltageInfo);
                }
            }
        }
    },

    _getHddTempLabels: function() {
        let hddtemp_cmd = Utilities.detectHDDTemp();
        if(hddtemp_cmd){
            let hddtemp_output = GLib.spawn_command_line_sync(hddtemp_cmd.join(' '))
            if(hddtemp_output[0]){
                let hddTempInfo = Utilities.parseHddTempOutput(hddtemp_output[1].toString(),
                                        !(/nc$/.exec(hddtemp_cmd[0])) ? ': ' : '|');
                this._appendMultipleItems(hddTempInfo);
            }
        }
    },

    _getUdisksLabels: function() {
        Utilities.UDisks.get_drive_ata_proxies((function(proxies) {
            let list = Utilities.UDisks.create_list_from_proxies(proxies);

            this._appendMultipleItems(list);
        }).bind(this));
    },

    _getActiveSensorIter: function() {
        /* Get the first iter in the list */
        [success, iter] = this._model.get_iter_first();
        let sensorLabel = this._model.get_value(iter, 0);

        while (success) {
            /* Walk through the list, reading each row */
            let sensorLabel = this._model.get_value(iter, 0);
            if(sensorLabel == this._settings.get_string('main-sensor'))
               break;

            success = this._model.iter_next(iter);
        }
        return iter;
    },

    _onUnitChanged: function (unit) {
        if (unit.get_active()) {
            this._settings.set_string('unit', unit.label);
        }
    },

    _onSelectorChanged: function (comboBox) {
        let [success, iter] = comboBox.get_active_iter();
        if (!success)
            return;

        let label = this._model.get_value(iter, modelColumn.label);
        this._settings.set_string('main-sensor', label);
    },

});

function buildPrefsWidget() {
    let w = new FreonPrefsWidget();
    w.show_all();
    return w;
}
