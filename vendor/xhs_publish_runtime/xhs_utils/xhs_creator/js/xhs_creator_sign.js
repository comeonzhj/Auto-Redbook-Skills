'use strict';

const crypto = require('crypto');

function dec2hex(value, width) {
    let result = '';
    for (let number = value; number;) {
        const digit = 15 & number;
        result = String.fromCharCode((digit > 9 ? 55 : 48) + digit) + result;
        number >>= 4;
    }
    if (width) {
        while (result.length < width) result = `0${result}`;
    }
    return result.toLowerCase();
}

function urlSing(value, timestampMs) {
    const now = timestampMs == null ? Date.now() : Number(timestampMs);
    const secondsHex = dec2hex(now / 1000);
    return crypto
        .createHash('md5')
        .update(`hIJXulBFYcGRQjrz${value}${secondsHex}`)
        .digest('hex');
}

if (typeof module !== 'undefined') {
    module.exports = { dec2hex, urlSing };
}
