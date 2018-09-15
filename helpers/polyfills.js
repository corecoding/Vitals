if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    'use strict';
    if (typeof start !== 'number') {
      start = 0;
    }
    
    if (start + search.length > this.length) {
      return false;
    } else {
      return this.indexOf(search, start) !== -1;
    }
  }
}

if (!Object.values) Object.values = o=>Object.keys(o).map(k=>o[k]);

if (!Math.getMaxOfArray) {
  Math.getMaxOfArray = function(numArray) {
    return Math.max.apply(null, numArray);
  }
}
