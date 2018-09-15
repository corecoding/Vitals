const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.helpers.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
Me.imports.helpers.otherPolyfills;

const Settings = new Lang.Class({
    Name: 'Vitals.Settings',

    _init: function() {
        this._settings = Convenience.getSettings();

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(Me.metadata['gettext-domain']);
        this.builder.add_from_file(Me.path + '/schemas/prefs.ui');

        this.widget = this.builder.get_object('prefs-container');

        this._bind_settings();
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function() {
        let widget;

        let sensors = [ 'show-temperature', 'show-voltage', 'show-fan',
                        'show-memory', 'show-processor', 'show-system',
                        'show-network', 'show-storage', 'use-higher-precision',
                        'alphabetize', 'hide-zeros',
                        'include-public-ip' ];

        for (let sensor of Object.values(sensors)) {
            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this._settings.set_boolean(sensor, val);
            });
        }

        sensors = [ 'position-in-panel', 'unit' ];

        for (let sensor of Object.values(sensors)) {
            widget = this.builder.get_object(sensor);
            widget.set_active(this._settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this._settings.set_int(sensor, widget.get_active());
            });
        }

        this._settings.bind(
            'update-time',
            this.builder.get_object('update-time'),
            'value',
            Gio.SettingsBindFlags.DEFAULT);
    }
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let settings = new Settings();
    let widget = settings.widget;

    Mainloop.timeout_add(0, () => {
        let header_bar = widget.get_toplevel().get_titlebar();
        header_bar.custom_title = settings.switcher;
        return false;
    });

    widget.show_all();
    return widget;
}
