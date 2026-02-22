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

const GRAPH_WIDTH = 220;
const GRAPH_HEIGHT = 90;
const PADDING = 4;
const BAR_GAP = 1;

export const HistoryGraph = GObject.registerClass({
    GTypeName: 'HistoryGraph',
}, class HistoryGraph extends St.Widget {

    _init(params = {}) {
        super._init({
            width: GRAPH_WIDTH,
            height: GRAPH_HEIGHT,
            style_class: 'vitals-history-graph',
            ...params
        });
        this._samples = [];
        this._label = '';
        this._unit = '';
        this._vMin = 0;
        this._vMax = 0;
        this._barContainer = new St.BoxLayout({
            vertical: false,
            style_class: 'vitals-history-graph-bars',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.END
        });
        this.add_child(this._barContainer);
    }

    setData(samples, label, unit) {
        this._samples = Array.isArray(samples) ? samples : [];
        this._label = label || '';
        this._unit = unit || '';
        this._rebuildBars();
    }

    _rebuildBars() {
        try {
            const children = this._barContainer.get_children();
            if (children && children.length > 0) {
                for (let i = children.length - 1; i >= 0; i--)
                    children[i].destroy();
            }
        } catch (e) {
            // ignore
        }
        const data = this._samples;
        if (data.length === 0) return;

        const graphW = GRAPH_WIDTH - 2 * PADDING;
        const graphH = GRAPH_HEIGHT - 2 * PADDING;
        if (graphW <= 0 || graphH <= 0) return;

        const vals = data.map(d => d.v);
        let vMin = Math.min(...vals);
        let vMax = Math.max(...vals);
        if (vMax <= vMin) {
            vMin = vMin - 1;
            vMax = vMax + 1;
        }
        this._vMin = vMin;
        this._vMax = vMax;
        const vRange = vMax - vMin;
        const tMin = data[0].t;
        const tMax = data[data.length - 1].t;
        const tRange = Math.max(0.001, tMax - tMin);

        const barWidth = Math.max(1, (graphW - (data.length - 1) * BAR_GAP) / data.length - BAR_GAP);

        for (let i = 0; i < data.length; i++) {
            const v = data[i].v;
            const norm = (v - vMin) / vRange;
            const barH = Math.max(1, Math.round(norm * graphH));
            const bar = new St.Bin({
                width: Math.round(barWidth),
                height: barH,
                style_class: 'vitals-history-graph-bar',
                y_align: Clutter.ActorAlign.END,
                x_align: Clutter.ActorAlign.CENTER
            });
            this._barContainer.add_child(bar);
        }
    }

    getRangeLabel() {
        if (this._samples.length === 0) return '';
        const a = this._vMin;
        const b = this._vMax;
        const fmt = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);
        return fmt(a) + ' – ' + fmt(b);
    }

    getRange() {
        if (this._samples.length === 0) return null;
        const fmt = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);
        return { min: fmt(this._vMin), max: fmt(this._vMax) };
    }

    getRawRange() {
        if (this._samples.length === 0) return null;
        return { min: this._vMin, max: this._vMax };
    }
});
