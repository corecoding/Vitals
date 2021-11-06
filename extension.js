const {Clutter, Gio, St, GObject} = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
Me.imports.helpers.polyfills;
const Sensors = Me.imports.sensors;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
const MessageTray = imports.ui.messageTray;
const Values = Me.imports.values;
const Config = imports.misc.config;
const MenuItem = Me.imports.menuItem;

let vitalsMenu;

var VitalsMenuButton = GObject.registerClass({
       GTypeName: 'VitalsMenuButton',
}, class VitalsMenuButton extends PanelMenu.Button {
    _init() {
        super._init(St.Align.START);

        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.vitals');

        this._sensorIcons = {
            'temperature' : { 'icon': 'temperature-symbolic.svg',
                       'alphabetize': true },
                'voltage' : { 'icon': 'voltage-symbolic.svg',
                       'alphabetize': true },
                    'fan' : { 'icon': 'fan-symbolic.svg',
                       'alphabetize': true },
                 'memory' : { 'icon': 'memory-symbolic.svg',
                       'alphabetize': true },
              'processor' : { 'icon': 'cpu-symbolic.svg',
                       'alphabetize': true },
                 'system' : { 'icon': 'system-symbolic.svg',
                       'alphabetize': true },
                'network' : { 'icon': 'network-symbolic.svg',
                       'alphabetize': true,
                     'icon-download': 'network-download-symbolic.svg',
                       'icon-upload': 'network-upload-symbolic.svg' },
                'storage' : { 'icon': 'storage-symbolic.svg',
                       'alphabetize': true },
                'battery' : { 'icon': 'battery-symbolic.svg',
                       'alphabetize': true }
        }

        this._warnings = [];
        this._sensorMenuItems = {};
        this._hotLabels = {};
        this._hotIcons = {};
        this._groups = {};
        this._widths = {};

        this._sensors = new Sensors.Sensors(this._settings, this._sensorIcons);
        this._values = new Values.Values(this._settings, this._sensorIcons);
        this._menuLayout = new St.BoxLayout({
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true,
            pack_start: false
        });

        this._drawMenu();
        this.add_actor(this._menuLayout);
        this._settingChangedSignals = [];
        this._refreshTimeoutId = null;

        this._addSettingChangedSignal('update-time', this._updateTimeChanged.bind(this));
        this._addSettingChangedSignal('position-in-panel', this._positionInPanelChanged.bind(this));
        this._addSettingChangedSignal('use-higher-precision', this._higherPrecisionChanged.bind(this));

        let settings = [ 'alphabetize', 'include-public-ip', 'hide-zeros', 'unit', 'network-speed-format', 'memory-measurement', 'storage-measurement', 'fixed-widths', 'hide-icons' ];
        for (let setting of Object.values(settings))
            this._addSettingChangedSignal(setting, this._redrawMenu.bind(this));

        // add signals for show- preference based categories
        for (let sensor in this._sensorIcons)
            this._addSettingChangedSignal('show-' + sensor, this._showHideSensorsChanged.bind(this));

        this._initializeMenu();
        this._initializeTimer();
    }

    _initializeMenu() {
        // display sensor categories
        for (let sensor in this._sensorIcons) {
            // groups associated sensors under accordion menu
            if (typeof this._groups[sensor] != 'undefined') continue;

            this._groups[sensor] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(sensor)), true);
            this._groups[sensor].icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[sensor]['icon']);

            // hide menu items that user has requested to not include
            if (!this._settings.get_boolean('show-' + sensor))
                this._groups[sensor].actor.hide(); // 3.34?

            if (!this._groups[sensor].status) {
                this._groups[sensor].status = this._defaultLabel();
                this._groups[sensor].actor.insert_child_at_index(this._groups[sensor].status, 4); // 3.34?
                this._groups[sensor].status.text = 'No Data';
            }

            this.menu.addMenuItem(this._groups[sensor]);
        }

        // add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'vitals-menu-button-container'
        });

        let customButtonBox = new St.BoxLayout({
            style_class: 'vitals-button-box',
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true,
            pack_start: false
        });

        // custom round refresh button
        let refreshButton = this._createRoundButton('view-refresh-symbolic', _('Refresh'));
        refreshButton.connect('clicked', (self) => {
            this._sensors.resetHistory();
            this._values.resetHistory();
            this._updateTimeChanged();
        });
        customButtonBox.add_actor(refreshButton);

        // custom round monitor button
        let monitorButton = this._createRoundButton('utilities-system-monitor-symbolic', _('System Monitor'));
        monitorButton.connect('clicked', (self) => {
            this.menu._getTopMenu().close();
            Util.spawn(['gnome-system-monitor']);
        });
        customButtonBox.add_actor(monitorButton);

        // custom round preferences button
        let prefsButton = this._createRoundButton('preferences-system-symbolic', _('Preferences'));
        prefsButton.connect('clicked', (self) => {
            this.menu._getTopMenu().close();

            // Gnome 3.36 has a fancier way of opening preferences
            if (typeof ExtensionUtils.openPrefs === 'function') {
                ExtensionUtils.openPrefs();
            } else {
                Util.spawn(['gnome-shell-extension-prefs', Me.metadata.uuid]);
            }
        });
        customButtonBox.add_actor(prefsButton);

        // now add the buttons to the top bar
        item.actor.add_actor(customButtonBox);

        // add buttons
        this.menu.addMenuItem(item);
    }

    _createRoundButton(iconName) {
        let button = new St.Button({
            style_class: 'message-list-clear-button button vitals-button-action'
        });

        button.child = new St.Icon({
            icon_name: iconName
        });

        return button;
    }

    _removeMissingHotSensors(hotSensors) {
        for (let i = hotSensors.length - 1; i >= 0; i--) {
            let sensor = hotSensors[i];

            // make sure default icon (if any) stays visible
            if (sensor == '_default_icon_') continue;

            if (!this._sensorMenuItems[sensor]) {
                hotSensors.splice(i, 1);
                this._removeHotLabel(sensor);
                this._removeHotIcon(sensor);
            }
        }

        return hotSensors;
    }

    _saveHotSensors(hotSensors) {
        this._settings.set_strv('hot-sensors', hotSensors.filter(
            function(item, pos) {
                return hotSensors.indexOf(item) == pos;
            }
        ));
    }

    _initializeTimer() {
        // start off with fresh sensors
        this._querySensors();

        // used to query sensors and update display
        let update_time = this._settings.get_int('update-time');
        this._sensors.update_time = update_time;
        this._refreshTimeoutId = Mainloop.timeout_add_seconds(update_time, (self) => {
            this._querySensors();

            // keep the timer running
            return true;
        });
    }

    _createHotItem(key, value) {
        let icon = this._defaultIcon(key);
        this._hotIcons[key] = icon;
        this._menuLayout.add_actor(icon)

        // don't add a label when no sensors are in the panel
        if (key == '_default_icon_') return;

        let label = new St.Label({
            style_class: 'vitals-panel-label',
            text: (value)?value:'\u2026', // ...
            y_expand: true,
            y_align: Clutter.ActorAlign.START
        });

        // attempt to prevent ellipsizes
        label.get_clutter_text().ellipsize = 0;

        this._hotLabels[key] = label;
        this._menuLayout.add_actor(label);
    }

    _higherPrecisionChanged() {
        this._sensors.resetHistory();
        this._values.resetHistory();
        this._querySensors();
    }

    _showHideSensorsChanged(self, sensor) {
        this._groups[sensor.substr(5)].visible = this._settings.get_boolean(sensor);
    }

    _positionInPanelChanged() {
        this.container.get_parent().remove_actor(this.container);

        // small HACK with private boxes
        let boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox
        };

        let p = this.positionInPanel;
        boxes[p].insert_child_at_index(this.container, p == 'right' ? 0 : -1)
    }

    _removeHotLabel(key) {
        if (typeof this._hotLabels[key] != 'undefined') {
            let label = this._hotLabels[key];
            delete this._hotLabels[key];
            // make sure set_label is not called on non existant actor
            label.destroy();
        }
    }

    _removeHotLabels() {
        for (let key in this._hotLabels)
            this._removeHotLabel(key);
    }

    _removeHotIcon(key) {
        if (typeof this._hotIcons[key] != 'undefined') {
            this._hotIcons[key].destroy();
            delete this._hotIcons[key];
        }
    }

    _removeHotIcons() {
        for (let key in this._hotIcons)
            this._removeHotIcon(key);
    }

    _redrawMenu() {
        this._removeHotIcons();
        this._removeHotLabels();

        for (let key in this._sensorMenuItems) {
            if (key.includes('-group')) continue;
            this._sensorMenuItems[key].destroy();
            delete this._sensorMenuItems[key];
        }

        this._drawMenu();
        this._sensors.resetHistory();
        this._values.resetHistory();
        this._querySensors();
    }

    _drawMenu() {
        // grab list of selected menubar icons
        let hotSensors = this._settings.get_strv('hot-sensors');
        for (let key of Object.values(hotSensors))
            this._createHotItem(key);
    }

    _destroyTimer() {
        // invalidate and reinitialize timer
        if (this._refreshTimeoutId != null) {
            Mainloop.source_remove(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }
    }

    _updateTimeChanged() {
        this._destroyTimer();
        this._initializeTimer();
    }

    _addSettingChangedSignal(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    }

    _updateDisplay(label, value, type, key) {
        // update sensor value in menubar
        if (this._hotLabels[key]) {
            this._hotLabels[key].set_text(value);

            // support for fixed widths #55
            if (this._settings.get_boolean('fixed-widths')) {
                if (typeof this._widths[key] == 'undefined')
                    this._widths[key] = this._hotLabels[key].width;

                let width2 = this._hotLabels[key].get_clutter_text().width;
                if (width2 > this._widths[key]) {
                    this._hotLabels[key].set_width(width2);
                    this._widths[key] = width2;
                }
            }
        }

        // have we added this sensor before?
        let item = this._sensorMenuItems[key];
        if (item) {
            // update sensor value in the group
            item.value = value;
        } else if (type.includes('-group')) {
            // update text next to group header
            let group = type.split('-')[0];
            if (this._groups[group]) {
                this._groups[group].status.text = value;
                this._sensorMenuItems[type] = this._groups[group];
            }
        } else {
            let sensor = { 'label': label, 'value': value, 'type': type }
            this._appendMenuItem(sensor, key);
        }
    }

    _appendMenuItem(sensor, key) {
        let split = sensor.type.split('-');
        let type = split[0];
        let icon = (typeof split[1] != 'undefined')?'icon-' + split[1]:'icon';
        let gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[type][icon]);

        let item = new MenuItem.MenuItem(gicon, key, sensor.label, sensor.value, this._hotLabels[key]);
        item.connect('toggle', (self) => {
            let hotSensors = this._settings.get_strv('hot-sensors');

            if (self.checked) {
                // add selected sensor to panel
                hotSensors.push(self.key);
                this._createHotItem(self.key, self.value);
            } else {
                // remove selected sensor from panel
                hotSensors.splice(hotSensors.indexOf(self.key), 1);
                this._removeHotLabel(self.key);
                this._removeHotIcon(self.key);
            }

            if (hotSensors.length <= 0) {
                // add generic icon to panel when no sensors are selected
                hotSensors.push('_default_icon_');
                this._createHotItem('_default_icon_');
            } else {
                let defIconPos = hotSensors.indexOf('_default_icon_');
                if (defIconPos >= 0) {
                    // remove generic icon from panel when sensors are selected
                    hotSensors.splice(defIconPos, 1);
                    this._removeHotIcon('_default_icon_');
                }
            }

            // removes any sensors that may not currently be available
            hotSensors = this._removeMissingHotSensors(hotSensors);

            // this code is called asynchronously - make sure to save it for next round
            this._saveHotSensors(hotSensors);
        });

        this._sensorMenuItems[key] = item;
        let i = Object.keys(this._sensorMenuItems[key]).length;

        // alphabetize the sensors for these categories
        if (this._sensorIcons[type]['alphabetize'] && this._settings.get_boolean('alphabetize')) {
            let menuItems = this._groups[type].menu._getMenuItems();
            for (i = 0; i < menuItems.length; i++)
                // use natural sort order for system load, etc
                if (typeof menuItems[i] != 'undefined' && typeof menuItems[i].key != 'undefined' && menuItems[i].key.localeCompare(key, undefined, { numeric: true, sensitivity: 'base' }) > 0)
                    break;
        }

        this._groups[type].menu.addMenuItem(item, i);
    }

    _defaultLabel() {
        return new St.Label({
               y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
        });
    }

    _defaultIcon(key) {
        let split = key.replaceAll('_', ' ').trim().split(' ')[0].split('-');
        let type = split[0];

        let icon = new St.Icon({
          style_class: 'system-status-icon vitals-panel-icon-' + type,
            reactive: true
        });

        // support for hide icons #80
        if (type == 'default') {
            icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons['system']['icon']);
        } else if (!this._settings.get_boolean('hide-icons')) {
            let iconObj = (typeof split[1] != 'undefined')?'icon-' + split[1]:'icon';
            icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[type][iconObj]);
        }

        return icon;
    }

    _ucFirst(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    get positionInPanel() {
        let positions = [ 'left', 'center', 'right' ];
        return positions[this._settings.get_int('position-in-panel')];
    }

    _querySensors() {
        this._sensors.query((label, value, type, format) => {
            let key = '_' + type.split('-')[0] + '_' + label.replace(' ', '_').toLowerCase() + '_';

            let items = this._values.returnIfDifferent(label, value, type, format, key);
            for (let item of Object.values(items))
                this._updateDisplay(_(item[0]), item[1], item[2], item[3]);
        });

        if (this._warnings.length > 0) {
            this._notify('Vitals', this._warnings.join("\n"), 'folder-symbolic');
            this._warnings = [];
        }
    }

    _notify(msg, details, icon) {
        let source = new MessageTray.Source('MyApp Information', icon);
        Main.messageTray.add(source);
        let notification = new MessageTray.Notification(source, msg, details);
        notification.setTransient(true);
        source.notify(notification);
    }

    destroy() {
        this._destroyTimer();

        // has already been deallocated, was causing silent crashes
/*
        for (let key in this._sensorMenuItems)
            if (typeof this._sensorMenuItems[key] != 'undefined')
                this._sensorMenuItems[key].destroy();
*/

        for (let signal of Object.values(this._settingChangedSignals))
            this._settings.disconnect(signal);

        super.destroy();
    }
});

function init() {
    ExtensionUtils.initTranslations('vitals');
}

function enable() {
    vitalsMenu = new VitalsMenuButton();
    let positionInPanel = vitalsMenu.positionInPanel;
    Main.panel.addToStatusArea('vitalsMenu', vitalsMenu, positionInPanel == 'right' ? 1 : -1, positionInPanel);
}

function disable() {
    vitalsMenu.destroy();
    vitalsMenu = null;
}
