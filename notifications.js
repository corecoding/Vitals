/*
  Copyright (c) 2018, Chris Monahan <chris@corecoding.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the GNOME nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const Lang = imports.lang;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

var Notifications = new Lang.Class({
    Name: 'Notifications',

    _init: function() {
        /*
        this._notifSource = new MessageTray.Source('ClipboardIndicator', "utilities-system-monitor-symbolic");

        this._notifSource.connect('destroy', Lang.bind(this, function() {
            this._notifSource = null;
        }));

        Main.messageTray.add(this._notifSource);
        */
    },

    _initNotification: function () {
        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source('ClipboardIndicator', "utilities-system-monitor-symbolic");

            this._notifSource.connect('destroy', Lang.bind(this, function() {
                this._notifSource = null;
            }));

            Main.messageTray.add(this._notifSource);
        }
    },

    display: function (message) {
        this._initNotification();

        let notification = null;
        if (this._notifSource.count === 0) {
            notification = new MessageTray.Notification(this._notifSource, message);
        } else {
            notification = this._notifSource.notifications[0];
            notification.update(message, '', { clear: true });
        }

        notification.setTransient(true);
        this._notifSource.notify(notification);
    }
});
