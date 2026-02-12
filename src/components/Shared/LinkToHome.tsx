import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import { Box } from '@mui/system';
import { style } from 'typestyle';

import { Spacing } from '../../styles';

export function LinkToHome() {
  return (
    <Box sx={{ mb: 3 }}>
      <Link href='/' aria-label='link to home'>
        <Stack
          direction='row'
          sx={{
            alignItems: 'center',
          }}
        >
          <ChevronLeftIcon fontSize='small' />
          <span>Home</span>
        </Stack>
      </Link>
    </Box>
  );
}
