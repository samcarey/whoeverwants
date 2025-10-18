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
}: ParticipationConditionsProps) {
  // Calculate enforced limits based on poll constraints
  // Voter's min must be >= poll's min
  const enforcedMinLimit = pollMinParticipants ?? 1;

  // Voter's max must be <= poll's max (if poll has a max)
  const enforcedMaxLimit = pollMaxParticipants ?? undefined;

  // If poll requires a max, voter cannot disable it
  const maxRequired = pollMaxParticipants !== null && pollMaxParticipants !== undefined;

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
        minLimit={enforcedMinLimit}
        maxLimit={enforcedMaxLimit}
        maxRequired={maxRequired}
        disabled={disabled}
      />
    </div>
  );
}
