const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();

const Gettext = imports.gettext;
Gettext.bindtextdomain(Me.metadata['gettext-domain'], Me.path + '/locale');
const _ = Gettext.domain(Me.metadata['gettext-domain']).gettext;

const Settings = new Lang.Class({
    Name: 'Vitals.Settings',

    _init: function () {
        {
            let GioSSS = Gio.SettingsSchemaSource;
            let schema = GioSSS.new_from_directory(Me.path + '/schemas', GioSSS.get_default(), false);
            schema = schema.lookup('org.gnome.shell.extensions.vitals', false);
            this.settings = new Gio.Settings({ settings_schema: schema });
        }

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(Me.metadata['gettext-domain']);
        this.builder.add_from_file(Me.path + '/schemas/prefs.ui');

        this.widget = this.builder.get_object('prefs-container');

        this._bind_settings();
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function () {
        let widget;

        let sensors = [ 'show-temperature', 'show-voltage', 'show-fan',
                        'show-memory', 'show-processor', 'show-system',
                        'show-network', 'show-storage', 'use-higher-precision',
                        'alphabetize', 'hide-zeros', 'show-icon-on-panel' ];

        for (let sensor of Object.values(sensors)) {
            widget = this.builder.get_object(sensor);
            widget.set_active(this.settings.get_boolean(sensor));
            widget.connect('state-set', (_, val) => {
                this.settings.set_boolean(sensor, val);
            });
        }

        sensors = [ 'position-in-panel', 'unit' ];

        for (let sensor of Object.values(sensors)) {
            widget = this.builder.get_object(sensor);
            widget.set_active(this.settings.get_int(sensor));
            widget.connect('changed', (widget) => {
                this.settings.set_int(sensor, widget.get_active());
            });
        }

        widget = this.builder.get_object('update-time');
        widget.set_value(this.settings.get_int('update-time'));
        widget.connect('changed', (widget) => {
            this.settings.set_int('update-time', widget.get_value());
        });
    },
});

function init () {}

function buildPrefsWidget () {
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
