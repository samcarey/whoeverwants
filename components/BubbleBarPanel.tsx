"use client";

import { DRAFT_POLL_PORTAL_ID } from "@/lib/groupDomMarkers";

/**
 * CSS variable set on `<html>` to the create-poll search bar's height, so
 * the group page can reserve matching bottom padding (its last poll card
 * clears the floating pill). Written by `CreateQuestionContent` (which
 * renders + measures the bar); exported here so consumers don't hand-write
 * the name. A `:root` default in globals.css covers the first paint before
 * the bar mounts + measures.
 */
export const PANEL_HEIGHT_VAR = "--bubble-bar-panel-height";

/**
 * Route-gated mount point for the create-poll search bar.
 *
 * The bar's JSX — an always-visible pill text box that expands into a
 * full-screen, keyboard-aware category picker on focus — is owned by
 * `CreateQuestionContent` (in the root layout) and portaled into the
 * `#draft-poll-portal` div below. This component is just the mount point:
 * `BubbleBarHost` renders it on group-root views, so the bar appears only
 * where a portal target exists.
 *
 * It has NO chrome and NO transform of its own. That's load-bearing: the
 * portaled bar is `position: fixed`, and a transform on this wrapper would
 * make that fixed positioning resolve relative to the wrapper instead of the
 * viewport — breaking the focused picker's full-screen + above-keyboard
 * layout. (BubbleBarHost mounts this at the layout level, outside
 * ResponsiveScaling's transform, for the same reason.)
 */
export default function BubbleBarPanel(): React.ReactElement {
  return <div id={DRAFT_POLL_PORTAL_ID} />;
}
