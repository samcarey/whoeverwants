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
  getRecurrenceForPoll,
  RECURRENCE_STORE_CHANGED_EVENT,
} from "@/lib/recurrenceStore";
import {
  generateOccurrences,
  summarizeRecurrence,
  formatLocalDateISO,
} from "@/lib/recurrence";
import { getCategoryIcon } from "@/lib/questionListUtils";
import { ROW_DIVIDER_CLASS } from "@/app/g/[groupShortId]/GroupCardItem";
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

  // Recompute when the recurrence store changes (e.g. right after creating a
  // recurring poll and navigating here).
  const [storeTick, setStoreTick] = useState(0);
  useEffect(() => {
    const onChange = () => setStoreTick((t) => t + 1);
    window.addEventListener(RECURRENCE_STORE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RECURRENCE_STORE_CHANGED_EVENT, onChange);
  }, []);

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
      const stored = getRecurrenceForPoll(poll.id);
      if (!stored) continue;
      // Generate enough occurrences to skip ones in the past, then take the
      // next few that open strictly after today (the first instance IS the
      // poll that already exists).
      const occ = generateOccurrences(stored.rule, stored.start, { limit: PER_POLL + 30 });
      const future = occ
        .map((d) => ({ d, iso: formatLocalDateISO(d) }))
        .filter(({ iso }) => iso > todayISO)
        .slice(0, PER_POLL);
      const summary = summarizeRecurrence(stored.rule, stored.start);
      for (const { d, iso } of future) {
        out.push({ poll, dateISO: iso, date: d, summary });
      }
    }
    out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    return out.slice(0, TOTAL_CAP);
    // storeTick forces a recompute on store writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, storeTick]);

  const groupName = group?.title ?? null;

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
            paddingLeft: "calc(1rem + max(0.35rem, env(safe-area-inset-left, 0px)))",
            paddingRight: "calc(1rem + max(0.35rem, env(safe-area-inset-right, 0px)))",
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
            <ul className={`border-t ${ROW_DIVIDER_CLASS}`}>
              {items.map((item, i) => (
                <ScheduledRow key={`${item.poll.id}-${item.dateISO}-${i}`} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function ScheduledRow({ item }: { item: ScheduledItem }) {
  const q = item.poll.questions[0];
  const title = q?.title || item.poll.title || "Poll";
  const icon = q ? getCategoryIcon(q) : "🗳️";
  return (
    <li className={`flex items-center gap-3 border-b ${ROW_DIVIDER_CLASS} py-3 pl-[0.9rem] pr-[0.65rem]`}>
      <span className="text-xl shrink-0" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium text-gray-900 dark:text-gray-100">{title}</div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{item.summary}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
          {item.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500">
          Opens {relativeDay(item.date)}
        </div>
      </div>
    </li>
  );
}

/** "in 3 days" / "in 2 weeks" / "in 5 months" — coarse relative phrasing for
 *  when a scheduled instance opens. */
function relativeDay(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

export default function ScheduledPage() {
  const params = useParams();
  const raw = params?.groupShortId;
  const groupId = Array.isArray(raw) ? raw[0] : (raw ?? "");
  return <ScheduledView groupId={groupId} />;
}
