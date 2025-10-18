import MinMaxCounter from './MinMaxCounter';

interface ParticipationConditionsProps {
  minValue: number | null;
  maxValue: number | null;
  maxEnabled: boolean;
  onMinChange: (value: number | null) => void;
  onMaxChange: (value: number | null) => void;
  onMaxEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export default function ParticipationConditions({
  minValue,
  maxValue,
  maxEnabled,
  onMinChange,
  onMaxChange,
  onMaxEnabledChange,
  disabled = false,
}: ParticipationConditionsProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        How many participants?
      </label>
      <MinMaxCounter
        minValue={minValue}
        maxValue={maxValue}
        maxEnabled={maxEnabled}
        onMinChange={onMinChange}
        onMaxChange={onMaxChange}
        onMaxEnabledChange={onMaxEnabledChange}
        increment={1}
        minLimit={1}
        disabled={disabled}
      />
    </div>
  );
}
