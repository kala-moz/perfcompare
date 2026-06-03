import { useMemo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { Colors } from '../../styles/Colors';
import { bootstrapMedianDiffCI } from '../../utils/bootstrap-ci';
import { matchModes, splitByMode } from '../../utils/kde.js';
import type { KdeAnalysis, ModeInfo } from '../../utils/kdeAnalysis';

const OK_COLOR = Colors.IconLightSuccess; // green
const BAD_COLOR = Colors.IconLightError; // red
const MUTED = '#555';
const SUBTLE = '#888';

// Whichever way significance is decided in the widget — accept a CI as
// "significant" when it sits entirely on one side and isn't degenerate [0,0].
function isSignificant(ciLow: number, ciHigh: number): boolean {
  return (
    (ciHigh <= 0 && (ciLow < 0 || ciHigh < 0)) ||
    (ciLow >= 0 && (ciLow > 0 || ciHigh > 0))
  );
}

// "fast path" / "mid path" / "slow path" — the rank's role in the ordered
// modes (A = fastest). Returns null for single-mode (no label needed).
function pathLabel(letter: string, totalModes: number): string | null {
  const rank = letter.charCodeAt(0) - 65;
  if (totalModes <= 1) return null;
  if (rank === 0) return 'fast path';
  if (rank === totalModes - 1) return 'slow path';
  return 'mid path';
}

function fmtVal(v: number): string {
  const a = Math.abs(v);
  return a < 10 ? v.toFixed(2) : a < 100 ? v.toFixed(1) : v.toFixed(0);
}

type PairData = {
  baseIdx: number;
  newIdx: number;
  ci: { medianDiff: number; ciLow: number; ciHigh: number } | null;
  sig: boolean;
};

type ComputedBlurb = {
  pairData: PairData[];
  improvements: PairData[];
  regressions: PairData[];
  ub: number[];
  un: number[];
  baseModes: ModeInfo;
  newModes: ModeInfo;
};

function computeBlurb(
  baseValues: number[],
  newValues: number[],
  baseModes: ModeInfo,
  newModes: ModeInfo,
): ComputedBlurb | null {
  if (!baseModes.peakLocs.length || !newModes.peakLocs.length) return null;

  const isMultimodal =
    baseModes.peakLocs.length > 1 || newModes.peakLocs.length > 1;
  if (!isMultimodal) return null;

  const match = matchModes(
    baseModes.peakLocs,
    baseModes.fracs,
    newModes.peakLocs,
    newModes.fracs,
  );
  const baseSplits = splitByMode(baseValues, baseModes.boundaries);
  const newSplits = splitByMode(newValues, newModes.boundaries);

  const pairData: PairData[] = (match.pairs).map(
    ([baseIdx, newIdx]) => {
      const left = baseSplits[baseIdx] ?? [];
      const right = newSplits[newIdx] ?? [];
      const ci =
        left.length >= 2 && right.length >= 2
          ? bootstrapMedianDiffCI(left, right)
          : null;
      const sig = ci ? isSignificant(ci.ciLow, ci.ciHigh) : false;
      return { baseIdx, newIdx, ci, sig };
    },
  );

  const improvements = pairData.filter(
    (r) => r.sig && r.ci && r.ci.medianDiff < 0,
  );
  const regressions = pairData.filter(
    (r) => r.sig && r.ci && r.ci.medianDiff > 0,
  );

  return {
    pairData,
    improvements,
    regressions,
    ub: match.ub,
    un: match.un,
    baseModes,
    newModes,
  };
}

function verdict(
  blurb: ComputedBlurb,
): { text: string; color: string } {
  const { pairData, improvements, regressions, ub, un, baseModes, newModes } =
    blurb;
  const sigCount = pairData.filter((r) => r.sig).length;

  if (ub.length === 0 && un.length === 0 && sigCount === 0) {
    return { text: 'No reliable change in any mode', color: MUTED };
  }

  const newSlowPaths = un.filter(
    (ci) => ci === newModes.peakLocs.length - 1,
  ).length;
  const lostFastPaths = ub.filter(
    (bi) => bi === 0 && baseModes.peakLocs.length > 1,
  ).length;
  const elimSlowPaths = ub.filter(
    (bi) => bi === baseModes.peakLocs.length - 1,
  ).length;

  if (
    regressions.length === 0 &&
    newSlowPaths === 0 &&
    lostFastPaths === 0 &&
    (improvements.length > 0 || elimSlowPaths > 0)
  ) {
    return { text: '▼ Overall faster', color: OK_COLOR };
  }
  if (
    improvements.length === 0 &&
    elimSlowPaths === 0 &&
    (regressions.length > 0 || newSlowPaths > 0 || lostFastPaths > 0)
  ) {
    return { text: '▲ Overall slower', color: BAD_COLOR };
  }
  return { text: '⚠ Mixed results', color: '#a60' };
}

type CiLineProps = {
  ci: { medianDiff: number; ciLow: number; ciHigh: number } | null;
  sig: boolean;
  baseLoc: number;
  unit: string;
};

function CiLine({ ci, sig, baseLoc, unit }: CiLineProps) {
  if (!ci) {
    return <Box sx={{ color: SUBTLE }}>no CI available</Box>;
  }
  const color = sig ? (ci.medianDiff < 0 ? OK_COLOR : BAD_COLOR) : MUTED;
  const arrow = sig
    ? ci.medianDiff < 0
      ? '▼ faster'
      : '▲ slower'
    : 'no reliable change';
  const pct = baseLoc > 0 ? (ci.medianDiff / baseLoc) * 100 : 0;
  const sign = (n: number) => (n >= 0 ? '+' : '');
  return (
    <Box>
      <Box component='span' sx={{ color, fontWeight: sig ? 'bold' : 'normal' }}>
        {arrow}
      </Box>
      {'  '}
      {sign(ci.medianDiff)}
      {fmtVal(ci.medianDiff)} {unit}
      {sig && baseLoc > 0 ? (
        <Box component='span' sx={{ color }}>
          {' '}
          ({sign(pct)}
          {pct.toFixed(1)}%)
        </Box>
      ) : null}
      <Box component='span' sx={{ color: SUBTLE }}>
        {'  '}95% CI [{sign(ci.ciLow)}
        {fmtVal(ci.ciLow)}, {sign(ci.ciHigh)}
        {fmtVal(ci.ciHigh)}]
      </Box>
    </Box>
  );
}

type KdeModesPanelProps = {
  baseValues: number[];
  newValues: number[];
  unit: string | null;
  analysis: KdeAnalysis;
};

function KdeModesPanel({
  baseValues,
  newValues,
  unit,
  analysis,
}: KdeModesPanelProps) {
  const blurb = useMemo(
    () =>
      computeBlurb(baseValues, newValues, analysis.baseModes, analysis.newModes),
    [baseValues, newValues, analysis],
  );

  if (!blurb) return null;

  const { pairData, ub, un, baseModes, newModes } = blurb;
  const v = verdict(blurb);
  const unitLabel = unit ?? 'samples/iter';
  const baseCount = baseModes.peakLocs.length;
  const newCount = newModes.peakLocs.length;
  const modeStr =
    `${baseCount === 1 ? '1 mode' : `${baseCount} modes`} base · ` +
    `${newCount === 1 ? '1 mode' : `${newCount} modes`} new`;

  return (
    <Box
      aria-label='Mode-by-mode breakdown'
      sx={{
        backgroundColor: 'manWhitneyComps.background',
        padding: 1.5,
        borderRadius: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography
          variant='subtitle1'
          sx={{ color: v.color, fontWeight: 'bold' }}
        >
          {v.text}
        </Typography>
        <Typography variant='caption' sx={{ color: SUBTLE }}>
          {modeStr}
        </Typography>
      </Box>

      {pairData.map((r) => {
        const letter = baseModes.letters[r.baseIdx];
        const baseLoc = baseModes.peakLocs[r.baseIdx];
        const baseFrac = baseModes.fracs[r.baseIdx];
        const newFrac = newModes.fracs[r.newIdx];
        const fracDelta = newFrac - baseFrac;
        const path = pathLabel(letter, baseCount);
        const fracStr =
          Math.abs(fracDelta) >= 0.03
            ? `${Math.round(baseFrac * 100)}% → ${Math.round(newFrac * 100)}%`
            : `${Math.round(baseFrac * 100)}% of runs`;
        return (
          <Box key={`pair-${r.baseIdx}-${r.newIdx}`} sx={{ mt: 1 }}>
            <Box>
              <Box component='b'>Mode {letter}</Box>
              {path ? (
                <Box component='span' sx={{ color: '#666' }}>
                  {' '}
                  {path}
                </Box>
              ) : null}{' '}
              ~{fmtVal(baseLoc)} {unitLabel} {fracStr}
            </Box>
            <CiLine
              ci={r.ci}
              sig={r.sig}
              baseLoc={baseLoc}
              unit={unitLabel}
            />
          </Box>
        );
      })}

      {ub.map((bi) => {
        const letter = baseModes.letters[bi];
        const baseLoc = baseModes.peakLocs[bi];
        const frac = baseModes.fracs[bi];
        const path = pathLabel(letter, baseCount);
        // Where did those runs likely go? — nearest comp peak.
        const nearestNew = newModes.peakLocs.reduce((a, b) =>
          Math.abs(b - baseLoc) < Math.abs(a - baseLoc) ? b : a,
        );
        const improved = baseLoc > nearestNew;
        return (
          <Box key={`ub-${bi}`} sx={{ mt: 1 }}>
            <Box>
              <Box component='b'>Mode {letter}</Box>
              {path ? <span style={{ color: '#666' }}> {path}</span> : null}{' '}
              ~{fmtVal(baseLoc)} {unitLabel} {Math.round(frac * 100)}% of base
              runs
            </Box>
            <Box
              sx={{
                color: improved ? OK_COLOR : BAD_COLOR,
                fontWeight: 'bold',
              }}
            >
              {improved
                ? '✓ gone — these runs are now faster (merged into a quicker path)'
                : '⚠ gone — these runs are now slower (merged into a slower path)'}
            </Box>
          </Box>
        );
      })}

      {un.map((ci) => {
        const letter = newModes.letters[ci];
        const newLoc = newModes.peakLocs[ci];
        const frac = newModes.fracs[ci];
        const path = pathLabel(letter, newCount);
        // Where did those runs come from? — nearest base peak.
        const nearestBase = baseModes.peakLocs.reduce((a, b) =>
          Math.abs(b - newLoc) < Math.abs(a - newLoc) ? b : a,
        );
        const improved = newLoc < nearestBase;
        return (
          <Box key={`un-${ci}`} sx={{ mt: 1 }}>
            <Box>
              <Box component='b'>Mode {letter}</Box>
              {path ? <span style={{ color: '#666' }}> {path}</span> : null}{' '}
              ~{fmtVal(newLoc)} {unitLabel} {Math.round(frac * 100)}% of new
              runs
            </Box>
            <Box
              sx={{
                color: improved ? OK_COLOR : BAD_COLOR,
                fontWeight: 'bold',
              }}
            >
              {improved
                ? '✓ new path — these runs are now faster than before'
                : '⚠ new path — these runs are now slower than before'}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default KdeModesPanel;
