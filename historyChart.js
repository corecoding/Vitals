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

const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 96;
const PADDING = 4;
const MIN_BAR_WIDTH = 2;

const METRICS = [
    { id: 'cpu', label: 'CPU', key: '_processor_usage_', series: 'cpu' },
    { id: 'memory', label: 'Memory', key: '_memory_usage_', series: 'memory' },
    { id: 'network', label: 'Network', key: '__network-rx_max__', series: 'networkRx' },
    { id: 'gpu', label: 'GPU', key: '_gpu#1_usage_', series: 'gpu' },
];

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
                label: _(metric.label),
                style_class: 'vitals-history-chart-tab button',
                toggle_mode: true,
                can_focus: false,
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
        this._box.add_child(this._graph);

        this._detail = new St.Label({
            text: '',
            style_class: 'vitals-history-chart-detail',
        });
        this._box.add_child(this._detail);

        this._processHeader = new St.Label({
            text: '',
            style_class: 'vitals-history-process-header',
        });
        this._box.add_child(this._processHeader);
        this._lastProcessSample = null;
        this._updateProcessHeader();

        this._processList = new St.BoxLayout({
            vertical: true,
            style_class: 'vitals-history-process-list',
            x_expand: true,
        });
        this._box.add_child(this._processList);

        this._graph.connect('motion-event', (_actor, event) => {
            this._onMotion(event);
            return Clutter.EVENT_PROPAGATE;
        });
        this._graph.connect('leave-event', () => {
            this._playhead.visible = false;
            this._scrubIndex = -1;
            this._updateDetail(null);
            this.emit('scrub', -1);
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // Keep the menu open; chart clicks are not pin toggles
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
        if (this._scrubIndex >= 0 && this._samples[this._scrubIndex])
            this._updateDetail(this._samples[this._scrubIndex]);
        // Re-render process rows for the newly selected metric
        this.setProcessSample(this._lastProcessSample);
    }

    _updateProcessHeader() {
        switch (this._metric) {
            case 'memory':
                this._processHeader.text = _('Top memory processes (at scrub time)');
                break;
            case 'network':
                this._processHeader.text = _('Network process breakdown');
                break;
            case 'gpu':
                this._processHeader.text = _('GPU process breakdown');
                break;
            case 'cpu':
            default:
                this._processHeader.text = _('Top CPU processes (at scrub time)');
                break;
        }
    }

    setSeriesData(essential) {
        this._essential = essential || null;
        const meta = METRICS.find(m => m.id === this._metric) || METRICS[0];
        this._samples = (this._essential && this._essential[meta.series]) ? this._essential[meta.series] : [];
        this._rebuildBars();

        if (this._samples.length < 2) {
            this._status.text = _('Collecting history…');
            this._status.visible = true;
            this._detail.text = '';
        } else {
            this._status.visible = false;
            if (this._scrubIndex < 0 || this._scrubIndex >= this._samples.length)
                this._updateDetail(this._samples[this._samples.length - 1]);
            else
                this._updateDetail(this._samples[this._scrubIndex]);
        }
    }

    setProcessSample(sample) {
        this._lastProcessSample = sample || null;

        const children = this._processList.get_children();
        for (const child of children)
            child.destroy();

        if (this._metric === 'network' || this._metric === 'gpu') {
            const empty = new St.Label({
                text: _('Per-process breakdown is not available for this metric yet'),
                style_class: 'vitals-history-process-empty',
            });
            this._processList.add_child(empty);
            return;
        }

        if (!sample) {
            const empty = new St.Label({
                text: _('No process data yet'),
                style_class: 'vitals-history-process-empty',
            });
            this._processList.add_child(empty);
            return;
        }

        const list = this._metric === 'memory'
            ? (sample.topMemory || [])
            : (sample.topCpu || sample.top || []);

        if (list.length === 0) {
            const empty = new St.Label({
                text: this._metric === 'memory'
                    ? _('No memory processes in this sample')
                    : _('No active CPU processes in this sample'),
                style_class: 'vitals-history-process-empty',
            });
            this._processList.add_child(empty);
            return;
        }

        for (const proc of list.slice(0, 8)) {
            const row = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style_class: 'vitals-history-process-row',
            });
            const name = new St.Label({
                text: proc.name,
                x_expand: true,
            });
            let valueText;
            if (this._metric === 'memory') {
                const mib = (proc.rss || 0) / (1024 * 1024);
                const pct = Math.max(0, Math.round((proc.mem || 0) * 1000) / 10);
                valueText = `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)} MiB (${pct}%)`;
            } else {
                const pct = Math.max(0, Math.round((proc.cpu || 0) * 1000) / 10);
                valueText = `${pct}%`;
            }
            const value = new St.Label({
                text: valueText,
                style_class: 'vitals-history-process-cpu',
            });
            row.add_child(name);
            row.add_child(value);
            this._processList.add_child(row);
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
        this._playhead.visible = true;
        this._playhead.set_position(Math.round(PADDING + rel * graphW), 0);
        this._updateDetail(sample);
        this.emit('scrub', sample ? sample.t : -1);
    }

    _updateDetail(sample) {
        if (!sample) {
            this._detail.text = '';
            return;
        }
        const meta = METRICS.find(m => m.id === this._metric) || METRICS[0];
        const clock = this._values.formatClock(sample.t);
        const value = this._values.formatSeriesValue(meta.key, sample.v);
        this._detail.text = `${clock}  ·  ${_(meta.label)}: ${value}`;
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
        const graphH = GRAPH_HEIGHT - PADDING;
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
            const norm = (sample.v - vMin) / vRange;
            const barH = Math.max(1, Math.round(Math.min(1, Math.max(0, norm)) * graphH));
            const x = Math.round(b * barWidth);
            const w = Math.max(1, Math.round((b + 1) * barWidth) - x);

            let bar;
            if (barIdx < children.length) {
                bar = children[barIdx];
                bar.set_size(w, barH);
                bar.set_position(x + PADDING, graphH - barH);
                bar.show();
            } else {
                bar = new St.Bin({
                    width: w,
                    height: barH,
                    style_class: 'vitals-history-graph-bar',
                });
                bar.set_position(x + PADDING, graphH - barH);
                this._barContainer.add_child(bar);
            }
            barIdx++;
        }

        for (let i = barIdx; i < children.length; i++)
            children[i].hide();
    }
});
