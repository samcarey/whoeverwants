"use client";

interface OptionMetadata {
  imageUrl?: string;
  infoUrl?: string;
}

interface OptionLabelProps {
  text: string;
  metadata?: OptionMetadata | null;
  className?: string;
}

export default function OptionLabel({ text, metadata, className = "" }: OptionLabelProps) {
  if (!metadata || (!metadata.imageUrl && !metadata.infoUrl)) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {metadata.imageUrl && (
        <img
          src={metadata.imageUrl}
          alt=""
          className="w-5 h-7 object-cover rounded flex-shrink-0"
        />
      )}
      <span>{text}</span>
      {metadata.infoUrl && (
        <a
          href={metadata.infoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
          title="More info"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </a>
      )}
    </span>
  );
}
