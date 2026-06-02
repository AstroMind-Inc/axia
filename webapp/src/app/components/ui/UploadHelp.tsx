"use client";

import { useState } from 'react';
import { Copy, X, Info, Check } from 'lucide-react';
import { useSettings } from '@/app/context/SettingsContext';

interface UploadHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UploadHelp({ isOpen, onClose }: UploadHelpProps) {
  const { theme } = useSettings();
  const [copied, setCopied] = useState(false);

  const sampleJson = `[
  {
    "obsid": 12345,
    "source_name": "Example Source 1",
    "source_type": "STAR",
    "ra": 83.63322,
    "dec": -5.39159,
    "embedding": [0.123, 0.456, 0.789, -0.123, -0.456, -0.789],
    "answer": "This is an example stellar source with moderate flux."
  },
  {
    "obsid": 67890,
    "source_name": "Example Source 2",
    "source_type": "QSO",
    "ra": 149.88204,
    "dec": 2.40553,
    "event_list": [1678945.23, 1678945.35, 1678945.41, 1678945.52],
    "answer": "This is an example quasar source with high energy observations."
  }
]`;

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(sampleJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4 text-center">
        {/* Backdrop */}
        <div
          className="fixed inset-0 transition-opacity bg-black bg-opacity-50"
          onClick={onClose}
        />

        {/* Modal */}
        <div className={`inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform 
          ${theme === 'dark' ? 'bg-[#111125] border border-gray-700' : 'bg-white border border-gray-200'}
          rounded-lg shadow-xl relative`}>

          {/* Close button */}
          <button
            onClick={onClose}
            className={`absolute top-3 right-3 p-1 rounded-full 
              ${theme === 'dark' ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="mb-5">
            <h3 className={`text-lg font-medium leading-6 
              ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              JSON Upload Guide
            </h3>
            <p className={`mt-1 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              Learn how to format your JSON data for upload
            </p>
          </div>

          {/* Content */}
          <div className="space-y-4">
            <div className={`p-3 rounded-md 
              ${theme === 'dark' ? 'bg-blue-900/20 border border-blue-800/30' : 'bg-blue-50 border border-blue-100'}`}>
              <div className="flex">
                <Info className={`h-5 w-5 mr-2 flex-shrink-0 mt-0.5 
                  ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
                <div>
                  <p className={`text-sm font-medium 
                    ${theme === 'dark' ? 'text-blue-300' : 'text-blue-700'}`}>
                    Required JSON Format
                  </p>
                  <p className={`text-sm mt-1 
                    ${theme === 'dark' ? 'text-blue-200' : 'text-blue-600'}`}>
                    Upload a JSON file with either a single object or an array of objects. Each object must include:
                  </p>
                </div>
              </div>

              <ul className={`mt-2 text-sm list-disc list-inside ml-5 
                ${theme === 'dark' ? 'text-blue-200' : 'text-blue-600'}`}>
                <li><strong>obsid</strong>: A unique identifier for the observation (number)</li>
                <li><strong>source_name</strong>: Name of the astronomical source (string)</li>
                <li>
                  Either <strong>embedding</strong> (for embedding models) or <strong>event_list</strong> (for event models):
                  <ul className="list-disc list-inside ml-5 mt-1">
                    <li><strong>embedding</strong>: Array of floating point numbers (vector)</li>
                    <li><strong>event_list</strong>: Array of time points (numbers)</li>
                  </ul>
                </li>
                <li><em>Optional:</em> source_type, ra, dec, answer, and other metadata</li>
              </ul>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className={`text-sm font-medium 
                  ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                  Sample JSON
                </h4>
                <button
                  onClick={handleCopy}
                  className={`flex items-center text-xs px-2 py-1 rounded 
                    ${theme === 'dark' 
                      ? 'bg-[#1A1832] text-[#00E0FF] hover:bg-[#2A2850]' 
                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      Copy
                    </>
                  )}
                </button>
              </div>

              <pre className={`p-3 rounded-md overflow-x-auto text-xs 
                ${theme === 'dark' 
                  ? 'bg-[#0D0C22] text-gray-300 border border-gray-700' 
                  : 'bg-gray-50 text-gray-700 border border-gray-200'}`}>
                {sampleJson}
              </pre>
            </div>

            <div className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <h4 className="font-medium mb-2">Tips:</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>For single object uploads, you can omit the outer array brackets</li>
                <li>Different models require different data: some need embeddings, others need event lists</li>
                <li>Ensure all numerical values are properly formatted (no quotes around numbers)</li>
                <li>For best results, include as much metadata as possible</li>
              </ul>
            </div>
          </div>

          {/* Button */}
          <div className="mt-5 flex justify-end">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-medium rounded-md 
                ${theme === 'dark' 
                  ? 'bg-[#1E1A3C] text-[#00E0FF] hover:bg-[#2A2850]' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}