"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Poll } from "@/lib/types";
import { apiGetSubPolls } from "@/lib/api";
import { getCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";

interface SubPollFieldProps {
  poll: Poll;
}

export default function SubPollField({ poll }: SubPollFieldProps) {
  const [subPolls, setSubPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hasLocationField = poll.location_mode && poll.location_mode !== 'set';
    const hasTimeField = poll.time_mode && poll.time_mode !== 'set';
    if (!hasLocationField && !hasTimeField) {
      setLoading(false);
      return;
    }
    apiGetSubPolls(poll.id)
      .then((polls) => {
        setSubPolls(polls);
        const parentSecret = getCreatorSecret(poll.id);
        if (parentSecret) {
          for (const sp of polls) {
            if (!getCreatorSecret(sp.id)) {
              recordPollCreation(sp.id, parentSecret);
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.id]);

  if (!poll.location_mode && !poll.time_mode) return null;

  const renderField = (label: string, mode: string | null | undefined, resolvedValue: string | null | undefined, staticValue: string | null | undefined, role: string) => {
    if (!mode) return null;

    if (mode === 'set' && staticValue) {
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600 dark:text-gray-400">{label}:</span>
          <span>{staticValue}</span>
        </div>
      );
    }

    if (resolvedValue) {
      const prefsPoll = subPolls.find(sp => sp.sub_poll_role === `${role}_preferences`);
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600 dark:text-gray-400">{label}:</span>
          {prefsPoll?.short_id ? (
            <Link href={`/p/${prefsPoll.short_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
              {resolvedValue}
            </Link>
          ) : (
            <span>{resolvedValue}</span>
          )}
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600 dark:text-gray-400">{label}:</span>
          <span className="text-gray-400 dark:text-gray-500">Loading...</span>
        </div>
      );
    }

    const suggestionsPoll = subPolls.find(sp => sp.sub_poll_role === `${role}_suggestions` && !sp.is_closed);
    const prefsPoll = subPolls.find(sp => sp.sub_poll_role === `${role}_preferences` && !sp.is_closed);
    const activePoll = suggestionsPoll || prefsPoll;

    if (activePoll) {
      const actionText = suggestionsPoll ? `Suggest a ${label.toLowerCase()}` : `Vote on ${label.toLowerCase()}`;
      return (
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-600 dark:text-gray-400">{label}:</span>
            <Link
              href={`/p/${activePoll.short_id || activePoll.id}`}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {actionText}
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-600 dark:text-gray-400">{label}:</span>
        <span className="text-gray-400 dark:text-gray-500 italic">Resolving...</span>
      </div>
    );
  };

  return (
    <div className="space-y-2 mb-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      {renderField("Location", poll.location_mode, poll.resolved_location, poll.location_value, "location")}
      {renderField("Time", poll.time_mode, poll.resolved_time, poll.time_value, "time")}
    </div>
  );
}
