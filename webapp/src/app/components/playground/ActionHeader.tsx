// app/components/playground/ActionHeader.tsx
"use client";

// Removed Validate and Reset controls

interface ActionHeaderProps {
  onResetChat: () => void;
  hasMessages: boolean;
}

export default function ActionHeader({ onResetChat, hasMessages }: ActionHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-stellar-white">Chat</h2>
      {/* Controls removed */}
    </div>
  );
}