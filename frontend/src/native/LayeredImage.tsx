import { useState } from 'react';

/** A sharp image fading in over a low-resolution placeholder that is already loaded. */
export function LayeredImage({ placeholder, src }: { placeholder: string; src: string | null }) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  return (
    <div className="route-image-layers">
      <img className="route-image-layer" src={placeholder} alt="" draggable={false} />
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
