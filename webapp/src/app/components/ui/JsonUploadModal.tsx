"use client";

import { useState, useRef } from 'react';
import { X, Upload, AlertTriangle, Info } from 'lucide-react';
import { useSettings } from '@/app/context/SettingsContext';

interface JsonUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File, prefix: string, isPruned: boolean) => Promise<{ failed?: Array<{ id: string; error: string }> } | void>;
  defaultPrefix: string;
}

export default function JsonUploadModal({
  isOpen,
  onClose,
  onUpload,
  defaultPrefix
}: JsonUploadModalProps) {
  const { theme } = useSettings();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPruned, setIsPruned] = useState<boolean>(false);
  const [failedItems, setFailedItems] = useState<Array<{ id: string; error: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !prefix.trim()) {
      setError('Please select a file and enter a prefix');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const result = await onUpload(selectedFile, prefix.trim(), isPruned);
      // If backend reported failures, show them and do not close yet
      if (result && Array.isArray(result.failed) && result.failed.length > 0) {
        setFailedItems(result.failed);
        setError(`Some items failed to upload (${result.failed.length}). See details below.`);
        return;
      }
      // Close modal on success with no failures
      onClose();
      // Reset form
      setSelectedFile(null);
      setPrefix(defaultPrefix);
      setIsPruned(false);
      setFailedItems([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFile(null);
      setError(null);
      setPrefix(defaultPrefix);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3">
      <div className={`rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden border ${
        theme === 'dark' 
          ? 'bg-[#111125] border-gray-700' 
          : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className={`flex justify-between items-center p-4 border-b ${
          theme === 'dark' 
            ? 'border-gray-700/50' 
            : 'border-gray-200'
        }`}>
          <h3 className={`text-lg font-medium ${
            theme === 'dark' ? 'text-white' : 'text-gray-800'
          }`}>Upload JSON Data</h3>

          <button
            onClick={handleClose}
            disabled={isUploading}
            className={`p-1 rounded-full ${
              theme === 'dark' 
                ? 'text-gray-400 hover:text-white hover:bg-gray-700/30' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Info section */}
          <div className={`p-3 rounded-md border ${
            theme === 'dark' 
              ? 'bg-blue-900/20 border-blue-800/50 text-blue-300' 
              : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}>
            <div className="flex items-start">
              <Info className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium mb-1">Supported Formats:</p>
                <ul className="space-y-1">
                  <li>• JSON array of objects</li>
                  <li>• JSON object with "event_list" key containing an array</li>
                  <li>• Each object must have an "event_list" field (array of numbers)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Prefix input */}
          <div className="space-y-2">
            <label className={`block text-sm font-medium ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              ID Prefix
            </label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="UPD_24_01_15_14_30"
              className={`w-full p-3 rounded-md border text-sm focus:outline-none focus:ring-1 ${
                theme === 'dark' 
                  ? 'bg-[#0D0C22] text-gray-300 border-gray-700 focus:border-[#00E0FF] focus:ring-[#00E0FF]' 
                  : 'bg-white text-gray-700 border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
              }`}
              disabled={isUploading}
            />
            <p className={`text-xs ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              Objects will be named: {prefix}_1, {prefix}_2, etc.
            </p>
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <label className={`block text-sm font-medium ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              JSON File
            </label>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
              id="json-file-input"
              disabled={isUploading}
            />

            <label
              htmlFor="json-file-input"
              className={`flex items-center justify-center w-full p-6 border-2 border-dashed rounded-md cursor-pointer transition-colors ${
                isUploading ? 'opacity-50 cursor-not-allowed' : ''
              } ${
                theme === 'dark'
                  ? 'border-gray-700 hover:border-[#00E0FF]/50 text-gray-300'
                  : 'border-gray-300 hover:border-blue-400 text-gray-600'
              }`}
            >
              <div className="text-center">
                <Upload className="w-8 h-8 mx-auto mb-2" />
                <span className="text-sm font-medium">
                  {selectedFile ? selectedFile.name : 'Select JSON file'}
                </span>
                {!selectedFile && (
                  <p className={`text-xs mt-1 ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    Click to browse files
                  </p>
                )}
              </div>
            </label>

            {selectedFile && (
              <div className={`text-xs p-2 rounded ${
                theme === 'dark' ? 'bg-[#1A1832] text-gray-300' : 'bg-gray-50 text-gray-600'
              }`}>
                <strong>File:</strong> {selectedFile.name}<br/>
                <strong>Size:</strong> {(selectedFile.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>

          {/* Pruned data toggle */}
          <div className="space-y-2">
            <label className={`block text-sm font-medium ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              Data is already pruned?
            </label>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={isPruned}
                onChange={(e) => setIsPruned(e.target.checked)}
                disabled={isUploading}
              />
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Indicates time is normalized and data has an 8h cutoff within 0.5–8.0 keV. Leave unchecked if unsure.
              </p>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className={`p-3 rounded-md ${
              theme === 'dark' ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600'
            }`}>
              <div className="flex items-start">
                <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {failedItems.length > 0 && (
            <div className={`p-3 rounded-md ${
              theme === 'dark' ? 'bg-yellow-900/20 text-yellow-300' : 'bg-yellow-50 text-yellow-700'
            }`}>
              <div className="text-sm font-medium mb-1">Items not uploaded due to errors:</div>
              <ul className="list-disc ml-5 space-y-1 text-xs">
                {failedItems.map((f, idx) => (
                  <li key={idx}><span className="font-mono">{f.id}</span>: {f.error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Example format */}
          <div className="space-y-2">
            <p className={`text-sm font-medium ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              Example Format:
            </p>
            <pre className={`text-xs p-3 rounded-md overflow-x-auto ${
              theme === 'dark' 
                ? 'bg-[#0D0C22] text-gray-300 border border-gray-700' 
                : 'bg-gray-50 text-gray-700 border border-gray-200'
            }`}>
{`[
  {
    "obsid": 17140,
    "source_name": "2CXO J195908.0+403706",
    "source_type": "RSCVnV*",
    "event_list": [
      [441.26, 1137.45],
      [1311.33, 1275.16]
    ],
    "flux_significance_b": 5.85
  }
]`}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className={`border-t p-4 flex justify-end space-x-3 ${
          theme === 'dark' 
            ? 'border-gray-700/50 bg-[#0D0C22]' 
            : 'border-gray-200 bg-gray-50'
        }`}>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              theme === 'dark'
                ? 'text-gray-300 hover:text-white hover:bg-gray-700/30'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200/50'
            } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Cancel
          </button>
          
          <button
            onClick={handleUpload}
            disabled={!selectedFile || !prefix.trim() || isUploading}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              !selectedFile || !prefix.trim() || isUploading
                ? 'opacity-50 cursor-not-allowed'
                : theme === 'dark'
                  ? 'bg-[#00E0FF] text-black hover:bg-[#00E0FF]/90'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
