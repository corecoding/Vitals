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

import GObject from 'gi://GObject';
import St from 'gi://St';

const GRAPH_WIDTH = 208;
const GRAPH_HEIGHT = 90;
const PADDING = 4;
const MIN_BAR_WIDTH = 1;

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
        this._base = 1;
        this._dataOffset = 0;
        this.clip_to_allocation = true;
        this._barContainer = new St.Widget({
            x_expand: true,
            y_expand: true
        });
        this._barContainer.clip_to_allocation = true;
        this.add_child(this._barContainer);
    }

    setData(samples, label, unit, base) {
        this._samples = Array.isArray(samples) ? samples : [];
        this._label = label || '';
        this._unit = unit || '';
        this._base = Math.max(1, base);
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
        const graphH = GRAPH_HEIGHT - PADDING;
        if (graphW <= 0 || graphH <= 0) return;

        const base = this._base;
        const maxBars = Math.floor(graphW / MIN_BAR_WIDTH);
        const totalBars = Math.ceil(data.length / base);
        const numBars = Math.min(totalBars, maxBars);
        const dataOffset = (totalBars - numBars) * base;
        this._dataOffset = dataOffset;
        const barWidth = graphW / numBars;

        let vMin = Infinity, vMax = -Infinity;
        for (let i = dataOffset; i < data.length; i++) {
            if (data[i].v === null) continue;
            if (data[i].v < vMin) vMin = data[i].v;
            if (data[i].v > vMax) vMax = data[i].v;
        }
        if (vMin === Infinity) {
            vMin = 0;
            vMax = 1;
        } else if (vMax <= vMin) {
            const v = vMin;
            if (v >= 0 && v <= 1) {
                const margin = 0.05;
                vMin = Math.max(0, v - margin);
                vMax = Math.min(1, v + margin);
                if (vMax <= vMin) vMax = vMin + margin;
            } else {
                vMin -= 1;
                vMax += 1;
            }
        }
        this._vMin = vMin;
        this._vMax = vMax;
        const vRange = vMax - vMin;

        for (let b = 0; b < numBars; b++) {
            const iStart = dataOffset + b * base;
            const iEnd = Math.min(iStart + base, data.length);
            let sum = 0;
            let count = 0;
            for (let i = iStart; i < iEnd; i++) {
                if (data[i].v !== null) {
                    sum += data[i].v;
                    count++;
                }
            }
            if (count === 0) continue;
            const avg = sum / count;
            const norm = (avg - vMin) / vRange;
            const barH = Math.max(1, Math.round(norm * graphH));
            const x = Math.round(b * barWidth);
            const w = Math.round((b + 1) * barWidth) - x;
            const bar = new St.Bin({
                width: w,
                height: barH,
                style_class: 'vitals-history-graph-bar'
            });
            bar.set_position(x, graphH - barH);
            this._barContainer.add_child(bar);
        }
    }

    getRawRange() {
        if (this._samples.length === 0) return null;
        return { min: this._vMin, max: this._vMax };
    }

    getTimeSpan() {
        const start = this._dataOffset;
        if (this._samples.length - start < 2) return 0;
        return this._samples[this._samples.length - 1].t - this._samples[start].t;
    }
});
