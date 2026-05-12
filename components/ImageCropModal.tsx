"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Drag + pinch-zoom circular cropper.
 *
 * Renders a full-screen modal containing:
 *  - a square crop frame whose visible area is a centered circle
 *  - the source image rendered behind the frame, positioned by (offsetX, offsetY, scale)
 *  - everything outside the circle is dimmed
 *  - one-pointer drag → translate; two-pointer pinch → scale (around midpoint)
 *  - on confirm, the visible-in-circle square is exported as a JPEG Blob
 *
 * Imperative pointer math (NOT React state per pointermove) so a 60Hz
 * gesture doesn't cause 60 re-renders — the underlying transform is
 * written directly to the image DOM, and React state only reflects the
 * end-of-gesture snapshot. Same idiom as `RankableOptions`'s drag path.
 *
 * Minimum scale is "image must always fully cover the crop circle": the
 * user can't zoom out far enough to expose blank space behind the crop.
 *
 * Output is `EXPORT_SIZE`-px JPEG with quality 0.9 (a couple dozen KB
 * typically — well under the server's 5 MiB cap).
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
  // Blob URL for the picked file. Created+revoked inside the SAME effect
  // so StrictMode's setup → cleanup → setup cycle pairs them correctly:
  // mount 1 creates URL_A; cleanup revokes URL_A; mount 2 creates URL_B
  // and writes it to state, triggering a re-render that swaps the
  // displayed `<img src>` from the dead URL_A to the live URL_B. The
  // first attempt at this pairing put the URL in `useState(() => ...)`
  // lazy init — that locks the URL in state for the component's lifetime,
  // so when StrictMode's cleanup revoked it, the setup effect couldn't
  // create a replacement (state was already set), and the displayed img
  // permanently pointed at a revoked URL.
  //
  // Two other pitfalls this approach sidesteps:
  //   - data URLs via FileReader are silently truncated by
  //     iOS Safari/WKWebView (and iOS Firefox, which uses WKWebView)
  //     beyond ~1-2 MB in `<img src>`. Phone photos at 5-15 MB
  //     produced an empty crop frame. Blob URLs have no length limit.
  //   - new Image() probes can mis-fire on mobile (decoded but with
  //     naturalWidth=0 on iOS for some HEIC files); we let the
  //     displayed `<img>` be the only loader and read dimensions from
  //     its onLoad.
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
    pointers: Map<number, { x: number; y: number }>;
    centerX: number;
    centerY: number;
    distance: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  function snapshotGesture() {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length === 0) {
      gestureStartRef.current = null;
      return;
    }
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    let dist = 1;
    if (pts.length >= 2) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      dist = Math.max(1, Math.hypot(dx, dy));
    }
    gestureStartRef.current = {
      pointers: new Map(pointersRef.current),
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

    const pts = Array.from(pointersRef.current.values());
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;

    let newScale = start.scale;
    if (pts.length >= 2) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      newScale = start.scale * (dist / start.distance);
    }

    // Translate so the pinch midpoint stays put relative to the image.
    // ox_new = ox_start + (cx_now - cx_start) + (centerX_relative_to_image
    //   * (newScale - start.scale)). The "midpoint stays put" math:
    //   pinch-midpoint in image-space = (centerX - frameCenterX - oxStart) / startScale
    //   we want it to map to (centerX - frameCenterX - oxNew) / newScale
    //   so oxNew = (centerX - frameCenterX) - newScale * imageX
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
            {/* Source image. Always rendered (when url is set) so the
                browser loads it. Until onLoad reports natural dimensions,
                the img is hidden 1×1px at top-left with opacity 0 — still
                in the DOM, still loading. Once imageDims is set, the
                inline width/height/margin/transform math takes over.
                onError → loadError, but it doesn't unmount the img: a
                src change (StrictMode mount 1 URL → mount 2 URL) will
                trigger a fresh load attempt on the same img element, and
                a successful onLoad both sets imageDims and clears
                loadError. */}
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
                  // Tailwind's preflight applies `img { max-width: 100%; height: auto }`
                  // globally, which would cap our explicit width at the container's
                  // 370px before the transform downscales it — producing the
                  // "image is visibly 1/N the expected width" rendering on
                  // every browser, not just iOS. We need the img to lay out at
                  // its natural pixel size so transform: scale() correctly
                  // fits the crop frame. (height: auto loses to our inline
                  // height anyway, so only max-width is actually load-bearing
                  // here, but maxHeight: 'none' is harmless insurance.)
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
