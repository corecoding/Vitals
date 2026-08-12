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

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Cairo from 'gi://cairo';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const GRAPH_WIDTH_MIN = 280;
const GRAPH_HEIGHT = 120;
const PLOT_PAD_Y = 8;
const LINE_WIDTH = 2.5;
const SCRUB_PROC_LIMIT = 10;

const METRICS = [
    { id: 'cpu', label: 'CPU', key: '_processor_usage_', series: 'cpu' },
    { id: 'memory', label: 'Memory', key: '_memory_usage_', series: 'memory' },
    { id: 'network', label: 'Network', key: '__network-rx_max__', series: 'networkRx' },
    { id: 'gpu', label: 'GPU', key: '_gpu#1_usage_', series: 'gpu' },
];

function colorForNorm(norm) {
    const t = Math.max(0, Math.min(1, norm));
    return {
        r: (90 + t * 150) / 255,
        g: (140 - t * 70) / 255,
        b: (220 - t * 120) / 255,
        a: 0.75 + t * 0.25,
    };
}

export const HistoryChartMenuItem = GObject.registerClass({
    GTypeName: 'VitalsHistoryChartMenuItem',
    Signals: {
        'scrub': { param_types: [GObject.TYPE_DOUBLE] },
        'scrub-view-changed': {},
    },
}, class HistoryChartMenuItem extends PopupMenu.PopupBaseMenuItem {

    _init(values) {
        super._init({
            reactive: true,
            can_focus: false,
            style_class: 'vitals-history-chart-item',
        });

        this._values = values;
        this._metric = 'cpu';
        this._essential = null;
        this._samples = [];
        this._plotPoints = [];
        this._tMin = 0;
        this._tMax = 1;
        this._scrubIndex = -1;
        this._hovering = false;
        this._seriesDirty = false;
        this._tabButtons = {};
        this._lastProcessSample = null;
        this._lastPlayX = 0;
        this._graphWidth = GRAPH_WIDTH_MIN;

        this.setOrnament(PopupMenu.Ornament.HIDDEN);

        this._box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'vitals-history-chart-box',
        });
        this.add_child(this._box);

        this._tabs = new St.BoxLayout({
            vertical: false,
            style_class: 'vitals-history-chart-tabs',
            x_expand: true,
        });
        this._box.add_child(this._tabs);

        for (const metric of METRICS) {
            const btn = new St.Button({
                style_class: 'vitals-history-chart-tab',
                label: _(metric.label),
                toggle_mode: true,
                can_focus: false,
                x_expand: true,
            });
            btn.connect('clicked', () => {
                this._setMetric(metric.id);
            });
            this._tabs.add_child(btn);
            this._tabButtons[metric.id] = btn;
        }
        this._tabButtons.cpu.checked = true;

        this._status = new St.Label({
            text: _('Collecting history…'),
            style_class: 'vitals-history-chart-status',
        });
        this._box.add_child(this._status);

        this._graphCard = new St.Bin({
            style_class: 'vitals-history-graph-card',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
        });

        this._graph = new St.DrawingArea({
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-graph',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        this._graph.clip_to_allocation = true;
        this._graph.connect('repaint', this._onRepaint.bind(this));
        this._graph.connect('notify::allocation', () => {
            this._onGraphAllocationChanged();
        });
        this._graphCard.set_child(this._graph);
        this._box.add_child(this._graphCard);

        this._graph.connect('enter-event', () => {
            this._hovering = true;
            const w = Math.floor(this._graph.get_width());
            if (w > 1)
                this._graphWidth = w;
            // Hide sensor groups immediately; bottom stays empty until a valid slice
            this._setGapScrub(true);
            return Clutter.EVENT_PROPAGATE;
        });
        this._graph.connect('motion-event', (_actor, event) => {
            this._hovering = true;
            this._onMotion(event);
            return Clutter.EVENT_PROPAGATE;
        });
        this._graph.connect('leave-event', () => {
            this._hovering = false;
            this._clearScrub();
            // Catch up with samples collected while the pointer was over the chart
            if (this._seriesDirty)
                this._applySeriesSamples();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    isHovering() {
        return this._hovering;
    }

    _setGapScrub(force = false) {
        const alreadyGap = this._scrubIndex < 0 && this._lastPlayX < 0;
        if (alreadyGap && !force)
            return;
        this._scrubIndex = -1;
        this._lastPlayX = -1;
        this.emit('scrub', -1);
        this.emit('scrub-view-changed');
        if (!alreadyGap)
            this._graph.queue_repaint();
    }

    _clearScrub() {
        const wasScrubbing = this._scrubIndex >= 0 || this._lastPlayX >= 0;
        this._scrubIndex = -1;
        this._lastPlayX = -1;
        this.emit('scrub', -1);
        this.emit('scrub-view-changed');
        if (wasScrubbing)
            this._graph.queue_repaint();
    }

    _onGraphAllocationChanged() {
        // Keep plot geometry matched to allocation even while hovering so a one-time
        // menu grow (long process names) does not leave empty padding on the right.
        // Series samples stay frozen via _seriesDirty; this only rescales X.
        const w = Math.floor(this._graph.get_width());
        if (w < 2 || w === this._graphWidth)
            return;
        this._graphWidth = w;
        this._rebuildLine();
    }

    _plotWidth() {
        return Math.max(1, this._graphWidth);
    }

    _localXFromEvent(event) {
        const [stageX] = event.get_coords();
        // Map stage pixels into actor allocation space (correct under fractional scaling)
        const [ax] = this._graph.get_transformed_position();
        const [aw] = this._graph.get_transformed_size();
        const width = Math.max(1, this._graph.get_width());
        const scaleX = Math.max(1e-6, aw / width);
        return (stageX - ax) / scaleX;
    }

    activate(_event) {
    }

    isScrubbing() {
        return this._scrubIndex >= 0;
    }

    getScrubView() {
        // While hovering the chart, always return a view so sensor groups stay hidden
        // even over downtime gaps (empty bottom until a valid slice).
        if (!this._hovering)
            return null;
        if (this._scrubIndex < 0)
            return { timeText: '', valueText: '', items: [] };
        const sample = this._samples[this._scrubIndex];
        if (!sample || sample.v === null)
            return { timeText: '', valueText: '', items: [] };

        const meta = METRICS.find(m => m.id === this._metric) || METRICS[0];
        const items = [];
        if (this._metric === 'gpu') {
            items.push({ kind: 'empty', name: _('No per-process data for this metric'), value: '' });
        } else {
            const list = this._processListFor(this._metric, this._lastProcessSample);
            if (!this._lastProcessSample) {
                items.push({ kind: 'empty', name: _('No process data yet'), value: '' });
            } else if (!list.length) {
                items.push({ kind: 'empty', name: _('No activity'), value: '' });
            } else {
                for (const proc of list.slice(0, SCRUB_PROC_LIMIT)) {
                    items.push({
                        kind: 'proc',
                        name: proc.count > 1 ? `${proc.name} ×${proc.count}` : proc.name,
                        value: this._formatProcValueFor(this._metric, proc),
                    });
                }
            }
        }

        return {
            timeText: this._values.formatClock(sample.t),
            valueText: `${_(meta.label)}  ${this._values.formatSeriesValue(meta.key, sample.v)}`,
            items,
        };
    }

    _notifyScrubView() {
        this.emit('scrub-view-changed');
    }

    _setMetric(id) {
        this._metric = id;
        for (const metric of METRICS)
            this._tabButtons[metric.id].checked = (metric.id === id);
        this._applySeriesSamples();
        if (this._scrubIndex >= 0)
            this.emit('scrub', this._samples[this._scrubIndex]?.t || -1);
    }

    _seriesFor(metric) {
        return (this._essential && this._essential[metric.series])
            ? this._essential[metric.series]
            : [];
    }

    setSeriesData(essential) {
        this._essential = essential || null;

        // Keep collecting underneath, but freeze the drawn line while hovering
        if (this._hovering) {
            this._seriesDirty = true;
            return;
        }

        this._applySeriesSamples();
    }

    _applySeriesSamples() {
        this._seriesDirty = false;
        const meta = METRICS.find(m => m.id === this._metric) || METRICS[0];
        this._samples = this._seriesFor(meta);
        this._rebuildLine();

        if (this._samples.length < 2) {
            this._status.text = _('Collecting history…');
            this._status.visible = true;
        } else {
            this._status.visible = false;
        }
    }

    setProcessSample(sample) {
        this._lastProcessSample = sample || null;
        if (this._scrubIndex >= 0)
            this._notifyScrubView();
    }

    _processListFor(metricId, sample) {
        if (!sample)
            return [];
        if (metricId === 'memory')
            return sample.topMemory || [];
        if (metricId === 'network')
            return sample.topNetwork || [];
        return sample.topCpu || sample.top || [];
    }

    _formatProcValueFor(metricId, proc) {
        if (metricId === 'memory') {
            const mib = (proc.rss || 0) / (1024 * 1024);
            const pct = Math.max(0, Math.round((proc.mem || 0) * 1000) / 10);
            return `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)} MiB · ${pct}%`;
        }
        if (metricId === 'network')
            return this._formatBytesPerSec(proc.net || ((proc.rx || 0) + (proc.tx || 0)));
        const pct = Math.max(0, Math.round((proc.cpu || 0) * 1000) / 10);
        return `${pct}%`;
    }

    _formatBytesPerSec(bytesPerSec) {
        const n = Math.max(0, bytesPerSec || 0);
        if (n < 1024)
            return `${Math.round(n)} B/s`;
        if (n < 1024 * 1024)
            return `${(n / 1024).toFixed(n >= 10 * 1024 ? 0 : 1)} KB/s`;
        return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB/s`;
    }

    _onMotion(event) {
        if (this._samples.length < 2) {
            this._setGapScrub();
            return;
        }

        // Hit-test against the live allocation, not a stale frozen plot width
        const allocW = Math.max(1, this._graph.get_width());
        if (allocW > 1 && allocW !== this._graphWidth) {
            this._graphWidth = Math.floor(allocW);
            this._computePlotPoints();
        }

        const localX = this._localXFromEvent(event);
        const graphW = this._plotWidth();
        if (localX < 0 || localX > graphW) {
            this._setGapScrub();
            return;
        }

        const span = Math.max(1e-9, this._tMax - this._tMin);
        const t = this._tMin + (localX / Math.max(1, graphW)) * span;
        let index = 0;
        let bestD = Infinity;
        for (let i = 0; i < this._samples.length; i++) {
            const d = Math.abs(this._samples[i].t - t);
            if (d < bestD) {
                bestD = d;
                index = i;
            }
        }
        const sample = this._samples[index];
        if (!sample || sample.v === null) {
            this._setGapScrub();
            return;
        }

        const playX = Math.round(localX);
        const indexChanged = this._scrubIndex !== index;
        this._scrubIndex = index;
        this._lastPlayX = playX;
        this._graph.queue_repaint();
        if (!indexChanged)
            return;
        this.emit('scrub', sample.t);
    }

    _valueRange(data) {
        let vMin = 0;
        let vMax = 1;
        let hasPercent = true;
        for (let i = 0; i < data.length; i++) {
            if (data[i].v === null) continue;
            if (data[i].v > 1.5)
                hasPercent = false;
        }
        if (!hasPercent) {
            vMin = Infinity;
            vMax = -Infinity;
            for (let i = 0; i < data.length; i++) {
                if (data[i].v === null) continue;
                if (data[i].v < vMin) vMin = data[i].v;
                if (data[i].v > vMax) vMax = data[i].v;
            }
            if (vMin === Infinity) {
                vMin = 0;
                vMax = 1;
            } else if (vMax <= vMin) {
                vMax = vMin + 1;
            }
        }
        return { vMin, vMax, vRange: Math.max(1e-9, vMax - vMin) };
    }

    _rebuildLine() {
        this._computePlotPoints();
        this._graph.queue_repaint();
    }

    _timeBounds(data) {
        let tMin = Infinity;
        let tMax = -Infinity;
        for (let i = 0; i < data.length; i++) {
            const t = data[i].t;
            if (t < tMin) tMin = t;
            if (t > tMax) tMax = t;
        }
        if (tMin === Infinity) {
            tMin = 0;
            tMax = 1;
        } else if (tMax <= tMin) {
            tMax = tMin + 1;
        }
        this._tMin = tMin;
        this._tMax = tMax;
        return { tMin, tSpan: Math.max(1e-9, tMax - tMin) };
    }

    _computePlotPoints() {
        this._plotPoints = [];
        const data = this._samples;
        if (!data || data.length === 0)
            return;

        const { tMin, tSpan } = this._timeBounds(data);
        const graphW = this._plotWidth();
        const graphH = GRAPH_HEIGHT - PLOT_PAD_Y * 1.5;
        const xScale = Math.max(0, graphW - 1);
        const { vMin, vRange } = this._valueRange(data);

        for (let i = 0; i < data.length; i++) {
            const sample = data[i];
            const x = ((sample.t - tMin) / tSpan) * xScale;
            if (!sample || sample.v === null) {
                this._plotPoints.push({ x, gap: true });
                continue;
            }
            const norm = Math.min(1, Math.max(0, (sample.v - vMin) / vRange));
            this._plotPoints.push({
                x,
                y: PLOT_PAD_Y / 2 + (1 - norm) * graphH,
                norm,
                gap: false,
            });
        }
    }

    _plotSegments(pts) {
        const segments = [];
        let current = [];
        for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            if (!pt || pt.gap) {
                if (current.length)
                    segments.push(current);
                current = [];
                continue;
            }
            current.push(pt);
        }
        if (current.length)
            segments.push(current);
        return segments;
    }

    _onRepaint(area) {
        const cr = area.get_context();
        try {
            const [surfW] = area.get_surface_size();
            if (surfW > 1 && surfW !== this._graphWidth && !this._hovering) {
                this._graphWidth = Math.floor(surfW);
                this._computePlotPoints();
            }

            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);

            const segments = this._plotSegments(this._plotPoints);
            cr.setLineWidth(LINE_WIDTH);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);

            const baselineY = GRAPH_HEIGHT - PLOT_PAD_Y / 2;
            let last = null;
            for (const seg of segments) {
                if (seg.length < 2)
                    continue;

                cr.moveTo(seg[0].x, baselineY);
                cr.lineTo(seg[0].x, seg[0].y);
                for (let i = 1; i < seg.length; i++)
                    cr.lineTo(seg[i].x, seg[i].y);
                cr.lineTo(seg[seg.length - 1].x, baselineY);
                cr.closePath();
                const fill = colorForNorm(seg[seg.length - 1].norm);
                cr.setSourceRGBA(fill.r, fill.g, fill.b, 0.12);
                cr.fill();

                for (let i = 1; i < seg.length; i++) {
                    const a = seg[i - 1];
                    const b = seg[i];
                    const c = colorForNorm((a.norm + b.norm) / 2);
                    cr.setSourceRGBA(c.r, c.g, c.b, c.a);
                    cr.moveTo(a.x, a.y);
                    cr.lineTo(b.x, b.y);
                    cr.stroke();
                }
                last = seg[seg.length - 1];
            }

            if (last) {
                const lc = colorForNorm(last.norm);
                cr.setSourceRGBA(lc.r, lc.g, lc.b, 1);
                cr.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
                cr.fill();
            }

            if (this._scrubIndex >= 0 && this._lastPlayX >= 0) {
                const x = this._lastPlayX + 0.5;
                cr.setSourceRGBA(1, 1, 1, 0.95);
                cr.setLineWidth(2);
                cr.moveTo(x, 0);
                cr.lineTo(x, GRAPH_HEIGHT);
                cr.stroke();
            }
        } finally {
            cr.$dispose();
        }
    }
});
