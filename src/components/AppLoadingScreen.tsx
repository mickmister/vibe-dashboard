type AppLoadingScreenProps = {
  className?: string;
};

export function AppLoadingScreen({
  className = 'fixed inset-0 z-50',
}: AppLoadingScreenProps) {
  return (
    <div
      className={`${className} bg-neutral-950 flex items-center justify-center`}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        <p className="text-neutral-400 text-sm">Loading...</p>
      </div>
    </div>
  );
}
