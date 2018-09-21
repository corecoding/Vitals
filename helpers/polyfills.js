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
