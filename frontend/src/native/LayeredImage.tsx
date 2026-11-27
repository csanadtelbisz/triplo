import { useEffect, useState } from 'react';

/** A sharp image fading in over a low-resolution placeholder that is already loaded. */
export function LayeredImage({ placeholder, src, placeholderFallback }: { placeholder: string; src: string | null; placeholderFallback?: string }) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  useEffect(() => setPlaceholderFailed(false), [placeholder]);
  return (
    <div className="route-image-layers">
      <img className="route-image-layer" src={placeholderFailed && placeholderFallback ? placeholderFallback : placeholder} alt="" draggable={false} onError={() => setPlaceholderFailed(true)} />
      {src && (
        <img
          className={`route-image-layer route-image-layer-sharp${loadedSrc === src ? ' loaded' : ''}`}
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          ref={element => { if (element?.complete && element.naturalWidth > 0) setLoadedSrc(src); }}
          onLoad={() => setLoadedSrc(src)}
        />
      )}
    </div>
  );
}
