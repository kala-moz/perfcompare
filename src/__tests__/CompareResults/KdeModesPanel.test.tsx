import KdeModesPanel from '../../components/CompareResults/KdeModesPanel';
import { fftkde } from '../../utils/kde.js';
import { computeKdeAnalysis } from '../../utils/kdeAnalysis';
import { render, screen } from '../utils/test-utils';

// Build a synthetic KDE with the bumps in a known set of locations so we can
// drive the mode detector deterministically. fftkde is mocked in setupTests
// to return empty arrays by default; we override per test to inject the curve.
function gaussianCurve(
  grid: { lo: number; hi: number; n: number },
  bumps: Array<{ mu: number; sigma: number; weight: number }>,
) {
  const { lo, hi, n } = grid;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const xi = lo + ((hi - lo) * i) / (n - 1);
    let yi = 0;
    for (const { mu, sigma, weight } of bumps) {
      yi +=
        (weight * Math.exp(-((xi - mu) ** 2) / (2 * sigma ** 2))) /
        (sigma * Math.sqrt(2 * Math.PI));
    }
    x[i] = xi;
    y[i] = yi;
  }
  return { x, y, bandwidth: 1 };
}

function mockKdePerSeries(baseCurve: ReturnType<typeof gaussianCurve>, newCurve: ReturnType<typeof gaussianCurve>) {
  // `safeKde` is called once per series with isSubtest=false → SJ-derived bw.
  // The mock ignores the bandwidth argument and returns the canned curve.
  (fftkde as jest.Mock)
    .mockImplementationOnce(() => baseCurve)
    .mockImplementationOnce(() => newCurve);
}

describe('KdeModesPanel', () => {
  it('renders nothing when neither side is multimodal', () => {
    // Both sides unimodal — the panel defers to the existing Δ-median alert.
    const curve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [{ mu: 50, sigma: 5, weight: 1 }],
    );
    mockKdePerSeries(curve, curve);
    const baseValues = [48, 50, 51, 49, 50];
    const newValues = [49, 51, 50, 50, 49];
    const analysis = computeKdeAnalysis(baseValues, newValues, 0.5, false);

    const { container } = render(
      <KdeModesPanel
        baseValues={baseValues}
        newValues={newValues}
        unit='ms'
        analysis={analysis}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a verdict and one row per matched mode when multimodal', () => {
    // Base bimodal at ~20 / ~80, new bimodal at the same locations — both
    // pairs match, no unmatched modes.
    const baseCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [
        { mu: 20, sigma: 3, weight: 1 },
        { mu: 80, sigma: 3, weight: 1 },
      ],
    );
    const newCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [
        { mu: 20, sigma: 3, weight: 1 },
        { mu: 80, sigma: 3, weight: 1 },
      ],
    );
    mockKdePerSeries(baseCurve, newCurve);
    const baseValues = [18, 19, 20, 21, 22, 78, 79, 80, 81, 82];
    const newValues = [18, 19, 20, 21, 22, 78, 79, 80, 81, 82];
    const analysis = computeKdeAnalysis(baseValues, newValues, 0.5, false);

    render(
      <KdeModesPanel
        baseValues={baseValues}
        newValues={newValues}
        unit='ms'
        analysis={analysis}
      />,
    );

    // Verdict shows mode counts.
    expect(screen.getByText(/2 modes base · 2 modes new/)).toBeInTheDocument();
    // Per-mode rows include the path labels (A=fast, B=slow with 2 modes).
    expect(screen.getByText('Mode A')).toBeInTheDocument();
    expect(screen.getByText('Mode B')).toBeInTheDocument();
    expect(screen.getAllByText(/fast path/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/slow path/).length).toBeGreaterThan(0);
  });

  it("flags an unmatched new mode as a new path", () => {
    // Base unimodal at ~20, new bimodal at ~20 + ~80 — the second new mode
    // has no base counterpart, so it shows up in the "new path" row.
    const baseCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [{ mu: 20, sigma: 3, weight: 1 }],
    );
    const newCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [
        { mu: 20, sigma: 3, weight: 1 },
        { mu: 80, sigma: 3, weight: 1 },
      ],
    );
    mockKdePerSeries(baseCurve, newCurve);
    const baseValues = [18, 19, 20, 21, 22, 18, 19, 20, 21, 22];
    const newValues = [18, 19, 20, 21, 22, 78, 79, 80, 81, 82];
    const analysis = computeKdeAnalysis(baseValues, newValues, 0.5, false);

    render(
      <KdeModesPanel
        baseValues={baseValues}
        newValues={newValues}
        unit='ms'
        analysis={analysis}
      />,
    );

    expect(screen.getByText(/new path — these runs/)).toBeInTheDocument();
  });

  it("flags an unmatched base mode as gone", () => {
    // Base bimodal, new unimodal at the lower mode — the higher base mode
    // is "gone" (merged into the faster path).
    const baseCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [
        { mu: 20, sigma: 3, weight: 1 },
        { mu: 80, sigma: 3, weight: 1 },
      ],
    );
    const newCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [{ mu: 20, sigma: 3, weight: 1 }],
    );
    mockKdePerSeries(baseCurve, newCurve);
    const baseValues = [18, 19, 20, 21, 22, 78, 79, 80, 81, 82];
    const newValues = [18, 19, 20, 21, 22, 18, 19, 20, 21, 22];
    const analysis = computeKdeAnalysis(baseValues, newValues, 0.5, false);

    render(
      <KdeModesPanel
        baseValues={baseValues}
        newValues={newValues}
        unit='ms'
        analysis={analysis}
      />,
    );

    expect(screen.getByText(/gone — these runs/)).toBeInTheDocument();
  });

  it('falls back to "samples/iter" when unit is null', () => {
    const baseCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [
        { mu: 20, sigma: 3, weight: 1 },
        { mu: 80, sigma: 3, weight: 1 },
      ],
    );
    const newCurve = gaussianCurve(
      { lo: 0, hi: 100, n: 1024 },
      [
        { mu: 20, sigma: 3, weight: 1 },
        { mu: 80, sigma: 3, weight: 1 },
      ],
    );
    mockKdePerSeries(baseCurve, newCurve);
    const baseValues = [18, 19, 20, 21, 22, 78, 79, 80, 81, 82];
    const newValues = [18, 19, 20, 21, 22, 78, 79, 80, 81, 82];
    const analysis = computeKdeAnalysis(baseValues, newValues, 0.5, false);

    render(
      <KdeModesPanel
        baseValues={baseValues}
        newValues={newValues}
        unit={null}
        analysis={analysis}
      />,
    );

    // At least one per-mode row should mention "samples/iter".
    expect(screen.getAllByText(/samples\/iter/).length).toBeGreaterThan(0);
  });
});
