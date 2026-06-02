"use client";

import React, { useEffect } from 'react';
import { useSettings } from './SettingsContext';

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme } = useSettings();

  // Apply the theme class to the document element
  useEffect(() => {
    const root = window.document.documentElement;

    // Remove the class
    root.classList.remove('dark', 'light');

    // Add the appropriate class based on the theme
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.add('light');
    }
  }, [theme]);

  return <>{children}</>;
}