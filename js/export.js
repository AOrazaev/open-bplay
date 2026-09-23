// Play-as-image export -----------------------------------------------------
// Renders the current court (background + tokens + lines) onto a plain
// offscreen <canvas> at a fixed export resolution, reusing the exact same
// drawCourt/drawTokens/drawLines functions the live canvas uses — just
// without any selection handles or in-progress drag previews — then
// copies the resulting PNG to the clipboard, falling back to a download
// if the Clipboard API isn't available. Mirrors the `rotations` app's
// js/export.js pattern (canvas -> blob -> clipboard-or-download).

const EXPORT_WIDTH_PX = 1600;

function renderCourtExportCanvas(tokens, lines) {
  const heightPx = Math.round(EXPORT_WIDTH_PX * (COURT_LENGTH_FT / COURT_WIDTH_FT));
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH_PX;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  drawCourt(ctx, canvas.width, canvas.height);
  const map = courtToCanvas(canvas.width, canvas.height);
  drawLines(ctx, lines, tokens, map);
  drawTokens(ctx, tokens, map);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Turns the current play name (if any) into a filesystem-safe filename,
// falling back to a generic name when the court hasn't been named/saved.
function exportFilename() {
  const trimmed = playNameInput.value.trim();
  const safe = trimmed.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '');
  return `${safe || 'play'}.png`;
}

const exportImageBtn = document.querySelector('#exportImageBtn');

exportImageBtn.addEventListener('click', async () => {
  const originalLabel = exportImageBtn.textContent;
  const filename = exportFilename();

  async function tryCopyThenDownload() {
    const canvas = renderCourtExportCanvas(tokens, lines);
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('Could not create image.');
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      exportImageBtn.textContent = '✅ Copied!';
      return;
    }
    downloadBlob(blob, filename);
    exportImageBtn.textContent = '✅ Downloaded';
  }

  try {
    await tryCopyThenDownload();
  } catch (_) {
    // Clipboard write can fail even when the API exists (e.g. no
    // clipboard permission) — fall back to a plain download rather than
    // leaving the user with no way to get the image at all.
    try {
      const canvas = renderCourtExportCanvas(tokens, lines);
      const blob = await canvasToBlob(canvas);
      if (!blob) throw new Error('Could not create image.');
      downloadBlob(blob, filename);
      exportImageBtn.textContent = '✅ Downloaded';
    } catch (_) {
      exportImageBtn.textContent = '⚠️ Export failed';
    }
  } finally {
    setTimeout(() => { exportImageBtn.textContent = originalLabel; }, 1400);
  }
});
