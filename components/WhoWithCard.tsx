"use client";

/**
 * The slot form's "Who With" card: who the caller is willing to do the slot's
 * activities with. Sits right before the Activities section in <NewSlotSheet>.
 *
 * The field defaults to "Anyone". Tapping it opens a combo box with three
 * modes — Anyone / Group / Pick. Choosing "Group" reveals a list of the
 * caller's groups (multi-select); choosing "Pick" reveals a name-search over
 * the caller's contacts (the same address book the group invite-members
 * search uses), multi-select.
 *
 * Scope note: this is form-local UI state only — the selection is NOT yet
 * persisted on the slot (the Slot model carries no audience field). The
 * component self-resets to "Anyone" on each open because <NewSlotSheet>
 * unmounts its body while closed. When persistence lands, lift this state up
 * and seed it from the edited slot.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGetMyGroups, apiGetMyEmptyGroups } from "@/lib/api";
import { apiListContacts, type Contact } from "@/lib/api/slots";
import { buildGroups, type Group } from "@/lib/groupUtils";
import GroupAvatar from "@/components/GroupAvatar";
import InitialBubble from "@/components/InitialBubble";

type WhoWithMode = "anyone" | "group" | "pick";

const MODES: { key: WhoWithMode; label: string }[] = [
  { key: "anyone", label: "Anyone" },
  { key: "group", label: "Group" },
  { key: "pick", label: "Pick" },
];

const CheckDisc = ({ checked }: { checked: boolean }) => (
  <span
    role="checkbox"
    aria-checked={checked}
    className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
      checked
        ? "bg-blue-500 border-blue-500 dark:bg-blue-500 dark:border-blue-500"
        : "border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900"
    }`}
  >
    {checked && (
      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )}
  </span>
);

export default function WhoWithCard() {
  const [mode, setMode] = useState<WhoWithMode>("anyone");
  const [comboOpen, setComboOpen] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());

  // Lazily-loaded pick sources (null = not fetched yet).
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [personQuery, setPersonQuery] = useState("");

  // Fetch the caller's groups the first time "Group" is chosen.
  useEffect(() => {
    if (mode !== "group" || groups !== null) return;
    let alive = true;
    (async () => {
      try {
        const [polls, empty] = await Promise.all([apiGetMyGroups(), apiGetMyEmptyGroups()]);
        const built = buildGroups(polls, new Set(), new Set(), empty).filter((g) => g.groupId);
        if (alive) setGroups(built);
      } catch {
        if (alive) setGroups([]);
      }
    })();
    return () => { alive = false; };
  }, [mode, groups]);

  // Fetch the caller's contacts the first time "Pick" is chosen.
  useEffect(() => {
    if (mode !== "pick" || contacts !== null) return;
    let alive = true;
    (async () => {
      try {
        const list = await apiListContacts();
        if (alive) setContacts(list);
      } catch {
        if (alive) setContacts([]);
      }
    })();
    return () => { alive = false; };
  }, [mode, contacts]);

  const toggleGroup = useCallback((id: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const togglePerson = useCallback((id: string) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const chooseMode = (m: WhoWithMode) => {
    setMode(m);
    setComboOpen(false);
  };

  // Summary shown in the collapsed field (the tappable value).
  const fieldValue = useMemo(() => {
    if (mode === "anyone") return "Anyone";
    if (mode === "group") {
      if (selectedGroupIds.size === 0) return "Group";
      const names = (groups ?? [])
        .filter((g) => g.groupId && selectedGroupIds.has(g.groupId))
        .map((g) => g.title);
      return names.length ? names.join(", ") : `${selectedGroupIds.size} group${selectedGroupIds.size === 1 ? "" : "s"}`;
    }
    // pick
    if (selectedPersonIds.size === 0) return "Pick";
    return `${selectedPersonIds.size} ${selectedPersonIds.size === 1 ? "person" : "people"}`;
  }, [mode, selectedGroupIds, selectedPersonIds, groups]);

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    const q = personQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => (c.name ?? "").toLowerCase().includes(q));
  }, [contacts, personQuery]);

  return (
    <div>
      <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
        Who With
      </label>
      <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
        {/* The value field — tap to open the mode combo box. */}
        <button
          type="button"
          onClick={() => setComboOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={comboOpen}
          className="w-full h-12 flex items-center justify-between gap-3 text-left active:opacity-70"
        >
          <span className={`min-w-0 truncate text-base ${mode === "anyone" ? "text-gray-500 dark:text-gray-400" : ""}`}>
            {fieldValue}
          </span>
          <svg
            className={`shrink-0 w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${comboOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Combo box: choose the mode. */}
        {comboOpen && (
          <ul className="py-1" role="listbox" aria-label="Who with">
            {MODES.map((m) => {
              const active = mode === m.key;
              return (
                <li key={m.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => chooseMode(m.key)}
                    className="w-full h-11 flex items-center justify-between gap-3 text-left text-base active:opacity-70"
                  >
                    <span>{m.label}</span>
                    {active && (
                      <svg className="shrink-0 w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Group picker — revealed when the mode is "Group". */}
        {mode === "group" && (
          <div className="py-2">
            {groups === null ? (
              <p className="py-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="py-2 text-sm text-gray-500 dark:text-gray-400">You&apos;re not in any groups yet.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto -mx-1">
                {groups.map((g) => {
                  const id = g.groupId as string;
                  const checked = selectedGroupIds.has(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(id)}
                        aria-pressed={checked}
                        className="w-full flex items-center gap-3 px-1 h-12 text-left active:opacity-70"
                      >
                        <CheckDisc checked={checked} />
                        <GroupAvatar
                          imageUrl={g.imageUrl}
                          names={g.participantNames}
                          anonymousCount={0}
                          sizeClassName="w-8"
                        />
                        <span className="flex-1 min-w-0 truncate text-base">{g.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Individual picker — revealed when the mode is "Pick". */}
        {mode === "pick" && (
          <div className="py-2">
            <input
              type="text"
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
              placeholder="Search by name"
              aria-label="Search people by name"
              className="w-full h-11 px-4 mb-2 rounded-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {contacts === null ? (
              <p className="py-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : filteredContacts.length === 0 ? (
              <p className="py-2 text-sm text-gray-500 dark:text-gray-400">
                {contacts.length === 0
                  ? "No one to pick yet. People you share groups with show up here."
                  : "No people match your search."}
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto -mx-1">
                {filteredContacts.map((c) => {
                  const checked = selectedPersonIds.has(c.user_id);
                  return (
                    <li key={c.user_id}>
                      <button
                        type="button"
                        onClick={() => togglePerson(c.user_id)}
                        aria-pressed={checked}
                        className="w-full flex items-center gap-3 px-1 h-12 text-left active:opacity-70"
                      >
                        <CheckDisc checked={checked} />
                        <InitialBubble name={c.name} imageUrl={null} sizeClassName="w-8 h-8" className="shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-base">{c.name ?? "Unnamed"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
