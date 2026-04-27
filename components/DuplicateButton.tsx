"use client";

import { useRouter, usePathname } from "next/navigation";
import { Question } from "@/lib/types";
import { buildQuestionSnapshot } from "@/lib/questionCreator";
import { debugLog } from "@/lib/debugLogger";

interface DuplicateButtonProps {
  question: Question;
}

export default function DuplicateButton({ question }: DuplicateButtonProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleDuplicate = () => {
    const duplicateData = buildQuestionSnapshot(question);

    debugLog.logObject('Duplicate button clicked', { questionId: question.id, duplicateData }, 'DuplicateButton');
    
    // Store in localStorage for form auto-fill
    const storageKey = `duplicate-data-${question.id}`;
    localStorage.setItem(storageKey, JSON.stringify(duplicateData));
    
    debugLog.logObject('Stored duplicate data', { storageKey, data: localStorage.getItem(storageKey) }, 'DuplicateButton');
    
    // Open create modal with duplicate parameter
    const navigateUrl = `${pathname}?create=1&duplicate=${question.id}`;
    debugLog.info(`Navigating to: ${navigateUrl}`, 'DuplicateButton');
    router.push(navigateUrl);
  };

  return (
    <button
      onClick={handleDuplicate}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 text-white transition-all duration-200"
      title="Create a follow-up question with the same structure"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      Copy
    </button>
  );
}