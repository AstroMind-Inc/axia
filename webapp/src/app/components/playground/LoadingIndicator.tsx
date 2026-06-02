// app/components/playground/LoadingIndicator.tsx
export default function LoadingIndicator() {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="space-x-1 flex items-center">
          <div className="w-2 h-2 bg-[var(--pulsar-cyan)] rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-[var(--pulsar-cyan)] rounded-full animate-pulse delay-75"></div>
          <div className="w-2 h-2 bg-[var(--pulsar-cyan)] rounded-full animate-pulse delay-150"></div>
        </div>
      </div>
    );
  }