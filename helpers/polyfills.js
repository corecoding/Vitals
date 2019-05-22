if (!String.prototype.includes) {
    String.prototype.includes = function(search, start) {
        'use strict';

        if (typeof start !== 'number')
          start = 0;

        if (start + search.length > this.length)
            return false;
        else
            return this.indexOf(search, start) !== -1;
    }
}

// in parts of the system you may think that we can use Object.values
// instead of "key in" statements. Gnome 3.18 - 3.22 doesn't like doing that.
if (!Object.values)
    Object.values = obj => Object.keys(obj).map(key => obj[key]);

if (!Math.getMaxOfArray) {
    Math.getMaxOfArray = function(numArray) {
        return Math.max.apply(null, numArray);
    }
}

// newer verisons of Gnome have Promises built in
// Credit goes to https://github.com/satya164/gjs-helpers
if (typeof Promise === 'undefined') {
    const GLib = imports.gi.GLib;

    const PENDING = 0,
          FULFILLED = 1,
          REJECTED = 2;

    Promise = function(executor) {
        if (false === (this instanceof Promise)) {
            throw new TypeError("Promises must be constructed via new");
        }

        if (typeof executor !== "function") {
            throw new TypeError("Promise resolver " + executor + " is not a function");
        }

        // Create an array to add handlers
        this._deferreds = [];

        // Set the promise status
        this._state = PENDING;
        this._caught = false;

        this._handle = deferred => {
            if (this._state === PENDING) {
                this._deferreds.push(deferred);

                return;
            }

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
                let cb = this._state === FULFILLED ? deferred.onFulfilled : deferred.onRejected;

                if (cb === null) {
                    (this._state === FULFILLED ? deferred.resolve : deferred.reject)(this._value);

                    return false;
                }

                if (typeof cb !== "function") {
                    deferred.reject(this._value);

                    return false;
                }

                let ret;

                try {
                    ret = cb(this._value);
                } catch (e) {
                    deferred.reject(e);

                    return false;
                }

                deferred.resolve(ret);

                return false; // Don't repeat
            });
        };

        let doresolve = (fn, onFulfilled, onRejected) => {
            let done = false;

            try {
                fn(value => {
                    if (done) {
                        return;
                    }

                    done = true;

                    onFulfilled(value);
                }, function(reason) {
                    if (done) return;
                    done = true;
                    onRejected(reason);
                });
            } catch (e) {
                if (done) return;
                done = true;
                onRejected(e);
            }
        };

        let finale = () => {
            for (var i = 0, len = this._deferreds.length; i < len; i++) {
                this._handle.call(this, this._deferreds[i]);
            }

            this._deferreds = null;
        };

        let resolve = value => {
            // Call all fulfillment handlers one by one
            try {
                if (value === this) {
                    throw new TypeError("A promise cannot be resolved with itself");
                }

                if (value && (typeof value === "object" || typeof value === "function")) {
                    // If returned value is a thenable, treat is as a promise
                    if (typeof value.then === "function") {
                        doresolve(value.then.bind(value), resolve.bind(this), reject.bind(this));

                        return;
                    }
                }

                // Promise is fulfilled
                this._state = FULFILLED;
                this._value = value;

                finale.call(this);
            } catch (e) {
                reject.call(this, e);
            }
        };

        let reject = reason => {
            // Promise is rejected
            this._state = REJECTED;
            this._value = reason;

            finale.call(this);
        };

        doresolve(executor, resolve.bind(this), reject.bind(this));
    };

    // Appends fulfillment and rejection handlers to the promise
    Promise.prototype.then = function(onFulfilled, onRejected) {
        return new Promise((resolve, reject) => {
            this._handle.call(this, {
                resolve: resolve,
                reject: reject,
                onFulfilled: onFulfilled,
                onRejected: onRejected
            });
        });
    };

    // Appends a rejection handler callback to the promise
    Promise.prototype.catch = function(onRejected) {
        return this.then(null, onRejected);
    };

    // Returns a Promise object that is rejected with the given reason
    Promise.reject = function(reason) {
        return new Promise((resolve, reject) => reject(reason));
    };

    // Returns a Promise object that is resolved with the given value
    Promise.resolve = function(value) {
        return new Promise(resolve => resolve(value));
    };
}
