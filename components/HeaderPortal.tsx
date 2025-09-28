import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface HeaderPortalProps {
  children: React.ReactNode;
}

export default function HeaderPortal({ children }: HeaderPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  const headerPortal = document.getElementById('header-portal');
  if (!headerPortal) return null;

  return createPortal(children, headerPortal);
}