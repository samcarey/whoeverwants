"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Drag + pinch-zoom circular cropper modal.
 *
 * Pointermove writes transform directly to the DOM (no per-frame React
 * re-render); React state only holds end-of-gesture snapshots. Minimum
 * scale guarantees the image always covers the crop frame.
 */

const EXPORT_SIZE = 512;
const JPEG_QUALITY = 0.9;
const MAX_SCALE_OVER_MIN = 5;

interface Props {
  /** File the user just picked. Component owns the URL.createObjectURL
   *  lifecycle — releases on unmount. */
  file: File;
  onCancel: () => void;
  onConfirm: (croppedBlob: Blob) => void | Promise<void>;
}

interface ImageDims {
  width: number;
  height: number;
}

export default function ImageCropModal({ file, onCancel, onConfirm }: Props) {
  // Blob URL for the picked file. Create + revoke + setUrl all pair inside
  // one effect so React StrictMode's setup → cleanup → setup cycle swaps
  // the displayed `<img src>` from the revoked URL_A to a fresh URL_B
  // instead of stranding the img on a dead URL. Data URLs (FileReader)
  // can't substitute: iOS WebKit silently fails `<img src>` for data URLs
  // larger than ~1-2 MB, which most phone photos exceed.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl((prev) => (prev === u ? null : prev));
    };
  }, [file]);

  const [imageDims, setImageDims] = useState<ImageDims | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Crop frame size — derived from viewport in a layout effect so the
  // first paint already has the correct dimensions on iOS.
  const [frameSize, setFrameSize] = useState(0);

  // Transform state (committed end-of-gesture values; the in-flight
  // transform is written imperatively to the DOM ref).
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const scaleRef = useRef(1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Pick the largest square that fits the viewport with sensible margins.
  useLayoutEffect(() => {
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Leave room for header (cancel button) on top, save button on bottom.
      const max = Math.min(vw - 32, vh - 200);
      setFrameSize(Math.max(200, max));
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
    };
  }, []);

  // Body scroll lock — same pattern as other modals in the app.
  useEffect(() => {
    const scrollY = window.scrollY;
    const prevStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.position = prevStyle.position;
      document.body.style.top = prevStyle.top;
      document.body.style.width = prevStyle.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Min scale: image must fully cover the crop frame in BOTH axes.
  const minScale = useMemo(() => {
    if (!imageDims || frameSize === 0) return 1;
    return Math.max(frameSize / imageDims.width, frameSize / imageDims.height);
  }, [imageDims, frameSize]);

  // On image / frame-size change, reset the transform so the image is
  // centered and minimally-zoomed inside the crop frame.
  useLayoutEffect(() => {
    if (!imageDims || frameSize === 0) return;
    scaleRef.current = minScale;
    offsetXRef.current = 0;
    offsetYRef.current = 0;
    applyTransformToDom();
  }, [imageDims, frameSize, minScale]);

  function applyTransformToDom() {
    const el = imgRef.current;
    if (!el) return;
    // The img is positioned absolute, centered. translate first (so
    // pan is in display pixels), then scale around its own center.
    el.style.transform = `translate(${offsetXRef.current}px, ${offsetYRef.current}px) scale(${scaleRef.current})`;
  }

  // Clamp so the image always fully covers the crop frame.
  function clamp(scale: number, ox: number, oy: number): [number, number, number] {
    if (!imageDims) return [scale, ox, oy];
    const clampedScale = Math.max(minScale, Math.min(scale, minScale * MAX_SCALE_OVER_MIN));
    const scaledW = imageDims.width * clampedScale;
    const scaledH = imageDims.height * clampedScale;
    const maxX = Math.max(0, (scaledW - frameSize) / 2);
    const maxY = Math.max(0, (scaledH - frameSize) / 2);
    const clampedX = Math.max(-maxX, Math.min(maxX, ox));
    const clampedY = Math.max(-maxY, Math.min(maxY, oy));
    return [clampedScale, clampedX, clampedY];
  }

  // --- Pointer state for drag + pinch ---
  // Track active pointers by pointerId; pinch when 2 are down.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStartRef = useRef<{
    centerX: number;
    centerY: number;
    distance: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  function snapshotGesture() {
    const pts = pointersRef.current;
    if (pts.size === 0) {
      gestureStartRef.current = null;
      return;
    }
    let cx = 0;
    let cy = 0;
    let first: { x: number; y: number } | null = null;
    let second: { x: number; y: number } | null = null;
    for (const p of pts.values()) {
      cx += p.x;
      cy += p.y;
      if (first === null) first = p;
      else if (second === null) second = p;
    }
    cx /= pts.size;
    cy /= pts.size;
    let dist = 1;
    if (first && second) {
      const dx = first.x - second.x;
      const dy = first.y - second.y;
      dist = Math.max(1, Math.hypot(dx, dy));
    }
    gestureStartRef.current = {
      centerX: cx,
      centerY: cy,
      distance: dist,
      scale: scaleRef.current,
      offsetX: offsetXRef.current,
      offsetY: offsetYRef.current,
    };
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!imageDims) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshotGesture();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = gestureStartRef.current;
    if (!start || !imageDims) return;

    // Direct iteration of the Map values avoids allocating an Array per
    // pointermove (this runs at ~60Hz on touch). At most 2 pointers in
    // practice — we capture the first two as we go for the pinch-distance
    // math without a separate slice.
    const pts = pointersRef.current;
    let cx = 0;
    let cy = 0;
    let first: { x: number; y: number } | null = null;
    let second: { x: number; y: number } | null = null;
    for (const p of pts.values()) {
      cx += p.x;
      cy += p.y;
      if (first === null) first = p;
      else if (second === null) second = p;
    }
    cx /= pts.size;
    cy /= pts.size;

    let newScale = start.scale;
    if (first && second) {
      const dx = first.x - second.x;
      const dy = first.y - second.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      newScale = start.scale * (dist / start.distance);
    }

    // Pinch math: midpoint in image-space at gesture start =
    // (cx_start - frameCenter - offsetStart) / scaleStart. Holding that
    // image-space point under the current midpoint gives
    // offsetNew = cx_now - frameCenter - scaleNew * imageMidpoint.
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const frameCenterX = containerRect.left + containerRect.width / 2;
    const frameCenterY = containerRect.top + containerRect.height / 2;
    const imageXAtStart =
      (start.centerX - frameCenterX - start.offsetX) / start.scale;
    const imageYAtStart =
      (start.centerY - frameCenterY - start.offsetY) / start.scale;
    let newOffsetX = (cx - frameCenterX) - newScale * imageXAtStart;
    let newOffsetY = (cy - frameCenterY) - newScale * imageYAtStart;

    const [s, ox, oy] = clamp(newScale, newOffsetX, newOffsetY);
    scaleRef.current = s;
    offsetXRef.current = ox;
    offsetYRef.current = oy;
    applyTransformToDom();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    snapshotGesture();
  };

  // Wheel for desktop zoom (deltaY < 0 = zoom in).
  const handleWheel = (e: React.WheelEvent) => {
    if (!imageDims || !containerRef.current) return;
    e.preventDefault();
    const containerRect = containerRef.current.getBoundingClientRect();
    const frameCenterX = containerRect.left + containerRect.width / 2;
    const frameCenterY = containerRect.top + containerRect.height / 2;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = scaleRef.current * factor;
    // Zoom around the cursor: keep cursor's image-space position fixed.
    const imageXAtCursor =
      (e.clientX - frameCenterX - offsetXRef.current) / scaleRef.current;
    const imageYAtCursor =
      (e.clientY - frameCenterY - offsetYRef.current) / scaleRef.current;
    const newOffsetX = (e.clientX - frameCenterX) - newScale * imageXAtCursor;
    const newOffsetY = (e.clientY - frameCenterY) - newScale * imageYAtCursor;
    const [s, ox, oy] = clamp(newScale, newOffsetX, newOffsetY);
    scaleRef.current = s;
    offsetXRef.current = ox;
    offsetYRef.current = oy;
    applyTransformToDom();
  };

  async function handleConfirm() {
    if (!imageDims || submitting) return;
    setSubmitting(true);
    try {
      const blob = await renderCropToBlob({
        srcUrl: url,
        imgWidth: imageDims.width,
        imgHeight: imageDims.height,
        frameSize,
        scale: scaleRef.current,
        offsetX: offsetXRef.current,
        offsetY: offsetYRef.current,
      });
      await onConfirm(blob);
    } catch (err) {
      console.error('Crop export failed:', err);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Top bar: Cancel */}
      <div className="w-full flex items-center justify-between px-4 py-3">
        <button
          onClick={onCancel}
          className="px-3 py-2 text-white text-sm font-medium"
          aria-label="Cancel"
        >
          Cancel
        </button>
        <span className="text-white text-sm font-medium select-none">
          Drag to position · pinch to zoom
        </span>
        <div className="w-[68px]" aria-hidden />
      </div>

      {/* Crop frame */}
      <div className="flex-1 flex items-center justify-center w-full px-4 overflow-hidden">
        {frameSize === 0 ? (
          <p className="text-white text-sm">Loading image…</p>
        ) : (
          <div
            ref={containerRef}
            className="relative overflow-hidden select-none"
            style={{
              width: frameSize,
              height: frameSize,
              touchAction: 'none',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            {/* Pre-load: img stays in the DOM as a 1×1 hidden element so
                a src change (StrictMode swaps the blob URL) triggers a
                fresh load attempt rather than unmount/remount. onLoad
                sets imageDims and clears any stale loadError. */}
            {url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                ref={imgRef}
                src={url}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  if (t.naturalWidth > 0 && t.naturalHeight > 0) {
                    setImageDims({
                      width: t.naturalWidth,
                      height: t.naturalHeight,
                    });
                    setLoadError(false);
                  }
                }}
                onError={() => setLoadError(true)}
                style={imageDims ? ({
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: imageDims.width,
                  height: imageDims.height,
                  // Override Tailwind preflight's `img { max-width: 100% }`
                  // so the img lays out at its natural pixel size; transform:
                  // scale() then fits it to the crop frame.
                  maxWidth: 'none',
                  maxHeight: 'none',
                  marginLeft: -imageDims.width / 2,
                  marginTop: -imageDims.height / 2,
                  transformOrigin: 'center center',
                  userSelect: 'none',
                  WebkitUserDrag: 'none',
                } as React.CSSProperties) : ({
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 1,
                  height: 1,
                  opacity: 0,
                  pointerEvents: 'none',
                } as React.CSSProperties)}
              />
            )}
            {!imageDims && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-white text-sm">
                  {loadError ? "Couldn't read that image file" : "Loading image…"}
                </p>
              </div>
            )}
            {/* Circular cutout overlay: darken everything outside the circle.
                Implemented as an SVG mask so the inside stays crisp. */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${frameSize} ${frameSize}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <defs>
                <mask id="circle-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <circle
                    cx={frameSize / 2}
                    cy={frameSize / 2}
                    r={frameSize / 2}
                    fill="black"
                  />
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="rgba(0,0,0,0.55)"
                mask="url(#circle-mask)"
              />
              {/* Ring outline so the crop boundary reads clearly */}
              <circle
                cx={frameSize / 2}
                cy={frameSize / 2}
                r={frameSize / 2 - 1}
                fill="none"
                stroke="white"
                strokeWidth={2}
              />
            </svg>
          </div>
        )}
      </div>

      {/* Bottom bar: Save */}
      <div className="w-full flex items-center justify-center px-4 py-4">
        <button
          onClick={handleConfirm}
          disabled={!imageDims || submitting}
          className="px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-base font-semibold"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/**
 * Render the visible-in-circle square of the source image to an
 * `EXPORT_SIZE`-px JPEG Blob via canvas.
 *
 * The math: at confirm time, the displayed image fills a `frameSize`-sized
 * square. Its CSS center is (offsetX, offsetY) relative to the frame
 * center, scaled by `scale`. The visible square's image-space coordinates
 * are derived by inverting that transform — top-left image px =
 *   ((-frameSize/2) - offsetX) / scale + imgWidth/2  (etc.)
 *
 * The output is a square JPEG; the eventual circular display is just an
 * `<img>` inside a `rounded-full overflow-hidden` div, so we don't need
 * to alpha-mask the corners in the export.
 */
async function renderCropToBlob(args: {
  srcUrl: string;
  imgWidth: number;
  imgHeight: number;
  frameSize: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}): Promise<Blob> {
  const { srcUrl, imgWidth, imgHeight, frameSize, scale, offsetX, offsetY } = args;

  // Decode the image fresh into an HTMLImageElement so we can drawImage
  // it onto a canvas. The blob URL is still alive (component unmount
  // releases it) so this load is fast.
  const img = await loadImage(srcUrl);

  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_SIZE;
  canvas.height = EXPORT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // Visible square in image-space coordinates (px on the source).
  const visibleLeftImg = (-frameSize / 2 - offsetX) / scale + imgWidth / 2;
  const visibleTopImg = (-frameSize / 2 - offsetY) / scale + imgHeight / 2;
  const visibleSizeImg = frameSize / scale;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
  ctx.drawImage(
    img,
    visibleLeftImg,
    visibleTopImg,
    visibleSizeImg,
    visibleSizeImg,
    0,
    0,
    EXPORT_SIZE,
    EXPORT_SIZE,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}
