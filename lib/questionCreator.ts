// Utility functions for managing question creator information in localStorage

import type { Poll, Question } from '@/lib/types';

const QUESTION_CREATOR_STORAGE_KEY = 'question_creator_data';
const CLEANUP_INTERVAL_DAYS = 30; // Clean up questions older than 30 days

interface QuestionCreatorData {
  questionId: string;
  creatorSecret: string;
  createdAt: string;
}

// Generate a random creator secret
export function generateCreatorSecret(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Store question creation data in localStorage
export function storeQuestionCreation(questionId: string, creatorSecret: string): void {
  if (typeof window === 'undefined') return; // SSR safety

  const existingData = getStoredQuestionData();
  const newData: QuestionCreatorData = {
    questionId,
    creatorSecret,
    createdAt: new Date().toISOString()
  };

  const updatedData = [...existingData, newData];
  localStorage.setItem(QUESTION_CREATOR_STORAGE_KEY, JSON.stringify(updatedData));
}

// Get stored question data from localStorage
function getStoredQuestionData(): QuestionCreatorData[] {
  if (typeof window === 'undefined') return []; // SSR safety

  try {
    const stored = localStorage.getItem(QUESTION_CREATOR_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error parsing stored question data:', error);
    return [];
  }
}

// Check if a question was created by this device
export function isCreatedByThisDevice(questionId: string): boolean {
  const questionData = getStoredQuestionData();
  return questionData.some(data => data.questionId === questionId);
}

// Get the creator secret for a question created by this device
export function getQuestionCreatorSecret(questionId: string): string | null {
  const questionData = getStoredQuestionData();
  const found = questionData.find(data => data.questionId === questionId);
  return found ? found.creatorSecret : null;
}

// Clean up old question data to prevent localStorage from growing indefinitely
export function cleanupOldQuestions(): void {
  if (typeof window === 'undefined') return; // SSR safety

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_INTERVAL_DAYS);

  const questionData = getStoredQuestionData();
  const filteredData = questionData.filter(data => {
    const createdDate = new Date(data.createdAt);
    return createdDate >= cutoffDate;
  });

  // Only update localStorage if we actually removed something
  if (filteredData.length !== questionData.length) {
    localStorage.setItem(QUESTION_CREATOR_STORAGE_KEY, JSON.stringify(filteredData));
    console.log(`Cleaned up ${questionData.length - filteredData.length} old question records`);
  }
}

// Build a snapshot of question fields used for duplicate/follow-up forms.
// Centralized here to avoid drift when fields are added or renamed.
//
// Phase 5b: wrapper-level fields (response_deadline, creator_name) are
// sourced from the parent `Poll` since they no longer live on `Question`.
// `poll` is optional so callsites that build a snapshot for a question
// whose wrapper isn't loaded (e.g. an old localStorage entry) can still
// pass just the question — the resulting snapshot just omits the wrapper bits.
export function buildQuestionSnapshot(question: Question, poll?: Poll | null) {
  return {
    title: question.title,
    question_type: question.question_type,
    options: question.options,
    response_deadline: poll?.response_deadline ?? null,
    creator_name: poll?.creator_name ?? null,
    auto_close_after: question.auto_close_after,
    details: question.details,
    category: question.category,
    options_metadata: question.options_metadata,
    is_auto_title: question.is_auto_title,
    // Migration 098: these fields live on the poll wrapper now.
    min_responses: poll?.min_responses ?? null,
    show_preliminary_results: poll?.show_preliminary_results ?? true,
    allow_pre_ranking: poll?.allow_pre_ranking ?? true,
  };
}

// Initialize cleanup on module load (only in browser)
if (typeof window !== 'undefined') {
  // Run cleanup immediately
  cleanupOldQuestions();
  
  // Set up periodic cleanup (run once per day when the module is loaded)
  const lastCleanup = localStorage.getItem('last_question_cleanup');
  const today = new Date().toDateString();
  
  if (lastCleanup !== today) {
    cleanupOldQuestions();
    localStorage.setItem('last_question_cleanup', today);
  }
}