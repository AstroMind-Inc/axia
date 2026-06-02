"use client";

import { useState, useRef } from 'react';
import { AlertCircle, Check, HelpCircle, Loader2, Upload, X } from 'lucide-react';
import { useSettings } from '@/app/context/SettingsContext';
import UploadHelp from './UploadHelp';

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Define maximum file size (100MB in bytes)
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export default function FileUploadModal({ isOpen, onClose, onSuccess }: FileUploadModalProps) {
  const { theme } = useSettings();
  const [datasetName, setDatasetName] = useState('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [uploadStats, setUploadStats] = useState<{
    totalObjects: number;
    withEmbedding: number;
    withEventList: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal is closed
  const handleClose = () => {
    setDatasetName('');
    setUploadStatus('idle');
    setErrorMessage(null);
    setValidationErrors([]);
    setUploadStats(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const validateJsonFile = (content: string): { isValid: boolean; data: any[] } => {
    try {
      // Instead of rejecting files with NaN values, we'll parse them and fix them
      let data;

      try {
        // First attempt to parse the JSON
        data = JSON.parse(content);
      } catch (parseError) {
        // If standard parsing fails, it might be due to NaN values
        // Replace NaN values with null in the raw string
        const nanCorrectedContent = content
          .replace(/: NaN/g, ': null')
          .replace(/:NaN/g, ':null');

        // Try parsing again with corrected content
        try {
          data = JSON.parse(nanCorrectedContent);
        } catch (secondParseError) {
          // If it still fails, there's another JSON syntax issue
          throw new Error('Invalid JSON format. Please check the file structure.');
        }
      }

      // If it's a single object, convert to array
      if (!Array.isArray(data) && typeof data === 'object' && data !== null) {
        data = [data];
      }

      // Check if it's an array
      if (!Array.isArray(data)) {
        throw new Error('JSON data must be an array of objects or a single object');
      }

      // Validate each object for proper structure and sanitize NaN values
      const validationErrors: string[] = [];

      // Function to recursively replace NaN values with null
      const sanitizeObject = (obj: any): any => {
        if (obj === null || obj === undefined) return obj;

        if (Array.isArray(obj)) {
          return obj.map(item => sanitizeObject(item));
        }

        if (typeof obj === 'object') {
          const sanitized: Record<string, any> = {};

          for (const [key, value] of Object.entries(obj)) {
            // Check for NaN
            if (typeof value === 'number' && isNaN(value)) {
              sanitized[key] = null;
            } else if (typeof value === 'object' && value !== null) {
              sanitized[key] = sanitizeObject(value);
            } else {
              sanitized[key] = value;
            }
          }

          return sanitized;
        }

        return obj;
      };

      // Sanitize and check each object
      data = data.map((obj, index) => {
        // Sanitize the object (replace NaN with null)
        const sanitizedObj = sanitizeObject(obj);

        // Check for required fields
        if (!sanitizedObj.obsid) {
          validationErrors.push(`Object at index ${index} is missing required field: obsid`);
        }

        if (!sanitizedObj.source_name) {
          validationErrors.push(`Object at index ${index} is missing required field: source_name`);
        }

        // Check for either embedding or event_list
        if (!sanitizedObj.embedding && !sanitizedObj.event_list) {
          validationErrors.push(`Object at index ${index} is missing both embedding and event_list (at least one is required)`);
        }

        // Validate embedding (if present)
        if (sanitizedObj.embedding && (!Array.isArray(sanitizedObj.embedding) || sanitizedObj.embedding.length === 0)) {
          validationErrors.push(`Object at index ${index} has invalid embedding (must be a non-empty array)`);
        }

        // Validate event_list (if present)
        if (sanitizedObj.event_list && (!Array.isArray(sanitizedObj.event_list) || sanitizedObj.event_list.length === 0)) {
          validationErrors.push(`Object at index ${index} has invalid event_list (must be a non-empty array)`);
        }

        return sanitizedObj;
      });

      if (validationErrors.length > 0) {
        setValidationErrors(validationErrors);
        return { isValid: false, data: [] };
      }

      return { isValid: true, data };
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Invalid JSON format');
      return { isValid: false, data: [] };
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const handleFileSelection = async (file: File) => {
    // Check file type
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setErrorMessage('Please upload a JSON file');
      return;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage(`File size exceeds the maximum limit of 100MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`);
      return;
    }

    setUploadStatus('loading');
    setErrorMessage(null);
    setValidationErrors([]);

    try {
      const content = await file.text();
      const { isValid, data } = validateJsonFile(content);

      if (!isValid) {
        setUploadStatus('error');
        return;
      }

      // Calculate stats
      const withEmbedding = data.filter(obj => obj.embedding && Array.isArray(obj.embedding)).length;
      const withEventList = data.filter(obj => obj.event_list && Array.isArray(obj.event_list)).length;

      setUploadStats({
        totalObjects: data.length,
        withEmbedding,
        withEventList
      });

      // If dataset name is empty, use filename without extension
      if (!datasetName) {
        setDatasetName(file.name.replace(/\.[^/.]+$/, ''));
      }

      // Set to idle so the preview is shown
      setUploadStatus('idle');

      // Attach data to the file input for later submission
      (fileInputRef.current as any).jsonData = data;

    } catch (error) {
      setUploadStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to read file');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!datasetName.trim()) {
      setErrorMessage('Dataset name is required');
      return;
    }

    if (!fileInputRef.current || !(fileInputRef.current as any).jsonData) {
      setErrorMessage('Please select a JSON file');
      return;
    }

    setUploadStatus('loading');
    setErrorMessage(null);
    setValidationErrors([]);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasetName: datasetName.trim(),
          dataObjects: (fileInputRef.current as any).jsonData
        }),
      });

      const result = await response.json();

      if (result.success) {
        setUploadStatus('success');
        // Wait 1.5 seconds before closing for user to see success message
        setTimeout(() => {
          handleClose();
          onSuccess();
        }, 1500);
      } else {
        setUploadStatus('error');
        setErrorMessage(result.message || 'Upload failed');
        if (result.errors && Array.isArray(result.errors)) {
          setValidationErrors(result.errors);
        }
      }
    } catch (error) {
      setUploadStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  if (!isOpen) return null;

  // Reset help modal when upload modal is closed
  if (showHelpModal && !isOpen) {
    setShowHelpModal(false);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        {/* Backdrop */}
        <div
          className="fixed inset-0 transition-opacity bg-black bg-opacity-50"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className={`inline-block w-full max-w-xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform 
          ${theme === 'dark' ? 'bg-[#111125] border border-gray-700' : 'bg-white border border-gray-200'}
          rounded-lg shadow-xl relative`}>

          {/* Close button */}
          <button
            onClick={handleClose}
            className={`absolute top-3 right-3 p-1 rounded-full 
              ${theme === 'dark' ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="mb-5">
            <div className="flex justify-between items-start">
              <div>
                <h3 className={`text-lg font-medium leading-6 
                  ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  Upload JSON Dataset
                </h3>
                <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  Upload a JSON file with object data to create a new dataset
                </p>
              </div>
              <button
                onClick={() => setShowHelpModal(true)}
                className={`flex items-center px-2 py-1 text-xs rounded 
                  ${theme === 'dark' 
                    ? 'bg-[#1A1832] text-[#00E0FF] hover:bg-[#2A2850]' 
                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
              >
                <HelpCircle className="w-3.5 h-3.5 mr-1" />
                Format Guide
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Dataset Name */}
            <div className="mb-4">
              <label htmlFor="datasetName" className={`block text-sm font-medium mb-1 
                ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                Dataset Name
              </label>
              <input
                type="text"
                id="datasetName"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                className={`w-full px-3 py-2 text-sm border rounded-md 
                  ${theme === 'dark' 
                    ? 'bg-[#1A1832] text-white border-gray-600 focus:border-[#00E0FF] focus:ring-1 focus:ring-[#00E0FF]' 
                    : 'bg-white text-gray-900 border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'}`}
                placeholder="Enter a name for your dataset"
                disabled={uploadStatus === 'loading' || uploadStatus === 'success'}
              />
            </div>

            {/* File Upload Area */}
            <div
              className={`border-2 border-dashed rounded-md p-6 mb-4 text-center 
                ${theme === 'dark' 
                  ? 'border-gray-600 bg-[#1A1832]' 
                  : 'border-gray-300 bg-gray-50'}
                ${uploadStatus === 'loading' || uploadStatus === 'success' ? 'opacity-50' : ''}
                `}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleInputChange}
                accept=".json,application/json"
                className="hidden"
                disabled={uploadStatus === 'loading' || uploadStatus === 'success'}
              />

              {!uploadStats ? (
                // No file selected yet
                <div className="space-y-3">
                  <Upload className={`mx-auto h-10 w-10 
                    ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} />
                  <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    Drag & drop your JSON file here, or{' '}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={`font-medium 
                        ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} 
                        hover:underline`}
                      disabled={uploadStatus === 'loading' || uploadStatus === 'success'}
                    >
                      browse
                    </button>
                  </p>
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    JSON files only (.json) - Maximum file size: 100MB
                  </p>
                </div>
              ) : (
                // File selected, show stats
                <div className="space-y-3">
                  <div className={`flex items-center justify-center text-sm font-medium 
                    ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                    <Check className={`mr-2 h-5 w-5 
                      ${theme === 'dark' ? 'text-green-400' : 'text-green-500'}`} />
                    File ready for upload
                  </div>

                  <div className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                    <p>Total objects: <span className="font-medium">{uploadStats.totalObjects}</span></p>
                    <p>With embedding: <span className="font-medium">{uploadStats.withEmbedding}</span></p>
                    <p>With event list: <span className="font-medium">{uploadStats.withEventList}</span></p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setUploadStats(null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                        (fileInputRef.current as any).jsonData = null;
                      }
                    }}
                    className={`text-xs underline 
                      ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                    disabled={uploadStatus === 'loading' || uploadStatus === 'success'}
                  >
                    Select a different file
                  </button>
                </div>
              )}
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className={`mb-4 p-3 rounded-md flex items-start 
                ${theme === 'dark' ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-700'}`}>
                <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{errorMessage}</p>
                  {validationErrors.length > 0 && (
                    <ul className="mt-2 text-sm list-disc list-inside">
                      {validationErrors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Success Message */}
            {uploadStatus === 'success' && (
              <div className={`mb-4 p-3 rounded-md flex items-center 
                ${theme === 'dark' ? 'bg-green-900/20 text-green-400' : 'bg-green-50 text-green-700'}`}>
                <Check className="w-5 h-5 mr-2" />
                <p>Dataset uploaded successfully!</p>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className={`px-4 py-2 text-sm font-medium rounded-md 
                  ${theme === 'dark' 
                    ? 'text-gray-300 bg-[#0D0C22] hover:bg-[#1A1832]' 
                    : 'text-gray-700 bg-gray-100 hover:bg-gray-200'}`}
                disabled={uploadStatus === 'loading' || uploadStatus === 'success'}
              >
                Cancel
              </button>

              <button
                type="submit"
                className={`px-4 py-2 text-sm font-medium rounded-md 
                  ${theme === 'dark' 
                    ? 'bg-[#1E1A3C] text-[#00E0FF] hover:bg-[#2A2850]' 
                    : 'bg-blue-600 text-white hover:bg-blue-700'}
                  ${(uploadStatus === 'loading' || uploadStatus === 'success') 
                    ? 'opacity-50 cursor-not-allowed' 
                    : ''}`}
                disabled={uploadStatus === 'loading' || uploadStatus === 'success' || !uploadStats}
              >
                {uploadStatus === 'loading' ? (
                  <span className="flex items-center">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </span>
                ) : uploadStatus === 'success' ? (
                  <span className="flex items-center">
                    <Check className="w-4 h-4 mr-2" />
                    Uploaded
                  </span>
                ) : (
                  'Upload Dataset'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Help Modal */}
      <UploadHelp
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
      />
    </div>
  );
}