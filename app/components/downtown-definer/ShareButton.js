'use client';

import { useEffect, useState } from 'react';
import { renderYourPolygonCard, renderHeatmapCard, canvasToFile } from '../../lib/downtown-definer/canvasRender';

export default function ShareButton({ cityName, boundary, bbox, yourPoints, grid, submissionCount }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [downloadUrls, setDownloadUrls] = useState(null);

  useEffect(() => {
    return () => {
      downloadUrls?.forEach((f) => URL.revokeObjectURL(f.url));
    };
  }, [downloadUrls]);

  async function buildFiles() {
    const files = [];
    if (yourPoints && yourPoints.length >= 3) {
      const canvas = renderYourPolygonCard({ cityName, boundary, bbox, points: yourPoints });
      files.push(await canvasToFile(canvas, `${cityName}-your-downtown.png`));
    }
    const heatmapCanvas = renderHeatmapCard({ cityName, boundary, bbox, grid, submissionCount });
    files.push(await canvasToFile(heatmapCanvas, `${cityName}-downtown-heatmap.png`));
    return files;
  }

  async function handleShare() {
    setBusy(true);
    setError(null);
    setDownloadUrls(null);

    // Step 1: build the images. If this fails, surface the real reason.
    let files;
    try {
      files = await buildFiles();
    } catch (err) {
      console.error('DowntownDefiner share: image generation failed', err);
      setError(`Could not generate share images: ${err?.message || err}`);
      setBusy(false);
      return;
    }

    // Step 2: try the native share sheet, otherwise offer downloads.
    try {
      if (navigator.canShare?.({ files })) {
        await navigator.share({
          files,
          title: `${cityName}'s downtown, defined`,
          text: `Here's my definition of downtown ${cityName}, and how it compares to everyone else's — via DowntownDefiner`,
        });
      } else {
        setDownloadUrls(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('DowntownDefiner share: navigator.share failed', err);
        setError('Could not open the share sheet — you can still download the images below.');
        setDownloadUrls(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleShare}
        disabled={busy}
        className="self-start bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? 'Preparing images…' : 'Share'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {downloadUrls && (
        <div className="flex gap-3 flex-wrap">
          {downloadUrls.map((file) => (
            <a key={file.name} href={file.url} download={file.name} className="text-sm text-blue-600 underline">
              Download {file.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
