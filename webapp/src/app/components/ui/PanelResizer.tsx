"use client";

import { useContext, useEffect, useRef } from 'react';
import { LayoutContext } from '@/app/context/LayoutContext';
import { useSettings } from '@/app/context/SettingsContext';
import { GripVertical } from 'lucide-react';

interface PanelResizerProps {
  onResize?: (chatWidth: number, objectWidth: number) => void;
}

export default function PanelResizer({ onResize }: PanelResizerProps) {
  const { 
    chatPanelWidth, 
    objectDetailsPanelWidth, 
    setChatPanelWidth, 
    setObjectDetailsPanelWidth,
    isResizing,
    setIsResizing,
    isMobileView 
  } = useContext(LayoutContext);
  const { theme } = useSettings();
  const resizerRef = useRef<HTMLDivElement>(null);
  // Local ref to avoid stale closures during document mousemove
  const resizingRef = useRef<boolean>(false);

  useEffect(() => {
    let startX = 0;
    let startChatWidth = 0;
    let startObjectWidth = 0;
    let containerWidth = 0;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizingRef.current = true;
      
      // Get the container width (excluding the left panel)
      const mainContainer = document.querySelector('[data-main-content]') as HTMLElement;
      if (mainContainer) {
        containerWidth = mainContainer.offsetWidth;
      }
      
      startX = e.clientX;
      startChatWidth = chatPanelWidth;
      startObjectWidth = objectDetailsPanelWidth;
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const handleDoubleClick = () => {
      // Reset to default 60/40 split
      setChatPanelWidth(60);
      setObjectDetailsPanelWidth(40);
      
      if (onResize) {
        onResize(60, 40);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      
      const deltaX = e.clientX - startX;
      const deltaPercentage = (deltaX / containerWidth) * 100;
      
      // Calculate new widths
      let newChatWidth = startChatWidth + deltaPercentage;
      let newObjectWidth = startObjectWidth - deltaPercentage;
      
      // Enforce minimum and maximum widths (20% to 80%)
      const minWidth = 20;
      const maxWidth = 80;
      
      if (newChatWidth < minWidth) {
        newChatWidth = minWidth;
        newObjectWidth = 100 - newChatWidth;
      } else if (newChatWidth > maxWidth) {
        newChatWidth = maxWidth;
        newObjectWidth = 100 - newChatWidth;
      }
      
      if (newObjectWidth < minWidth) {
        newObjectWidth = minWidth;
        newChatWidth = 100 - newObjectWidth;
      } else if (newObjectWidth > maxWidth) {
        newObjectWidth = maxWidth;
        newChatWidth = 100 - newObjectWidth;
      }
      
      setChatPanelWidth(newChatWidth);
      setObjectDetailsPanelWidth(newObjectWidth);
      
      if (onResize) {
        onResize(newChatWidth, newObjectWidth);
      }
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const resizer = resizerRef.current;
    if (resizer && !isMobileView) {
      resizer.addEventListener('mousedown', handleMouseDown);
      resizer.addEventListener('dblclick', handleDoubleClick);
    }

    return () => {
      if (resizer) {
        resizer.removeEventListener('mousedown', handleMouseDown);
        resizer.removeEventListener('dblclick', handleDoubleClick);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [
    chatPanelWidth, 
    objectDetailsPanelWidth, 
    setChatPanelWidth, 
    setObjectDetailsPanelWidth, 
    setIsResizing, 
    isMobileView,
    onResize
  ]);

  // Don't render on mobile
  if (isMobileView) {
    return null;
  }

  return (
    <div
      ref={resizerRef}
      className={`flex-shrink-0 w-1 cursor-col-resize relative group ${
        theme === 'dark' 
          ? 'bg-gray-800/40 hover:bg-gray-700/60' 
          : 'bg-gray-200/40 hover:bg-gray-300/60'
      } transition-colors duration-200 ${
        isResizing ? (theme === 'dark' ? 'bg-blue-500/50' : 'bg-blue-400/50') : ''
      }`}
      title={`Drag to resize panels • Double-click to reset (Chat: ${Math.round(chatPanelWidth)}% | Details: ${Math.round(objectDetailsPanelWidth)}%)`}
    >
      {/* Visual indicator */}
      <div className={`absolute inset-y-0 left-0 w-1 ${
        isResizing 
          ? theme === 'dark' ? 'bg-blue-400' : 'bg-blue-500'
          : 'opacity-0 group-hover:opacity-100 ' + (theme === 'dark' ? 'bg-gray-500' : 'bg-gray-400')
      } transition-opacity duration-200`} />
      
      {/* Grip icon that appears on hover */}
      <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
      }`}>
        <GripVertical className="w-3 h-3" />
      </div>

      {/* Size indicator that appears while resizing */}
      {isResizing && (
        <div className={`absolute top-4 left-2 px-2 py-1 rounded text-xs font-mono ${
          theme === 'dark' 
            ? 'bg-gray-900/90 text-gray-200 border border-gray-700/50' 
            : 'bg-white/90 text-gray-700 border border-gray-300/50'
        } shadow-lg pointer-events-none z-10`}>
          {Math.round(chatPanelWidth)}% | {Math.round(objectDetailsPanelWidth)}%
        </div>
      )}
    </div>
  );
}