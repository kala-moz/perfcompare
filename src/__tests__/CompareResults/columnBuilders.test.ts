import { buildColumnsForVersion } from '../../utils/columnBuilders';
import { getTableLayoutConfig } from '../../utils/tableConfigs';

describe('columnBuilders', () => {
  describe('buildColumnsForVersion', () => {
    it('should build correct columns for Student-T main table', () => {
      const layoutConfig = getTableLayoutConfig('student-t', false);
      const columns = buildColumnsForVersion('student-t', layoutConfig);

      const keys = columns.map((c) => c.key);

      // Should have platform, base, comparisonSign, new, status, delta, confidence, runs, buttons, expand
      expect(keys).toEqual([
        'platform',
        'base',
        'comparisonSign',
        'new',
        'status',
        'delta',
        'confidence',
        'runs',
        'buttons',
        'expand',
      ]);

      // Check specific columns have correct properties
      const confidenceCol = columns.find((c) => c.key === 'confidence');
      expect(confidenceCol).toBeDefined();
      expect(confidenceCol?.name).toBe('Confidence');
      expect('filter' in confidenceCol!).toBe(true);
    });

    it('should build correct columns for Mann-Whitney main table', () => {
      const layoutConfig = getTableLayoutConfig('mann-whitney-u', false);
      const columns = buildColumnsForVersion('mann-whitney-u', layoutConfig);

      const keys = columns.map((c) => c.key);

      // Should have platform, base, comparisonSign, new, status, delta, significance, effects, runs, buttons, expand
      expect(keys).toEqual([
        'platform',
        'base',
        'comparisonSign',
        'new',
        'status',
        'delta',
        'significance',
        'effects',
        'runs',
        'buttons',
        'expand',
      ]);

      // Check specific columns
      const deltaCol = columns.find((c) => c.key === 'delta');
      expect(deltaCol).toBeDefined();
      expect(deltaCol?.name).toBe("Cliff's Delta");

      const significanceCol = columns.find((c) => c.key === 'significance');
      expect(significanceCol).toBeDefined();
      expect(significanceCol?.name).toBe('Significance');
      expect('filter' in significanceCol!).toBe(true);
    });

    it('should build correct columns for Student-T subtest table', () => {
      const layoutConfig = getTableLayoutConfig('student-t', true);
      const columns = buildColumnsForVersion('student-t', layoutConfig);

      const keys = columns.map((c) => c.key);
      expect(keys).toContain('subtests'); // Platform becomes subtests for subtest tables
      expect(keys).toContain('confidence');
    });

    it('should build correct columns for Mann-Whitney subtest table', () => {
      const layoutConfig = getTableLayoutConfig('mann-whitney-u', true);
      const columns = buildColumnsForVersion('mann-whitney-u', layoutConfig);

      const keys = columns.map((c) => c.key);
      expect(keys).toContain('subtests'); // Platform becomes subtests for subtest tables
      expect(keys).toContain('significance');
      expect(keys).toContain('effects');
    });
  });
});
