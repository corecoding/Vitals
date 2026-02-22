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
        this._canvas = new Clutter.Canvas();
        this._canvas.set_size(GRAPH_WIDTH, GRAPH_HEIGHT);
        this._canvas.connect('draw', this._onDraw.bind(this));
        this.set_content(this._canvas);
    }

    setData(samples, label, unit) {
        this._samples = Array.isArray(samples) ? samples : [];
        this._label = label || '';
        this._unit = unit || '';
        this._canvas.invalidate();
    }

    _onDraw(canvas, cr, width, height) {
        cr.setOperator(1); // CAIRO_OPERATOR_CLEAR
        cr.paint();
        cr.setOperator(0); // CAIRO_OPERATOR_OVER

        const data = this._samples;
        if (data.length === 0) return true;

        const x0 = PADDING;
        const y0 = PADDING;
        const graphW = width - 2 * PADDING;
        const graphH = height - 2 * PADDING;
        if (graphW <= 0 || graphH <= 0) return true;

        const vals = data.map(d => d.v);
        let vMin = Math.min(...vals);
        let vMax = Math.max(...vals);
        if (vMax <= vMin) {
            vMin = vMin - 1;
            vMax = vMax + 1;
        }
        const vRange = vMax - vMin;
        const tMin = data[0].t;
        const tMax = data[data.length - 1].t;
        const tRange = Math.max(0.001, tMax - tMin);

        const barWidth = Math.max(1, (graphW - (data.length - 1) * BAR_GAP) / data.length - BAR_GAP);

        cr.setSourceRgba(0.2, 0.5, 0.9, 0.85);
        for (let i = 0; i < data.length; i++) {
            const v = data[i].v;
            const norm = (v - vMin) / vRange;
            const barH = Math.max(1, norm * graphH);
            const x = x0 + (data[i].t - tMin) / tRange * (graphW - barWidth);
            const y = y0 + graphH - barH;
            cr.rectangle(x, y, barWidth, barH);
        }
        cr.fill();

        return true;
    }
});
