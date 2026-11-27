import { useEffect, useState } from 'react';
import { fullImageUrl, thumbnailUrl } from './gallery';

export function GalleryThumbnail({ id, size = 256, alt = '', className, loading }: { id: number; size?: number; alt?: string; className?: string; loading?: 'eager' | 'lazy' }) {
  const [useFullImage, setUseFullImage] = useState(false);
  useEffect(() => setUseFullImage(false), [id, size]);
  return <img
    className={className}
    src={useFullImage ? fullImageUrl(id) : thumbnailUrl(id, size)}
    alt={alt}
    loading={loading}
    onError={() => setUseFullImage(true)}
  />;
}
