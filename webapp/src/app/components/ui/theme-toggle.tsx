"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useSettings } from "@/app/context/SettingsContext";
import { Button } from "./button";
import { cn } from "@/app/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useSettings();

  // Track client-side mounting state to prevent hydration mismatch
  const [mounted, setMounted] = React.useState(false);
  const [windowWidth, setWindowWidth] = React.useState(0);

  React.useEffect(() => {
    setMounted(true);

    // Set initial window width
    setWindowWidth(window.innerWidth);

    // Add resize listener
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);

    // Clean up
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Prevent hydration mismatch by using consistent className and sizes
  // Only apply responsive styling after client-side mount
  if (!mounted) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {}}
        className="rounded-md flex items-center gap-2 px-3"
      >
        {theme === "light" ? (
          <>
            <Sun className="h-[1.2rem] w-[1.2rem] text-amber-500" />
            <span className="text-sm font-medium">Light</span>
          </>
        ) : (
          <>
            <Moon className="h-[1.2rem] w-[1.2rem] text-indigo-400" />
            <span className="text-sm font-medium">Dark</span>
          </>
        )}
      </Button>
    );
  }

  // Responsive styling based on screen size
  const isMobile = windowWidth < 768;
  const isVerySmallMobile = windowWidth < 370;

  // Always hide text on mobile
  const showText = !isMobile && windowWidth >= 400;

  // Icon sizing
  const iconSize = isVerySmallMobile ? "1rem" : "1.2rem";

  // Button styling
  const mobileButtonClasses = isMobile ?
    "bg-transparent border-0 hover:bg-transparent dark:hover:bg-[#1A1832] hover:bg-gray-100 p-1" :
    "";

  return (
    <Button
      variant={isMobile ? "ghost" : "outline"}
      size={isMobile ? "icon" : "sm"}
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className={cn(
        "flex items-center transition-colors",
        mobileButtonClasses,
        isMobile ? "rounded-md" : "gap-1.5 px-3 py-2 rounded-md"
      )}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? (
        <>
          <Sun style={{ width: iconSize, height: iconSize }} className="text-amber-500" />
          {showText && (
            <span className="text-sm font-medium">Light</span>
          )}
        </>
      ) : (
        <>
          <Moon style={{ width: iconSize, height: iconSize }} className="text-indigo-400" />
          {showText && (
            <span className="text-sm font-medium">Dark</span>
          )}
        </>
      )}
    </Button>
  );
}