const Gio = imports.gi.Gio;

const UDisksDriveProxy = Gio.DBusProxy.makeProxyWrapper(
'<node> \
    <interface name="org.freedesktop.UDisks2.Drive"> \
        <property type="s" name="Model" access="read"/> \
    </interface> \
</node>');

const UDisksDriveAtaProxy = Gio.DBusProxy.makeProxyWrapper(
'<node> \
    <interface name="org.freedesktop.UDisks2.Drive.Ata"> \
        <property type="d" name="SmartTemperature" access="read"/> \
    </interface> \
</node>');

// Poor man's async.js
const Async = {
    // mapping will be done in parallel
    map(arr, mapClb /* function(in, successClb)) */, resClb /* function(result) */) {
        let counter = arr.length;
        let result = [];
        for (let i = 0; i < arr.length; ++i) {
            mapClb(arr[i], (function(i, newVal) {
                result[i] = newVal;
                if (--counter == 0) resClb(result);
            }).bind(null, i)); // i needs to be bound since it will be changed during the next iteration
        }
    }
}

// routines for handling of udisks2
var UDisks2  = class {

    constructor(callback) {
        this._udisksProxies = [];
        this._get_drive_ata_proxies((proxies) => {
            this._udisksProxies = proxies;
            callback();
        });
        this._updated = true;
    }

    get available(){
        return this._udisksProxies.length > 0;
    }

    get updated (){
       return this._updated;
    }

    set updated (updated){
        this._updated = updated;
    }

    // creates a list of sensor objects from the list of proxies given
    get temp() {
        return this._udisksProxies.filter(function(proxy) {
            // 0K means no data available
            return proxy.ata.SmartTemperature > 0;
        }).map(function(proxy) {
            return {
                label: proxy.drive.Model,
                temp: proxy.ata.SmartTemperature - 273.15
            };
        });
    }

    // calls callback with [{ drive: UDisksDriveProxy, ata: UDisksDriveAtaProxy }, ... ] for every drive that implements both interfaces
    _get_drive_ata_proxies(callback) {
        Gio.DBusObjectManagerClient.new(Gio.DBus.system, 0, "org.freedesktop.UDisks2", "/org/freedesktop/UDisks2", null, null, function(src, res) {
            try {
                let objMgr = Gio.DBusObjectManagerClient.new_finish(res); //might throw

                let objPaths = objMgr.get_objects().filter(function(o) {
                    return o.get_interface("org.freedesktop.UDisks2.Drive") != null
                        && o.get_interface("org.freedesktop.UDisks2.Drive.Ata") != null;
                }).map(function(o) { return o.get_object_path() });

                // now create the proxy objects, log and ignore every failure
                Async.map(objPaths, function(obj, callback) {
                    // create the proxies object
                    let driveProxy = new UDisksDriveProxy(Gio.DBus.system, "org.freedesktop.UDisks2", obj, function(res, error) {
                        if (error) { //very unlikely - we even checked the interfaces before!
                            global.log('[FREON] Could not create proxy on ' + obj + ':' + error);
                            callback(null);
                            return;
                        }
                        let ataProxy = new UDisksDriveAtaProxy(Gio.DBus.system, "org.freedesktop.UDisks2", obj, function(res, error) {
                            if (error) {
                                global.log('[FREON] Could not create proxy on ' + obj + ':' + error);
                                callback(null);
                                return;
                            }

                            callback({ drive: driveProxy, ata: ataProxy });
                        });
                    });
                }, function(proxies) {
                    // filter out failed attempts == null values
                    callback(proxies.filter(function(a) { return a != null; }));
                });
            } catch (e) {
                global.log('[FREON] Could not find UDisks2 objects: ' + e);
            }
        });
    }

    destroy(callback) {
        for (let proxy of this._udisksProxies){
            if(proxy.drive){
                proxy.drive.run_dispose();
            }
            if(proxy.ata){
                proxy.ata.run_dispose();
            }
        }
        this._udisksProxies = [];
    }

    execute(callback) {
        this._updated = true;
    }

};
