import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St'

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as Sensors from './sensors.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Values from './values.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as MenuItem from './menuItem.js';

let vitalsMenu;

var VitalsMenuButton = GObject.registerClass({
    GTypeName: 'VitalsMenuButton',
}, class VitalsMenuButton extends PanelMenu.Button {
    _init(extensionObject) {
        super._init(Clutter.ActorAlign.FILL);

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();

        this._sensorIcons = {
            'temperature' : { 'icon': 'temperature-symbolic.svg' },
                'voltage' : { 'icon': 'voltage-symbolic.svg' },
                    'fan' : { 'icon': 'fan-symbolic.svg' },
                 'memory' : { 'icon': 'memory-symbolic.svg' },
              'processor' : { 'icon': 'cpu-symbolic.svg' },
                 'system' : { 'icon': 'system-symbolic.svg' },
                'network' : { 'icon': 'network-symbolic.svg',
                           'icon-rx': 'network-download-symbolic.svg',
                           'icon-tx': 'network-upload-symbolic.svg',
                           'icon-ad': '../flags/1x1/ad.svg',
                           'icon-ae': '../flags/1x1/ae.svg',
                           'icon-af': '../flags/1x1/af.svg',
                           'icon-ag': '../flags/1x1/ag.svg',
                           'icon-ai': '../flags/1x1/ai.svg',
                           'icon-al': '../flags/1x1/al.svg',
                           'icon-am': '../flags/1x1/am.svg',
                           'icon-ao': '../flags/1x1/ao.svg',
                           'icon-ar': '../flags/1x1/ar.svg',
                           'icon-at': '../flags/1x1/at.svg',
                           'icon-au': '../flags/1x1/au.svg',
                           'icon-aw': '../flags/1x1/aw.svg',
                           'icon-ax': '../flags/1x1/ax.svg',
                           'icon-az': '../flags/1x1/az.svg',
                           'icon-ba': '../flags/1x1/ba.svg',
                           'icon-bb': '../flags/1x1/bb.svg',
                           'icon-bd': '../flags/1x1/bd.svg',
                           'icon-be': '../flags/1x1/be.svg',
                           'icon-bf': '../flags/1x1/bf.svg',
                           'icon-bg': '../flags/1x1/bg.svg',
                           'icon-bh': '../flags/1x1/bh.svg',
                           'icon-bi': '../flags/1x1/bi.svg',
                           'icon-bj': '../flags/1x1/bj.svg',
                           'icon-bl': '../flags/1x1/bl.svg',
                           'icon-bm': '../flags/1x1/bm.svg',
                           'icon-bn': '../flags/1x1/bn.svg',
                           'icon-bo': '../flags/1x1/bo.svg',
                           'icon-bq': '../flags/1x1/bq.svg',
                           'icon-br': '../flags/1x1/br.svg',
                           'icon-bs': '../flags/1x1/bs.svg',
                           'icon-bt': '../flags/1x1/bt.svg',
                           'icon-bv': '../flags/1x1/bv.svg',
                           'icon-bw': '../flags/1x1/bw.svg',
                           'icon-by': '../flags/1x1/by.svg',
                           'icon-bz': '../flags/1x1/bz.svg',
                           'icon-ca': '../flags/1x1/ca.svg',
                           'icon-cc': '../flags/1x1/cc.svg',
                           'icon-cd': '../flags/1x1/cd.svg',
                           'icon-cf': '../flags/1x1/cf.svg',
                           'icon-cg': '../flags/1x1/cg.svg',
                           'icon-ch': '../flags/1x1/ch.svg',
                           'icon-ci': '../flags/1x1/ci.svg',
                           'icon-ck': '../flags/1x1/ck.svg',
                           'icon-cl': '../flags/1x1/cl.svg',
                           'icon-cm': '../flags/1x1/cm.svg',
                           'icon-cn': '../flags/1x1/cn.svg',
                           'icon-co': '../flags/1x1/co.svg',
                           'icon-cr': '../flags/1x1/cr.svg',
                           'icon-cu': '../flags/1x1/cu.svg',
                           'icon-cv': '../flags/1x1/cv.svg',
                           'icon-cw': '../flags/1x1/cw.svg',
                           'icon-cx': '../flags/1x1/cx.svg',
                           'icon-cy': '../flags/1x1/cy.svg',
                           'icon-cz': '../flags/1x1/cz.svg',
                           'icon-de': '../flags/1x1/de.svg',
                           'icon-dj': '../flags/1x1/dj.svg',
                           'icon-dk': '../flags/1x1/dk.svg',
                           'icon-dm': '../flags/1x1/dm.svg',
                           'icon-do': '../flags/1x1/do.svg',
                           'icon-dz': '../flags/1x1/dz.svg',
                           'icon-ec': '../flags/1x1/ec.svg',
                           'icon-ee': '../flags/1x1/ee.svg',
                           'icon-eg': '../flags/1x1/eg.svg',
                           'icon-eh': '../flags/1x1/eh.svg',
                           'icon-er': '../flags/1x1/er.svg',
                           'icon-es': '../flags/1x1/es.svg',
                           'icon-et': '../flags/1x1/et.svg',
                           'icon-eu': '../flags/1x1/eu.svg',
                           'icon-fi': '../flags/1x1/fi.svg',
                           'icon-fj': '../flags/1x1/fj.svg',
                           'icon-fk': '../flags/1x1/fk.svg',
                           'icon-fm': '../flags/1x1/fm.svg',
                           'icon-fo': '../flags/1x1/fo.svg',
                           'icon-fr': '../flags/1x1/fr.svg',
                           'icon-ga': '../flags/1x1/ga.svg',
                           'icon-gb': '../flags/1x1/gb.svg',
                           'icon-gd': '../flags/1x1/gd.svg',
                           'icon-ge': '../flags/1x1/ge.svg',
                           'icon-gf': '../flags/1x1/gf.svg',
                           'icon-gg': '../flags/1x1/gg.svg',
                           'icon-gh': '../flags/1x1/gh.svg',
                           'icon-gi': '../flags/1x1/gi.svg',
                           'icon-gl': '../flags/1x1/gl.svg',
                           'icon-gm': '../flags/1x1/gm.svg',
                           'icon-gn': '../flags/1x1/gn.svg',
                           'icon-gp': '../flags/1x1/gp.svg',
                           'icon-gq': '../flags/1x1/gq.svg',
                           'icon-gr': '../flags/1x1/gr.svg',
                           'icon-gs': '../flags/1x1/gs.svg',
                           'icon-gt': '../flags/1x1/gt.svg',
                           'icon-gu': '../flags/1x1/gu.svg',
                           'icon-gw': '../flags/1x1/gw.svg',
                           'icon-gy': '../flags/1x1/gy.svg',
                           'icon-hk': '../flags/1x1/hk.svg',
                           'icon-hm': '../flags/1x1/hm.svg',
                           'icon-hn': '../flags/1x1/hn.svg',
                           'icon-hr': '../flags/1x1/hr.svg',
                           'icon-ht': '../flags/1x1/ht.svg',
                           'icon-hu': '../flags/1x1/hu.svg',
                           'icon-id': '../flags/1x1/id.svg',
                           'icon-ie': '../flags/1x1/ie.svg',
                           'icon-il': '../flags/1x1/il.svg',
                           'icon-im': '../flags/1x1/im.svg',
                           'icon-in': '../flags/1x1/in.svg',
                           'icon-io': '../flags/1x1/io.svg',
                           'icon-iq': '../flags/1x1/iq.svg',
                           'icon-ir': '../flags/1x1/ir.svg',
                           'icon-is': '../flags/1x1/is.svg',
                           'icon-it': '../flags/1x1/it.svg',
                           'icon-je': '../flags/1x1/je.svg',
                           'icon-jm': '../flags/1x1/jm.svg',
                           'icon-jo': '../flags/1x1/jo.svg',
                           'icon-jp': '../flags/1x1/jp.svg',
                           'icon-ke': '../flags/1x1/ke.svg',
                           'icon-kg': '../flags/1x1/kg.svg',
                           'icon-kh': '../flags/1x1/kh.svg',
                           'icon-ki': '../flags/1x1/ki.svg',
                           'icon-km': '../flags/1x1/km.svg',
                           'icon-kn': '../flags/1x1/kn.svg',
                           'icon-kp': '../flags/1x1/kp.svg',
                           'icon-kr': '../flags/1x1/kr.svg',
                           'icon-kw': '../flags/1x1/kw.svg',
                           'icon-ky': '../flags/1x1/ky.svg',
                           'icon-kz': '../flags/1x1/kz.svg',
                           'icon-la': '../flags/1x1/la.svg',
                           'icon-lb': '../flags/1x1/lb.svg',
                           'icon-lc': '../flags/1x1/lc.svg',
                           'icon-li': '../flags/1x1/li.svg',
                           'icon-lk': '../flags/1x1/lk.svg',
                           'icon-lr': '../flags/1x1/lr.svg',
                           'icon-ls': '../flags/1x1/ls.svg',
                           'icon-lt': '../flags/1x1/lt.svg',
                           'icon-lu': '../flags/1x1/lu.svg',
                           'icon-lv': '../flags/1x1/lv.svg',
                           'icon-ly': '../flags/1x1/ly.svg',
                           'icon-ma': '../flags/1x1/ma.svg',
                           'icon-mc': '../flags/1x1/mc.svg',
                           'icon-md': '../flags/1x1/md.svg',
                           'icon-me': '../flags/1x1/me.svg',
                           'icon-mf': '../flags/1x1/mf.svg',
                           'icon-mg': '../flags/1x1/mg.svg',
                           'icon-mh': '../flags/1x1/mh.svg',
                           'icon-mk': '../flags/1x1/mk.svg',
                           'icon-ml': '../flags/1x1/ml.svg',
                           'icon-mm': '../flags/1x1/mm.svg',
                           'icon-mn': '../flags/1x1/mn.svg',
                           'icon-mo': '../flags/1x1/mo.svg',
                           'icon-mp': '../flags/1x1/mp.svg',
                           'icon-mq': '../flags/1x1/mq.svg',
                           'icon-mr': '../flags/1x1/mr.svg',
                           'icon-ms': '../flags/1x1/ms.svg',
                           'icon-mt': '../flags/1x1/mt.svg',
                           'icon-mu': '../flags/1x1/mu.svg',
                           'icon-mv': '../flags/1x1/mv.svg',
                           'icon-mw': '../flags/1x1/mw.svg',
                           'icon-mx': '../flags/1x1/mx.svg',
                           'icon-my': '../flags/1x1/my.svg',
                           'icon-mz': '../flags/1x1/mz.svg',
                           'icon-na': '../flags/1x1/na.svg',
                           'icon-nc': '../flags/1x1/nc.svg',
                           'icon-ne': '../flags/1x1/ne.svg',
                           'icon-nf': '../flags/1x1/nf.svg',
                           'icon-ng': '../flags/1x1/ng.svg',
                           'icon-ni': '../flags/1x1/ni.svg',
                           'icon-nl': '../flags/1x1/nl.svg',
                           'icon-no': '../flags/1x1/no.svg',
                           'icon-np': '../flags/1x1/np.svg',
                           'icon-nr': '../flags/1x1/nr.svg',
                           'icon-nu': '../flags/1x1/nu.svg',
                           'icon-nz': '../flags/1x1/nz.svg',
                           'icon-om': '../flags/1x1/om.svg',
                           'icon-pa': '../flags/1x1/pa.svg',
                           'icon-pe': '../flags/1x1/pe.svg',
                           'icon-pf': '../flags/1x1/pf.svg',
                           'icon-pg': '../flags/1x1/pg.svg',
                           'icon-ph': '../flags/1x1/ph.svg',
                           'icon-pk': '../flags/1x1/pk.svg',
                           'icon-pl': '../flags/1x1/pl.svg',
                           'icon-pm': '../flags/1x1/pm.svg',
                           'icon-pn': '../flags/1x1/pn.svg',
                           'icon-pr': '../flags/1x1/pr.svg',
                           'icon-ps': '../flags/1x1/ps.svg',
                           'icon-pt': '../flags/1x1/pt.svg',
                           'icon-pw': '../flags/1x1/pw.svg',
                           'icon-py': '../flags/1x1/py.svg',
                           'icon-qa': '../flags/1x1/qa.svg',
                           'icon-re': '../flags/1x1/re.svg',
                           'icon-ro': '../flags/1x1/ro.svg',
                           'icon-rs': '../flags/1x1/rs.svg',
                           'icon-ru': '../flags/1x1/ru.svg',
                           'icon-rw': '../flags/1x1/rw.svg',
                           'icon-sa': '../flags/1x1/sa.svg',
                           'icon-sb': '../flags/1x1/sb.svg',
                           'icon-sc': '../flags/1x1/sc.svg',
                           'icon-sd': '../flags/1x1/sd.svg',
                           'icon-se': '../flags/1x1/se.svg',
                           'icon-sg': '../flags/1x1/sg.svg',
                           'icon-sh': '../flags/1x1/sh.svg',
                           'icon-si': '../flags/1x1/si.svg',
                           'icon-sj': '../flags/1x1/sj.svg',
                           'icon-sk': '../flags/1x1/sk.svg',
                           'icon-sl': '../flags/1x1/sl.svg',
                           'icon-sm': '../flags/1x1/sm.svg',
                           'icon-sn': '../flags/1x1/sn.svg',
                           'icon-so': '../flags/1x1/so.svg',
                           'icon-sr': '../flags/1x1/sr.svg',
                           'icon-ss': '../flags/1x1/ss.svg',
                           'icon-st': '../flags/1x1/st.svg',
                           'icon-sv': '../flags/1x1/sv.svg',
                           'icon-sx': '../flags/1x1/sx.svg',
                           'icon-sy': '../flags/1x1/sy.svg',
                           'icon-sz': '../flags/1x1/sz.svg',
                           'icon-tc': '../flags/1x1/tc.svg',
                           'icon-td': '../flags/1x1/td.svg',
                           'icon-tf': '../flags/1x1/tf.svg',
                           'icon-tg': '../flags/1x1/tg.svg',
                           'icon-th': '../flags/1x1/th.svg',
                           'icon-tj': '../flags/1x1/tj.svg',
                           'icon-tk': '../flags/1x1/tk.svg',
                           'icon-tl': '../flags/1x1/tl.svg',
                           'icon-tm': '../flags/1x1/tm.svg',
                           'icon-tn': '../flags/1x1/tn.svg',
                           'icon-to': '../flags/1x1/to.svg',
                           'icon-tr': '../flags/1x1/tr.svg',
                           'icon-tt': '../flags/1x1/tt.svg',
                           'icon-tv': '../flags/1x1/tv.svg',
                           'icon-tw': '../flags/1x1/tw.svg',
                           'icon-tz': '../flags/1x1/tz.svg',
                           'icon-ua': '../flags/1x1/ua.svg',
                           'icon-ug': '../flags/1x1/ug.svg',
                           'icon-um': '../flags/1x1/um.svg',
                           'icon-us': '../flags/1x1/us.svg',
                           'icon-uy': '../flags/1x1/uy.svg',
                           'icon-uz': '../flags/1x1/uz.svg',
                           'icon-va': '../flags/1x1/va.svg',
                           'icon-vc': '../flags/1x1/vc.svg',
                           'icon-ve': '../flags/1x1/ve.svg',
                           'icon-vg': '../flags/1x1/vg.svg',
                           'icon-vi': '../flags/1x1/vi.svg',
                           'icon-vn': '../flags/1x1/vn.svg',
                           'icon-vu': '../flags/1x1/vu.svg',
                           'icon-wf': '../flags/1x1/wf.svg',
                           'icon-ws': '../flags/1x1/ws.svg',
                           'icon-xk': '../flags/1x1/xk.svg',
                           'icon-ye': '../flags/1x1/ye.svg',
                           'icon-yt': '../flags/1x1/yt.svg',
                           'icon-za': '../flags/1x1/za.svg',
                           'icon-zm': '../flags/1x1/zm.svg',
                           'icon-zw': '../flags/1x1/zw.svg'
                      
                },
                'storage' : { 'icon': 'storage-symbolic.svg' },
                'battery' : { 'icon': 'battery-symbolic.svg' },
                    'gpu' : { 'icon': 'gpu-symbolic.svg' }
        }

        // list with the prefixes for the according themes, the index of each 
        // item must match the index on the combo box
        this._sensorsIconPathPrefix = ['/icons/original/', '/icons/gnome/'];

        this._warnings = [];
        this._sensorMenuItems = {};
        this._hotLabels = {};
        this._hotItems = {};
        this._groups = {};
        this._widths = {};
        this._numGpus = 1;
        this._newGpuDetected = false;
        this._newGpuDetectedCount = 0;
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
            style_class: 'vitals-panel-menu'
        });

        this._drawMenu();
        this.add_child(this._menuLayout);
        this._settingChangedSignals = [];
        this._trackedSignals = [];
        this._refreshTimeoutId = null;

        this._addSettingChangedSignal('update-time', this._updateTimeSettingChanged.bind(this));
        this._addSettingChangedSignal('position-in-panel', this._positionInPanelChanged.bind(this));
        this._addSettingChangedSignal('menu-centered', this._positionInPanelChanged.bind(this));
        this._addSettingChangedSignal('icon-style', this._iconStyleChanged.bind(this));

        let settings = [ 'use-higher-precision', 'alphabetize', 'hide-zeros',
                         'fixed-widths', 'hide-icons', 'unit',
                         'memory-measurement', 'include-public-ip', 'network-public-ip-interval',
                         'network-public-ip-show-flag', 'network-speed-format', 'storage-measurement',
                         'include-static-info', 'include-static-gpu-info' ];

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

    _trackConnect(object, signalName, handler) {
        let id = object.connect(signalName, handler);
        this._trackedSignals.push({ object, id });
        return id;
    }

    _untrackObjectSignals(object) {
        this._trackedSignals = this._trackedSignals.filter((entry) => {
            if (entry.object === object) {
                entry.object.disconnect(entry.id);
                return false;
            }
            return true;
        });
    }

    _initializeMenu() {
        // display sensor categories
        for (let sensor in this._sensorIcons) {
            // groups associated sensors under accordion menu
            if (sensor in this._groups) continue;

            //handle gpus separately.
            if (sensor === 'gpu') continue;

            this._initializeMenuGroup(sensor, sensor);
        }

        for (let i = 1; i <= this._numGpus; i++)
            this._initializeMenuGroup('gpu#' + i, 'gpu', (this._numGpus > 1 ? ' ' + i : ''));

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
            x_expand: true
        });

        // custom round refresh button
        let refreshButton = this._createRoundButton('view-refresh-symbolic', _('Refresh'));
        this._trackConnect(refreshButton, 'clicked', (self) => {
            // force refresh by clearing history
            this._sensors.resetHistory();
            this._values.resetHistory(this._numGpus);

            // make sure timer fires at next full interval
            this._updateTimeChanged();

            // refresh sensors now
            this._querySensors();
        });
        customButtonBox.add_child(refreshButton);

        // custom round monitor button
        let monitorButton = this._createRoundButton('org.gnome.SystemMonitor-symbolic', _('System Monitor'));
        this._trackConnect(monitorButton, 'clicked', (self) => {
            this.menu._getTopMenu().close();
            Util.spawn(this._settings.get_string('monitor-cmd').split(" "));
        });
        customButtonBox.add_child(monitorButton);

        // custom round preferences button
        let prefsButton = this._createRoundButton('preferences-system-symbolic', _('Preferences'));
        this._trackConnect(prefsButton, 'clicked', (self) => {
            this.menu._getTopMenu().close();
            this._extensionObject.openPreferences();
        });
        customButtonBox.add_child(prefsButton);

        // now add the buttons to the top bar
        item.actor.add_child(customButtonBox);

        // add buttons
        this.menu.addMenuItem(item);

        // query sensors on menu open
        this._trackConnect(this.menu, 'open-state-changed', (self, isMenuOpen) => {
            if (isMenuOpen) {
                // make sure timer fires at next full interval
                this._updateTimeChanged();

                // refresh sensors now
                this._querySensors();
            }
        });
    }

    _initializeMenuGroup(groupName, optionName, menuSuffix = '', position = -1) {
        this._groups[groupName] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(groupName) + menuSuffix), true);
        this._groups[groupName].icon.gicon = Gio.icon_new_for_string(this._sensorIconPath(groupName));

        // hide menu items that user has requested to not include
        if (!this._settings.get_boolean('show-' + optionName))
            this._groups[groupName].actor.hide();

        if (!this._groups[groupName].status) {
            this._groups[groupName].status = this._defaultLabel();
            this._groups[groupName].actor.insert_child_at_index(this._groups[groupName].status, 4);
            this._groups[groupName].status.text = _('No Data');
        }

        if(position == -1) this.menu.addMenuItem(this._groups[groupName]);
        else this.menu.addMenuItem(this._groups[groupName], position);
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
                this._removeHotItem(sensor);
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
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            update_time,
            (self) => {
                // always query sensors (for panel display when hot)
                this._querySensors();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _createHotItem(key, value, gicon) {
        let item = new St.BoxLayout({
            style_class: 'vitals-panel-item',
        });
        this._hotItems[key] = item;
        this._menuLayout.add_child(item);

        if (!this._settings.get_boolean('hide-icons') || key == '_default_icon_') {
            let icon = this._defaultIcon(key);
            if (gicon) icon.gicon = gicon;
            item.add_child(icon);
        }

        // don't add a label when no sensors are in the panel
        if (key == '_default_icon_') return;

        let label = new St.Label({
            style_class: 'vitals-panel-label',
            text: (value)?value:'\u2026', // ...
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        // attempt to prevent ellipsizes
        label.get_clutter_text().ellipsize = 0;
        // keep track of label for removal later
        this._hotLabels[key] = label;
        // prevent "called on the widget"  "which is not in the stage" errors by adding before width below
        item.add_child(label);

        // support for fixed widths #55, save label (text) width
        this._widths[key] = label.get_clutter_text().width;
    }

    _showHideSensorsChanged(self, sensor) {
        this._sensors.resetHistory();

        const sensorName = sensor.substr(5);
        if(sensorName === 'gpu') {
            for(let i = 1; i <= this._numGpus; i++)
                this._groups[sensorName + '#' + i].visible = this._settings.get_boolean(sensor);
        } else
            this._groups[sensorName].visible = this._settings.get_boolean(sensor);
    }

    _positionInPanelChanged() {
        this.container.get_parent().remove_child(this.container);
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

    _redrawDetailsMenuIcons() {
        // updates the icons on the 'details' menu, the one 
        // you have to click to appear
        this._sensors.resetHistory();
        for (const sensor in this._sensorIcons) {
            if (sensor == "gpu") continue;
            this._groups[sensor].icon.gicon = Gio.icon_new_for_string(this._sensorIconPath(sensor));
        }

        // gpu's are indexed differently, handle them here
        const gpuKeys = Object.keys(this._groups).filter(key => key.startsWith("gpu#"));
        gpuKeys.forEach((gpuKey) => {
            this._groups[gpuKey].icon.gicon = Gio.icon_new_for_string(this._sensorIconPath("gpu"));
        }); 
    }

    _iconStyleChanged() {
        this._redrawDetailsMenuIcons();
        this._redrawMenu();
    }

    _removeHotItems(){
        for (let key in this._hotItems) {
            this._removeHotItem(key);
        }
    }

    _removeHotItem(key) {
        if (key in this._hotItems) {
            this._hotItems[key].destroy();
            delete this._hotItems[key];
            delete this._hotLabels[key];
            delete this._widths[key];
        }
    }

    _redrawMenu() {
        this._removeHotItems();

        for (let key in this._sensorMenuItems) {
            if (key.includes('-group')) continue;
            let menuItem = this._sensorMenuItems[key];
            this._untrackObjectSignals(menuItem);
            menuItem.destroy();
            delete this._sensorMenuItems[key];
        }

        this._drawMenu();
        this._sensors.resetHistory();
        this._values.resetHistory(this._numGpus);
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
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }
    }

    _updateTimeSettingChanged() {
        this._destroyTimer();
        this._initializeTimer();
    }

    _updateTimeChanged() {
        this._destroyTimer();
        this._initializeTimer();
    }

    _addSettingChangedSignal(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    }

    _disconnectSettingsSignals() {
        for (let handlerId of this._settingChangedSignals)
            this._settings.disconnect(handlerId);
        this._settingChangedSignals = [];
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
        let gicon = Gio.icon_new_for_string(this._sensorIconPath(type, icon));

        let item = new MenuItem.MenuItem(gicon, key, sensor.label, sensor.value, this._hotLabels[key]);
        this._trackConnect(item, 'toggle', (self) => {
            let hotSensors = this._settings.get_strv('hot-sensors');

            if (self.checked) {
                // add selected sensor to panel
                hotSensors.push(self.key);
                this._createHotItem(self.key, self.value, self.gicon);
            } else {
                // remove selected sensor from panel
                hotSensors.splice(hotSensors.indexOf(self.key), 1);
                this._removeHotItem(self.key);
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
                    this._removeHotItem('_default_icon_');
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
        // don't use the default system icon if the type is a gpu; use the universal gpu icon instead
        if (type == 'default' || (!(type in this._sensorIcons) && !type.startsWith('gpu'))) {
            icon.gicon = Gio.icon_new_for_string(this._sensorIconPath('system'));
        } else { // support for hide icons #80
            let iconObj = (split.length == 2)?'icon-' + split[1]:'icon';
            icon.gicon = Gio.icon_new_for_string(this._sensorIconPath(type, iconObj));
        }

        return icon;
    }

    _sensorIconPath(sensor, icon = 'icon') {
        // If the sensor is a numbered gpu, use the gpu icon. Otherwise use whatever icon associated with the sensor name.
        let sensorKey = sensor;
        if(sensor.startsWith('gpu')) sensorKey = 'gpu';

        const iconPathPrefixIndex = this._settings.get_int('icon-style');
        return this._extensionObject.path + this._sensorsIconPathPrefix[iconPathPrefixIndex] + this._sensorIcons[sensorKey][icon];
    }

    _ucFirst(string) {
        if(string.startsWith('gpu')) return 'Graphics';
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

        let centered = this._settings.get_boolean('menu-centered')
        if (centered) arrow_pos = 0.5;

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
            let typeKey = type.replace('-group', '');
            if (/^network-(?!rx$|tx$)/.test(typeKey)) typeKey = 'network';
            let key = '_' + typeKey + '_' + label.replace(' ', '_').toLowerCase() + '_';

            // if a sensor is disabled, gray it out
            if (key in this._sensorMenuItems) {
                this._sensorMenuItems[key].setSensitive((value!='disabled'));

                // don't continue below, last known value is shown
                if (value == 'disabled') return;
            }

            // add/initialize any gpu groups that we haven't added yet
            if (typeKey.startsWith('gpu') && typeKey !== 'gpu#1') {
                const split = typeKey.split('#');
                if(split.length == 2 && this._numGpus < parseInt(split[1])) {
                    // occasionally two lines from nvidia-smi will be read at once
                    // so we only actually update the number of gpus if we have recieved multiple lines at least 3 times in a row
                    // i.e. we make sure that mutiple queries have detected a new gpu back-to-back
                    if(this._newGpuDetectedCount < 2) {
                        this._newGpuDetected = true;
                        return;
                    }

                    this._numGpus = parseInt(split[1]);
                    this._newGpuDetectedCount = 0;
                    this._newGpuDetected = false;
                    // change label for gpu 1 from "Graphics" to "Graphics 1" since we have multiple gpus now
                    this._groups['gpu#1'].label.text = this._ucFirst('gpu#1') + ' 1';
                    for(let i = 2; i <= this._numGpus; i++)
                        if(!('gpu#' + i in this._groups))
                            this._initializeMenuGroup('gpu#' + i, 'gpu', ' ' + i, Object.keys(this._groups).length);
                }
            }

            let items = this._values.returnIfDifferent(dwell, label, value, type, format, key);
            for (let item of items) {
                if (item.type.startsWith('network-') && item.type.length == 10 && item.type != 'network-rx' && item.type != 'network-tx') {
                    // Geo / flags: stable key (no country in key); type stays network-<cc> for icon-us etc.
                    const stem = item.type.slice('network-'.length);
                    let flagGIcon = Gio.icon_new_for_string(this._sensorIconPath('network', 'icon-' + stem));
                    if (this._hotItems[item.key] && !this._settings.get_boolean('hide-icons')) {
                        // change icon in menu bar
                        let icon = this._hotItems[item.key].get_first_child();
                        if (icon instanceof St.Icon)
                        icon.gicon = flagGIcon;
                    }
                    // change icon in dropdown
                    let menuRow = this._sensorMenuItems[item.key];
                    if (menuRow) menuRow.gicon = flagGIcon;
                }

                this._updateDisplay(_(item.label), item.value, item.type, item.key);
            }
        }, dwell);

        //if a new gpu has been detected during the last query, then increment the amount of times we've detected a new gpu
        if(this._newGpuDetected) this._newGpuDetectedCount++;
        else this._newGpuDetectedCount = 0;
        this._newGpuDetected = false;

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
        for (let { object, id } of this._trackedSignals)
            object.disconnect(id);
        this._trackedSignals = [];

        this._destroyTimer();
        this._sensors.destroy();

        this._disconnectSettingsSignals();

        super.destroy();
    }
});

export default class VitalsExtension extends Extension {
    enable() {
        vitalsMenu = new VitalsMenuButton(this);
        let position = vitalsMenu._positionInPanel();
        Main.panel.addToStatusArea('vitalsMenu', vitalsMenu, position[1], position[0]);
    }

    disable() {
        if (vitalsMenu) {
            vitalsMenu._disconnectSettingsSignals();
            vitalsMenu.destroy();
        }
        vitalsMenu = null;
    }
}
