const {Clutter, Gio, St, GObject} = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
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
            'temperature' : { 'icon': 'temperature-symbolic.svg' },
                'voltage' : { 'icon': 'voltage-symbolic.svg' },
                    'fan' : { 'icon': 'fan-symbolic.svg' },
                 'memory' : { 'icon': 'memory-symbolic.svg' },
              'processor' : { 'icon': 'cpu-symbolic.svg' },
                 'system' : { 'icon': 'system-symbolic.svg' },
                'network' : { 'icon': 'network-symbolic.svg',
                           'icon-rx': 'network-download-symbolic.svg',
                           'icon-tx': 'network-upload-symbolic.svg' },
                'storage' : { 'icon': 'storage-symbolic.svg' },
                'battery' : { 'icon': 'battery-symbolic.svg' }
        }

        this._warnings = [];
        this._sensorMenuItems = {};
        this._hotLabels = {};
        this._hotIcons = {};
        this._groups = {};
        this._widths = {};
        this._last_query = new Date().getTime();

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

        let settings = [ 'use-higher-precision', 'alphabetize', 'hide-zeros', 'fixed-widths', 'hide-icons', 'unit', 'memory-measurement', 'include-public-ip', 'network-speed-format', 'storage-measurement', 'include-static-info' ];
        for (let setting of Object.values(settings))
            this._addSettingChangedSignal(setting, this._redrawMenu.bind(this));

        // add signals for show- preference based categories
        for (let sensor in this._sensorIcons)
            this._addSettingChangedSignal('show-' + sensor, this._showHideSensorsChanged.bind(this));

        this._initializeMenu();

        // start off with fresh sensors
        this._querySensors();

        // start monitoring sensors
        this._initializeTimer();
    }

    _initializeMenu() {
        // display sensor categories
        for (let sensor in this._sensorIcons) {
            // groups associated sensors under accordion menu
            if (sensor in this._groups) continue;

            this._groups[sensor] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(sensor)), true);
            this._groups[sensor].icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[sensor]['icon']);

            // hide menu items that user has requested to not include
            if (!this._settings.get_boolean('show-' + sensor))
                this._groups[sensor].actor.hide();

            if (!this._groups[sensor].status) {
                this._groups[sensor].status = this._defaultLabel();
                this._groups[sensor].actor.insert_child_at_index(this._groups[sensor].status, 4);
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
            // force refresh by clearing history
            this._sensors.resetHistory();
            this._values.resetHistory();

            // make sure timer fires at next full interval
            this._updateTimeChanged();

            // refresh sensors now
            this._querySensors();
        });
        customButtonBox.add_actor(refreshButton);

        // custom round monitor button
        let monitorButton = this._createRoundButton('org.gnome.SystemMonitor-symbolic', _('System Monitor'));
        monitorButton.connect('clicked', (self) => {
            this.menu._getTopMenu().close();
            Util.spawn([this._settings.get_string('monitor-cmd')]);
        });
        customButtonBox.add_actor(monitorButton);

        // custom round preferences button
        let prefsButton = this._createRoundButton('preferences-system-symbolic', _('Preferences'));
        prefsButton.connect('clicked', (self) => {
            this.menu._getTopMenu().close();
            ExtensionUtils.openPrefs();
        });
        customButtonBox.add_actor(prefsButton);

        // now add the buttons to the top bar
        item.actor.add_actor(customButtonBox);

        // add buttons
        this.menu.addMenuItem(item);

        // query sensors on menu open
        this._menuStateChangeId = this.menu.connect('open-state-changed', (self, isMenuOpen) => {
            if (isMenuOpen) {
                // make sure timer fires at next full interval
                this._updateTimeChanged();

                // refresh sensors now
                this._querySensors();
            }
        });
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

            // removes sensors that are no longer available
            if (!this._sensorMenuItems[sensor]) {
                hotSensors.splice(i, 1);
                this._removeHotLabel(sensor);
                this._removeHotIcon(sensor);
            }
        }

        return hotSensors;
    }

    _saveHotSensors(hotSensors) {
        // removes any sensors that may not currently be available
        hotSensors = this._removeMissingHotSensors(hotSensors);

        this._settings.set_strv('hot-sensors', hotSensors.filter(
            function(item, pos) {
                return hotSensors.indexOf(item) == pos;
            }
        ));
    }

    _initializeTimer() {
        // used to query sensors and update display
        let update_time = this._settings.get_int('update-time');
        this._refreshTimeoutId = Mainloop.timeout_add_seconds(update_time, (self) => {
            // only update menu if we have hot sensors
            if (Object.values(this._hotLabels).length > 0)
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

        // keep track of label for removal later
        this._hotLabels[key] = label;

        // prevent "called on the widget"  "which is not in the stage" errors by adding before width below
        this._menuLayout.add_actor(label);

        // support for fixed widths #55, save label (text) width
        this._widths[key] = label.width;
    }

    _showHideSensorsChanged(self, sensor) {
        this._sensors.resetHistory();
        this._groups[sensor.substr(5)].visible = this._settings.get_boolean(sensor);
    }

    _positionInPanelChanged() {
        this.container.get_parent().remove_actor(this.container);
        let position = this._positionInPanel();

        // allows easily addressable boxes
        let boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox
        };

        // update position when changed from preferences
        boxes[position[0]].insert_child_at_index(this.container, position[1]);
    }

    _removeHotLabel(key) {
        if (key in this._hotLabels) {
            let label = this._hotLabels[key];
            delete this._hotLabels[key];
            // make sure set_label is not called on non existent actor
            label.destroy();
        }
    }

    _removeHotLabels() {
        for (let key in this._hotLabels)
            this._removeHotLabel(key);
    }

    _removeHotIcon(key) {
        if (key in this._hotIcons) {
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
        for (let key of Object.values(hotSensors)) {
            // fixes issue #225 which started when _max_ was moved to the end
            if (key == '__max_network-download__') key = '__network-rx_max__';
            if (key == '__max_network-upload__') key = '__network-tx_max__';

            this._createHotItem(key);
        }
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
                // grab text box width and see if new text is wider than old text
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
            // add item to group for the first time
            let sensor = { 'label': label, 'value': value, 'type': type }
            this._appendMenuItem(sensor, key);
        }
    }

    _appendMenuItem(sensor, key) {
        let split = sensor.type.split('-');
        let type = split[0];
        let icon = (split.length == 2)?'icon-' + split[1]:'icon';
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

            // this code is called asynchronously - make sure to save it for next round
            this._saveHotSensors(hotSensors);
        });

        this._sensorMenuItems[key] = item;
        let i = Object.keys(this._sensorMenuItems[key]).length;

        // alphabetize the sensors for these categories
        if (this._settings.get_boolean('alphabetize')) {
            let menuItems = this._groups[type].menu._getMenuItems();
            for (i = 0; i < menuItems.length; i++)
                // use natural sort order for system load, etc
                if (menuItems[i].label.localeCompare(item.label, undefined, { numeric: true, sensitivity: 'base' }) > 0)
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

        // second condition prevents crash due to issue #225, which started when _max_ was moved to the end
        if (type == 'default' || !(type in this._sensorIcons)) {
            icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons['system']['icon']);
        } else if (!this._settings.get_boolean('hide-icons')) { // support for hide icons #80
            let iconObj = (split.length == 2)?'icon-' + split[1]:'icon';
            icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[type][iconObj]);
        }

        return icon;
    }

    _ucFirst(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    _positionInPanel() {
        let alignment = '';
        let gravity = 0;
        let arrow_pos = 0;

        switch (this._settings.get_int('position-in-panel')) {
            case 0: // left
                alignment = 'left';
                gravity = -1;
                arrow_pos = 1;
                break;
            case 1: // center
                alignment = 'center';
                gravity = -1;
                arrow_pos = 0.5;
                break;
            case 2: // right
                alignment = 'right';
                gravity = 0;
                arrow_pos = 0;
                break;
            case 3: // far left
                alignment = 'left';
                gravity = 0;
                arrow_pos = 1;
                break;
            case 4: // far right
                alignment = 'right';
                gravity = -1;
                arrow_pos = 0;
                break;
        }

        // set arrow position when initializing and moving vitals
        this.menu._arrowAlignment = arrow_pos;

        return [alignment, gravity];
    }

    _querySensors() {
        // figure out last run time
        let now = new Date().getTime();
        let dwell = (now - this._last_query) / 1000;
        this._last_query = now;

        this._sensors.query((label, value, type, format) => {
            let key = '_' + type.replace('-group', '') + '_' + label.replace(' ', '_').toLowerCase() + '_';

            // if a sensor is disabled, gray it out
            if (key in this._sensorMenuItems) {
                this._sensorMenuItems[key].setSensitive((value!='disabled'));

                // don't continue below, last known value is shown
                if (value == 'disabled') return;
            }

            let items = this._values.returnIfDifferent(dwell, label, value, type, format, key);
            for (let item of Object.values(items))
                this._updateDisplay(_(item[0]), item[1], item[2], item[3]);
        }, dwell);

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
    let position = vitalsMenu._positionInPanel();
    Main.panel.addToStatusArea('vitalsMenu', vitalsMenu, position[1], position[0]);
}

function disable() {
    vitalsMenu.destroy();
    vitalsMenu = null;
}
