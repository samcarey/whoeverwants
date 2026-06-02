/**
 * Horizontal rule with a centered label, used to separate sign-in sections
 * (the "or" between email and provider buttons in `SignInOptions`, and the
 * "or just provide a name/alias" between provider buttons and the name field
 * in `SignInModal` / `AccountGateModal`). Presentational only.
 */
export default function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}
