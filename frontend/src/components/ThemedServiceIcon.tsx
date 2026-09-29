import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import githubDarkIcon from '../assets/icons/dark/github.png';
import { getResolvedAppearanceTheme } from '../utils/appearancePreferences';

interface ThemedServiceIconProps {
  serviceName: string;
  lightIcon: string;
  alt: string;
  width: number;
  height: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

const darkIcons: Record<string, string> = {
  GitHub: githubDarkIcon
};

export function ThemedServiceIcon({ serviceName, lightIcon, alt, width, height, title, className, style }: ThemedServiceIconProps) {
  const [theme, setTheme] = useState(() => getResolvedAppearanceTheme());
  const darkIcon = darkIcons[serviceName];

  useEffect(() => {
    const refreshTheme = () => setTheme(getResolvedAppearanceTheme());
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('preferences-updated', refreshTheme);
    mediaQuery.addEventListener('change', refreshTheme);
    return () => {
      window.removeEventListener('preferences-updated', refreshTheme);
      mediaQuery.removeEventListener('change', refreshTheme);
    };
  }, []);

  return (
    <img
      src={theme === 'dark' && darkIcon ? darkIcon : lightIcon}
      alt={alt}
      title={title}
      width={width}
      height={height}
      className={`${className || ''} themed-service-icon${theme === 'dark' && darkIcon ? ' themed-service-icon-dark' : ''}`}
      style={style}
    />
  );
}