import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import {
    ExtensionPreferences,
    gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

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
    Name: "Vitals.Settings",

    _init: function (extensionObject, params) {
        this._extensionObject = extensionObject;
        this.parent(params);

        this._settings = extensionObject.getSettings();

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(
            this._extensionObject.metadata["gettext-domain"]
        );
        this.builder.add_from_file(this._extensionObject.path + "/prefs.ui");
        this.widget = this.builder.get_object("prefs-container");

        this._bind_settings();
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function () {
        const boolParams = [
            "show-system",
            "show-network",
            "alphabetize",
            "fixed-widths",
            "hide-icons",
            "hide-zeros",
            "include-public-ip",
            "include-static-gpu-info",
            "include-static-info",
            "menu-centered",
            "show-fan",
            "show-memory",
            "show-processor",
            "show-storage",
            "show-temperature",
            "show-voltage",
            "use-higher-precision",
            "show-battery",
            "show-gpu",
        ];
        for (const param in boolParams) {
            let paramName = boolParams[param];
            const widget = this.builder.get_object(paramName);
            if (!widget) {
                console.error("Widget not found: " + paramName);
            }
            this._settings.bind(
                paramName,
                widget,
                "active",
                Gio.SettingsBindFlags.DEFAULT
            );
        }

        const comboParams = [
            "icon-style",
            "position-in-panel",
            "unit",
            "network-speed-format",
            "storage-measurement",
            "memory-measurement",
            "battery-slot",
        ];
        for (const param in comboParams) {
            let paramName = comboParams[param];
            const widget = this.builder.get_object(paramName);
            this._settings.bind(
                paramName,
                widget,
                "selected",
                Gio.SettingsBindFlags.DEFAULT
            );
        }

        this._settings.bind(
            "update-time",
            this.builder.get_object("update-time"),
            "value",
            Gio.SettingsBindFlags.DEFAULT
        );

        // process individual text entry sensor preferences
        const entryRows = ["storage-path", "monitor-cmd"];
        for (let key in entryRows) {
            let paramName = entryRows[key];

            const widget = this.builder.get_object(paramName);

            this._settings.bind(
                paramName,
                widget,
                "text",
                Gio.SettingsBindFlags.DEFAULT
            );
        }

        // makes individual sensor preference boxes appear
        const sensors = [
            "temperature",
            "network",
            "storage",
            "memory",
            "battery",
            "system",
            "processor",
            "gpu",
        ];
        for (let key in sensors) {
            let sensor = sensors[key];

            // create dialog for intelligent autohide advanced settings
            this.builder
                .get_object(sensor + "-prefs")
                .connect("clicked", (sender, arg) => {
                    let transientObj = this.widget.get_root();
                    let title =
                        sensor.charAt(0).toUpperCase() + sensor.slice(1);
                    let dialog = new Adw.Dialog({
                        title: _(title) + " " + _("Preferences"),
                    });
                    try {
                        let box = this.builder.get_object(sensor + "_prefs");
                        const view = new Adw.ToolbarView({});
                        view.add_top_bar(new Adw.HeaderBar({}));

                        const clamp = new Adw.Clamp({});
                        clamp.set_child(box);
                        view.set_content(clamp);
                        dialog.set_child(view);

                        dialog.present(sender);
                    } catch (e) {
                        const alert = new Adw.AlertDialog({
                            heading: "Error",
                            body: e.message,
                        });
                        alert.add_response("ok", "OK");
                        alert.present(sender);
                    }
                });
        }
    },
});

export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        let settings = new Settings(this);
        let widget = settings.widget;

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({});
        group.add(widget);
        page.add(group);
        window.add(page);
        window.set_default_size(800, 600);
        widget.show();
    }
}
