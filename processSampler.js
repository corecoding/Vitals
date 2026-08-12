/*
  Copyright (c) 2018, Chris Monahan <chris@corecoding.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the GNOME nor the names of its contributors may be
      used to endorse or promote products derived from this software without
      specific prior written permission.

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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const TOP_N = 10;
const CLK_TCK = 100; // Linux USER_HZ is almost always 100

export const ProcessSampler = GObject.registerClass({
    GTypeName: 'VitalsProcessSampler',
}, class ProcessSampler extends GObject.Object {

    _init(settings) {
        super._init();
        this._settings = settings;
        this._prev = new Map();
        this._samples = [];
        this._lastSampleAt = 0;
        this._ncpus = Math.max(1, GLib.get_num_processors());
        this._pageSize = 4096;
        this._memTotalBytes = 0;
        this._enabled = false;
    }

    setEnabled(enabled) {
        this._enabled = !!enabled;
        if (!this._enabled) {
            this._samples = [];
            this._prev.clear();
            this._lastSampleAt = 0;
        }
    }

    clear() {
        this._samples = [];
        this._prev.clear();
        this._lastSampleAt = 0;
    }

    _maxAge() {
        return Math.max(60, this._settings.get_int('history-duration'));
    }

    sample() {
        if (!this._enabled)
            return;

        let pids;
        try {
            pids = this._listPids();
        } catch (e) {
            return;
        }

        this._refreshMemTotal();

        const now = Date.now() / 1000;
        const next = new Map();
        for (const pid of pids) {
            const entry = this._readStatSync(pid);
            if (entry)
                next.set(`${entry.pid}:${entry.starttime}`, entry);
        }

        const hadPrev = this._prev.size > 0;
        const dwell = this._lastSampleAt > 0
            ? Math.max(0.5, now - this._lastSampleAt)
            : Math.max(1, this._settings.get_int('update-time'));

        if (hadPrev) {
            const cpuScored = [];
            const memScored = [];

            for (const [id, entry] of next) {
                const prev = this._prev.get(id);
                if (prev) {
                    const deltaTicks = entry.cpuTime - prev.cpuTime;
                    if (deltaTicks > 0) {
                        const cpu = (deltaTicks / CLK_TCK) / dwell / this._ncpus;
                        cpuScored.push({
                            pid: entry.pid,
                            starttime: entry.starttime,
                            name: entry.name,
                            cpu: Math.max(0, cpu),
                            rss: entry.rssBytes,
                        });
                    }
                }

                if (entry.rssBytes > 0) {
                    memScored.push({
                        pid: entry.pid,
                        starttime: entry.starttime,
                        name: entry.name,
                        rss: entry.rssBytes,
                        mem: this._memTotalBytes > 0
                            ? entry.rssBytes / this._memTotalBytes
                            : 0,
                    });
                }
            }

            cpuScored.sort((a, b) => b.cpu - a.cpu);
            memScored.sort((a, b) => b.rss - a.rss);

            this._samples.push({
                t: now,
                topCpu: cpuScored.slice(0, TOP_N),
                topMemory: memScored.slice(0, TOP_N),
                // legacy alias used by older call sites
                top: cpuScored.slice(0, TOP_N),
            });

            const cutoff = now - this._maxAge();
            while (this._samples.length > 0 && this._samples[0].t < cutoff)
                this._samples.shift();
        }

        this._prev = next;
        this._lastSampleAt = now;
    }

    getNearest(unixSeconds) {
        if (!this._samples.length)
            return null;

        let best = this._samples[0];
        let bestDelta = Math.abs(best.t - unixSeconds);
        for (let i = 1; i < this._samples.length; i++) {
            const delta = Math.abs(this._samples[i].t - unixSeconds);
            if (delta < bestDelta) {
                best = this._samples[i];
                bestDelta = delta;
            }
        }
        return best;
    }

    getLatest() {
        if (!this._samples.length)
            return null;
        return this._samples[this._samples.length - 1];
    }

    _refreshMemTotal() {
        try {
            const [ok, bytes] = GLib.file_get_contents('/proc/meminfo');
            if (!ok)
                return;
            const text = new TextDecoder('utf-8').decode(bytes);
            const match = text.match(/^MemTotal:\s+(\d+)\s+kB/m);
            if (match)
                this._memTotalBytes = parseInt(match[1], 10) * 1024;
        } catch (e) {
            // keep previous
        }
    }

    _listPids() {
        const dir = Gio.File.new_for_path('/proc');
        const enumerator = dir.enumerate_children(
            Gio.FILE_ATTRIBUTE_STANDARD_NAME,
            Gio.FileQueryInfoFlags.NONE,
            null);
        const pids = [];
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (/^\d+$/.test(name))
                pids.push(name);
        }
        enumerator.close(null);
        return pids;
    }

    _readStatSync(pid) {
        try {
            const path = `/proc/${pid}/stat`;
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                return null;
            const text = new TextDecoder('utf-8').decode(bytes);
            const open = text.indexOf('(');
            const close = text.lastIndexOf(')');
            if (open < 0 || close < 0)
                return null;
            const comm = text.substring(open + 1, close);
            const rest = text.substring(close + 2).trim().split(/\s+/);
            // After comm: state(0) … utime(11), stime(12), … starttime(19), … rss(21)
            const utime = parseInt(rest[11], 10);
            const stime = parseInt(rest[12], 10);
            const starttime = parseInt(rest[19], 10);
            const rssPages = parseInt(rest[21], 10);
            if (!Number.isFinite(utime) || !Number.isFinite(stime))
                return null;
            return {
                pid,
                starttime,
                name: comm,
                cpuTime: utime + stime,
                rssBytes: Number.isFinite(rssPages) ? rssPages * this._pageSize : 0,
            };
        } catch (e) {
            return null;
        }
    }
});
