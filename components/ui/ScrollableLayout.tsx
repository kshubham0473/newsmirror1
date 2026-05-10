'use client';

import { useEffect } from 'react';

/**
 * Wrap any page that needs normal document scroll (i.e. NOT the card feed).
 * The card feed sets overflow:hidden on body globally — this component
 * counteracts that for pages like /sources, /sources/[id], /methodology.
 *
 * Usage: wrap the <main> in your page with this component.
 */
export default function ScrollableLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.documentElement.setAttribute('data-scrollable', 'true');
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';

    return () => {
      document.documentElement.removeAttribute('data-scrollable');
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  }, []);

  return <>{children}</>;
}
