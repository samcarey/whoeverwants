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
      className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-800 dark:bg-gray-100 hover:bg-gray-900 dark:hover:bg-white transition-colors flex items-center justify-center text-xs font-semibold text-white dark:text-gray-900"
      title={userName ? `Profile: ${userName}` : 'Set your name'}
    >
      {initials || ""}
    </button>
  );
}