'use client';

import { useId } from 'react';
import SliderSwitch from './SliderSwitch';
import CompactNumberRow from './CompactNumberRow';

interface CompactMinResponsesFieldProps {
  value: number;
  setValue: (value: number) => void;
  showPreliminary: boolean;
  setShowPreliminary: (value: boolean) => void;
  disabled?: boolean;
}

export default function CompactMinResponsesField({ value, setValue, showPreliminary, setShowPreliminary, disabled = false }: CompactMinResponsesFieldProps) {
  const checkboxId = useId();

  return (
    <>
      <CompactNumberRow label="Minimum Votes" value={value} setValue={setValue} disabled={disabled} />
      <div
        className={`flex items-center justify-between gap-3 h-12 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={() => { if (!disabled) setShowPreliminary(!showPreliminary); }}
      >
        <span id={checkboxId} className="text-base font-normal">
          Show Results After Min Votes
        </span>
        <SliderSwitch
          checked={showPreliminary}
          onChange={setShowPreliminary}
          disabled={disabled}
          aria-labelledby={checkboxId}
        />
      </div>
    </>
  );
}
