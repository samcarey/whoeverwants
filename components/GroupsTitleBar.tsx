/**
 * The "Groups" bar at the top of /groups. Shared by the real page (fixed,
 * pinned to the viewport top while the list scrolls under it) and by
 * GroupsBackdropHost's swipe-back mirror (in flow at the top of the contained
 * box), so the two can't drift — the same split ExploreTitleBar uses.
 */

export default function GroupsTitleBar({ fixed = false }: { fixed?: boolean }) {
  return (
    <div
      className={
        fixed
          ? "fixed top-0 left-0 right-0 z-20 bg-background"
          : "bg-background"
      }
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="h-14 flex items-center justify-center">
        <h1 className="text-2xl font-bold select-none">Groups</h1>
      </div>
    </div>
  );
}
