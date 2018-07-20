const GLib = imports.gi.GLib;

const PENDING = 0,
      FULFILLED = 1,
      REJECTED = 2;

function Promise(executor) {
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
                if (done) {
                    return;
                }

                done = true;

                onRejected(reason);
            });
        } catch (e) {
            if (done) {
                return;
            }

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
}

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

// Returns a promise that resolves when all of the promises in the iterable
// argument have resolved
Promise.all = function(iterable) {
    let promises = iterable.filter(p => p instanceof Promise),
        values = [],
        done = 0;

    return new Promise((resolve, reject) => {
        promises.forEach((promise, index) => {
            promise.then(value => {
                done++;

                values[index] = value;

                if (done === promises.length) {
                    resolve(values);
                }
            }, reject);
        });
    });
};

// Returns a promise that resolves or rejects as soon as one of the promises
// in the iterable resolves or rejects, with the value or reason from that
// promise
Promise.race = function(iterable) {
    let promises = iterable.filter(p => p instanceof Promise);

    return new Promise((resolve, reject) => {
        promises.forEach(promise => promise.then(resolve, reject));
    });
};

// Returns a Promise object that is rejected with the given reason
Promise.reject = function(reason) {
    return new Promise((resolve, reject) => reject(reason));
};

// Returns a Promise object that is resolved with the given value
Promise.resolve = function(value) {
    return new Promise(resolve => resolve(value));
};
