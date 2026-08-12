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

const GRAPH_WIDTH = 360;
const GRAPH_HEIGHT = 120;
const PADDING = 8;
const TOOLTIP_WIDTH = 190;
const LINE_WIDTH = 2.5;

const METRICS = [
    { id: 'cpu', label: 'CPU', key: '_processor_usage_', series: 'cpu' },
    { id: 'memory', label: 'Memory', key: '_memory_usage_', series: 'memory' },
    { id: 'network', label: 'Network', key: '__network-rx_max__', series: 'networkRx' },
    { id: 'gpu', label: 'GPU', key: '_gpu#1_usage_', series: 'gpu' },
];

function colorForNorm(norm) {
    // Soft blue → warm coral as usage rises (same palette as the old bars)
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
        this._scrubIndex = -1;
        this._hovering = false;
        this._seriesDirty = false;
        this._tabButtons = {};
        this._tabValueLabels = {};
        this._lastProcessSample = null;
        this._lastPlayX = PADDING;

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
                toggle_mode: true,
                can_focus: false,
                x_expand: true,
            });
            const tabInner = new St.BoxLayout({
                vertical: true,
                style_class: 'vitals-history-chart-tab-inner',
                x_expand: true,
            });
            const title = new St.Label({
                text: _(metric.label),
                style_class: 'vitals-history-chart-tab-title',
            });
            const value = new St.Label({
                text: '—',
                style_class: 'vitals-history-chart-tab-value',
            });
            tabInner.add_child(title);
            tabInner.add_child(value);
            btn.set_child(tabInner);
            btn.connect('clicked', () => {
                this._setMetric(metric.id);
            });
            this._tabs.add_child(btn);
            this._tabButtons[metric.id] = btn;
            this._tabValueLabels[metric.id] = value;
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
        });
        this._graphCard.clip_to_allocation = false;
        // Unclipped stage so the scrub tooltip can extend past the chart edge
        this._graphStage = new St.Widget({
            width: GRAPH_WIDTH,
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-graph-stage',
            reactive: false,
        });
        this._graphStage.clip_to_allocation = false;

        this._graph = new St.DrawingArea({
            width: GRAPH_WIDTH,
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-graph',
            reactive: true,
            track_hover: true,
        });
        this._graph.clip_to_allocation = true;
        this._graph.connect('repaint', this._onRepaint.bind(this));
        this._plotPoints = [];
        this._graphStage.add_child(this._graph);

        // Sibling overlay so the scrub line sits above the Cairo surface
        this._playhead = new St.Bin({
            width: 2,
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-playhead',
            visible: false,
            reactive: false,
        });
        this._graphStage.add_child(this._playhead);

        this._tooltip = new St.BoxLayout({
            vertical: true,
            style_class: 'vitals-history-tooltip',
            visible: false,
            width: TOOLTIP_WIDTH,
        });
        this._tooltipTime = new St.Label({
            text: '',
            style_class: 'vitals-history-tooltip-time',
        });
        this._tooltipValue = new St.Label({
            text: '',
            style_class: 'vitals-history-tooltip-value',
        });
        this._tooltipProcs = new St.BoxLayout({
            vertical: true,
            style_class: 'vitals-history-tooltip-procs',
        });
        this._tooltip.add_child(this._tooltipTime);
        this._tooltip.add_child(this._tooltipValue);
        this._tooltip.add_child(this._tooltipProcs);
        // Sibling of the clipped graph so it is not cropped by the chart border
        this._graphStage.add_child(this._tooltip);

        this._graphCard.set_child(this._graphStage);
        this._box.add_child(this._graphCard);

        this._graph.connect('enter-event', () => {
            this._hovering = true;
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

    _clearScrub() {
        this._playhead.visible = false;
        this._tooltip.visible = false;
        if (this._scrubIndex < 0)
            return;
        this._scrubIndex = -1;
        this.emit('scrub', -1);
    }

    activate(_event) {
    }

    isScrubbing() {
        return this._scrubIndex >= 0;
    }

    _setMetric(id) {
        this._metric = id;
        for (const metric of METRICS)
            this._tabButtons[metric.id].checked = (metric.id === id);
        // Always redraw for the selected metric, even while hover-frozen
        this._refreshTabValues();
        this._applySeriesSamples();
        if (this._scrubIndex >= 0 && this._samples[this._scrubIndex])
            this._updateTooltip(this._samples[this._scrubIndex]);
    }

    _latestValueText(metric) {
        const series = this._essential && this._essential[metric.series];
        if (!series || !series.length)
            return '—';
        let last = null;
        for (let i = series.length - 1; i >= 0; i--) {
            if (series[i].v !== null) {
                last = series[i];
                break;
            }
        }
        if (!last)
            return '—';
        return this._values.formatSeriesValue(metric.key, last.v);
    }

    _refreshTabValues() {
        for (const metric of METRICS) {
            const label = this._tabValueLabels[metric.id];
            if (label)
                label.text = this._latestValueText(metric);
        }
    }

    setSeriesData(essential) {
        this._essential = essential || null;
        this._refreshTabValues();

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
        this._samples = (this._essential && this._essential[meta.series]) ? this._essential[meta.series] : [];
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
        if (this._scrubIndex >= 0 && this._samples[this._scrubIndex])
            this._updateTooltip(this._samples[this._scrubIndex]);
    }

    _processRows(sample) {
        if (this._metric === 'gpu')
            return { unavailable: true, list: [] };
        if (!sample)
            return { unavailable: false, list: null };
        if (this._metric === 'memory')
            return { unavailable: false, list: sample.topMemory || [] };
        if (this._metric === 'network')
            return { unavailable: false, list: sample.topNetwork || [] };
        return { unavailable: false, list: sample.topCpu || sample.top || [] };
    }

    _formatProcValue(proc) {
        if (this._metric === 'memory') {
            const mib = (proc.rss || 0) / (1024 * 1024);
            const pct = Math.max(0, Math.round((proc.mem || 0) * 1000) / 10);
            return `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)} MiB · ${pct}%`;
        }
        if (this._metric === 'network') {
            return this._formatBytesPerSec(proc.net || ((proc.rx || 0) + (proc.tx || 0)));
        }
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

    _renderTooltipProcs(sample) {
        const container = this._tooltipProcs;
        const children = container.get_children();
        for (const child of children)
            child.destroy();

        const { unavailable, list } = this._processRows(sample);
        if (unavailable) {
            container.add_child(new St.Label({
                text: _('No per-process data for this metric'),
                style_class: 'vitals-history-tooltip-empty',
            }));
            return;
        }
        if (!list) {
            container.add_child(new St.Label({
                text: _('No process data yet'),
                style_class: 'vitals-history-tooltip-empty',
            }));
            return;
        }
        if (list.length === 0) {
            container.add_child(new St.Label({
                text: _('No activity in this sample'),
                style_class: 'vitals-history-tooltip-empty',
            }));
            return;
        }

        for (const proc of list.slice(0, 5)) {
            const row = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style_class: 'vitals-history-tooltip-proc-row',
            });
            row.add_child(new St.Label({
                text: proc.count > 1 ? `${proc.name} ×${proc.count}` : proc.name,
                x_expand: true,
                style_class: 'vitals-history-tooltip-proc-name',
            }));
            row.add_child(new St.Label({
                text: this._formatProcValue(proc),
                style_class: 'vitals-history-tooltip-proc-value',
            }));
            container.add_child(row);
        }
    }

    _onMotion(event) {
        if (this._samples.length < 2)
            return;

        const [x] = event.get_coords();
        const [gx] = this._graph.get_transformed_position();
        const localX = x - gx;
        const graphW = GRAPH_WIDTH - 2 * PADDING;
        const plotLeft = PADDING;
        const plotRight = PADDING + graphW;

        // Ignore the empty pad outside the drawn line
        if (localX < plotLeft || localX > plotRight) {
            this._clearScrub();
            return;
        }

        const denom = Math.max(1, this._samples.length - 1);
        const rel = (localX - plotLeft) / Math.max(1, graphW);
        const index = Math.max(0, Math.min(this._samples.length - 1,
            Math.round(rel * denom)));
        const sample = this._samples[index];
        if (!sample || sample.v === null) {
            this._clearScrub();
            return;
        }

        // Snap playhead to the sample's x on the line (not free-float in the pad)
        const playX = Math.round(plotLeft + (index / denom) * graphW);
        this._scrubIndex = index;
        this._lastPlayX = playX;
        this._playhead.visible = true;
        // Center the 2px line on the sample
        this._playhead.set_position(playX - 1, 0);
        // Extension updates process sample synchronously via scrub
        this.emit('scrub', sample.t);
        this._updateTooltip(sample, playX);
    }

    _updateTooltip(sample, playX = null) {
        if (!sample) {
            this._tooltip.visible = false;
            return;
        }

        const meta = METRICS.find(m => m.id === this._metric) || METRICS[0];
        this._tooltipTime.text = this._values.formatClock(sample.t);
        this._tooltipValue.text = `${_(meta.label)}  ${this._values.formatSeriesValue(meta.key, sample.v)}`;
        this._renderTooltipProcs(this._lastProcessSample);

        this._tooltip.visible = true;
        // Ensure allocation is current before measuring/positioning
        this._tooltip.queue_relayout();
        let tipH = this._tooltip.height;
        if (!tipH || tipH < 8)
            tipH = 96;

        const tipW = TOOLTIP_WIDTH;
        const anchorX = playX !== null ? playX : this._lastPlayX;
        let tipX = anchorX + 10;
        if (tipX + tipW > GRAPH_WIDTH - 4)
            tipX = Math.max(4, anchorX - tipW - 10);

        // Prefer above the pointer band; allow overflow below the chart (stage is unclipped)
        let tipY = 8;
        if (tipY + tipH > GRAPH_HEIGHT - 4)
            tipY = Math.max(4, GRAPH_HEIGHT - tipH - 4);

        this._tooltip.set_position(Math.round(tipX), Math.round(tipY));
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
        const data = this._samples;
        this._plotPoints = [];

        if (!data || data.length === 0) {
            this._graph.queue_repaint();
            return;
        }

        const graphW = GRAPH_WIDTH - 2 * PADDING;
        const graphH = GRAPH_HEIGHT - PADDING * 1.5;
        const { vMin, vRange } = this._valueRange(data);
        const n = data.length;
        const denom = Math.max(1, n - 1);

        for (let i = 0; i < n; i++) {
            const sample = data[i];
            if (!sample || sample.v === null)
                continue;
            const norm = Math.min(1, Math.max(0, (sample.v - vMin) / vRange));
            this._plotPoints.push({
                x: PADDING + (i / denom) * graphW,
                y: PADDING / 2 + (1 - norm) * graphH,
                norm,
            });
        }

        this._graph.queue_repaint();
    }

    _onRepaint(area) {
        const cr = area.get_context();
        try {
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);

            const pts = this._plotPoints;
            if (!pts || pts.length < 2)
                return;

            // Soft fill under the path
            cr.moveTo(pts[0].x, GRAPH_HEIGHT - PADDING / 2);
            cr.lineTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++)
                cr.lineTo(pts[i].x, pts[i].y);
            cr.lineTo(pts[pts.length - 1].x, GRAPH_HEIGHT - PADDING / 2);
            cr.closePath();
            const fill = colorForNorm(pts[pts.length - 1].norm);
            cr.setSourceRGBA(fill.r, fill.g, fill.b, 0.12);
            cr.fill();

            // Multi-color stroke: each segment tinted by intensity
            cr.setLineWidth(LINE_WIDTH);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1];
                const b = pts[i];
                const c = colorForNorm((a.norm + b.norm) / 2);
                cr.setSourceRGBA(c.r, c.g, c.b, c.a);
                cr.moveTo(a.x, a.y);
                cr.lineTo(b.x, b.y);
                cr.stroke();
            }

            // Endpoint dot
            const last = pts[pts.length - 1];
            const lc = colorForNorm(last.norm);
            cr.setSourceRGBA(lc.r, lc.g, lc.b, 1);
            cr.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
            cr.fill();
        } finally {
            cr.$dispose();
        }
    }
});
