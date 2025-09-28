declare module 'pushover-notifications' {
  interface PushoverOptions {
    user: string;
    token: string;
  }

  interface NotificationOptions {
    message: string;
    title?: string;
    sound?: string;
    priority?: number;
    url?: string;
    url_title?: string;
  }

  class Push {
    constructor(options: PushoverOptions);
    send(notification: NotificationOptions, callback: (err: any, result: any) => void): void;
  }

  export = Push;
}