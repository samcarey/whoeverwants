"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import GroupHeader from "@/components/GroupHeader";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { useSwipeBackGesture } from "@/lib/useSwipeBackGesture";
import { slideToGroupRoot } from "@/lib/slideOverlay";
import { hasAppHistory } from "@/lib/viewTransitions";
import {
  SHOW_GROUP_BACKDROP_EVENT,
  HIDE_GROUP_BACKDROP_EVENT,
  type GroupBackdropShowDetail,
} from "@/lib/eventChannels";
import {
  generateOccurrences,
  summarizeRecurrence,
  recurrenceIsActive,
  formatLocalDateISO,
} from "@/lib/recurrence";
import { apiCancelRecurrence } from "@/lib/api/polls";
import { getCategoryIcon } from "@/lib/questionListUtils";
import { ROW_DIVIDER_CLASS } from "@/app/g/[groupShortId]/GroupCardItem";
import RecurrenceCancelSheet from "@/components/RecurrenceCancelSheet";
import { haptic } from "@/lib/haptics";
import { useLongPress } from "@/lib/useLongPress";
import type { Poll } from "@/lib/types";

interface ScheduledViewProps {
  groupId: string;
  /** Unused here (Scheduled lands top-scroll), accepted for slide-overlay parity. */
  overlayCardsOffset?: number;
}

interface ScheduledItem {
  poll: Poll;
  /** Local YYYY-MM-DD the instance opens. */
  dateISO: string;
  date: Date;
  summary: string;
}

/** How many future occurrences to show per recurring poll. */
const PER_POLL = 4;
/** Total cap across all recurring polls. */
const TOTAL_CAP = 40;

export function ScheduledView({ groupId }: ScheduledViewProps) {
  const router = useRouter();
  const { group, loading } = useGroup(groupId);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([!!group], 80);

  // Optimistic cancellations, applied on top of the server data so a cancel
  // reflects instantly without re-fetching the whole group. Keyed by anchor id:
  // `extraSkip` holds individually-cancelled dates; `extraUntil` is the
  // soonest series-cutoff date. The server is updated for persistence.
  const [extraSkip, setExtraSkip] = useState<Record<string, Set<string>>>({});
  const [extraUntil, setExtraUntil] = useState<Record<string, string>>({});
  const [sheetItem, setSheetItem] = useState<ScheduledItem | null>(null);
  const [busy, setBusy] = useState(false);

  const goBack = () => {
    slideToGroupRoot({ groupId, direction: "back", useHistoryBack: hasAppHistory() });
  };

  // Swipe-back → group root (mirrors the poll detail page). The group backdrop
  // renders the group behind the page during the drag; on commit we navigate
  // directly with router.push (the backdrop is already showing the group).
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef,
    showBackdrop: () => {
      window.dispatchEvent(
        new CustomEvent<GroupBackdropShowDetail>(SHOW_GROUP_BACKDROP_EVENT, {
          detail: { groupId },
        }),
      );
    },
    hideBackdrop: () => {
      window.dispatchEvent(new Event(HIDE_GROUP_BACKDROP_EVENT));
    },
    onCommit: () => router.push(`/g/${groupId}`),
  });

  const items = useMemo<ScheduledItem[]>(() => {
    if (!group) return [];
    const todayISO = formatLocalDateISO(new Date());
    const out: ScheduledItem[] = [];
    for (const poll of group.polls) {
      // Only ANCHOR polls carry the rule; materialized children have
      // recurrence === null, so they're excluded naturally.
      const rule = poll.recurrence;
      if (!recurrenceIsActive(rule) || !rule) continue;
      const start = rule.start ?? formatLocalDateISO(poll.created_at ? new Date(poll.created_at) : new Date());
      const skip = new Set([
        ...(poll.recurrence_skip_dates ?? []),
        ...Array.from(extraSkip[poll.id] ?? []),
      ]);
      const untilCandidates = [poll.recurrence_until, extraUntil[poll.id]].filter(Boolean) as string[];
      const until = untilCandidates.length ? untilCandidates.sort()[0] : null;
      // Generate enough to skip past occurrences, then keep the next few that
      // open strictly after today (the first instance IS the existing poll).
      const occ = generateOccurrences(rule, start, { limit: PER_POLL + 60 });
      const summary = summarizeRecurrence(rule, start);
      let kept = 0;
      for (const d of occ) {
        const iso = formatLocalDateISO(d);
        if (iso <= todayISO) continue;
        if (until && iso >= until) break;
        if (skip.has(iso)) continue;
        out.push({ poll, dateISO: iso, date: d, summary });
        if (++kept >= PER_POLL) break;
      }
    }
    out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    return out.slice(0, TOTAL_CAP);
  }, [group, extraSkip, extraUntil]);

  const groupName = group?.title ?? null;

  // Resolve an item to the anchor poll id the cancel endpoint operates on.
  // (Scheduled rows are always anchors here, but be defensive about children.)
  const anchorIdFor = (poll: Poll) => poll.recurrence_anchor_id || poll.id;

  const handleCancelOccurrence = async () => {
    if (!sheetItem) return;
    const { poll, dateISO } = sheetItem;
    const anchorId = anchorIdFor(poll);
    setBusy(true);
    setExtraSkip((prev) => ({ ...prev, [poll.id]: new Set([...(prev[poll.id] ?? []), dateISO]) }));
    setSheetItem(null);
    try {
      await apiCancelRecurrence(anchorId, "occurrence", dateISO);
    } catch {
      /* optimistic; a refresh will reconcile */
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSeries = async () => {
    if (!sheetItem) return;
    const { poll, dateISO } = sheetItem;
    const anchorId = anchorIdFor(poll);
    setBusy(true);
    setExtraUntil((prev) => ({ ...prev, [poll.id]: dateISO }));
    setSheetItem(null);
    try {
      await apiCancelRecurrence(anchorId, "series", dateISO);
    } catch {
      /* optimistic */
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title="Scheduled"
        subtitle={groupName}
        onBack={goBack}
        backIconVariant="menu"
        titleAriaLabel="Scheduled polls"
      />

      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 1,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          style={{
            paddingTop: `calc(${headerHeight}px + 1.25rem)`,
            // NO horizontal padding: the swipeWrapper's negative margins above
            // cancel the template/overlay `px-4` + safe-area inset, and we do
            // NOT re-apply it here — so the rows bleed edge-to-edge and their
            // dividers butt against the body's safe-area content edge, exactly
            // like the group page's cards (GroupContent does the same; the poll
            // DETAIL page re-applies the inset because its rounded cards stay
            // inset, which is the opposite of full-bleed rows).
          }}
        >
          {!loading && items.length === 0 && (
            <div className="px-2 py-16 text-center">
              <div className="text-4xl mb-3" aria-hidden>🔁</div>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                Nothing scheduled yet. Turn on <span className="font-medium">Repeat</span> when
                creating a poll and its future copies will open here automatically.
              </p>
            </div>
          )}

          {items.length > 0 && (
            // Sentinel top divider (mirrors the group page's first-row divider).
            <div className={`border-t ${ROW_DIVIDER_CLASS}`}>
              {items.map((item, i) => (
                <ScheduledRow
                  key={`${item.poll.id}-${item.dateISO}-${i}`}
                  item={item}
                  onLongPress={() => { haptic.medium(); setSheetItem(item); }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {sheetItem && (
        <RecurrenceCancelSheet
          isOpen={true}
          pollTitle={sheetItem.poll.questions[0]?.title || sheetItem.poll.title || "Poll"}
          occurrenceLabel={sheetItem.date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
          busy={busy}
          onCancelOccurrence={handleCancelOccurrence}
          onCancelSeries={handleCancelSeries}
          onClose={() => setSheetItem(null)}
        />
      )}
    </>
  );
}

/**
 * A scheduled-instance row that mirrors the group page's poll card
 * (GroupCardItem) — same edge-to-edge rectangle, padding, divider, title row
 * (category icon + title at text-lg, hang-indented), and bottom metadata row
 * (author · detail on the left, status on the right). The only key details
 * swapped for a not-yet-open instance: the creation date → the OPEN date
 * ("Opens <date>"), and the votes/views/countdown corner → the recurrence
 * cadence ("Weekly on Tue").
 */
function ScheduledRow({ item, onLongPress }: { item: ScheduledItem; onLongPress: () => void }) {
  const q = item.poll.questions[0];
  const title = q?.title || item.poll.title || "Poll";
  const icon = q ? getCategoryIcon(q) : "🗳️";
  const creatorName = item.poll.creator_name;
  const { props: longPressProps, isPressed } = useLongPress(onLongPress);
  const openDate = item.date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div
      {...longPressProps}
      className={`relative overflow-x-clip border-b ${ROW_DIVIDER_CLASS} select-none cursor-pointer transition-colors ${
        isPressed ? "bg-blue-100 dark:bg-blue-900/40" : ""
      }`}
    >
      <div className="relative z-10 pl-[0.9rem] pr-[0.65rem] pt-[7px] pb-1">
        {/* Title row — mirrors TitleResultRow's no-result branch. */}
        <div className="min-w-0">
          <h3 className="flex items-start font-medium text-lg leading-tight text-gray-900 dark:text-white">
            <span className="mr-1.5 shrink-0" aria-hidden="true">{icon}</span>
            <span className="min-w-0">{title}</span>
          </h3>
        </div>

        {/* Bottom row — mirrors the group card: author · date (left), status
            (right). Creation date → open date; vote/view counts → cadence. */}
        <div className="mt-2 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-baseline min-w-0 text-xs text-gray-400 dark:text-gray-500">
            {creatorName && (
              <>
                <span className="truncate shrink min-w-0">{creatorName}</span>
                <span className="shrink-0">&nbsp;&middot;&nbsp;</span>
              </>
            )}
            <span className="shrink-0 whitespace-nowrap">Opens {openDate}</span>
          </div>
          <div className="shrink-0 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {item.summary}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScheduledPage() {
  const params = useParams();
  const raw = params?.groupShortId;
  const groupId = Array.isArray(raw) ? raw[0] : (raw ?? "");
  return <ScheduledView groupId={groupId} />;
}
