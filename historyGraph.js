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

const GRAPH_WIDTH = 204;
const GRAPH_HEIGHT = 90;
const PADDING = 4;
const MIN_BAR_WIDTH = 2;

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
        this._tSpan = 0;
        this.clip_to_allocation = true;
        this._barContainer = new St.Widget({
            x_expand: true,
            y_expand: true
        });
        this._barContainer.clip_to_allocation = true;
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

        const now = Date.now() / 1000;
        const tOldest = data[0].t;
        this._tSpan = now - tOldest;
        const tRange = Math.max(0.001, this._tSpan);

        const gaps = [];
        for (let i = 1; i < data.length; i++)
            gaps.push(data[i].t - data[i - 1].t);
        gaps.sort((a, b) => a - b);
        const medianGap = gaps.length > 0
            ? gaps[Math.floor(gaps.length / 2)]
            : tRange;
        const maxBarTime = medianGap * 2.5;

        const xPixels = data.map(d =>
            Math.round((d.t - tOldest) / tRange * graphW));

        for (let i = 0; i < data.length; i++) {
            const v = data[i].v;
            const norm = (v - vMin) / vRange;
            const barH = Math.max(1, Math.round(norm * graphH));
            const x = xPixels[i];
            const nextT = (i < data.length - 1) ? data[i + 1].t : now;
            const gap = nextT - data[i].t;
            let rightEdge;
            if (gap <= maxBarTime) {
                rightEdge = (i < data.length - 1) ? xPixels[i + 1] : graphW;
            } else {
                rightEdge = Math.min(graphW,
                    Math.round((data[i].t - tOldest + maxBarTime) / tRange * graphW));
            }
            const barW = Math.max(MIN_BAR_WIDTH, rightEdge - x);
            const y = graphH - barH;
            const bar = new St.Bin({
                width: Math.min(barW, graphW - x),
                height: barH,
                style_class: 'vitals-history-graph-bar'
            });
            bar.set_position(x, y);
            this._barContainer.add_child(bar);
        }
    }

    getRawRange() {
        if (this._samples.length === 0) return null;
        return { min: this._vMin, max: this._vMax };
    }

    getTimeSpan() {
        return this._tSpan;
    }
});
