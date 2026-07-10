'use client';

import { useRef, useState } from 'react';
import { renderShareCard, canvasToFile } from '../../lib/downtown-definer/canvasRender';

const SITE_URL = 'https://www.observingthecity.ca/downtown-definer';

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 1.6h3.5l-7.6 8.7 8.9 11.8h-7l-5.5-7.2-6.3 7.2H1.4l8.1-9.3L1 1.6h7.2l5 6.6 5.7-6.6Zm-1.2 18.2h1.9L6.4 3.6H4.3l13.4 16.2Z" />
    </svg>
  );
}
function BlueskyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 10.8C10.9 8.6 7.9 4.6 5.1 2.7 2.4.9 1.4 1.2.7 1.5c-.8.4-1 1.7-1 2.4 0 .8.4 6.3.7 7.2.9 3 4.1 4 7 3.7-4.3.6-8.1 2.2-3.1 7.7 5.5 5.7 7.5-1.2 8.6-4.7 1.1 3.5 2.3 10.2 8.6 4.7 4.7-4.7 1.3-7.1-3-7.7 2.9.3 6.1-.7 7-3.7.3-.9.7-6.4.7-7.2 0-.7-.2-2-1-2.4-.7-.3-1.7-.6-4.4 1.2C16 4.6 13 8.6 12 10.8Z" />
    </svg>
  );
}
function FacebookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.6.2 2.6.2v2.9h-1.5c-1.4 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12Z" />
    </svg>
  );
}

export default function ShareButton({ cityName, boundary, bbox, yourPoints, grid, submissionCount }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const filesRef = useRef(null);

  const text = `Where is downtown ${cityName}? I mapped what I think counts. See how it compares:`;
  const links = {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${SITE_URL}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SITE_URL)}`,
  };

  async function buildFiles() {
    if (filesRef.current) return filesRef.current;
    const canvas = await renderShareCard({ cityName, boundary, bbox, yourPoints, grid, submissionCount });
    const file = await canvasToFile(canvas, `${cityName}-downtown.png`);
    filesRef.current = [file];
    return filesRef.current;
  }

  async function withImages(action) {
    setBusy(true);
    setError(null);
    try {
      const files = await buildFiles();
      await action(files);
    } catch (err) {
      console.error('DowntownDefiner share:', err);
      setError(`Could not generate the image: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  function handleDownload() {
    return withImages(async (files) => {
      files.forEach((file) => {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
    });
  }

  function handleNativeShare() {
    return withImages(async (files) => {
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, title: `${cityName}'s downtown, defined`, text });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;
        }
      } else {
        await handleDownload();
      }
    });
  }

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.canShare;

  return (
    <div className="pt-4" style={{ borderTop: '1px solid var(--line)' }}>
      <p className="dd-kicker mb-3" style={{ color: 'var(--ink-2)' }}>
        Share your definition
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a href={links.x} target="_blank" rel="noopener noreferrer" className="dd-btn dd-btn-primary">
          <XIcon /> Post
        </a>
        <a href={links.bluesky} target="_blank" rel="noopener noreferrer" className="dd-btn dd-btn-ghost">
          <BlueskyIcon /> Bluesky
        </a>
        <a href={links.facebook} target="_blank" rel="noopener noreferrer" className="dd-btn dd-btn-ghost">
          <FacebookIcon /> Facebook
        </a>

        <span className="mx-1 hidden sm:inline" style={{ color: 'var(--line)' }}>
          |
        </span>

        {canNativeShare ? (
          <button onClick={handleNativeShare} disabled={busy} className="dd-btn dd-btn-accent">
            {busy ? 'Preparing…' : '↗ Share image'}
          </button>
        ) : (
          <button onClick={handleDownload} disabled={busy} className="dd-btn dd-btn-accent">
            {busy ? 'Preparing…' : '↓ Download image'}
          </button>
        )}
        {canNativeShare && (
          <button onClick={handleDownload} disabled={busy} className="dd-btn dd-btn-ghost">
            ↓ Download
          </button>
        )}
      </div>

      <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Posting opens a pre-filled message linking back here. To include the picture, attach the downloaded image
        (or use &ldquo;Share image&rdquo; on mobile).
      </p>
      {error && <p className="text-sm mt-2" style={{ color: 'var(--accent)' }}>{error}</p>}
    </div>
  );
}
