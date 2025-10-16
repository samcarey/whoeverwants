"use client";

interface CounterInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  increment?: number;
  min: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export default function CounterInput({
  value,
  onChange,
  increment = 1,
  min,
  max,
  disabled = false,
  placeholder = '',
  className = ''
}: CounterInputProps) {
  const handleIncrement = () => {
    const currentValue = value ?? min;
    const newValue = currentValue + increment;
    if (max === undefined || newValue <= max) {
      onChange(newValue);
    }
  };

  const handleDecrement = () => {
    const currentValue = value ?? min;
    const newValue = currentValue - increment;
    if (newValue >= min) {
      onChange(newValue);
    }
  };

  const handleInputChange = (inputValue: string) => {
    if (inputValue === '') {
      onChange(null);
    } else if (/^\d+$/.test(inputValue)) {
      const newValue = parseInt(inputValue);
      if (!isNaN(newValue)) {
        // Only update if within bounds
        if ((max === undefined || newValue <= max) && newValue >= min) {
          onChange(newValue);
        }
      }
    }
  };

  const handleBlur = () => {
    // Reset to min if empty or invalid on blur
    if (value === null || value < min) {
      onChange(min);
    } else if (max !== undefined && value > max) {
      onChange(max);
    }
  };

  const isDecrementDisabled = disabled || (value ?? min) <= min;
  const isIncrementDisabled = disabled || (max !== undefined && (value ?? min) >= max);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={handleIncrement}
          disabled={isIncrementDisabled}
          className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleDecrement}
          disabled={isDecrementDisabled}
          className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={value ?? ''}
        onChange={(e) => handleInputChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder}
        className="w-16 px-3 py-2 text-center text-xl font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
    </div>
  );
}
