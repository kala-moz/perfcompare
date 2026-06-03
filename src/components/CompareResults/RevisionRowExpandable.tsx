import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';

import CommonGraph from './CommonGraph';
import KdeModesPanel from './KdeModesPanel';
import { getStrategy } from '../../common/testVersions';
import { Strings } from '../../resources/Strings';
import { Spacing } from '../../styles';
import type { CombinedResultsItemType } from '../../types/state';
import { TestVersion } from '../../types/types';
import { computeKdeAnalysis } from '../../utils/kdeAnalysis';

const { singleRun } = Strings.components.expandableRow;

function RevisionRowExpandable(props: RevisionRowExpandableProps) {
  const { result, id, testVersion } = props;

  // Valley-depth threshold for the mode-detection slider rendered next to the
  // chart. Lifted to this row so the future mode-blurb panel can read the same
  // detected modes without recomputing the KDE.
  const [vt, setVt] = useState(0.5);

  const {
    base_runs: baseRuns,
    new_runs: newRuns,
    base_runs_replicates: baseRunsReplicates,
    new_runs_replicates: newRunsReplicates,
    platform,
    more_runs_are_needed: moreRunsAreNeeded,
    lower_is_better: lowerIsBetter,
    base_app: baseApplication,
    new_app: newApplication,
    base_measurement_unit: baseUnit,
    new_measurement_unit: newUnit,
  } = result;

  const strategy = getStrategy(testVersion);

  const baseValues =
    baseRunsReplicates && baseRunsReplicates.length
      ? baseRunsReplicates
      : baseRuns;

  const newValues =
    newRunsReplicates && newRunsReplicates.length ? newRunsReplicates : newRuns;

  const isSubtest = result.base_parent_signature !== null;

  // KDE + mode detection runs once at this level so the chart and the blurb
  // panel can't drift onto different grids or different mode counts.
  const analysis = useMemo(
    () => computeKdeAnalysis(baseValues, newValues, vt, isSubtest),
    [baseValues, newValues, vt, isSubtest],
  );

  const showKdeBlurb = testVersion === 'mann-whitney-u';

  return (
    <Box
      component='section'
      id={id}
      aria-label='Revision Row Details'
      sx={{
        backgroundColor: 'revisionRow.background',
        padding: 2,
        borderRadius: `0px 0px ${Spacing.Small}px ${Spacing.Small}px`,
        marginInlineEnd:
          '34px' /* This value needs to be synchronized with the expand icon size. */,
      }}
    >
      <Stack
        divider={<Divider flexItem />}
        spacing={2}
        sx={{
          backgroundColor: 'expandedRow.background',
          padding: 2,
          borderRadius: 0.5,
        }}
      >
        <b>{platform}</b>
        <Grid container spacing={2}>
          <Grid size={8}>
            <Stack spacing={2}>
              {(baseValues.length > 0 || newValues.length > 0) && (
                <CommonGraph
                  baseValues={baseValues}
                  newValues={newValues}
                  unit={baseUnit || newUnit}
                  analysis={analysis}
                  vt={vt}
                  onVtChange={setVt}
                />
              )}
              {showKdeBlurb && (
                <KdeModesPanel
                  baseValues={baseValues}
                  newValues={newValues}
                  unit={baseUnit || newUnit}
                  analysis={analysis}
                />
              )}
              {strategy.renderExpandedLeft(result)}
            </Stack>
          </Grid>
          <Grid size={4}>
            <div>
              {moreRunsAreNeeded && <div>{singleRun} </div>}
              {baseApplication && (
                <div>
                  <b>Base application</b>: {baseApplication}{' '}
                </div>
              )}
              {newApplication && (
                <div>
                  <b>New application</b>: {newApplication}{' '}
                </div>
              )}
              <Box sx={{ whiteSpace: 'nowrap', marginTop: 1 }}>
                <b>Comparison result</b>: {strategy.getComparisonResult(result)}{' '}
                ({lowerIsBetter ? 'lower' : 'higher'} is better)
              </Box>
              {strategy.renderExpandedRight(result)}
            </div>
          </Grid>
        </Grid>
        <Stack>{strategy.renderExpandedBottom(result)}</Stack>
      </Stack>
    </Box>
  );
}

interface RevisionRowExpandableProps {
  result: CombinedResultsItemType;
  id: string;
  testVersion: TestVersion;
}

export default RevisionRowExpandable;
