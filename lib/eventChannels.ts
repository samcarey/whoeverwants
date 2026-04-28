/**
 * Cross-component custom event channels.
 *
 * Pattern matches `QUESTION_VOTES_CHANGED_EVENT` in `lib/api/votes.ts`:
 * a string-named CustomEvent dispatched on `window` with a typed `detail`
 * payload, so listeners can subscribe across module / portal boundaries
 * without prop drilling. Centralized here so the dispatcher and listener
 * sides can't drift apart.
 *
 * Add a new event by exporting a const + a `*Detail` type alongside it.
 */

/** Open/close state of the top "New Question" form modal. Listened to by
 *  `template.tsx` to hide the floating What/When/Where bubble bar while the
 *  form is open (per spec: either the buttons or the form, not both). */
export const QUESTION_FORM_STATE_CHANGE_EVENT = 'questionFormStateChange';
export interface QuestionFormStateChangeDetail {
  open: boolean;
}

/** Request from the bubble bar to open the top "New Question" form when the
 *  bottom panel is already open. CreateQuestionContent listens and calls its
 *  `handleOpenNewQuestion` with the preselect detail. */
export const OPEN_QUESTION_FORM_EVENT = 'openQuestionForm';
export interface OpenQuestionFormDetail {
  mode?: 'question' | 'time';
  category?: string;
}

/** Submit-time signal: CreateQuestionContent has resolved apiCreatePoll and
 *  is about to navigate. template.tsx listens to slide the bottom panel down
 *  in lockstep with the draft-poll-card morph animation. */
export const CREATE_PANEL_FINALIZE_EVENT = 'createPanelFinalize';
