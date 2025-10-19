import MinMaxCounter from './MinMaxCounter';

interface ParticipationConditionsProps {
  minValue: number | null;
  maxValue: number | null;
  maxEnabled: boolean;
  onMinChange: (value: number | null) => void;
  onMaxChange: (value: number | null) => void;
  onMaxEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  pollMinParticipants?: number | null;
  pollMaxParticipants?: number | null;
  // Duration props
  durationMinValue?: number | null;
  durationMaxValue?: number | null;
  durationMinEnabled?: boolean;
  durationMaxEnabled?: boolean;
  onDurationMinChange?: (value: number | null) => void;
  onDurationMaxChange?: (value: number | null) => void;
  onDurationMinEnabledChange?: (enabled: boolean) => void;
  onDurationMaxEnabledChange?: (enabled: boolean) => void;
}

export default function ParticipationConditions({
  minValue,
  maxValue,
  maxEnabled,
  onMinChange,
  onMaxChange,
  onMaxEnabledChange,
  disabled = false,
  pollMinParticipants = null,
  pollMaxParticipants = null,
  durationMinValue = null,
  durationMaxValue = null,
  durationMinEnabled = false,
  durationMaxEnabled = false,
  onDurationMinChange,
  onDurationMaxChange,
  onDurationMinEnabledChange,
  onDurationMaxEnabledChange,
}: ParticipationConditionsProps) {
  // Calculate enforced limits based on poll constraints
  // Voter's min must be >= poll's min
  const enforcedMinLimit = pollMinParticipants ?? 1;

  // Voter's max must be <= poll's max (if poll has a max)
  const enforcedMaxLimit = pollMaxParticipants ?? undefined;

  // If poll requires a max, voter cannot disable it
  const maxRequired = pollMaxParticipants !== null && pollMaxParticipants !== undefined;

  // Format duration values to show decimals nicely (remove trailing zeros)
  const formatDurationValue = (value: number) => {
    // Use toFixed for precision, then parse to remove trailing zeros
    return parseFloat(value.toFixed(2)).toString();
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-2">
          Number of participants
        </label>
        <MinMaxCounter
          minValue={minValue}
          maxValue={maxValue}
          maxEnabled={maxEnabled}
          onMinChange={onMinChange}
          onMaxChange={onMaxChange}
          onMaxEnabledChange={onMaxEnabledChange}
          increment={1}
          minLimit={enforcedMinLimit}
          maxLimit={enforcedMaxLimit}
          maxRequired={maxRequired}
          disabled={disabled}
        />
      </div>

      {onDurationMinChange && onDurationMaxChange && onDurationMinEnabledChange && onDurationMaxEnabledChange && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Duration (hours)
          </label>
          <MinMaxCounter
            minValue={durationMinValue}
            maxValue={durationMaxValue}
            maxEnabled={durationMaxEnabled}
            onMinChange={onDurationMinChange}
            onMaxChange={onDurationMaxChange}
            onMaxEnabledChange={onDurationMaxEnabledChange}
            increment={0.25}
            minLimit={0.25}
            disabled={disabled}
            formatValue={formatDurationValue}
            minCheckboxEnabled={durationMinEnabled}
            onMinCheckboxChange={onDurationMinEnabledChange}
          />
        </div>
      )}
    </div>
  );
}
