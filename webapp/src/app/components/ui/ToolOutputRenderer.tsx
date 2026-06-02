"use client";
import React, { useState } from 'react';
import { Download, ZoomIn, ZoomOut, Maximize2, X } from 'lucide-react';

interface ToolOutputRendererProps {
  result: any;
  toolName: string;
}

/**
 * Smart renderer for tool outputs that detects type and renders appropriately.
 * 
 * Supported types:
 * - Images (base64, data URLs)
 * - JSON (formatted, expandable)
 * - Text/HTML
 * - Tables (future)
 * - Vega-Lite specs (future)
 */
const ToolOutputRenderer: React.FC<ToolOutputRendererProps> = ({ result, toolName }) => {
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [imageZoom, setImageZoom] = useState(100);

  // Type detection
  const detectType = (data: any): 'image' | 'json' | 'text' | 'html' | 'table' | 'vega' | 'unknown' => {
    if (!data) return 'unknown';

    // Explicit type field (preferred)
    if (data.type === 'image') return 'image';
    if (data.type === 'visualization') return 'vega';
    if (data.type === 'table') return 'table';

    // Data URL detection
    if (typeof data === 'string' && data.startsWith('data:image/')) return 'image';
    
    // Object with data field containing image
    if (data.data && typeof data.data === 'string' && data.data.startsWith('data:image/')) return 'image';
    
    // URL field containing image
    if (data.url && typeof data.url === 'string' && data.url.startsWith('data:image/')) return 'image';

    // JSON object
    if (typeof data === 'object') return 'json';

    // HTML detection
    if (typeof data === 'string' && (data.includes('<html') || data.includes('<!DOCTYPE'))) return 'html';

    // Plain text
    if (typeof data === 'string') return 'text';

    return 'unknown';
  };

  const type = detectType(result);

  // Image Renderer
  const renderImage = () => {
    let imageUrl: string | null = null;
    let metadata: any = {};

    // Extract image URL from various formats
    if (typeof result === 'string' && result.startsWith('data:image/')) {
      imageUrl = result;
    } else if (result.data && typeof result.data === 'string') {
      // Check if it's a data URL already, or just base64
      if (result.data.startsWith('data:image/')) {
        imageUrl = result.data;
      } else {
        // Assume it's base64, construct data URL
        const format = result.format || 'base64_png';
        const mimeType = format.includes('png') ? 'image/png' : 'image/jpeg';
        imageUrl = `data:${mimeType};base64,${result.data}`;
      }
      metadata = result.metadata || {};
    } else if (result.url && typeof result.url === 'string') {
      imageUrl = result.url;
      metadata = result.metadata || {};
    }

    if (!imageUrl) return renderJson();

    const format = result.format || 'png';
    const survey = metadata.survey || toolName;

    return (
      <div className="space-y-2">
        {/* Image preview */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
          <img
            src={imageUrl}
            alt={`${toolName} output`}
            className="w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => setIsImageModalOpen(true)}
            style={{ maxHeight: '300px', objectFit: 'contain' }}
          />
          
          {/* Image overlay controls */}
          <div className="absolute top-2 right-2 flex space-x-1">
            <button
              onClick={() => setIsImageModalOpen(true)}
              className="p-1.5 bg-black/50 hover:bg-black/70 text-white rounded transition-colors"
              title="View fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const link = document.createElement('a');
                link.href = imageUrl!;
                link.download = `${toolName}_${Date.now()}.${format}`;
                link.click();
              }}
              className="p-1.5 bg-black/50 hover:bg-black/70 text-white rounded transition-colors"
              title="Download image"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

          {/* Image info badge */}
          <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 text-white text-xs rounded">
            {format.toUpperCase()} • {survey}
          </div>
        </div>

        {/* Metadata if available */}
        {Object.keys(metadata).length > 0 && (
          <div className="text-xs text-gray-500 space-y-1">
            {metadata.width && metadata.height && (
              <div>Dimensions: {metadata.width} × {metadata.height}px</div>
            )}
            {metadata.fov && (
              <div>Field of View: {metadata.fov}°</div>
            )}
          </div>
        )}

        {/* Fullscreen Modal */}
        {isImageModalOpen && (
          <div 
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setIsImageModalOpen(false)}
          >
            <div className="relative max-w-7xl max-h-screen" onClick={(e) => e.stopPropagation()}>
              {/* Controls */}
              <div className="absolute top-4 right-4 flex space-x-2 z-10">
                <button
                  onClick={() => setImageZoom(Math.max(50, imageZoom - 25))}
                  className="p-2 bg-black/70 hover:bg-black text-white rounded"
                  disabled={imageZoom <= 50}
                >
                  <ZoomOut className="w-5 h-5" />
                </button>
                <span className="px-3 py-2 bg-black/70 text-white rounded">
                  {imageZoom}%
                </span>
                <button
                  onClick={() => setImageZoom(Math.min(200, imageZoom + 25))}
                  className="p-2 bg-black/70 hover:bg-black text-white rounded"
                  disabled={imageZoom >= 200}
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setIsImageModalOpen(false)}
                  className="p-2 bg-black/70 hover:bg-black text-white rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Image */}
              <div className="overflow-auto max-h-screen">
                <img
                  src={imageUrl}
                  alt={`${toolName} output (fullscreen)`}
                  style={{ 
                    width: `${imageZoom}%`,
                    height: 'auto'
                  }}
                  className="mx-auto"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // JSON Renderer (formatted and expandable)
  const renderJson = () => {
    const [isExpanded, setIsExpanded] = useState(false);
    const jsonString = JSON.stringify(result, null, 2);
    const preview = jsonString.length > 500 ? jsonString.substring(0, 500) + '...' : jsonString;

    return (
      <div className="space-y-2">
        <pre className={`text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto ${
          isExpanded ? 'max-h-96' : 'max-h-32'
        } overflow-y-auto`}>
          {isExpanded ? jsonString : preview}
        </pre>
        {jsonString.length > 500 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  };

  // Text Renderer
  const renderText = () => {
    const text = typeof result === 'string' ? result : String(result);
    const [isExpanded, setIsExpanded] = useState(false);
    const preview = text.length > 500 ? text.substring(0, 500) + '...' : text;

    return (
      <div className="space-y-2">
        <pre className={`text-xs bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap ${
          isExpanded ? 'max-h-96' : 'max-h-32'
        } overflow-y-auto`}>
          {isExpanded ? text : preview}
        </pre>
        {text.length > 500 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  };

  // HTML Renderer (sandboxed iframe)
  const renderHtml = () => {
    const htmlContent = typeof result === 'string' ? result : JSON.stringify(result);
    
    return (
      <div className="space-y-2">
        <iframe
          srcDoc={htmlContent}
          className="w-full h-64 border border-gray-200 rounded"
          sandbox="allow-scripts"
          title="HTML Output"
        />
        <p className="text-xs text-gray-500">HTML content rendered in sandboxed iframe</p>
      </div>
    );
  };

  // Vega-Lite Renderer (placeholder for future)
  const renderVega = () => {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
        <p className="text-sm text-yellow-800">
          📊 Vega-Lite visualization detected. Renderer coming soon!
        </p>
        {renderJson()}
      </div>
    );
  };

  // Table Renderer (placeholder for future)
  const renderTable = () => {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded">
        <p className="text-sm text-blue-800">
          📋 Table data detected. Renderer coming soon!
        </p>
        {renderJson()}
      </div>
    );
  };

  // Main render logic
  switch (type) {
    case 'image':
      return renderImage();
    case 'json':
      return renderJson();
    case 'text':
      return renderText();
    case 'html':
      return renderHtml();
    case 'vega':
      return renderVega();
    case 'table':
      return renderTable();
    default:
      return (
        <div className="p-2 bg-gray-50 border border-gray-200 rounded">
          <p className="text-xs text-gray-600">Unable to render output</p>
          {renderJson()}
        </div>
      );
  }
};

export default ToolOutputRenderer;

