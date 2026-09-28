// Draw AI-returned markings (boxes / points, normalized 0-1 coords) over a
// captured image and return a new image data URL to display in the panel.

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = typeof source === 'string' ? new Image() : source;
    if (typeof source === 'string') {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image for marking overlay.'));
      img.src = source;
    } else if (img && img.complete && img.naturalWidth) {
      resolve(img);
    } else if (img) {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image for marking overlay.'));
    } else {
      reject(new Error('No image source provided.'));
    }
  });
}

// Convert a normalized (0-1) or absolute value to pixels against `size`.
function toPx(value, size, fallback) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return value >= 0 && value <= 1 ? value * size : value;
}

const DEFAULT_COLORS = {
  low: '#ffc400',
  medium: '#ff8c00',
  high: '#ff3b3b',
};

export async function drawMarkingsOnImage(imageSource, markings = [], options = {}) {
  const img = await loadImage(imageSource);
  const width = options.width || img.naturalWidth || img.width;
  const height = options.height || img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0, width, height);

  const list = Array.isArray(markings) ? markings : [];

  for (const mark of list) {
    if (!mark || typeof mark !== 'object') continue;

    const severity = mark.severity || null;
    const color = options.colors?.[severity] || DEFAULT_COLORS[severity] || DEFAULT_COLORS.high;

    const isPoint =
      (mark.type === 'point' ||
        (typeof mark.x === 'number' && typeof mark.y === 'number' && mark.width == null && mark.height == null));

    if (isPoint) {
      const cx = toPx(mark.x, width, width / 2);
      const cy = toPx(mark.y, height, height / 2);
      const radius = mark.radius || Math.max(5, Math.round(width / 120));

      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, Math.round(width / 400));
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      if (mark.label) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.font = `bold ${Math.max(12, Math.round(width / 70))}px sans-serif`;
        const textWidth = ctx.measureText(mark.label).width;
        const labelX = cx + radius;
        const labelY = cy - radius - 6;
        const boxTop = Math.max(0, labelY - 18);
        ctx.fillRect(labelX, boxTop, textWidth + 10, 20);
        ctx.fillStyle = color;
        ctx.fillText(mark.label, labelX + 5, labelY + 2);
      }
      continue;
    }

    // box
    const x = toPx(mark.x, width, 0);
    const y = toPx(mark.y, height, 0);
    const w = Math.max(1, toPx(mark.width, width, width / 4));
    const h = Math.max(1, toPx(mark.height, height, height / 4));

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.round(width / 300));
    ctx.strokeRect(x, y, w, h);

    if (mark.label) {
      ctx.font = `bold ${Math.max(12, Math.round(width / 70))}px sans-serif`;
      const textWidth = ctx.measureText(mark.label).width;
      const labelX = x;
      const labelY = y - 6;
      const boxTop = Math.max(0, labelY - 18);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(labelX, boxTop, textWidth + 10, 20);
      ctx.fillStyle = color;
      ctx.fillText(mark.label, labelX + 5, labelY + 2);
    }
  }

  return canvas.toDataURL(options.outputMimeType || 'image/jpeg', options.quality ?? 0.9);
}

export default drawMarkingsOnImage;