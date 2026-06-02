// app/components/playground/ErrorAlert.tsx
import { AlertCircle, X } from 'lucide-react';

interface ErrorAlertProps {
  message: string;
  onDismiss: () => void;
}

export default function ErrorAlert({ message, onDismiss }: ErrorAlertProps) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 mb-4">
      <div className="flex items-start">
        <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
        <div className="ml-3 flex-1">
          <p className="text-sm text-red-500">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}