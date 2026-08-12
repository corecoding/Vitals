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
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const GRAPH_WIDTH = 360;
const GRAPH_HEIGHT = 120;
const PADDING = 8;
const MIN_BAR_WIDTH = 2;
const TOOLTIP_WIDTH = 168;

const METRICS = [
    { id: 'cpu', label: 'CPU', key: '_processor_usage_', series: 'cpu' },
    { id: 'memory', label: 'Memory', key: '_memory_usage_', series: 'memory' },
    { id: 'network', label: 'Network', key: '__network-rx_max__', series: 'networkRx' },
    { id: 'gpu', label: 'GPU', key: '_gpu#1_usage_', series: 'gpu' },
];

function barColorForNorm(norm) {
    // Soft blue → warm coral as usage rises (AppControl-like intensity cue)
    const t = Math.max(0, Math.min(1, norm));
    const r = Math.round(90 + t * 150);
    const g = Math.round(140 - t * 70);
    const b = Math.round(220 - t * 120);
    const a = 0.55 + t * 0.35;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
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
        this._graph = new St.Widget({
            width: GRAPH_WIDTH,
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-graph',
            reactive: true,
            track_hover: true,
        });
        this._graph.clip_to_allocation = true;
        this._barContainer = new St.Widget({
            x_expand: true,
            y_expand: true,
        });
        this._barContainer.clip_to_allocation = true;
        this._graph.add_child(this._barContainer);

        this._playhead = new St.Bin({
            width: 2,
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-playhead',
            visible: false,
        });
        this._graph.add_child(this._playhead);

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
        this._graph.add_child(this._tooltip);

        this._graphCard.set_child(this._graph);
        this._box.add_child(this._graphCard);

        this._processCard = new St.BoxLayout({
            vertical: true,
            style_class: 'vitals-history-process-card',
            x_expand: true,
        });
        this._processHeader = new St.Label({
            text: '',
            style_class: 'vitals-history-process-header',
        });
        this._processCard.add_child(this._processHeader);
        this._processList = new St.BoxLayout({
            vertical: true,
            style_class: 'vitals-history-process-list',
            x_expand: true,
        });
        this._processCard.add_child(this._processList);
        this._box.add_child(this._processCard);
        this._updateProcessHeader();

        this._graph.connect('motion-event', (_actor, event) => {
            this._onMotion(event);
            return Clutter.EVENT_PROPAGATE;
        });
        this._graph.connect('leave-event', () => {
            this._playhead.visible = false;
            this._tooltip.visible = false;
            this._scrubIndex = -1;
            this.emit('scrub', -1);
            return Clutter.EVENT_PROPAGATE;
        });
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
        this._updateProcessHeader();
        this.setSeriesData(this._essential);
        this.setProcessSample(this._lastProcessSample);
        if (this._scrubIndex >= 0 && this._samples[this._scrubIndex])
            this._updateTooltip(this._samples[this._scrubIndex]);
    }

    _updateProcessHeader() {
        switch (this._metric) {
            case 'memory':
                this._processHeader.text = _('Memory');
                break;
            case 'network':
                this._processHeader.text = _('Network');
                break;
            case 'gpu':
                this._processHeader.text = _('GPU');
                break;
            case 'cpu':
            default:
                this._processHeader.text = _('CPU');
                break;
        }
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
        const meta = METRICS.find(m => m.id === this._metric) || METRICS[0];
        this._samples = (this._essential && this._essential[meta.series]) ? this._essential[meta.series] : [];
        this._rebuildBars();
        this._refreshTabValues();

        if (this._samples.length < 2) {
            this._status.text = _('Collecting history…');
            this._status.visible = true;
        } else {
            this._status.visible = false;
        }
    }

    setProcessSample(sample) {
        this._lastProcessSample = sample || null;
        this._renderProcessList(this._processList, sample, 8, false);

        if (this._scrubIndex >= 0 && this._samples[this._scrubIndex])
            this._updateTooltip(this._samples[this._scrubIndex]);
    }

    _processRows(sample) {
        if (this._metric === 'network' || this._metric === 'gpu')
            return { unavailable: true, list: [] };
        if (!sample)
            return { unavailable: false, list: null };
        const list = this._metric === 'memory'
            ? (sample.topMemory || [])
            : (sample.topCpu || sample.top || []);
        return { unavailable: false, list };
    }

    _formatProcValue(proc) {
        if (this._metric === 'memory') {
            const mib = (proc.rss || 0) / (1024 * 1024);
            const pct = Math.max(0, Math.round((proc.mem || 0) * 1000) / 10);
            return `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)} MiB · ${pct}%`;
        }
        const pct = Math.max(0, Math.round((proc.cpu || 0) * 1000) / 10);
        return `${pct}%`;
    }

    _renderProcessList(container, sample, limit, compact) {
        const children = container.get_children();
        for (const child of children)
            child.destroy();

        const { unavailable, list } = this._processRows(sample);
        if (unavailable) {
            container.add_child(new St.Label({
                text: _('Per-process breakdown coming later'),
                style_class: 'vitals-history-process-empty',
            }));
            return;
        }
        if (!list) {
            container.add_child(new St.Label({
                text: _('No process data yet'),
                style_class: 'vitals-history-process-empty',
            }));
            return;
        }
        if (list.length === 0) {
            container.add_child(new St.Label({
                text: _('No activity in this sample'),
                style_class: 'vitals-history-process-empty',
            }));
            return;
        }

        for (const proc of list.slice(0, limit)) {
            const row = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style_class: compact
                    ? 'vitals-history-tooltip-proc-row'
                    : 'vitals-history-process-row',
            });
            const swatch = new St.Bin({
                style_class: 'vitals-history-process-swatch',
                width: compact ? 6 : 8,
                height: compact ? 6 : 8,
            });
            const name = new St.Label({
                text: proc.name,
                x_expand: true,
                style_class: compact
                    ? 'vitals-history-tooltip-proc-name'
                    : 'vitals-history-process-name',
            });
            const value = new St.Label({
                text: this._formatProcValue(proc),
                style_class: compact
                    ? 'vitals-history-tooltip-proc-value'
                    : 'vitals-history-process-value',
            });
            if (!compact)
                row.add_child(swatch);
            row.add_child(name);
            row.add_child(value);
            container.add_child(row);
        }
    }

    _onMotion(event) {
        if (this._samples.length < 2)
            return;

        const [x] = event.get_coords();
        const [gx] = this._graph.get_transformed_position();
        const localX = Math.max(0, Math.min(GRAPH_WIDTH, x - gx));
        const graphW = GRAPH_WIDTH - 2 * PADDING;
        const rel = (localX - PADDING) / Math.max(1, graphW);
        const index = Math.max(0, Math.min(this._samples.length - 1,
            Math.round(rel * (this._samples.length - 1))));

        this._scrubIndex = index;
        const sample = this._samples[index];
        const playX = Math.round(PADDING + rel * graphW);
        this._lastPlayX = playX;
        this._playhead.visible = true;
        this._playhead.set_position(playX, 0);
        // Extension updates process sample synchronously via scrub
        this.emit('scrub', sample ? sample.t : -1);
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
        this._renderProcessList(this._tooltipProcs, this._lastProcessSample, 3, true);

        this._tooltip.visible = true;
        const tipW = TOOLTIP_WIDTH;
        const anchorX = playX !== null ? playX : this._lastPlayX;
        let tipX = anchorX + 10;
        if (tipX + tipW > GRAPH_WIDTH - 4)
            tipX = Math.max(4, anchorX - tipW - 10);
        this._tooltip.set_position(Math.round(tipX), 10);
    }

    _rebuildBars() {
        const data = this._samples;
        let children;
        try {
            children = this._barContainer.get_children();
        } catch (e) {
            return;
        }

        if (data.length === 0) {
            for (let i = 0; i < children.length; i++)
                children[i].hide();
            return;
        }

        const graphW = GRAPH_WIDTH - 2 * PADDING;
        const graphH = GRAPH_HEIGHT - PADDING * 1.5;
        const maxBars = Math.floor(graphW / MIN_BAR_WIDTH);
        const numBars = Math.min(data.length, maxBars);
        const dataOffset = Math.max(0, data.length - numBars);
        const barWidth = graphW / numBars;

        let vMin = 0;
        let vMax = 1;
        let hasPercent = true;
        for (let i = dataOffset; i < data.length; i++) {
            if (data[i].v === null) continue;
            if (data[i].v > 1.5)
                hasPercent = false;
        }
        if (!hasPercent) {
            vMin = Infinity;
            vMax = -Infinity;
            for (let i = dataOffset; i < data.length; i++) {
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

        const vRange = Math.max(1e-9, vMax - vMin);
        let barIdx = 0;
        for (let b = 0; b < numBars; b++) {
            const sample = data[dataOffset + b];
            if (!sample || sample.v === null)
                continue;
            const norm = Math.min(1, Math.max(0, (sample.v - vMin) / vRange));
            const barH = Math.max(2, Math.round(norm * graphH));
            const x = Math.round(b * barWidth);
            const gap = barWidth > 3 ? 1 : 0;
            const w = Math.max(1, Math.round((b + 1) * barWidth) - x - gap);
            const color = barColorForNorm(norm);

            let bar;
            if (barIdx < children.length) {
                bar = children[barIdx];
                bar.set_size(w, barH);
                bar.set_position(x + PADDING, Math.round(graphH - barH) + PADDING / 2);
                bar.set_style(`background-color: ${color};`);
                bar.show();
            } else {
                bar = new St.Bin({
                    width: w,
                    height: barH,
                    style_class: 'vitals-history-graph-bar',
                    style: `background-color: ${color};`,
                });
                bar.set_position(x + PADDING, Math.round(graphH - barH) + PADDING / 2);
                this._barContainer.add_child(bar);
            }
            barIdx++;
        }

        for (let i = barIdx; i < children.length; i++)
            children[i].hide();
    }
});
