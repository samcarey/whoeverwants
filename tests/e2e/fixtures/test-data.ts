export interface PollTestData {
  title: string;
  description?: string;
  type: 'poll' | 'nomination';
  options?: string[];
  deadline?: string;
  customDate?: string;
  customTime?: string;
  creatorName?: string;
}

export const testPolls = {
  yesNo: {
    title: 'Should we have pizza for lunch?',
    type: 'poll' as const,
    deadline: '10min',
    creatorName: 'Test User'
  },
  
  rankedChoice: {
    title: 'What should we watch tonight?',
    type: 'poll' as const,
    options: ['Action Movie', 'Comedy Show', 'Documentary'],
    deadline: '1hr',
    creatorName: 'Movie Buff'
  },
  
  nomination: {
    title: 'Restaurant recommendations for dinner',
    type: 'nomination' as const,
    options: ['Italian Place Downtown', 'Sushi Bar'],
    deadline: '4hr',
    creatorName: 'Food Lover'
  },
  
  customDeadline: {
    title: 'Weekend activity planning',
    type: 'poll' as const,
    options: ['Hiking', 'Beach Day', 'Museum Visit'],
    deadline: 'custom',
    customDate: '2025-12-31',
    customTime: '18:00',
    creatorName: 'Weekend Planner'
  }
} as const;

export const testUsers = {
  creator: {
    name: 'Test Creator',
    email: 'creator@example.com'
  },
  
  voter1: {
    name: 'Alice Voter',
    email: 'alice@example.com'
  },
  
  voter2: {
    name: 'Bob Voter', 
    email: 'bob@example.com'
  }
} as const;

// Helper function to get tomorrow's date in YYYY-MM-DD format
export function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// Helper function to get a time 1 hour from now in HH:MM format
export function getOneHourFromNow(): string {
  const oneHour = new Date();
  oneHour.setHours(oneHour.getHours() + 1);
  return oneHour.toTimeString().slice(0, 5);
}