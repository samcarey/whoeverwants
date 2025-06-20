export default function Confirmation() {
  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6 text-center">
        <h1 className="text-2xl font-bold mb-4 text-green-600 dark:text-green-400">
          Poll Created Successfully!
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Your poll has been created and is now ready to share.
        </p>
        <div className="checkmark mb-6">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}