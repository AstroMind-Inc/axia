"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/app/lib/utils";
import {
  Rocket,
  Terminal,
  Menu,
  X,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { ThemeToggle } from "@/app/components/ui/theme-toggle";
import { useSettings } from "@/app/context/SettingsContext";

const iconComponents = {
  Rocket,
  Terminal,
  Menu,
  X,
  Settings,
  AlertTriangle,
};

const navItems = [
  {
    name: "Playground",
    href: "/playground",
    iconName: "Rocket",
  },
];

const IconComponent = ({
  name,
  className,
}: {
  name: string;
  className?: string;
}) => {
  const Icon = iconComponents[name as keyof typeof iconComponents];
  if (!Icon) {
    return <div className={`${className} bg-gray-700 rounded`} />;
  }
  return <Icon className={className} />;
};

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const { theme } = useSettings();

  // Client-side only state for responsive elements
  const [mounted, setMounted] = useState(false);
  const [screenWidth, setScreenWidth] = useState(0);

  // Detect if we're mounted on client and handle screen width
  useEffect(() => {
    setMounted(true);
    setScreenWidth(window.innerWidth);

    const handleResize = () => {
      setScreenWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Add scroll event listener to add shadow when scrolled
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // Get logo config based on screen size - but only after client mount
  const getLogoConfig = () => {
    // Default/fallback config for server render
    let config = {
      width: 140,
      height: 32,
      className: "h-8 w-auto"
    };

    // Only apply responsive sizing on client after mount
    if (mounted) {
      if (screenWidth < 370) {
        config = {
          width: 100,
          height: 24,
          className: "h-6 w-auto"
        };
      } else if (screenWidth < 640) {
        config = {
          width: 120,
          height: 28,
          className: "h-7 w-auto"
        };
      }
    }

    return config;
  };

  const logoConfig = getLogoConfig();

  return (
    <nav
      className={cn(
        "border-b sticky top-0 z-50 transition-all duration-200",
        theme === 'dark'
          ? "bg-[#0D0C22] border-gray-800/30"
          : "bg-white border-gray-200/30",
        scrolled && (theme === 'dark'
          ? "shadow-lg backdrop-blur-sm shadow-black/20 bg-[#0D0C22]/95"
          : "shadow-lg backdrop-blur-sm bg-white/95")
      )}
    >
      {/* Desktop Navigation */}
      <div className="container mx-auto px-4">
        <div className="hidden md:flex items-center h-16">
          {/* Logo on the left for desktop */}
          <div className="flex-shrink-0 mr-4 lg:mr-8">
            <Link href="/">
              <Image
                src={theme === 'dark' ? "/Final Wordmark Logo.png" : "/Light Mode Wordmark_3.png"}
                alt="ASTROMIND Logo"
                width={logoConfig.width}
                height={logoConfig.height}
                className={logoConfig.className}
                priority={true}
              />
            </Link>
          </div>

          {/* Navigation items left-aligned */}
          <div className="flex items-center space-x-1 lg:space-x-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center px-2 lg:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap",
                    isActive
                      ? (theme === 'dark'
                          ? "bg-[#1E1A3C] text-[#00E0FF] shadow-sm shadow-[#00E0FF]/20"
                          : "bg-[#F7F7F7] text-[#333] shadow-sm shadow-[#333]/20")
                      : (theme === 'dark'
                          ? "text-gray-300 hover:bg-[#1A1832] hover:text-[#00E0FF]"
                          : "text-gray-600 hover:bg-[#F2F2F2] hover:text-[#333]")
                  )}
                >
                  <IconComponent
                    name={item.iconName}
                    className={cn(
                      "w-3.5 h-3.5 lg:w-4 lg:h-4 mr-1 lg:mr-2 transition-transform duration-200",
                      isActive ? (theme === 'dark' ? "text-[#00E0FF]" : "text-[#333]") : (theme === 'dark' ? "text-gray-400" : "text-gray-500")
                    )}
                  />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Theme toggle on the right for desktop */}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="container mx-auto px-4">
          {/* Mobile Navigation Bar */}
          <div className="md:hidden flex items-center justify-between h-14 sm:h-16">
            {/* Menu button on left */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className={cn(
                "inline-flex items-center justify-center p-1.5 sm:p-2 rounded-lg transition-colors duration-200",
                theme === 'dark' ? "text-gray-400 hover:text-white hover:bg-[#1A1832]" : "text-gray-600 hover:text-[#333] hover:bg-[#F2F2F2]"
              )}
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? "Close main menu" : "Open main menu"}
            >
              {isMobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>

            {/* Logo centered on mobile - consistent size for SSR */}
            <div className="absolute left-1/2 transform -translate-x-1/2">
              <Link href="/">
                <Image
                  src={theme === 'dark' ? "/Final Wordmark Logo.png" : "/Light Mode Wordmark_3.png"}
                  alt="ASTROMIND Logo"
                  width={logoConfig.width}
                  height={logoConfig.height}
                  className={logoConfig.className}
                  priority={true}
                />
              </Link>
            </div>

            {/* Theme toggle on the right for mobile */}
            <div className="flex items-center">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        <div
          className={cn(
            "md:hidden overflow-hidden transition-all duration-300 ease-in-out",
            isMobileMenuOpen ? "max-h-screen" : "max-h-0"
          )}
        >
          <div className={cn(
            "container mx-auto px-4 py-2 space-y-1.5 border-t",
            theme === 'dark'
              ? "bg-[#0D0C22] border-gray-800/30"
              : "bg-white border-gray-200/30"
          )}>
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive
                      ? (theme === 'dark'
                          ? "bg-[#1E1A3C] text-[#00E0FF] shadow-sm shadow-[#00E0FF]/20"
                          : "bg-[#F7F7F7] text-[#333] shadow-sm shadow-[#333]/20")
                      : (theme === 'dark'
                          ? "text-gray-300 hover:bg-[#1A1832] hover:text-[#00E0FF]"
                          : "text-gray-600 hover:bg-[#F2F2F2] hover:text-[#333]")
                  )}
                >
                  <IconComponent
                    name={item.iconName}
                    className={cn(
                      "w-5 h-5 mr-3 transition-transform duration-200",
                      isActive ? (theme === 'dark' ? "text-[#00E0FF]" : "text-[#333]") : (theme === 'dark' ? "text-gray-400" : "text-gray-500")
                    )}
                  />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}