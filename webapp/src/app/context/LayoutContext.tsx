"use client";

import { createContext, useState, useEffect, ReactNode } from 'react';

// Context type definition
interface LayoutContextType {
  isDataExpanded: boolean;
  isChatExpanded: boolean;
  isObjectDetailsExpanded: boolean;
  toggleData: () => void;
  toggleChat: () => void;
  toggleObjectDetails: () => void;
  isMobileView: boolean;
  isTabletView: boolean;
  // New resizer properties
  chatPanelWidth: number;
  objectDetailsPanelWidth: number;
  setChatPanelWidth: (width: number) => void;
  setObjectDetailsPanelWidth: (width: number) => void;
  isResizing: boolean;
  setIsResizing: (resizing: boolean) => void;
}

// Create the context with default values
export const LayoutContext = createContext<LayoutContextType>({
  isDataExpanded: false,
  isChatExpanded: true,
  isObjectDetailsExpanded: true,
  toggleData: () => {},
  toggleChat: () => {},
  toggleObjectDetails: () => {},
  isMobileView: false,
  isTabletView: false,
  // Default panel widths (in percentages)
  chatPanelWidth: 60,
  objectDetailsPanelWidth: 40,
  setChatPanelWidth: () => {},
  setObjectDetailsPanelWidth: () => {},
  isResizing: false,
  setIsResizing: () => {},
});

// Provider component
interface LayoutProviderProps {
  children: ReactNode;
}

export const LayoutProvider = ({ children }: LayoutProviderProps) => {
  // Default: Data panel collapsed, Chat expanded, Object details expanded
  const [isDataExpanded, setIsDataExpanded] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const [isObjectDetailsExpanded, setIsObjectDetailsExpanded] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isTabletView, setIsTabletView] = useState(false);

  // Resizer state - default to 60/40 split
  const [chatPanelWidth, setChatPanelWidth] = useState(60);
  const [objectDetailsPanelWidth, setObjectDetailsPanelWidth] = useState(40);
  const [isResizing, setIsResizing] = useState(false);

  // Load saved panel sizes from localStorage
  useEffect(() => {
    const savedChatWidth = localStorage.getItem('astromind-chat-panel-width');
    const savedObjectWidth = localStorage.getItem('astromind-object-panel-width');
    
    if (savedChatWidth && savedObjectWidth) {
      const chatWidth = parseFloat(savedChatWidth);
      const objectWidth = parseFloat(savedObjectWidth);
      
      // Validate the widths
      if (chatWidth > 20 && chatWidth < 80 && objectWidth > 20 && objectWidth < 80) {
        setChatPanelWidth(chatWidth);
        setObjectDetailsPanelWidth(objectWidth);
      }
    }
  }, []);

  // Save panel sizes to localStorage when they change
  useEffect(() => {
    localStorage.setItem('astromind-chat-panel-width', chatPanelWidth.toString());
    localStorage.setItem('astromind-object-panel-width', objectDetailsPanelWidth.toString());
  }, [chatPanelWidth, objectDetailsPanelWidth]);

  // Check for responsive breakpoints
  useEffect(() => {
    const checkViewMode = () => {
      const width = window.innerWidth;
      setIsMobileView(width < 768);
      setIsTabletView(width >= 768 && width < 1200);
    };

    checkViewMode();
    window.addEventListener("resize", checkViewMode);

    return () => {
      window.removeEventListener("resize", checkViewMode);
    };
  }, []);

  // Toggle handlers for 3-column layout
  const toggleData = () => {
    setIsDataExpanded(!isDataExpanded);
  };

  const toggleChat = () => {
    setIsChatExpanded(!isChatExpanded);
  };

  const toggleObjectDetails = () => {
    setIsObjectDetailsExpanded(!isObjectDetailsExpanded);
  };

  return (
    <LayoutContext.Provider value={{
      isDataExpanded,
      isChatExpanded,
      isObjectDetailsExpanded,
      toggleData,
      toggleChat,
      toggleObjectDetails,
      isMobileView,
      isTabletView,
      chatPanelWidth,
      objectDetailsPanelWidth,
      setChatPanelWidth,
      setObjectDetailsPanelWidth,
      isResizing,
      setIsResizing
    }}>
      {children}
    </LayoutContext.Provider>
  );
};