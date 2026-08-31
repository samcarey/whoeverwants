/**
 * The "Contacts" bar at the top of /contacts — same split as GroupsTitleBar
 * (fixed variant for the live page, in-flow variant for any future backdrop
 * mirror) so the two can't drift.
 */

export default function ContactsTitleBar({ fixed = false }: { fixed?: boolean }) {
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
        <h1 className="text-2xl font-bold select-none">Contacts</h1>
      </div>
    </div>
  );
}
