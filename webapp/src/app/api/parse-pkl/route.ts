import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

// Python script as a string - this will be passed to Python via stdin
const PYTHON_SCRIPT = `
import pickle
import sys
import json
import numpy as np
import base64
import io

# Custom JSON encoder to handle NumPy types
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        return super(NumpyEncoder, self).default(obj)

def parse_pkl_from_base64(base64_data):
    try:
        # Decode base64 to bytes
        pkl_bytes = base64.b64decode(base64_data)
        
        # Use BytesIO to create a file-like object in memory
        pkl_file = io.BytesIO(pkl_bytes)
        
        # Load pickle from the in-memory file
        data = pickle.load(pkl_file)
        
        return process_data(data)
    except Exception as e:
        return {"error": f"Failed to parse pickle data: {str(e)}"}

def process_data(data):
    # Handle different data structures
    result = []
    
    # Case 1: Data is a list of dictionaries with event_list
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and 'event_list' in item:
                result.append(item)
    
    # Case 2: Data is a dictionary with event_list
    elif isinstance(data, dict) and 'event_list' in data:
        result.append(data)
    
    # Case 3: Data is a dictionary with sources/objects as values
    elif isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, dict) and 'event_list' in value:
                # Add the key as 'name' if not already present
                if 'name' not in value:
                    value['name'] = key
                result.append(value)
    
    return result

# Read base64 data from stdin
base64_data = sys.stdin.read().strip()
result = parse_pkl_from_base64(base64_data)

# Output result as JSON
print(json.dumps(result, cls=NumpyEncoder))
`;

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Check file type
    if (!file.name.endsWith('.pkl')) {
      return NextResponse.json({ error: 'Only .pkl files are accepted' }, { status: 400 });
    }

    // Read the file into memory
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Convert to base64 for safe passing to Python
    const base64Data = buffer.toString('base64');

    // Use child_process.spawn to run Python and pass data via stdin
    const pythonProcess = spawn(process.env.PYTHON_PATH || 'python3', ['-c', PYTHON_SCRIPT]);

    // Set up promise to collect output
    const outputPromise = new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Collect stdout data
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr data
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Python process exited with code ${code}\n${stderr}`));
        }
      });

      // Handle process errors
      pythonProcess.on('error', (err) => {
        reject(err);
      });
    });

    // Send the base64 data to the Python process
    pythonProcess.stdin.write(base64Data);
    pythonProcess.stdin.end();

    // Wait for the Python process to complete
    const { stdout, stderr } = await outputPromise;

    if (stderr) {
      console.warn('Python stderr:', stderr);
    }

    // Parse JSON output
    let parsedData;
    try {
      parsedData = JSON.parse(stdout);
    } catch (e) {
      console.error('Error parsing Python output:', stdout);
      return NextResponse.json({ error: 'Failed to parse Python script output' }, { status: 500 });
    }

    // Check if we got an error from the Python script
    if (parsedData && parsedData.error) {
      return NextResponse.json({ error: parsedData.error }, { status: 400 });
    }

    // Check if we have valid data
    if (!Array.isArray(parsedData) || parsedData.length === 0) {
      return NextResponse.json({ error: 'No valid event list data found in the file' }, { status: 400 });
    }

    // Validate each source has an event_list property
    for (const source of parsedData) {
      if (!source.event_list || !Array.isArray(source.event_list) || source.event_list.length === 0) {
        return NextResponse.json({ error: 'Invalid event list data format' }, { status: 400 });
      }
    }

    // Return the parsed data
    return NextResponse.json(parsedData);

  } catch (error) {
    console.error('Error processing pkl file:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process the uploaded file' },
      { status: 500 }
    );
  }
}

// Define config for the route to increase body limit
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '8mb',
  },
};