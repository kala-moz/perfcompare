import { useEffect, useMemo, useRef } from 'react';

import InfoIcon from '@mui/icons-material/InfoOutlined';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { init, type ECharts, type EChartsOption } from 'echarts';

import { Colors } from '../../styles/Colors';
import type { KdeAnalysis, ModeInfo } from '../../utils/kdeAnalysis';

const CHART_HEIGHT = 340;
const KDE_GRID = { left: 70, right: 70, top: 28, height: 155 };
const SCATTER_GRID = { left: 70, right: 70, top: 250, height: 50 };

// Valley-depth threshold bounds for the mode-detection slider.
const VT_MIN = 0.1;
const VT_MAX = 0.99;
const VT_STEP = 0.01;

// Tick labels show 2 dp for fractional values, drop ".00" for whole numbers.
// Floats near integers (e.g. 14 + 1e-15) collapse to "14".
function tickFormatter(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-9) return String(rounded);
  return value.toFixed(2);
}

// Stagger levels (0, 1, 2 …) for peak labels: peaks closer than ~13% of the
// x-span get bumped to different levels so their labels don't overlap. Ported
// from kde-widget.js's allPeaks.level pass; we use a fixed 13% threshold
// because the chart's pixel width isn't known inside useMemo.
type PeakRef = {
  loc: number;
  seriesIdx: number;
  peakIdx: number;
  level: number;
};

function assignStaggerLevels(peaks: PeakRef[], xSpan: number): void {
  peaks.sort((a, b) => a.loc - b.loc);
  const threshold = xSpan * 0.13;
  for (let idx = 0; idx < peaks.length; idx++) {
    const used = new Set<number>();
    for (let k = 0; k < idx; k++) {
      if (Math.abs(peaks[k].loc - peaks[idx].loc) < threshold) {
        used.add(peaks[k].level);
      }
    }
    let level = 0;
    while (used.has(level)) level++;
    peaks[idx].level = level;
  }
}

// Compute axis bounds (min/max with 5% padding) from raw runs.
function axisBounds(baseValues: number[], newValues: number[]) {
  const all = [...baseValues, ...newValues];
  if (!all.length) return { min: 0, max: 1 };
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return { min: lo * 0.95, max: hi * 1.05 };
}

function CommonGraph({
  baseValues,
  newValues,
  unit,
  analysis,
  vt,
  onVtChange,
}: CommonGraphProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<ECharts | null>(null);

  const option: EChartsOption = useMemo(() => {
    const { bKde, nKde, sharedX, baseY, newY, baseModes, newModes } = analysis;
    const { min, max } = axisBounds(baseValues, newValues);

    const baseRunsDensity: [number, number][] = bKde
      ? sharedX.map((xCoord, i) => [xCoord, baseY[i]])
      : [];
    const newRunsDensity: [number, number][] = nKde
      ? sharedX.map((xCoord, i) => [xCoord, newY[i]])
      : [];

    const unitSuffix = unit ? ` (${unit})` : '';

    const totalCount = baseValues.length + newValues.length;
    const symbolSize = totalCount < 20 ? 10 : 7;

    const JITTER = 0.6;
    const baseScatterData: [number, number][] = baseValues.map((v) => [
      v,
      (Math.random() - 0.5) * JITTER,
    ]);
    const newScatterData: [number, number][] = newValues.map((v) => [
      v,
      1 + (Math.random() - 0.5) * JITTER,
    ]);

    // Assign vertical stagger levels across all peaks so labels don't collide.
    const allPeaks: PeakRef[] = [];
    baseModes.peakLocs.forEach((loc, peakIdx) =>
      allPeaks.push({ loc, seriesIdx: 0, peakIdx, level: 0 }),
    );
    newModes.peakLocs.forEach((loc, peakIdx) =>
      allPeaks.push({ loc, seriesIdx: 1, peakIdx, level: 0 }),
    );
    const xSpan = max - min;
    if (xSpan > 0) assignStaggerLevels(allPeaks, xSpan);
    const levelLookup = new Map<string, number>();
    for (const p of allPeaks) {
      levelLookup.set(`${p.seriesIdx}-${p.peakIdx}`, p.level);
    }

    // Build the per-peak markLine overlays. Each is a dataless line series so
    // the markLine renders on its own. Names start with "_mode-" so the tooltip
    // and legend can filter them out.
    const modeOverlays: EChartsOption['series'] = [];
    function pushOverlays(
      seriesIdx: 0 | 1,
      seriesName: 'Base' | 'New',
      modes: ModeInfo,
      color: string,
    ) {
      modes.peakLocs.forEach((loc, peakIdx) => {
        const level = levelLookup.get(`${seriesIdx}-${peakIdx}`) ?? 0;
        (modeOverlays as unknown[]).push({
          name: `_mode-${seriesIdx}-${peakIdx}`,
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: [],
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ xAxis: loc }],
            lineStyle: { color, type: 'solid', width: 1.5 },
            label: {
              formatter:
                `${seriesName} ${modes.letters[peakIdx]}: ` +
                `${tickFormatter(loc)} (${Math.round(modes.fracs[peakIdx] * 100)}%)`,
              distance: [0, level * 16],
              color,
              fontSize: 12,
            },
          },
        });
      });
    }
    pushOverlays(0, 'Base', baseModes, Colors.ChartBase);
    pushOverlays(1, 'New', newModes, Colors.ChartNew);

    return {
      animation: false,
      grid: [KDE_GRID, SCATTER_GRID],
      // axisPointer link keeps the vertical crosshair in sync across both grids.
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [
        {
          gridIndex: 0,
          type: 'value',
          min,
          max,
          name: unit ?? '',
          nameLocation: 'middle',
          nameGap: 30,
          nameTextStyle: { fontSize: 13, fontWeight: 'bold', color: '#000' },
          // Tick labels show 2 dp for fractional values, drop ".00" for whole
          // numbers. Floats near integers (e.g. 14 + 1e-15) collapse to "14".
          axisLabel: { formatter: tickFormatter },
          splitLine: { show: true, lineStyle: { color: '#eee' } },
          axisLine: { show: true, lineStyle: { color: '#999' } },
        },
        {
          gridIndex: 1,
          type: 'value',
          min,
          max,
          axisLabel: { show: false },
          splitLine: { show: false },
          axisLine: { show: true, lineStyle: { color: '#999' } },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          gridIndex: 0,
          type: 'value',
          min: 0,
          splitLine: { show: true, lineStyle: { color: '#eee' } },
          axisLine: { show: true, lineStyle: { color: '#999' } },
          axisTick: { show: false },
          axisLabel: { show: true, color: '#000', fontSize: 12 },
        },
        {
          gridIndex: 1,
          type: 'value',
          min: -0.5,
          max: 1.5,
          interval: 1,
          axisTick: { show: false },
          axisLine: { show: true, lineStyle: { color: '#999' } },
          axisLabel: {
            color: '#000',
            fontSize: 12,
            formatter: (v: number) => (v === 0 ? 'Base' : v === 1 ? 'New' : ''),
          },
          splitLine: { show: false },
        },
      ],
      // Wheel to zoom on the x-axis; shift+drag pans.
      // filterMode: 'none' keeps every data point in place — the zoom only
      // changes the visible window, so KDE curves still extend to the edges.
      // xAxisIndex: [0, 1] keeps both grids in sync.
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseMove: 'shift',
          moveOnMouseWheel: false,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          filterMode: 'none',
          height: 16,
          bottom: 4,
          showDetail: false,
          brushSelect: false,
        },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', snap: true, lineStyle: { color: '#999' } },
        padding: 10,
        formatter: (params) => {
          const items = Array.isArray(params) ? params : [params];
          if (items.length === 0) return '';
          // Scatter tooltip: show raw run values
          if ((items[0] as { seriesType?: string }).seriesType === 'scatter') {
            return items
              .map((pts) => {
                const marker = typeof pts.marker === 'string' ? pts.marker : '';
                const xVal = (pts.value as [number, number])[0];
                return `${marker}${pts.seriesName ?? ''}: ${xVal.toFixed(2)}${unitSuffix}`;
              })
              .join('<br>');
          }
          // KDE tooltip: show density at the cursor x
          const axisX =
            (items[0] as { axisValue?: number }).axisValue ??
            (items[0].value as [number, number])[0];
          const header = `Value: ${Number(axisX).toFixed(2)}${unitSuffix}`;
          const lines = items.map((pts) => {
            const marker = typeof pts.marker === 'string' ? pts.marker : '';
            const y = (pts.value as [number, number])[1];
            return `${marker}${pts.seriesName ?? ''}: ${y.toFixed(4)}`;
          });
          return [header, ...lines].join('<br>');
        },
      },
      toolbox: {
        feature: { restore: {}, saveAsImage: {} },
        right: 8,
        top: 4,
        itemSize: 12,
      },
      legend: {
        data: ['Base', 'New'],
        // Sit below the centered x-axis unit label, between the KDE grid and
        // the scatter strip, with a small gap above and below.
        top: 232,
        left: 'center',
        itemHeight: 10,
        itemWidth: 30,
      },
      series: [
        {
          name: 'Base',
          type: 'line',
          triggerLineEvent: true,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: baseRunsDensity,
          showSymbol: false,
          lineStyle: { width: 3, color: Colors.ChartBase },
          itemStyle: { color: Colors.ChartBase },
          emphasis: { focus: 'none' },
        },
        {
          name: 'New',
          type: 'line',
          triggerLineEvent: true,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: newRunsDensity,
          showSymbol: false,
          lineStyle: { width: 3, color: Colors.ChartNew },
          itemStyle: { color: Colors.ChartNew },
          emphasis: { focus: 'none' },
        },
        {
          name: 'Base',
          type: 'scatter',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: baseScatterData,
          symbol: 'triangle',
          symbolSize,
          itemStyle: { color: Colors.ChartBase, opacity: 0.6 },
          emphasis: { focus: 'none' },
        },
        {
          name: 'New',
          type: 'scatter',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: newScatterData,
          symbol: 'triangle',
          symbolSize,
          itemStyle: { color: Colors.ChartNew, opacity: 0.6 },
          emphasis: { focus: 'none' },
        },
        ...((modeOverlays ?? []) as []),
      ],
    };
  }, [analysis, baseValues, newValues, unit]);

  useEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }
    const instance = init(chartContainerRef.current);
    chartInstanceRef.current = instance;

    const handleResize = () => instance.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      instance.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartInstanceRef.current?.setOption(option, true);
  }, [option]);

  return (
    <>
      <Typography id='retrigger-modal-title' component='h3' variant='h3'>
        Runs Density Distribution
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          mt: 1,
          mb: 0.5,
        }}
      >
        <Typography
          variant='body2'
          sx={{
            color: '#000',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Valley depth threshold
          <Tooltip
            placement='top'
            title='A valley between two peaks must be shallower than this fraction of the shorter peak to count as a mode boundary. Higher = more splits detected.'
          >
            <InfoIcon
              fontSize='small'
              sx={{ color: '#000', cursor: 'help', mx: 0.5 }}
            />
          </Tooltip>
          :
        </Typography>
        <Slider
          size='small'
          value={vt}
          min={VT_MIN}
          max={VT_MAX}
          step={VT_STEP}
          onChange={(_, value) => onVtChange(value)}
          aria-label='Valley depth threshold'
          sx={{ maxWidth: 240 }}
        />
        <Typography
          variant='body2'
          sx={{ color: '#555', minWidth: 36, textAlign: 'right' }}
        >
          {Math.round(vt * 100)}%
        </Typography>
      </Box>
      <Box sx={{ flex: 0 }}>
        <div
          ref={chartContainerRef}
          style={{ width: '100%', height: CHART_HEIGHT }}
        />
      </Box>
    </>
  );
}

interface CommonGraphProps {
  baseValues: number[];
  newValues: number[];
  unit: string | null;
  analysis: KdeAnalysis;
  vt: number;
  onVtChange: (value: number) => void;
}

export default CommonGraph;
