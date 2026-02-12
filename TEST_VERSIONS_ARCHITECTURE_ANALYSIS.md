# Test Versions Architecture Analysis & Refactoring Proposal

## Current State Analysis

### How Test Versions Are Currently Added

The project currently supports two statistical test versions:

- `student-t` (default)
- `mann-whitney-u`

#### 1. **Type Definition** (`src/types/types.ts`)

```typescript
export type TestVersion = 'student-t' | 'mann-whitney-u';
```

**Problem:** A string union type that's not extensible without modifying the type definition.

#### 2. **Constants** (`src/common/constants.ts`)

```typescript
export const MANN_WHITNEY_U = 'mann-whitney-u' as TestVersion;
export const STUDENT_T = 'student-t' as TestVersion;
```

**Problem:** Each new test version requires a manual constant declaration.

#### 3. **UI Dropdown** (`src/components/Shared/TestVersionDropdown.tsx`)

```typescript
const TEST_VERSIONS = [
  { type: 'mann-whitney-u', label: 'Mann-Whitney-U' },
  { type: 'student-t', label: 'Student-T' },
];
```

**Problem:** Hard-coded array; adding a new version requires modifying the dropdown.

#### 4. **Table Column Configuration** (`src/utils/rowTemplateColumns.ts`)

- Two separate column configurations: `columnsConfiguration` and `columnsMannWhitneyConfiguration`
- Hard-coded conditional: `if (testVersion === MANN_WHITNEY_U) { return columnsMannWhitneyConfiguration; }`

**Problem:** Each new test version requires duplicate column definitions and manual branching logic.

#### 5. **Rendering Logic** (`src/components/CompareResults/RevisionRow.tsx`)

```typescript
const renderDifferingTestVersionColumns = (
  testVersion: TestVersion,
  result: CombinedResultsItemType,
) => {
  if (testVersion === MANN_WHITNEY_U) {
    // Mann-Whitney specific rendering
  } else {
    // Student-T rendering
  }
};
```

**Problem:** Monolithic conditional logic that grows with each new test version.

#### 6. **Components**

Multiple components check for specific test versions:

- `StatisticsWarnings.tsx`: Only shows warnings for Mann-Whitney
- `ModeInterpretation.tsx`: Only renders for Mann-Whitney
- `MannWhitneyCompareMetrics.tsx`: Only renders for Mann-Whitney
- `RevisionRowExpandable.tsx`: Conditional rendering based on test version

**Problem:** Each component that needs version-specific behavior requires explicit checks.

---

## Architectural Problems (Scaling Issues)

### 1. **Scattered Configuration**

Test version metadata is spread across:

- Type definitions
- Constants
- UI components
- Column configurations
- Rendering functions
- Special-case components

Adding a new test version requires changes in **at least 6+ places**.

### 2. **Type Safety Issues**

The string union type doesn't capture the semantic meaning or properties of each test version. Adding a new type requires changing the type definition.

### 3. **Duplicate Column Definitions**

Column configurations are hard-coded and duplicated. This violates DRY principles and makes maintenance harder.

### 4. **Monolithic Conditionals**

Rendering logic contains explicit `if (testVersion === X)` checks scattered throughout the codebase. This creates tight coupling and makes it hard to add new versions without understanding the entire codebase.

### 5. **Component Explosion**

Special-case components like `MannWhitneyCompareMetrics.tsx` are test-version-specific. With each new version, you might need new special-case components.

### 6. **Hard to Test**

Testing a new test version requires updating test fixtures, mock data, and assertions in many places.

---

## Addressing the Column Configuration Union Type Scalability

### Problem

The current interface returns a union type:

```typescript
getColumnConfiguration(isSubtestTable: boolean): CompareResultsTableConfig | CompareMannWhitneyResultsTableConfig;
```

This doesn't scale—each new test version adds another type to the union. With 5+ test versions, this becomes unmaintainable.

### Solution Options

#### **Option 1: Base Configuration Interface (Recommended)**

Create a common base interface that all column configurations extend. Currently, both table configs are arrays of column objects that share `BasicColumn` as their foundation:

```typescript
// src/types/types.ts

/**
 * Base interface for all table column configurations
 * All column types extend BasicColumn with optional filtering/sorting capabilities
 */
export interface BasicColumn {
  name?: string;
  key: string;
  gridWidth: string;
  tooltip?: string;
}

/**
 * Base configuration shared across all test versions
 * Represents an array of columns with common properties
 */
export type BaseCompareResultsTableConfig = BasicColumn[];

/**
 * Student-T test version columns
 * May include filterable and sortable columns specific to Student-T metrics
 */
export type CompareResultsTableConfig =
  | BasicColumn
  | FilterableColumn
  | SortableColumn
  | FilterableAndSortableColumn[];

/**
 * Mann-Whitney U test version columns
 * May include filterable and sortable columns specific to Mann-Whitney metrics
 * Uses different filter/sort functions tailored to Mann-Whitney results
 */
export type CompareMannWhitneyResultsTableConfig =
  | BasicColumn
  | FilterableMannWhitneyColumn
  | SortableMannWhitneyColumn
  | FilterableAndSortableMannWhitneyColumn[];
```

Update the strategy interface:

```typescript
export interface TestVersionStrategy {
  metadata: TestVersionMetadata;

  // Return the base type instead of union
  getColumnConfiguration(
    isSubtestTable: boolean,
  ): BaseCompareResultsTableConfig;

  // ... rest of methods
}
```

**Advantages:**

- ✅ No union type explosion
- ✅ Type-safe for common properties
- ✅ Components can safely access base properties
- ✅ Type-cast only when version-specific properties needed
- ✅ Scales linearly with new versions (no union growth)

**Disadvantages:**

- Requires careful management of what goes in the base interface

---

### Recommendation

**Use Option 1 (Base Configuration Interface)** because:

- Clean separation between common and version-specific properties
- Type-safe for base properties used by most components
- No unnecessary complexity (no generics required)
- Scales linearly—no union type explosion
- Matches the pattern used for other strategy methods (`getWarnings()`, `getMetricsPanel()`, etc.)
- Easy to understand and maintain

The strategies can return their specific types (which extend the base), and components that need version-specific properties can safely type-cast when needed.

### Type Safety at Runtime: How Column Filtering/Sorting Works

A critical consideration: `getColumnConfiguration()` returns `BaseCompareResultsTableConfig` (which is `BasicColumn[]`), but the actual columns may have version-specific filter/sort functions with different signatures:

- **Student-T columns:** May contain `FilterableColumn` with `matchesFunction(result: CompareResultsItem, value: string)`
- **Mann-Whitney columns:** May contain `FilterableMannWhitneyColumn` with `matchesFunction(result: MannWhitneyResultsItem, value: string)`

**How this works in practice:**

Components always know which test version they're rendering, so they have the context to safely use version-specific column types:

```typescript
// In a component
function ResultsTable({ testVersion, results }: Props) {
  const strategy = getTestVersionStrategy(testVersion);
  const columns = strategy.getColumnConfiguration(isSubtestTable);

  // Component knows the test version, so it knows what result type to expect
  const handleSort = (column: BasicColumn) => {
    if ('sortFunction' in column) {
      // Safe to call sort with results of the correct type
      // because this component only receives results for its test version
      results.sort((a, b) =>
        (column as SortableColumn).sortFunction(
          a as CompareResultsItem, // Correctly typed for this version
          b as CompareResultsItem,
        ),
      );
    }
  };
}
```

**Key principle:** The base type `BaseCompareResultsTableConfig` eliminates the union type explosion, while components remain type-safe because they:

1. Already know their test version
2. Receive results pre-filtered for that version
3. Can safely type-cast columns when accessing version-specific functions

This is a form of **type narrowing by context**: the test version serves as the discriminator.

---

## Recommended Refactoring: Strategy Registry Pattern

### Overview

Use a **Strategy Registry** pattern to encapsulate all test-version-specific behavior in a single, declarative configuration object. This follows SOLID principles:

- **Single Responsibility:** Each test version strategy owns its own behavior
- **Open/Closed:** New test versions don't require modifying existing code
- **Dependency Inversion:** Components depend on abstractions, not concrete implementations

### Implementation Approach

#### Step 1: Create Test Version Strategy Registry

**New File:** `src/common/testVersionStrategies.ts`

```typescript
import type {
  BaseCompareResultsTableConfig,
  TestVersion,
} from '../types/types';
import type { CombinedResultsItemType } from '../types/state';

/**
 * Metadata about a test version strategy
 */
export interface TestVersionMetadata {
  id: TestVersion;
  label: string; // Display label for UI
  description: string; // User-friendly description
  isDefault: boolean;
}

/**
 * Complete strategy for a statistical test version
 */
export interface TestVersionStrategy {
  metadata: TestVersionMetadata;

  // Table configuration - returns base type to avoid union explosion
  getColumnConfiguration(
    isSubtestTable: boolean,
  ): BaseCompareResultsTableConfig;

  // Rendering
  renderColumns(result: CombinedResultsItemType): React.ReactNode;

  // Warnings
  getWarnings(result: CombinedResultsItemType): string[];

  // Metrics/interpretation
  getModeInterpretation(
    result: CombinedResultsItemType,
  ): React.ReactNode | null;
  getMetricsPanel(result: CombinedResultsItemType): React.ReactNode | null;
}

/**
 * Registry of all available test version strategies
 */
export const TestVersionRegistry = new Map<TestVersion, TestVersionStrategy>();

/**
 * Get a test version strategy by ID
 */
export function getTestVersionStrategy(
  testVersion: TestVersion,
): TestVersionStrategy {
  const strategy = TestVersionRegistry.get(testVersion);
  if (!strategy) {
    throw new Error(`Unknown test version: ${testVersion}`);
  }
  return strategy;
}

/**
 * Get all available test versions for dropdown/selection
 */
export function getAvailableTestVersions(): TestVersionMetadata[] {
  return Array.from(TestVersionRegistry.values()).map((s) => s.metadata);
}

/**
 * Get the default test version
 */
export function getDefaultTestVersion(): TestVersion {
  for (const [id, strategy] of TestVersionRegistry) {
    if (strategy.metadata.isDefault) {
      return id;
    }
  }
  throw new Error('No default test version found');
}
```

#### Step 2: Implement Concrete Strategies

**New File:** `src/common/testVersions/studentTStrategy.ts`

```typescript
import type { TestVersionStrategy } from '../testVersionStrategies';
import type { CombinedResultsItemType } from '../../types/state';
import { columnStudentTConfiguration } from '../../utils/studentTColumnConfig';

export const studentTStrategy: TestVersionStrategy = {
  metadata: {
    id: 'student-t',
    label: 'Student-T',
    description: 'Student\'s t-test for normally distributed data',
    isDefault: true,
  },

  getColumnConfiguration(isSubtestTable: boolean) {
    return columnStudentTConfiguration(isSubtestTable);
  },

  renderColumns(result: CombinedResultsItemType) {
    const {
      is_improvement: improvement,
      is_regression: regression,
      confidence,
      confidence_text,
      delta_percentage,
    } = result as any; // Cast to CompareResultsItem

    return (
      <>
        <div className='status cell' role='cell'>
          {/* Student-T specific status rendering */}
        </div>
        <div className='delta cell' role='cell'>
          {delta_percentage}
        </div>
        <div className='confidence cell' role='cell'>
          {confidence_text || '-'}
        </div>
      </>
    );
  },

  getWarnings(result: CombinedResultsItemType): string[] {
    // Student-T doesn't have statistical warnings
    return [];
  },

  getModeInterpretation(result: CombinedResultsItemType) {
    // Student-T doesn't use mode interpretation
    return null;
  },

  getMetricsPanel(result: CombinedResultsItemType) {
    // Student-T doesn't have a special metrics panel
    return null;
  },
};
```

**New File:** `src/common/testVersions/mannWhitneyStrategy.ts`

```typescript
import type { TestVersionStrategy } from '../testVersionStrategies';
import type { CombinedResultsItemType, MannWhitneyResultsItem } from '../../types/state';
import { columnMannWhitneyConfiguration } from '../../utils/mannWhitneyColumnConfig';
import ModeInterpretation from '../../components/CompareResults/ModeInterpretation';
import MannWhitneyCompareMetrics from '../../components/CompareResults/MannWhitneyCompareMetrics';

export const mannWhitneyStrategy: TestVersionStrategy = {
  metadata: {
    id: 'mann-whitney-u',
    label: 'Mann-Whitney-U',
    description: 'Mann-Whitney U test for non-normally distributed data',
    isDefault: false,
  },

  getColumnConfiguration(isSubtestTable: boolean) {
    return columnMannWhitneyConfiguration(isSubtestTable);
  },

  renderColumns(result: CombinedResultsItemType) {
    const { cliffs_delta, direction_of_change, mann_whitney_test, cles } =
      result as MannWhitneyResultsItem;

    const clesValue = cles?.cles ? `${(cles?.cles * 100).toFixed(2)} %` : '-';

    return (
      <>
        <div className='status cell' role='cell'>
          {/* Mann-Whitney specific status rendering */}
        </div>
        <div className='delta cell' role='cell'>
          {cliffs_delta || '-'}
        </div>
        <div className='significance cell' role='cell'>
          {mann_whitney_test?.interpretation ?
            mann_whitney_test.interpretation.charAt(0).toUpperCase() +
            mann_whitney_test.interpretation.slice(1) : '-'}
        </div>
        <div className='effects cell' role='cell'>
          {clesValue}
        </div>
      </>
    );
  },

  getWarnings(result: CombinedResultsItemType): string[] {
    const mwResult = result as MannWhitneyResultsItem;
    return [
      ...(mwResult?.shapiro_wilk_warnings ?? []),
      ...(mwResult?.silverman_warnings ?? []),
      ...(mwResult?.ks_warning ? [mwResult.ks_warning] : []),
      ...(mwResult?.kde_warnings ?? []),
    ];
  },

  getModeInterpretation(result: CombinedResultsItemType) {
    return <ModeInterpretation result={result} testVersion='mann-whitney-u' />;
  },

  getMetricsPanel(result: CombinedResultsItemType) {
    return <MannWhitneyCompareMetrics result={result} testVersion='mann-whitney-u' />;
  },
};
```

#### Understanding Type Covariance in Concrete Strategies

A key design detail: while the `TestVersionStrategy` interface declares `getColumnConfiguration()` returns `BaseCompareResultsTableConfig`, the concrete implementations return more specific types:

- **Student-T strategy** returns: `CompareResultsTableConfig` (which is `BasicColumn | FilterableColumn | SortableColumn | FilterableAndSortableColumn[]`)
- **Mann-Whitney strategy** returns: `CompareMannWhitneyResultsTableConfig` (which is `BasicColumn | FilterableMannWhitneyColumn | SortableMannWhitneyColumn | FilterableAndSortableMannWhitneyColumn[]`)

This is **type-safe covariance** — each concrete implementation can return a more specific type than the interface declares, because those specific types are assignable to the base type. This pattern provides:

- ✅ **Interface simplicity** — The interface stays version-agnostic
- ✅ **Implementation specificity** — Each strategy returns its actual column type
- ✅ **Type safety** — The returned types are compatible with the declared return type
- ✅ **No runtime overhead** — The type narrowing is purely compile-time

```typescript
// This is type-safe because CompareResultsTableConfig extends BaseCompareResultsTableConfig
const studentTConfig: BaseCompareResultsTableConfig =
  columnStudentTConfiguration(false);

// And the same for Mann-Whitney
const mannWhitneyConfig: BaseCompareResultsTableConfig =
  columnMannWhitneyConfiguration(false);
```

#### Step 3: Initialize Registry

**New File:** `src/common/testVersions/index.ts`

```typescript
import { TestVersionRegistry } from '../testVersionStrategies';
import { studentTStrategy } from './studentTStrategy';
import { mannWhitneyStrategy } from './mannWhitneyStrategy';

/**
 * Initialize test version strategies
 * This runs once on application startup
 */
export function initializeTestVersionStrategies() {
  TestVersionRegistry.set('student-t', studentTStrategy);
  TestVersionRegistry.set('mann-whitney-u', mannWhitneyStrategy);
}

export * from '../testVersionStrategies';
```

#### Step 4: Update Constants

**Modified:** `src/common/constants.ts`

```typescript
// Remove these:
// export const MANN_WHITNEY_U = 'mann-whitney-u' as TestVersion;
// export const STUDENT_T = 'student-t' as TestVersion;

// Add instead:
import {
  getDefaultTestVersion,
  getTestVersionStrategy,
} from './testVersionStrategies';

export const STUDENT_T = 'student-t' as const;
export const MANN_WHITNEY_U = 'mann-whitney-u' as const;

// Helper for components that need the default
export function getDefaultTestVersionId(): TestVersion {
  return getDefaultTestVersion();
}
```

#### Step 5: Update Dropdown

**Modified:** `src/components/Shared/TestVersionDropdown.tsx`

```typescript
import { getAvailableTestVersions } from '../../common/testVersionStrategies';

function TestVersionDropdown({
  testType,
  variant,
  size,
  onChange,
  mode,
}: TestVersionDropdownProps) {
  const testVersions = getAvailableTestVersions();

  return (
    <Select
      // ... other props
    >
      {testVersions.map(({ id, label }) => (
        <MenuItem value={id} key={id} className={`statistic-test-item`}>
          {label}
        </MenuItem>
      ))}
    </Select>
  );
}
```

#### Step 6: Update Column Configuration

**Modified:** `src/utils/rowTemplateColumns.ts`

```typescript
import { getTestVersionStrategy } from '../common/testVersionStrategies';

export const getColumnsConfiguration = (
  isSubtestTable: boolean,
  testVersion: TestVersion,
) => {
  const strategy = getTestVersionStrategy(testVersion);
  return strategy.getColumnConfiguration(isSubtestTable);
};
```

#### Step 7: Update Rendering

**Modified:** `src/components/CompareResults/RevisionRow.tsx`

```typescript
import { getTestVersionStrategy } from '../../common/testVersionStrategies';

export const renderDifferingTestVersionColumns = (
  testVersion: TestVersion,
  result: CombinedResultsItemType,
) => {
  const strategy = getTestVersionStrategy(testVersion);
  return strategy.renderColumns(result);
};
```

#### Step 8: Simplify Components

**Modified:** `src/components/CompareResults/RevisionRowExpandable.tsx`

```typescript
import { getTestVersionStrategy } from '../../common/testVersionStrategies';

export function RevisionRowExpandable({ result, testVersion }: Props) {
  const strategy = getTestVersionStrategy(testVersion);
  const warnings = strategy.getWarnings(result);
  const modeInterpretation = strategy.getModeInterpretation(result);
  const metricsPanel = strategy.getMetricsPanel(result);

  return (
    <div>
      {warnings.length > 0 && (
        <Box sx={warningStyles}>
          {warnings.map((warning) => (
            <span key={warning} className='warning-row'>
              <Warning sx={{ color: Colors.WarningIcon }} /> {warning}
            </span>
          ))}
        </Box>
      )}
      {modeInterpretation}
      {metricsPanel}
    </div>
  );
}
```

---

## Benefits of This Refactoring

### 1. **Easy to Add New Test Versions**

Adding a new test version (e.g., `welch-t`, `bootstrap`, `permutation-test`) requires:

1. Create a new strategy file: `src/common/testVersions/newTestStrategy.ts`
2. Register it in `src/common/testVersions/index.ts`
3. Done! No other files need modification.

### 2. **Follows SOLID Principles**

- **Single Responsibility:** Each strategy owns one test version
- **Open/Closed:** New strategies don't require modifying existing code
- **Liskov Substitution:** All strategies implement the same interface
- **Interface Segregation:** Components use only what they need via the strategy interface
- **Dependency Inversion:** Components depend on `TestVersionStrategy` interface, not concrete implementations

### 3. **Better Code Organization**

- Test version logic is centralized and organized
- Clear separation of concerns
- Easier to test (each strategy can be tested independently)

### 4. **Improved Maintainability**

- No scattered conditionals
- Clear contract for what each test version must provide
- Changes to one test version don't affect others

### 5. **Type Safety**

- The registry pattern maintains type safety
- IDEs can provide better autocomplete and refactoring support

### 6. **Testability**

- Mock strategies for testing
- Test each strategy independently
- No need to mock entire table configurations

---

## Migration Path

1. **Phase 1:** Create the strategy infrastructure without changing existing code
   - Add `testVersionStrategies.ts`
   - Add strategy implementations
   - Keep existing code working

2. **Phase 2:** Gradually migrate to use strategies
   - Update `TestVersionDropdown` to use `getAvailableTestVersions()`
   - Update `rowTemplateColumns.ts` to use `getTestVersionStrategy()`
   - Update rendering in `RevisionRow.tsx`

3. **Phase 3:** Clean up old code
   - Remove hard-coded constants
   - Consolidate column configurations
   - Remove conditional logic from components

---

## Example: Adding a Welch-T Test

Once the registry pattern is in place, adding Welch-T test would look like:

**New File:** `src/common/testVersions/welchTStrategy.ts`

```typescript
import type { TestVersionStrategy } from '../testVersionStrategies';

export const welchTStrategy: TestVersionStrategy = {
  metadata: {
    id: 'welch-t',
    label: 'Welch-T',
    description: "Welch's t-test for unequal variances",
    isDefault: false,
  },
  // ... implement interface methods
};
```

**Update:** `src/common/testVersions/index.ts`

```typescript
import { welchTStrategy } from './welchTStrategy';

export function initializeTestVersionStrategies() {
  TestVersionRegistry.set('student-t', studentTStrategy);
  TestVersionRegistry.set('mann-whitney-u', mannWhitneyStrategy);
  TestVersionRegistry.set('welch-t', welchTStrategy); // Just add this line!
}
```

Done! The new test version is available in the dropdown and all rendering logic automatically works with it.

---

## Considerations

### 1. **React Component Rendering in Strategy**

The strategy interface includes methods like `getModeInterpretation()` that return React nodes. This is acceptable because:

- Strategies are initialized at app startup (no performance concerns)
- The methods are only called when rendering (lazy evaluation)
- Alternative: Use a factory pattern to create components instead

### 2. **Type System Updates**

Update `src/types/types.ts` to use a constant type:

```typescript
import type { TestVersionMetadata } from '../common/testVersionStrategies';

export type TestVersion = TestVersionMetadata['id'];
```

This ensures `TestVersion` always stays in sync with registered strategies.

### 3. **Backward Compatibility**

During migration, keep `STUDENT_T` and `MANN_WHITNEY_U` constants as type-safe references. They can reference the strategy IDs directly.

---

## Risks & Mitigations

### Risk 1: React Component Imports Create Data/View Coupling

**The Problem:**

```typescript
// In strategy - data layer importing view layer
import ModeInterpretation from '../../components/CompareResults/ModeInterpretation';

getModeInterpretation(result): React.ReactNode | null {
  return <ModeInterpretation result={result} testVersion='mann-whitney-u' />;
}
```

**Why This is Risky:**

- ❌ Data/business logic tightly coupled to React rendering
- ❌ Can't test strategy logic without React setup
- ❌ Can't use strategies in non-React contexts (CLI, API, SSR)
- ❌ Circular dependency potential: components → strategies → components

**Mitigation:**
Use a **component factory pattern** instead of returning JSX directly:

```typescript
// Strategy returns metadata, not components
interface TestVersionStrategy {
  getModeInterpretationComponent: () => typeof ModeInterpretation;
  getModeInterpretationProps: (result: CombinedResultsItemType) => ComponentProps<typeof ModeInterpretation>;
}

// In component layer, call the factory
const ModeComponent = strategy.getModeInterpretationComponent();
const props = strategy.getModeInterpretationProps(result);
return <ModeComponent {...props} />;
```

Or use a **strategy callback pattern**:

```typescript
interface TestVersionStrategy {
  renderModeInterpretation?: (
    result: CombinedResultsItemType,
    ComponentLibrary: typeof components,
  ) => React.ReactNode;
}
```

---

### Risk 2: Runtime Registration Without Compile-Time Safety

**The Problem:**

```typescript
// Called at startup - if forgotten, app breaks at runtime
initializeTestVersionStrategies();

// No guarantee that registry is initialized before use
export function getTestVersionStrategy(testVersion: TestVersion) {
  const strategy = TestVersionRegistry.get(testVersion);
  if (!strategy) {
    throw new Error(`Unknown test version: ${testVersion}`); // Fails at call time
  }
  return strategy;
}
```

**Why This is Risky:**

- ❌ Silent failures if `initializeTestVersionStrategies()` isn't called
- ❌ Type union ≠ registered strategies at runtime (easy to add type without registering)
- ❌ Errors surface late in the execution, not at startup
- ❌ Difficult to debug which versions are actually registered

**Mitigation:**

**1. Fail-fast validation at startup:**

```typescript
export function initializeTestVersionStrategies() {
  const expectedVersions: TestVersion[] = ['student-t', 'mann-whitney-u'];

  TestVersionRegistry.set('student-t', studentTStrategy);
  TestVersionRegistry.set('mann-whitney-u', mannWhitneyStrategy);

  // Validate all expected versions are registered
  for (const version of expectedVersions) {
    if (!TestVersionRegistry.has(version)) {
      throw new Error(
        `Missing strategy for test version: ${version}. ` +
          `Registered versions: ${Array.from(TestVersionRegistry.keys()).join(', ')}`,
      );
    }
  }

  // Log available versions for debugging
  console.info(
    'Test version strategies initialized:',
    Array.from(TestVersionRegistry.keys()).join(', '),
  );
}
```

**2. Keep type union in sync with registry:**

```typescript
// testVersionStrategies.ts - single source of truth
const REGISTERED_VERSIONS = ['student-t', 'mann-whitney-u'] as const;

export type TestVersion = (typeof REGISTERED_VERSIONS)[number];

// In types.ts, derive the type
export type { TestVersion } from '../common/testVersionStrategies';
```

**3. Add a registration guard:**

```typescript
export function registerTestVersionStrategy(
  id: TestVersion,
  strategy: TestVersionStrategy,
) {
  if (TestVersionRegistry.has(id)) {
    throw new Error(`Test version strategy already registered: ${id}`);
  }
  TestVersionRegistry.set(id, strategy);
}
```

---

### Risk 3: Type Derivation Creates Reverse Dependency

**The Problem:**

```typescript
// src/types/types.ts now depends on testVersionStrategies
export type TestVersion = TestVersionMetadata['id'];
```

**Why This is Risky:**

- ❌ Types depend on runtime code (violates clean architecture)
- ❌ Circular dependency potential (types → strategy → types)
- ❌ Can't use types in type-only scenarios (declaration files, build-time code)
- ❌ Makes type definitions harder to understand

**Mitigation:**

Keep the type union **explicit and independent**:

```typescript
// src/types/types.ts - independent of runtime
export type TestVersion = 'student-t' | 'mann-whitney-u';

// src/common/testVersionStrategies.ts - validates against type
const REGISTERED_VERSIONS = [
  'student-t',
  'mann-whitney-u',
] as const satisfies TestVersion[];

export function initializeTestVersionStrategies() {
  // Compile-time check: ensure all registered versions match TestVersion type
  // If you add 'welch-t' to REGISTERED_VERSIONS but forget to update TestVersion,
  // TypeScript will error here
  const _: Record<(typeof REGISTERED_VERSIONS)[number], boolean> = {
    'student-t': true,
    'mann-whitney-u': true,
  };

  // Runtime registration
  TestVersionRegistry.set('student-t', studentTStrategy);
  TestVersionRegistry.set('mann-whitney-u', mannWhitneyStrategy);
}
```

---

### Risk 4: Covariance Complexity & Component Type Casting

**The Problem:**

```typescript
// Interface declares base type
getColumnConfiguration(): BaseCompareResultsTableConfig // just BasicColumn[]

// Components must cast to access version-specific properties
const handleSort = (column: BasicColumn) => {
  if ('sortFunction' in column) {
    (column as SortableColumn).sortFunction(a, b); // Type cast required
  }
};
```

**Why This is Risky:**

- ❌ Developers might cast incorrectly to wrong type (Student-T vs Mann-Whitney)
- ❌ No IDE autocomplete for version-specific properties
- ❌ Runtime errors if casting to wrong type
- ❌ Easy to introduce bugs during refactoring

**Mitigation:**

**1. Create type guards:**

```typescript
// Type guards for safe narrowing
function isFilterableColumn(
  column: BasicColumn,
  testVersion: TestVersion,
): column is FilterableColumn {
  return (
    testVersion === 'student-t' && 'filter' in column && column.filter === true
  );
}

function isFilterableMannWhitneyColumn(
  column: BasicColumn,
  testVersion: TestVersion,
): column is FilterableMannWhitneyColumn {
  return (
    testVersion === 'mann-whitney-u' &&
    'filter' in column &&
    column.filter === true
  );
}

// Safe usage:
if (isFilterableColumn(column, testVersion)) {
  column.matchesFunction(result as CompareResultsItem, value);
}
```

**2. Return discriminated union:**

```typescript
// Instead of returning BaseCompareResultsTableConfig
interface ColumnWithMeta extends BasicColumn {
  _testVersion: TestVersion;
}

// Now components know the version of each column
const handleSort = (column: ColumnWithMeta) => {
  if ('sortFunction' in column) {
    if (column._testVersion === 'student-t') {
      (column as SortableColumn).sortFunction(
        a as CompareResultsItem,
        b as CompareResultsItem,
      );
    } else {
      (column as SortableMannWhitneyColumn).sortFunction(
        a as MannWhitneyResultsItem,
        b as MannWhitneyResultsItem,
      );
    }
  }
};
```

---

### Risk 5: Phased Migration Complexity

**The Problem:**
During the 3-phase migration, the codebase exists in an inconsistent state:

- Some code uses new strategy pattern
- Some code uses old conditional checks
- Difficult to know which system a given component uses

**Why This is Risky:**

- ❌ Inconsistent patterns make code harder to understand
- ❌ Easy to miss converting a call site, causing runtime bugs
- ❌ Testing is complex (some tests use old pattern, some use new)
- ❌ Hard to roll back if issues arise mid-migration

**Mitigation:**

**1. Feature-flag the migration:**

```typescript
const USE_STRATEGY_REGISTRY =
  process.env.REACT_APP_USE_STRATEGY_REGISTRY === 'true';

export function getColumnsConfiguration(
  isSubtestTable: boolean,
  testVersion: TestVersion,
) {
  if (USE_STRATEGY_REGISTRY) {
    const strategy = getTestVersionStrategy(testVersion);
    return strategy.getColumnConfiguration(isSubtestTable);
  } else {
    // Old system
    return getColumnsConfigurationLegacy(isSubtestTable, testVersion);
  }
}
```

**2. Migrate by feature, not gradually:**
Instead of 3 phases across the whole app:

- Pick ONE feature component (e.g., `TestVersionDropdown`)
- Fully migrate it (all tests, all usages)
- Move to next feature
- Never have mixed old/new in same component

**3. Add linting rules:**

```javascript
// .eslintrc.js
rules: {
  'no-restricted-imports': [
    'error',
    {
      patterns: ['./rowTemplateColumnsLegacy'],
      message: 'Use strategy registry instead',
    },
  ],
}
```

---

### Risk 6: Column Configuration Functions Still Duplicated

**The Problem:**

```typescript
// Still have separate functions - logic duplication persists
columnStudentTConfiguration(isSubtestTable);
columnMannWhitneyConfiguration(isSubtestTable);
```

**Why This is Risky:**

- ❌ DRY principle still violated at lowest level
- ❌ If column structure changes, update multiple places
- ❌ Harder to refactor shared column logic
- ❌ Doesn't fully solve the scalability problem

**Mitigation:**

**1. Extract common column builder:**

```typescript
// utils/columnBuilders.ts
function buildBaseColumns(): BasicColumn[] {
  return [
    { key: 'suite', gridWidth: '150px', name: 'Suite' },
    { key: 'test', gridWidth: '200px', name: 'Test' },
  ];
}

function addStudentTColumns(columns: BasicColumn[]): CompareResultsTableConfig {
  return [
    ...columns,
    { key: 'confidence', gridWidth: '100px', name: 'Confidence' },
  ];
}

function addMannWhitneyColumns(columns: BasicColumn[]): CompareMannWhitneyResultsTableConfig {
  return [
    ...columns,
    { key: 'cles', gridWidth: '100px', name: 'CLES' },
  ];
}

// Strategy implementation
getColumnConfiguration(isSubtestTable: boolean) {
  const baseColumns = buildBaseColumns();
  return addStudentTColumns(baseColumns);
}
```

**2. Use composition over duplication:**

```typescript
type ColumnDefinition = {
  key: string;
  gridWidth: string;
  name?: string;
  studentT?: true;
  mannWhitney?: true;
};

const COLUMNS: Record<string, ColumnDefinition> = {
  suite: { key: 'suite', gridWidth: '150px', name: 'Suite' },
  test: { key: 'test', gridWidth: '200px', name: 'Test' },
  confidence: { key: 'confidence', gridWidth: '100px', studentT: true },
  cles: { key: 'cles', gridWidth: '100px', mannWhitney: true },
};

function buildColumns(testVersion: TestVersion): BasicColumn[] {
  return Object.values(COLUMNS).filter((col) =>
    testVersion === 'student-t' ? col.studentT : col.mannWhitney,
  );
}
```

---

### Risk 7: Testing Strategy Methods that Return Components

**The Problem:**

```typescript
// How do you unit test this?
getModeInterpretation(result): React.ReactNode | null {
  return <ModeInterpretation result={result} />;
}
```

**Why This is Risky:**

- ❌ Can't unit test strategy logic without React rendering setup
- ❌ Tests become slow (React render time)
- ❌ Tests become brittle (snapshot tests)
- ❌ Hard to test error conditions or edge cases in isolation

**Mitigation:**

**1. Separate logic from rendering:**

```typescript
// Logic layer
export interface TestVersionStrategyLogic {
  getModeInterpretationData(result: CombinedResultsItemType): ModeData | null;
}

export const studentTStrategyLogic: TestVersionStrategyLogic = {
  getModeInterpretationData(result) {
    // Pure logic, testable without React
    return null; // Student-T doesn't have mode interpretation
  },
};

// View layer (can be tested with React Testing Library if needed)
export const studentTStrategy: TestVersionStrategy = {
  getModeInterpretation(result) {
    const data = studentTStrategyLogic.getModeInterpretationData(result);
    return data ? <ModeInterpretation data={data} /> : null;
  },
};

// Test file - pure logic
describe('studentTStrategyLogic', () => {
  it('returns null for mode interpretation', () => {
    const result = { /* test data */ };
    expect(studentTStrategyLogic.getModeInterpretationData(result)).toBeNull();
  });
});
```

**2. Test at integration level:**

```typescript
// Test strategy + component integration separately
describe('StudentT ModeInterpretation Component', () => {
  it('renders null when strategy returns null', () => {
    const strategy = studentTStrategy;
    const result = render(strategy.getModeInterpretation(mockResult));
    expect(result.container).toBeEmptyDOMElement();
  });
});
```

---

### Risk 8: Future Extensibility Issues

**The Problem:**

```typescript
export interface TestVersionStrategy {
  metadata: TestVersionMetadata;
  getColumnConfiguration(): BaseCompareResultsTableConfig;
  renderColumns(): React.ReactNode;
  getWarnings(): string[];
  getModeInterpretation(): React.ReactNode | null;
  getMetricsPanel(): React.ReactNode | null;
  // When you add a new method here...
}

// ...ALL strategies must implement it immediately
```

**Why This is Risky:**

- ❌ Adding new methods breaks all existing strategies
- ❌ Forces backward-incompatible changes across codebase
- ❌ Can't gradually add features to only some versions
- ❌ Difficult to deprecate old methods

**Mitigation:**

**1. Use optional properties with defaults:**

```typescript
export interface TestVersionStrategy {
  metadata: TestVersionMetadata;
  getColumnConfiguration(
    isSubtestTable: boolean,
  ): BaseCompareResultsTableConfig;
  renderColumns(result: CombinedResultsItemType): React.ReactNode;
  getWarnings(result: CombinedResultsItemType): string[];

  // Optional - can be undefined or missing
  getModeInterpretation?: (
    result: CombinedResultsItemType,
  ) => React.ReactNode | null;
  getMetricsPanel?: (result: CombinedResultsItemType) => React.ReactNode | null;
  getCustomProperty?: (result: CombinedResultsItemType) => any;
}

// Default factory
export function createDefaultStrategy(
  base: Omit<TestVersionStrategy, 'getModeInterpretation' | 'getMetricsPanel'>,
): TestVersionStrategy {
  return {
    ...base,
    getModeInterpretation: () => null,
    getMetricsPanel: () => null,
  };
}
```

**2. Use plugin architecture for extensions:**

```typescript
export interface TestVersionStrategyPlugin {
  id: string;
  canHandle(testVersion: TestVersion): boolean;
  execute(context: StrategyContext): React.ReactNode;
}

// Register plugins independently
const pluginRegistry = new Map<string, TestVersionStrategyPlugin[]>();

export function registerPlugin(plugin: TestVersionStrategyPlugin) {
  const key = plugin.id;
  if (!pluginRegistry.has(key)) {
    pluginRegistry.set(key, []);
  }
  pluginRegistry.get(key)!.push(plugin);
}

// Components query for available plugins
const modeInterpretationPlugins =
  pluginRegistry.get('modeInterpretation') || [];
```

---

### Risk 9: Error Handling is Fragile

**The Problem:**

```typescript
export function getTestVersionStrategy(
  testVersion: TestVersion,
): TestVersionStrategy {
  const strategy = TestVersionRegistry.get(testVersion);
  if (!strategy) {
    throw new Error(`Unknown test version: ${testVersion}`); // Generic error
  }
  return strategy;
}
```

**Why This is Risky:**

- ❌ Generic error message doesn't help debug
- ❌ Errors surface late (when strategy is requested, not when app starts)
- ❌ No validation that strategies implement interface correctly
- ❌ No way to list registered versions for debugging

**Mitigation:**

**1. Comprehensive error messages:**

```typescript
export function getTestVersionStrategy(
  testVersion: TestVersion,
): TestVersionStrategy {
  const strategy = TestVersionRegistry.get(testVersion);
  if (!strategy) {
    const registered = Array.from(TestVersionRegistry.keys());
    throw new Error(
      `Test version strategy not found: "${testVersion}"\n` +
        `Registered versions: ${registered.join(', ')}\n` +
        `This is usually caused by:\n` +
        `1. initializeTestVersionStrategies() not being called at app startup\n` +
        `2. A new test version added to TestVersion type without registering it\n` +
        `3. A typo in the test version ID`,
    );
  }
  return strategy;
}
```

**2. Validate strategies at initialization:**

```typescript
export function initializeTestVersionStrategies() {
  const strategies = [studentTStrategy, mannWhitneyStrategy];

  for (const strategy of strategies) {
    validateStrategy(strategy);
    TestVersionRegistry.set(strategy.metadata.id, strategy);
  }
}

function validateStrategy(strategy: TestVersionStrategy) {
  if (!strategy.metadata?.id) {
    throw new Error('Strategy missing metadata.id');
  }
  if (typeof strategy.getColumnConfiguration !== 'function') {
    throw new Error(
      `Strategy ${strategy.metadata.id} missing getColumnConfiguration()`,
    );
  }
  if (typeof strategy.renderColumns !== 'function') {
    throw new Error(`Strategy ${strategy.metadata.id} missing renderColumns()`);
  }
  // etc.
}
```

**3. Add a debug utility:**

```typescript
export function debugTestVersionStrategies() {
  console.log('=== Test Version Strategies Debug ===');
  console.log(`Total registered: ${TestVersionRegistry.size}`);
  for (const [id, strategy] of TestVersionRegistry) {
    console.log(`\n✓ ${id}`);
    console.log(`  Label: ${strategy.metadata.label}`);
    console.log(`  Default: ${strategy.metadata.isDefault}`);
    console.log(
      `  Methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(strategy))
        .filter((m) => m !== 'constructor')
        .join(', ')}`,
    );
  }
}

// Call in development
if (process.env.NODE_ENV === 'development') {
  window.__debugTestVersionStrategies = debugTestVersionStrategies;
}
```

---

## Summary of Risk Mitigations

| Risk                    | Priority   | Recommended Mitigation                        |
| ----------------------- | ---------- | --------------------------------------------- |
| React coupling          | **High**   | Component factory pattern or callbacks        |
| Runtime safety          | **High**   | Fail-fast validation + sync type/registry     |
| Type dependencies       | **Medium** | Keep type union explicit, validate separately |
| Type casting complexity | **Medium** | Type guards + discriminated unions            |
| Migration chaos         | **High**   | Feature-flag approach + lint rules            |
| Column duplication      | **Low**    | Column builder functions                      |
| Component testing       | **Medium** | Separate logic from rendering                 |
| Interface extensibility | **Medium** | Optional properties + plugin architecture     |
| Error handling          | **Low**    | Better error messages + debug utilities       |

The **highest priority** mitigations are preventing React coupling, ensuring runtime safety, and controlling the migration process. Implement those first before rolling out the strategy pattern.
