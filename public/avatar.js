// Selfie : recadrage carré, réduction à environ 256 px et JPEG léger avant l'envoi au serveur.
export const SELFIE_SIZE = 256;
export const SELFIE_MAX_CHARS = 100_000;
export const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

// Carré centré dans une image de width × height.
export function squareCrop(width, height) {
  const size = Math.min(width, height);
  return { sx: Math.round((width - size) / 2), sy: Math.round((height - size) / 2), size };
}

export function fitsLimit(dataUrl, maxChars = SELFIE_MAX_CHARS) {
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/jpeg;base64,') && dataUrl.length <= maxChars;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // repli sur <img> ci-dessous
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Renvoie une data URL JPEG carrée prête à être envoyée.
export async function fileToSelfie(file) {
  const source = await decode(file);
  const width = source.width ?? source.naturalWidth;
  const height = source.height ?? source.naturalHeight;
  const { sx, sy, size } = squareCrop(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = SELFIE_SIZE;
  canvas.height = SELFIE_SIZE;
  canvas.getContext('2d').drawImage(source, sx, sy, size, size, 0, 0, SELFIE_SIZE, SELFIE_SIZE);
  if (typeof source.close === 'function') source.close();
  for (const quality of QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (fitsLimit(dataUrl)) return dataUrl;
  }
  throw new Error('photo_too_large');
}
