/**
 * DOM markers shared between the thread page (writer) and the
 * create-poll component (reader). Hardcoding these strings at each
 * call site invites typos that silently break the integration —
 * keep them centralized.
 */

/** `<body data-thread-latest-question-id="...">` is set by the thread
 *  page on mount with the id of the latest question. The in-card
 *  bubble bar in CreateQuestionContent reads it to auto-attach the
 *  new question as a follow-up. */
export const THREAD_LATEST_QUESTION_ID_ATTR = 'data-thread-latest-question-id';

/** Portal target rendered by the thread page (and the empty `/p/`
 *  placeholder) where CreateQuestionContent portals the always-on
 *  draft poll card. */
export const DRAFT_POLL_PORTAL_ID = 'draft-poll-portal';
