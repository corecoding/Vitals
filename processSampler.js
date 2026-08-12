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

        this._ssPath = GLib.find_program_in_path('ss');
        this._netBusy = false;
        this._netPrev = null;
        this._netPrevAt = 0;
        this._latestTopNetwork = [];
    }

    setEnabled(enabled) {
        this._enabled = !!enabled;
        if (!this._enabled) {
            this._samples = [];
            this._prev.clear();
            this._lastSampleAt = 0;
            this._netPrev = null;
            this._netPrevAt = 0;
            this._latestTopNetwork = [];
        }
    }

    clear() {
        this._samples = [];
        this._prev.clear();
        this._lastSampleAt = 0;
        this._netPrev = null;
        this._netPrevAt = 0;
        this._latestTopNetwork = [];
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
        this._sampleNetworkAsync();

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
            const cpuByName = new Map();
            const memByName = new Map();

            for (const [id, entry] of next) {
                const prev = this._prev.get(id);
                // New processes have no prior sample; their cpuTime so far all fell in this dwell
                const deltaTicks = prev
                    ? (entry.cpuTime - prev.cpuTime)
                    : entry.cpuTime;
                if (deltaTicks > 0) {
                    // Process-level utime+stime (not per-core); normalize to share of all CPUs
                    const cpu = Math.max(0, (deltaTicks / CLK_TCK) / dwell / this._ncpus);
                    const row = cpuByName.get(entry.name) || {
                        name: entry.name,
                        cpu: 0,
                        count: 0,
                    };
                    row.cpu += cpu;
                    row.count += 1;
                    cpuByName.set(entry.name, row);
                }

                if (entry.rssBytes > 0) {
                    const row = memByName.get(entry.name) || {
                        name: entry.name,
                        rss: 0,
                        count: 0,
                    };
                    row.rss += entry.rssBytes;
                    row.count += 1;
                    memByName.set(entry.name, row);
                }
            }

            const cpuScored = Array.from(cpuByName.values()).map(row => ({
                name: row.name,
                cpu: row.cpu,
                count: row.count,
            }));
            cpuScored.sort((a, b) => b.cpu - a.cpu);

            const memScored = Array.from(memByName.values()).map(row => ({
                name: row.name,
                rss: row.rss,
                mem: this._memTotalBytes > 0 ? row.rss / this._memTotalBytes : 0,
                count: row.count,
            }));
            memScored.sort((a, b) => b.rss - a.rss);

            this._samples.push({
                t: now,
                topCpu: cpuScored.slice(0, TOP_N),
                topMemory: memScored.slice(0, TOP_N),
                topNetwork: this._latestTopNetwork.slice(0, TOP_N),
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

    _sampleNetworkAsync() {
        if (!this._ssPath || this._netBusy)
            return;

        this._netBusy = true;
        let proc;
        try {
            // TCP sockets with process owners + byte counters (iproute2)
            proc = Gio.Subprocess.new(
                [this._ssPath, '-H', '-tnopi'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._netBusy = false;
            return;
        }

        proc.communicate_utf8_async(null, null, (sub, res) => {
            try {
                const [, stdout] = sub.communicate_utf8_finish(res);
                this._ingestSsOutput(stdout || '');
            } catch (e) {
                // ss missing counters / permission — leave previous network tops
            } finally {
                this._netBusy = false;
            }
        });
    }

    _ingestSsOutput(text) {
        const totals = new Map(); // pid -> { name, sent, recv }
        let curPid = null;

        for (const line of text.split('\n')) {
            const userMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
            if (userMatch) {
                curPid = userMatch[2];
                if (!totals.has(curPid)) {
                    totals.set(curPid, {
                        name: userMatch[1],
                        sent: 0,
                        recv: 0,
                    });
                } else {
                    totals.get(curPid).name = userMatch[1];
                }
            }

            if (!curPid || !totals.has(curPid))
                continue;

            const sentMatch = line.match(/bytes_sent:(\d+)/);
            const recvMatch = line.match(/bytes_received:(\d+)/);
            const row = totals.get(curPid);
            if (sentMatch)
                row.sent += parseInt(sentMatch[1], 10);
            if (recvMatch)
                row.recv += parseInt(recvMatch[1], 10);
        }

        const now = Date.now() / 1000;
        if (this._netPrev && this._netPrevAt > 0) {
            const dwell = Math.max(0.5, now - this._netPrevAt);
            const byName = new Map();

            for (const [pid, cur] of totals) {
                const prev = this._netPrev.get(pid);
                if (!prev)
                    continue;
                const dSent = Math.max(0, cur.sent - prev.sent);
                const dRecv = Math.max(0, cur.recv - prev.recv);
                const tx = dSent / dwell;
                const rx = dRecv / dwell;
                const rate = tx + rx;
                if (rate <= 0)
                    continue;
                const row = byName.get(cur.name) || {
                    name: cur.name,
                    tx: 0,
                    rx: 0,
                    net: 0,
                    count: 0,
                };
                row.tx += tx;
                row.rx += rx;
                row.net += rate;
                row.count += 1;
                byName.set(cur.name, row);
            }

            const scored = Array.from(byName.values());
            scored.sort((a, b) => b.net - a.net);
            this._latestTopNetwork = scored.slice(0, TOP_N);

            // Refresh the newest history sample so scrubbing sees current tops sooner
            if (this._samples.length > 0)
                this._samples[this._samples.length - 1].topNetwork = this._latestTopNetwork;
        }

        this._netPrev = totals;
        this._netPrevAt = now;
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
