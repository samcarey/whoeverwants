import { ANONYMOUS_FALLBACK_COLOR, nameToColor } from "@/components/RespondentCircles";
import { getUserInitials } from "@/lib/userProfile";

const BASE_CLASS =
  "w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs select-none";

export default function InitialBubble({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  const backgroundColor = name?.trim() ? nameToColor(name) : ANONYMOUS_FALLBACK_COLOR;
  return (
    <div
      className={className ? `${BASE_CLASS} ${className}` : BASE_CLASS}
      style={{ backgroundColor }}
      aria-hidden="true"
    >
      {getUserInitials(name)}
    </div>
  );
}
