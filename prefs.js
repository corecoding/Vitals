// https://gjs.guide/extensions/upgrading/gnome-shell-40.html#contents
const Config = imports.misc.config;
const [major] = Config.PACKAGE_VERSION.split('.');
const shellVersion = Number.parseInt(major);

const {Gio, Gtk, GObject} = imports.gi;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();
Me.imports.helpers.polyfills;
const ExtensionUtils = imports.misc.extensionUtils;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
const FileModule = Me.imports.helpers.file;

/*
        if (sensor == 'show-storage' && this._settings.get_boolean(sensor)) {

            let val = true;

            try {
                let GTop = imports.gi.GTop;
            } catch (e) {
                val = false;
            }

            let now = new Date().getTime();
            this._notify("Vitals", "Please run sudo apt install gir1.2-gtop-2.0", 'folder-symbolic');

        }
*/

const Settings = new GObject.Class({
    Name: 'Vitals.Settings',

    _init: function(params) {
        this.parent(params);

        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.vitals');

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(Me.metadata['gettext-domain']);

        if (shellVersion < 40)
            this.builder.add_from_file(Me.path + '/prefs.legacy.ui');
        else
            this.builder.add_from_file(Me.path + '/prefs.ui');

        this.widget = this.builder.get_object('prefs-container');

        this._bind_settings();

        // let contents = FileModule.getcontents('/proc/mounts');
        // let lines = contents.split("\n");

        // for (let line of Object.values(lines)) {
        //     if (line[0] != '/') continue;
        //     if (line.indexOf('/snap/') != -1) continue;
        //     global.log('*** ' + line);
        // }
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function() {
        let widget;

        // process sensor toggles
        let sensors = [ 'show-temperature', 'show-voltage', 'show-fan',
                        'show-memory', 'show-processor', 'show-system',
                        'show-network', 'show-storage', 'use-higher-precision',
                        'alphabetize', 'hide-zeros', 'include-public-ip',
                        'show-battery', 'fixed-widths', 'hide-icons' ];

        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this._settings.set_boolean(sensor, val);
            });
        }

        // process individual drop down sensor preferences
        sensors = [ 'position-in-panel', 'unit', 'network-speed-format', 'memory-measurement', 'storage-measurement', 'battery-slot' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this._settings.set_int(sensor, widget.get_active());
            });
        }

        this._settings.bind('update-time', this.builder.get_object('update-time'), 'value', Gio.SettingsBindFlags.DEFAULT);

        // process individual text entry sensor preferences
        sensors = [ 'storage-path' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            widget = this.builder.get_object(sensor);
            widget.set_text(this._settings.get_string(sensor));

            widget.connect('changed', (widget) => {
                let text = widget.get_text();
                if (!text) text = widget.get_placeholder_text();
                this._settings.set_string(sensor, text);
            });
        }

        // makes individual sensor preference boxes appear
        sensors = [ 'temperature', 'network', 'storage', 'memory', 'battery' ];
        for (let key in sensors) {
            let sensor = sensors[key];

            // create dialog for intelligent autohide advanced settings
            this.builder.get_object(sensor + '-prefs').connect('clicked', () => {

                let transientObj;
                if (shellVersion < 40)
                    transientObj = this.widget.get_toplevel();
                else
                    transientObj = this.widget.get_root();

                let title = sensor.charAt(0).toUpperCase() + sensor.slice(1);
                let dialog = new Gtk.Dialog({ title: _(title + ' Preferences'),
                                              transient_for: transientObj,
                                              use_header_bar: false,
                                              modal: true });

                let box = this.builder.get_object(sensor + '_prefs');

                if (shellVersion < 40)
                    dialog.get_content_area().add(box);
                else
                    dialog.get_content_area().append(box);

                dialog.connect('response', (dialog, id) => {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                    return;
                });

                dialog.show();
            });
        }
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    let settings = new Settings();
    let widget = settings.widget;

    widget.show();
    return widget;
}
