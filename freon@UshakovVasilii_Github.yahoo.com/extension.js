const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Utilities = Me.imports.utilities;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

let settings;

const FreonItem = new Lang.Class({
    Name: 'FreonItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(gIcon, label, value) {
        this.parent();
        this.connect('activate', function () {
            settings.set_string('main-sensor', label);
        });
        this._label = label;
        this._value = value;

        this.actor.add(new St.Icon({ style_class: 'system-status-icon', gicon : gIcon}));
        this.actor.add(new St.Label({text: label}));
        this.actor.add(new St.Label({text: value}), {align: St.Align.END});
    },

    getPanelString: function() {
        if(settings.get_boolean('show-label'))
            return '%s: %s'.format(this._label, this._value);
        else
            return this._value;
    },

    setMainSensor: function() {
        this.setOrnament(PopupMenu.Ornament.DOT);
    },

    getLabel: function() {
        return this._label;
    },
});

const FreonMenuButton = new Lang.Class({
    Name: 'FreonMenuButton',

    Extends: PanelMenu.Button,

    _init: function(){
        this.parent(null, 'sensorMenu');

        this._sensorsOutput = '';
        this._hddtempOutput = '';

        this._temperatureGIcon = Gio.icon_new_for_string(Me.path + '/icons/sensors-temperature-symbolic.svg');
        this._voltageGIcon = Gio.icon_new_for_string(Me.path + '/icons/sensors-voltage-symbolic.svg');
        this._fanGIcon = Gio.icon_new_for_string(Me.path + '/icons/sensors-fan-symbolic.svg');

        this.statusLabel = new St.Label({ text: '\u2026', y_expand: true, y_align: Clutter.ActorAlign.CENTER });

        this.menu.removeAll();
        this.actor.add_actor(this.statusLabel);

        this.sensorsArgv = Utilities.detectSensors();
        this.hddtempArgv = Utilities.detectHDDTemp();

        this.udisksProxies = [];
        Utilities.UDisks.get_drive_ata_proxies(Lang.bind(this, function(proxies) {
            this.udisksProxies = proxies;
            this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
        }));

        this._settingsChanged = settings.connect('changed', Lang.bind(this, this._querySensors));
        this.connect('destroy', Lang.bind(this, this._onDestroy));

        // don't postprone the first call by update-time.
        this._querySensors();

        this._eventLoop = Mainloop.timeout_add_seconds(settings.get_int('update-time'), Lang.bind(this, function (){
            this._querySensors();
            // readd to update queue
            return true;
        }));
    },

    _onDestroy: function(){
        for each (let proxy in this.udisksProxies){
            if(proxy.drive){
                proxy.drive.run_dispose();
            }
            if(proxy.ata){
                proxy.ata.run_dispose();
            }
        }
        
        Mainloop.source_remove(this._eventLoop);
        this.menu.removeAll();
        settings.disconnect(this._settingsChanged);
    },

    _querySensors: function(){
        if (this.sensorsArgv){
            this._sensorsFuture = new Utilities.Future(this.sensorsArgv, Lang.bind(this,function(stdout){
                this._sensorsOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
                this._sensorsFuture = undefined;
            }));
        }

        if (settings.get_boolean('show-hdd-temp') && this.hddtempArgv){
            this._hddtempFuture = new Utilities.Future(this.hddtempArgv, Lang.bind(this,function(stdout){
                this._hddtempOutput = stdout;
                this._updateDisplay(this._sensorsOutput, this._hddtempOutput);
                this._hddtempFuture = undefined;
            }));
        }
    },

    _updateDisplay: function(sensors_output, hddtemp_output){
        let display_fan_rpm = settings.get_boolean('show-fan-rpm');
        let display_voltage = settings.get_boolean('show-voltage');

        let tempInfo = Array();
        let fanInfo = Array();
        let voltageInfo = Array();

        tempInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseSensorsTemperatureLine);
        tempInfo = tempInfo.filter(Utilities.filterTemperature);
        if (display_fan_rpm){
            fanInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseFanRPMLine);
            fanInfo = fanInfo.filter(Utilities.filterFan);
        }
        if (display_voltage){
            voltageInfo = Utilities.parseSensorsOutput(sensors_output,Utilities.parseVoltageLine);
        }

        if(settings.get_boolean('show-hdd-temp') && this.hddtempArgv)
            tempInfo = tempInfo.concat(Utilities.parseHddTempOutput(hddtemp_output, !(/nc$/.exec(this.hddtempArgv[0])) ? ': ' : '|'));

        tempInfo = tempInfo.concat(Utilities.UDisks.create_list_from_proxies(this.udisksProxies));

        tempInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
        fanInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });
        voltageInfo.sort(function(a,b) { return a['label'].localeCompare(b['label']) });

        this.menu.removeAll();
        let section = new PopupMenu.PopupMenuSection("Temperature");
        if (this.sensorsArgv && tempInfo.length > 0){
            let sensorsList = new Array();
            let sum = 0; //sum
            let max = 0; //max temp
            for each (let temp in tempInfo){
                sum += temp['temp'];
                if (temp['temp'] > max)
                    max = temp['temp'];

                sensorsList.push(new FreonItem(this._temperatureGIcon, temp['label'], this._formatTemp(temp['temp'])));
            }
            if (tempInfo.length > 0){
                sensorsList.push(new PopupMenu.PopupSeparatorMenuItem());

                // Add average and maximum entries
                sensorsList.push(new FreonItem(this._temperatureGIcon, _("Average"), this._formatTemp(sum/tempInfo.length)));
                sensorsList.push(new FreonItem(this._temperatureGIcon, _("Maximum"), this._formatTemp(max)));

                if(fanInfo.length > 0 || voltageInfo.length > 0)
                    sensorsList.push(new PopupMenu.PopupSeparatorMenuItem());
            }

            for each (let fan in fanInfo){
                sensorsList.push(new FreonItem(this._fanGIcon, fan['label'], _("%drpm").format(fan['rpm'])));
            }
            if (fanInfo.length > 0 && voltageInfo.length > 0){
                sensorsList.push(new PopupMenu.PopupSeparatorMenuItem());
            }
            for each (let voltage in voltageInfo){
                sensorsList.push(new FreonItem(this._voltageGIcon, voltage['label'], _("%s%.2fV").format(((voltage['volt'] >= 0) ? '+' : '-'), voltage['volt'])));
            }

            this.statusLabel.set_text(_("N/A")); // Just in case

            for each (let item in sensorsList) {
                if(item instanceof FreonItem) {
                    if (settings.get_string('main-sensor') == item.getLabel()) {

                        // Configure as main sensor and set panel string
                        item.setMainSensor();
                        this.statusLabel.set_text(item.getPanelString());
                    }
                }
                section.addMenuItem(item);
            }

            // separator
            section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            let item = new PopupMenu.PopupBaseMenuItem();
            // HACK: span and expand parameters don't work as expected on Label, so add an invisible
            // Label to switch columns and not totally break the layout.
            item.actor.add(new St.Label({ text: '' }));
            item.actor.add(new St.Label({ text: _("Sensors Settings") }));

            item.connect('activate', function () {
                Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
            });

            section.addMenuItem(item);
        } else {
            this.statusLabel.set_text(_("Error"));

            let item = new PopupMenu.PopupMenuItem(
                (this.sensorsArgv
                    ? _("Please run sensors-detect as root.")
                    : _("Please install lm_sensors.")) + "\n" + _("If this doesn\'t help, click here to report with your sensors output!")
            );
            item.connect('activate',function() {
                Util.spawn(["xdg-open", "https://github.com/UshakovVasilii/gnome-shell-extension-freon/issues"]);
            });
            section.addMenuItem(item);
        }

        this.menu.addMenuItem(section);
    },

    _toFahrenheit: function(c){
        return ((9/5)*c+32);
    },

    _formatTemp: function(value) {
        if (settings.get_string('unit')=='fahrenheit'){
            value = this._toFahrenheit(value);
        }
        let format = '%.1f';
        if (!settings.get_boolean('show-decimal-value')){
            //ret = Math.round(value);
            format = '%d';
        }
        format += '%s';
        return format.format(value, (settings.get_string('unit')=='fahrenheit') ? "\u00b0F" : "\u00b0C");
    }
});

let freonMenu;

function init(extensionMeta) {
    Convenience.initTranslations();
    settings = Convenience.getSettings();
}

function enable() {
    freonMenu = new FreonMenuButton();
    Main.panel.addToStatusArea('freonMenu', freonMenu, 1, 'right');
}

function disable() {
    freonMenu.destroy();
    freonMenu = null;
}
