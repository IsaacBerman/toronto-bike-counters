import { ImageResponse } from 'next/og';

export const alt = 'Where is Downtown? — draw what you consider downtown';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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
          <div style={{ fontSize: '104px', fontWeight: 800, color: '#16150f', lineHeight: 1, letterSpacing: '-0.03em' }}>
            Where is Downtown?
          </div>
          <div style={{ fontSize: '34px', color: '#57554b', marginTop: '24px', maxWidth: '900px' }}>
            Draw the boundary of what you call “downtown” and watch it merge into a crowd heatmap.
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: '24px', color: '#8a887c' }}>
          observingthecity.ca/downtown-definer
        </div>
      </div>
    ),
    { ...size }
  );
}
