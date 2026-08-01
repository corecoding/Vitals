import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PAGE_IDS = [
    'general-page',
    'temperature-page',
    'voltage-page',
    'fan-page',
    'memory-page',
    'processor-page',
    'system-page',
    'network-page',
    'storage-page',
    'battery-page',
    'gpu-page',
];

const ICON_STYLE_DIRS = ['original', 'gnome'];

const VitalsPrefsWidget = GObject.registerClass(
class VitalsPrefsWidget extends GObject.Object {
    _init({settings, path, metadata}) {
        super._init();

        this._settings = settings;
        this._path = path;
        this._metadata = metadata;
        this._iconSearchPaths = [];

        this._provider = new Gtk.CssProvider();
        this._provider.load_from_path(`${this._path}/prefs.css`);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            this._provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        this.builder = new Gtk.Builder();
        this.builder.set_translation_domain(this._metadata['gettext-domain']);
        this.builder.add_from_file(`${this._path}/prefs.ui`);
    }

    _obj(id) {
        return this.builder.get_object(id);
    }

    _registerIconPaths() {
        const display = Gdk.Display.get_default();
        if (!display)
            return;

        const iconTheme = Gtk.IconTheme.get_for_display(display);
        const preferred = ICON_STYLE_DIRS[this._settings.get_int('icon-style')] ?? 'original';
        const orderedDirs = [preferred, ...ICON_STYLE_DIRS.filter(dir => dir !== preferred)];

        for (const dir of orderedDirs) {
            const iconPath = GLib.build_filenamev([this._path, 'icons', dir]);
            if (!GLib.file_test(iconPath, GLib.FileTest.IS_DIR))
                continue;

            if (!this._iconSearchPaths.includes(iconPath)) {
                iconTheme.add_search_path(iconPath);
                this._iconSearchPaths.push(iconPath);
            }
        }
    }

    _bindSwitch(settingsKey) {
        this._settings.bind(
            settingsKey,
            this._obj(settingsKey),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
    }

    _bindSpin(settingsKey) {
        this._settings.bind(
            settingsKey,
            this._obj(settingsKey),
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
    }

    _bindCombo(settingsKey) {
        const widget = this._obj(settingsKey);
        widget.set_active(this._settings.get_int(settingsKey));
        widget.connect('changed', () => {
            this._settings.set_int(settingsKey, widget.get_active());
        });
    }

    _bindEntry(settingsKey, placeholder = null) {
        const widget = this._obj(settingsKey);
        widget.set_text(this._settings.get_string(settingsKey));
        widget.connect('changed', () => {
            let text = widget.get_text();
            if (!text && placeholder)
                text = placeholder;
            this._settings.set_string(settingsKey, text);
        });
    }

    _setWidgetsSensitive(widgets, sensitive) {
        for (const widget of widgets)
            widget.sensitive = sensitive;
    }

    _bindEnabled(toggle, widgets) {
        const update = () => this._setWidgetsSensitive(widgets, toggle.active);
        toggle.connect('notify::active', update);
        update();
    }

    _bindSettings() {
        const switches = [
            'menu-centered',
            'use-higher-precision',
            'alphabetize',
            'hide-zeros',
            'fixed-widths',
            'hide-icons',
            'show-temperature',
            'show-voltage',
            'show-fan',
            'show-memory',
            'show-processor',
            'include-static-info',
            'show-system',
            'show-network',
            'include-public-ip',
            'network-public-ip-show-flag',
            'show-storage',
            'show-battery',
            'show-gpu',
            'include-static-gpu-info',
        ];
        for (const key of switches)
            this._bindSwitch(key);

        this._bindSpin('update-time');
        this._bindSpin('network-public-ip-interval');

        const combos = [
            'position-in-panel',
            'icon-style',
            'unit',
            'memory-measurement',
            'network-public-ip-provider',
            'network-speed-format',
            'network-speed-unit',
            'storage-measurement',
            'battery-slot',
        ];
        for (const key of combos)
            this._bindCombo(key);

        this._bindEntry('monitor-cmd', 'gnome-system-monitor');
        this._bindEntry('storage-path', '/');

        this._bindEnabled(this._obj('show-temperature'), [this._obj('unit')]);
        this._bindEnabled(this._obj('show-memory'), [this._obj('memory-measurement')]);
        this._bindEnabled(this._obj('show-processor'), [this._obj('include-static-info')]);
        this._bindEnabled(this._obj('show-system'), [this._obj('monitor-cmd')]);
        this._bindEnabled(this._obj('show-storage'), [
            this._obj('storage-path'),
            this._obj('storage-measurement'),
        ]);
        this._bindEnabled(this._obj('show-battery'), [this._obj('battery-slot')]);
        this._bindEnabled(this._obj('show-gpu'), [this._obj('include-static-gpu-info')]);

        const showNetwork = this._obj('show-network');
        const publicIpProvider = this._obj('network-public-ip-provider');
        const showFlag = this._obj('network-public-ip-show-flag');
        const networkDetailWidgets = [
            this._obj('include-public-ip'),
            this._obj('network-public-ip-interval'),
            publicIpProvider,
            this._obj('network-speed-format'),
            this._obj('network-speed-unit'),
        ];
        const updateNetworkSensitivity = () => {
            const enabled = showNetwork.active;
            this._setWidgetsSensitive(networkDetailWidgets, enabled);
            showFlag.sensitive = enabled && publicIpProvider.get_active() !== 2;
        };
        showNetwork.connect('notify::active', updateNetworkSensitivity);
        publicIpProvider.connect('changed', updateNetworkSensitivity);
        updateNetworkSensitivity();

        this._obj('github-row').connect('activated', () => {
            this._openUri('https://github.com/corecoding/Vitals/issues');
        });
        this._obj('donate-row').connect('activated', () => {
            this._openUri('https://corecoding.com/donate.php');
        });
    }

    _openUri(uri) {
        if (typeof Gtk.UriLauncher === 'function') {
            const launcher = new Gtk.UriLauncher({uri});
            launcher.launch(null, null, null);
            return;
        }

        Gtk.show_uri(null, uri, Gdk.CURRENT_TIME);
    }

    _cleanupCssProvider() {
        if (!this._provider)
            return;

        const display = Gdk.Display.get_default();
        if (display)
            Gtk.StyleContext.remove_provider_for_display(display, this._provider);

        this._provider = null;
    }

    _relaxPreferencesWindowClamps(window) {
        const stack = [window];

        while (stack.length > 0) {
            const widget = stack.pop();
            if (!widget)
                continue;

            if (widget instanceof Adw.Clamp) {
                widget.hexpand = true;
                widget.halign = Gtk.Align.FILL;

                if (typeof widget.set_maximum_size === 'function')
                    widget.set_maximum_size(2400);
                else if ('maximum_size' in widget)
                    widget.maximum_size = 2400;

                if (typeof widget.set_tightening_threshold === 'function')
                    widget.set_tightening_threshold(800);
                else if ('tightening_threshold' in widget)
                    widget.tightening_threshold = 800;
            }

            let child = widget.get_first_child?.() ?? null;
            while (child) {
                stack.push(child);
                child = child.get_next_sibling?.() ?? null;
            }
        }
    }

    fillPreferencesWindow(window) {
        window.add_css_class('vitals-preferences');

        if (window.set_title)
            window.set_title(this._metadata?.name ?? _('Vitals'));

        if (window.set_search_enabled)
            window.set_search_enabled(true);

        this._registerIconPaths();
        this._bindSettings();

        for (const pageId of PAGE_IDS)
            window.add(this._obj(pageId));

        window.connect('close-request', () => {
            this._cleanupCssProvider();
            return false;
        });

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._relaxPreferencesWindowClamps(window);
            return GLib.SOURCE_REMOVE;
        });
    }
});

export default class VitalsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const widget = new VitalsPrefsWidget({
            settings: this.getSettings(),
            path: this.path,
            metadata: this.metadata,
        });
        widget.fillPreferencesWindow(window);
    }
}
