"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUserName, getUserInitials } from "@/lib/userProfile";

export default function ProfileButton() {
  const router = useRouter();
  const [userName, setUserName] = useState<string | null>(null);
  const [initials, setInitials] = useState("");

  useEffect(() => {
    // Load initial name
    const name = getUserName();
    setUserName(name);
    setInitials(getUserInitials(name));

    // Listen for storage changes (in case name is updated in another tab)
    const handleStorageChange = () => {
      const updatedName = getUserName();
      setUserName(updatedName);
      setInitials(getUserInitials(updatedName));
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also check on focus (for same-tab updates)
    const handleFocus = () => {
      const updatedName = getUserName();
      setUserName(updatedName);
      setInitials(getUserInitials(updatedName));
    };
    
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return (
    <button
      onClick={() => router.push('/profile')}
      className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center"
      title={userName ? `Profile: ${userName}` : 'Set your name'}
    >
      <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </button>
  );
}