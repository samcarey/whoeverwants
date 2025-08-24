import { useEffect } from 'react';

// Custom hook to set page title in the template
export function usePageTitle(title: string) {
  useEffect(() => {
    // Set a custom property on the document to communicate the title
    document.documentElement.setAttribute('data-page-title', title);
    
    // Dispatch a custom event to notify the template of title change
    window.dispatchEvent(new CustomEvent('pageTitleChange', { detail: { title } }));
    
    // Cleanup on unmount
    return () => {
      document.documentElement.removeAttribute('data-page-title');
    };
  }, [title]);
}