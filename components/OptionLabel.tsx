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

  const content = (
    <>
      {metadata.imageUrl && (
        <img
          src={metadata.imageUrl}
          alt=""
          className="w-5 h-7 object-cover rounded flex-shrink-0"
          loading="lazy"
        />
      )}
      <span>{text}</span>
    </>
  );

  if (metadata.infoUrl) {
    return (
      <a
        href={metadata.infoUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline ${className}`}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {content}
    </span>
  );
}
