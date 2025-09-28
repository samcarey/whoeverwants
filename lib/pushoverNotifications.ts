// Pushover notification utility for development notifications
import Push from 'pushover-notifications';

// Initialize Pushover client
const createPushoverClient = () => {
  const userKey = process.env.PUSHOVER_USER_KEY;
  const apiToken = process.env.PUSHOVER_APP_TOKEN;

  if (!userKey || !apiToken) {
    console.warn('Pushover credentials not configured. Notifications disabled.');
    return null;
  }

  return new Push({
    user: userKey,
    token: apiToken,
  });
};

// Send development notification
export const sendDevNotification = async (
  message: string, 
  options: {
    title?: string;
    priority?: number;
    sound?: string;
    url?: string;
    url_title?: string;
  } = {}
) => {
  const pushover = createPushoverClient();
  
  if (!pushover) {
    console.log('Would send Pushover notification:', { ...options, message });
    return;
  }

  const notification = {
    message,
    title: options.title || '🛠️ Dev Notification',
    sound: options.sound || 'pushover',
    priority: options.priority || 0,
    url: options.url,
    url_title: options.url_title
  };

  return new Promise((resolve, reject) => {
    pushover.send(notification, (err: any, result: any) => {
      if (err) {
        console.error('Failed to send Pushover notification:', err);
        reject(err);
      } else {
        console.log('Pushover notification sent successfully:', result);
        resolve(result);
      }
    });
  });
};