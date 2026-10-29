import { ImageResponse } from 'next/og';
import { CANDIDATE_COLORS_2026 } from '../components/elections/results';

export const alt = '2026 Toronto election results map';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const CHOW = CANDIDATE_COLORS_2026['Olivia Chow'];
const BRADFORD = CANDIDATE_COLORS_2026['Brad Bradford'];

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#f3f2ec',
          padding: '64px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '28px', height: '28px', background: '#e8590c' }} />
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#16150f', letterSpacing: '0.02em' }}>
            OBSERVING THE CITY
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '96px', fontWeight: 800, color: '#16150f', lineHeight: 1, letterSpacing: '-0.03em' }}>
            2026 Toronto Election Results
          </div>
          <div style={{ fontSize: '34px', color: '#57554b', marginTop: '24px', maxWidth: '980px' }}>
            Mayor and council results, poll by poll and ward by ward.
          </div>
          <div style={{ display: 'flex', marginTop: '36px', height: '14px', width: '560px' }}>
            <div style={{ flex: 1, background: CHOW }} />
            <div style={{ flex: 1, background: BRADFORD }} />
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: '24px', color: '#8a887c' }}>
          observingthecity.ca/elections
        </div>
      </div>
    ),
    { ...size }
  );
}
