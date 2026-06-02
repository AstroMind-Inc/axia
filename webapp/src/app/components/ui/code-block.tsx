"use client";

import { cn } from "@/app/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "python", className }: CodeBlockProps) {
  return (
    <pre className={cn(
      "bg-gray-900 text-white p-4 rounded-lg overflow-x-auto font-mono text-sm",
      "border border-gray-800",
      className
    )}>
      <code>{code}</code>
    </pre>
  );
}
