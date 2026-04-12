import OptionLabel from './OptionLabel';
import type { OptionsMetadata } from '@/lib/types';

interface ReadOnlyTierCardsProps {
  tiers: string[][];
  optionsMetadata?: OptionsMetadata | null;
}

export default function ReadOnlyTierCards({ tiers, optionsMetadata }: ReadOnlyTierCardsProps) {
  let posSoFar = 0;
  return tiers.map((tier, tierIdx) => {
    const rank = posSoFar + 1;
    posSoFar += tier.length;
    return (
      <div key={tierIdx} className="flex items-center gap-2">
        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: '32px' }}>
          <span className="w-6 h-6 flex-shrink-0 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
            {rank}
          </span>
        </div>
        <div className="flex-1 rounded-md shadow-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-500 min-w-0">
          {tier.map((choice, innerIdx) => (
            <div key={`${tierIdx}-${innerIdx}`}>
              {innerIdx > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 mx-3" />
              )}
              <div className="p-3 flex items-center min-w-0">
                <div className="min-w-0 overflow-hidden text-gray-900 dark:text-white">
                  <OptionLabel text={choice} metadata={optionsMetadata?.[choice]} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  });
}
