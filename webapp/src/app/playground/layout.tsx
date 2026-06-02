// app/playground/layout.tsx
import { PlaygroundProvider } from '@/app/context/PlaygroundContext';

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full bg-gradient-to-br from-[var(--space-bg-dark)] to-[var(--space-bg-medium)] overflow-hidden">
      <PlaygroundProvider>
        {children}
      </PlaygroundProvider>
    </div>
  );
}