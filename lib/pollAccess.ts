// Enhanced question access management with database-level security
// Replaces and extends lib/questionCreator.ts functionality

const QUESTION_ACCESS_STORAGE_KEY = 'question_access_data';
const LEGACY_CREATOR_STORAGE_KEY = 'question_creator_data';
const CLEANUP_INTERVAL_DAYS = 30;

interface QuestionAccessData {
  questionId: string;
  accessType: 'creator' | 'viewer';
  creatorSecret?: string; // Only for creator type
  createdAt: string;
  lastAccessed: string;
}

interface LegacyQuestionCreatorData {
  questionId: string;
  creatorSecret: string;
  createdAt: string;
}

// Add question access for current user
export function addQuestionAccess(
  questionId: string, 
  accessType: 'creator' | 'viewer', 
  creatorSecret?: string
): void {
  if (typeof window === 'undefined') return; // SSR safety

  const existingData = getStoredQuestionAccessData();
  
  // Check if access already exists
  const existingIndex = existingData.findIndex(data => data.questionId === questionId);
  
  if (existingIndex >= 0) {
    // Update existing record
    existingData[existingIndex] = {
      ...existingData[existingIndex],
      lastAccessed: new Date().toISOString(),
      // Upgrade viewer to creator if applicable
      accessType: existingData[existingIndex].accessType === 'creator' ? 'creator' : accessType,
      creatorSecret: creatorSecret || existingData[existingIndex].creatorSecret
    };
  } else {
    // Add new record
    const newData: QuestionAccessData = {
      questionId,
      accessType,
      creatorSecret,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };
    existingData.push(newData);
  }

  localStorage.setItem(QUESTION_ACCESS_STORAGE_KEY, JSON.stringify(existingData));
}

// Get list of all accessible question IDs
export function getQuestionAccessList(): string[] {
  const questionData = getStoredQuestionAccessData();
  return questionData.map(data => data.questionId);
}

// Check if user has access to specific question
export function hasQuestionAccess(questionId: string): boolean {
  const questionData = getStoredQuestionAccessData();
  return questionData.some(data => data.questionId === questionId);
}

// Backward compatibility: Check if question was created by this device
export function isCreatedByThisDevice(questionId: string): boolean {
  const questionData = getStoredQuestionAccessData();
  return questionData.some(data => data.questionId === questionId && data.accessType === 'creator');
}

// Backward compatibility: Get creator secret for question
export function getQuestionCreatorSecret(questionId: string): string | null {
  const questionData = getStoredQuestionAccessData();
  const found = questionData.find(data => data.questionId === questionId && data.accessType === 'creator');
  return found?.creatorSecret || null;
}

// Get stored question access data with automatic migration
function getStoredQuestionAccessData(): QuestionAccessData[] {
  if (typeof window === 'undefined') return []; // SSR safety

  try {
    // Try to get new format data
    const stored = localStorage.getItem(QUESTION_ACCESS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }

    // If new format doesn't exist, try to migrate from legacy format
    return migrateLegacyCreatorData();
  } catch (error) {
    console.error('Error parsing stored question access data:', error);
    return [];
  }
}

// Migrate from legacy question_creator_data format
export function migrateLegacyCreatorData(): QuestionAccessData[] {
  if (typeof window === 'undefined') return []; // SSR safety

  try {
    const legacyData = localStorage.getItem(LEGACY_CREATOR_STORAGE_KEY);
    if (!legacyData) {
      return [];
    }

    const legacyRecords: LegacyQuestionCreatorData[] = JSON.parse(legacyData);
    const migratedData: QuestionAccessData[] = legacyRecords.map(legacy => ({
      questionId: legacy.questionId,
      accessType: 'creator' as const,
      creatorSecret: legacy.creatorSecret,
      createdAt: legacy.createdAt,
      lastAccessed: legacy.createdAt
    }));

    // Save migrated data in new format
    localStorage.setItem(QUESTION_ACCESS_STORAGE_KEY, JSON.stringify(migratedData));

    console.log(`Migrated ${legacyRecords.length} legacy question creator records`);
    return migratedData;
  } catch (error) {
    console.error('Error migrating legacy question creator data:', error);
    return [];
  }
}

// Clean up old question access data to prevent localStorage from growing indefinitely
export function cleanupOldQuestionAccess(): void {
  if (typeof window === 'undefined') return; // SSR safety

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_INTERVAL_DAYS);

  const questionData = getStoredQuestionAccessData();
  const filteredData = questionData.filter(data => {
    const lastAccessDate = new Date(data.lastAccessed);
    return lastAccessDate >= cutoffDate;
  });

  // Only update localStorage if we actually removed something
  if (filteredData.length !== questionData.length) {
    localStorage.setItem(QUESTION_ACCESS_STORAGE_KEY, JSON.stringify(filteredData));
    console.log(`Cleaned up ${questionData.length - filteredData.length} old question access records`);
  }
}

// Get access statistics for monitoring
export function getQuestionAccessStats(): {
  totalQuestions: number;
  createdQuestions: number;
  viewedQuestions: number;
  oldestAccess: string | null;
  newestAccess: string | null;
} {
  const questionData = getStoredQuestionAccessData();
  
  const createdQuestions = questionData.filter(data => data.accessType === 'creator').length;
  const viewedQuestions = questionData.filter(data => data.accessType === 'viewer').length;
  
  const sortedByAccess = questionData.sort((a, b) => 
    new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime()
  );

  return {
    totalQuestions: questionData.length,
    createdQuestions,
    viewedQuestions,
    oldestAccess: sortedByAccess[0]?.lastAccessed || null,
    newestAccess: sortedByAccess[sortedByAccess.length - 1]?.lastAccessed || null
  };
}

// Initialize migration and cleanup on module load (browser only)
if (typeof window !== 'undefined') {
  // Run migration immediately
  migrateLegacyCreatorData();
  
  // Run cleanup immediately
  cleanupOldQuestionAccess();
  
  // Set up periodic cleanup (run once per day when the module is loaded)
  const lastCleanup = localStorage.getItem('last_question_access_cleanup');
  const today = new Date().toDateString();
  
  if (lastCleanup !== today) {
    cleanupOldQuestionAccess();
    localStorage.setItem('last_question_access_cleanup', today);
  }
}